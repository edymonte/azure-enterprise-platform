// Runs the registered checker of a session as a separate, read-only process.
//
// Guarantees: one run per checker at a time (extra triggers coalesce into a
// single re-run), a hard timeout that kills the whole process tree,
// cancellation, polling for external services with exponential backoff on
// non-definitive outcomes, and a strict output contract (see CONTRACT.md).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { killTree, runCommand } from '../lib/exec.js';
import { redact } from '../lib/redact.js';
import { BLOCKED_REASONS } from './progress.js';

export const CHECKER_SCHEMA = 'portal.checker/v1';
const OUTCOMES = new Set(['pass', 'fail', 'blocked', 'error']);
const CRITERION_STATUS = new Set(['pass', 'fail', 'skipped']);
const CHECKER_BLOCK_REASONS = new Set(BLOCKED_REASONS.filter((r) => r !== 'locked' && r !== 'validation_error'));
const MAX_OUTPUT = 512 * 1024;
const MAX_EVIDENCE = 4000;

// Parses and validates checker stdout. Anything off-contract becomes an
// internal validation error — never a pass.
export function parseCheckerOutput(stdout, session) {
  const line = stdout.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) return { outcome: 'error', summary: 'Checker printed no JSON result.', criteria: [] };
  let raw;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    return { outcome: 'error', summary: `Checker output is not valid JSON (${err.message}).`, criteria: [] };
  }
  if (raw.schema !== CHECKER_SCHEMA || !OUTCOMES.has(raw.outcome) || !Array.isArray(raw.criteria)) {
    return { outcome: 'error', summary: 'Checker output does not follow portal.checker/v1.', criteria: [] };
  }
  const known = new Map(session.criteria.map((c) => [c.id, c]));
  const criteria = [];
  for (const c of raw.criteria) {
    if (!known.has(c.id) || !CRITERION_STATUS.has(c.status)) {
      return { outcome: 'error', summary: `Checker reported an unknown criterion or status ("${c.id}").`, criteria: [] };
    }
    criteria.push({
      id: c.id,
      status: c.status,
      evidence: redact(String(c.evidence ?? '')).slice(0, MAX_EVIDENCE),
      reason: c.reason ? redact(String(c.reason)).slice(0, 500) : undefined,
    });
  }
  let outcome = raw.outcome;
  let blockedReason;
  if (outcome === 'blocked') {
    blockedReason = CHECKER_BLOCK_REASONS.has(raw.blockedReason) ? raw.blockedReason : null;
    if (!blockedReason) return { outcome: 'error', summary: `Checker returned an invalid blockedReason ("${raw.blockedReason}").`, criteria };
  }
  // A pass must prove every catalog criterion; a partial pass is not a pass.
  if (outcome === 'pass') {
    const passed = new Set(criteria.filter((c) => c.status === 'pass').map((c) => c.id));
    const missing = session.criteria.filter((c) => !passed.has(c.id)).map((c) => c.id);
    if (missing.length) return { outcome: 'error', summary: `Checker reported pass without passing: ${missing.join(', ')}.`, criteria };
  }
  return { outcome, blockedReason, summary: redact(String(raw.summary ?? '')).slice(0, 500), criteria };
}

export class Runner extends EventEmitter {
  constructor({ config, catalog, probe }) {
    super();
    this.config = config;
    this.catalog = catalog;
    this.probe = probe;
    this.running = new Map();   // id -> { child, startedAt, cancelled }
    this.pending = new Map();   // id -> reason of the coalesced re-run
    this.timers = new Map();    // id -> poll timer
    this.failures = new Map();  // id -> consecutive non-definitive outcomes
    this.stopped = false;
  }

  isRunning(id) {
    return this.running.has(id);
  }

  async revision() {
    const head = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.config.repoRoot, timeoutMs: 10000 });
    const sha = await runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.config.repoRoot, timeoutMs: 10000 });
    const dirty = await runCommand('git', ['status', '--porcelain'], { cwd: this.config.repoRoot, timeoutMs: 15000 });
    return {
      branch: head.code === 0 ? head.stdout.trim() : null,
      commit: sha.code === 0 ? sha.stdout.trim() : null,
      dirty: dirty.code === 0 ? dirty.stdout.trim().length > 0 : null,
    };
  }

  // Requests a run. Returns false when the session has no runnable checker.
  trigger(id, reason) {
    const session = this.catalog.byId.get(id);
    if (!session || session.checker.status !== 'implemented' || this.stopped) return false;
    if (this.running.has(id)) {
      this.pending.set(id, reason);
      return true;
    }
    this.execute(session, reason);
    return true;
  }

  cancel(id) {
    const run = this.running.get(id);
    if (!run) return false;
    run.cancelled = true;
    this.pending.delete(id);
    killTree(run.child);
    return true;
  }

  async execute(session, reason) {
    const id = session.id;
    const startedAt = Date.now();
    const run = { child: null, startedAt, cancelled: false, timedOut: false };
    this.running.set(id, run);
    this.emit('started', { id, reason, at: new Date(startedAt).toISOString() });

    let observation;
    const envBlock = this.probe.blockFor(session);
    if (envBlock) {
      observation = {
        outcome: 'blocked',
        blockedReason: envBlock,
        summary: 'Checker not started: the environment does not meet this session\'s prerequisites.',
        criteria: [],
      };
    } else {
      observation = await this.spawnChecker(session, run);
    }
    observation.at = new Date().toISOString();
    observation.durationMs = Date.now() - startedAt;
    observation.trigger = reason;
    observation.revision = await this.revision();

    this.running.delete(id);
    this.updateBackoff(id, observation);
    this.emit('finished', { id, observation });

    if (this.pending.has(id) && !this.stopped) {
      const next = this.pending.get(id);
      this.pending.delete(id);
      this.trigger(id, `${next} (coalesced)`);
    }
  }

  spawnChecker(session, run) {
    return new Promise((resolve) => {
      const script = path.join(this.config.portalRoot, session.checker.script);
      const child = spawn(process.execPath, [script], {
        cwd: this.config.repoRoot,
        env: { ...process.env, PORTAL_REPO_ROOT: this.config.repoRoot, PORTAL_SESSION_ID: session.id, PORTAL_DATA_DIR: this.config.dataDir },
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      run.child = child;
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        run.timedOut = true;
        killTree(child);
      }, session.checker.timeoutSeconds * 1000);
      child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
      child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ outcome: 'error', summary: `Could not start checker: ${err.message}`, criteria: [] });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (run.cancelled) return resolve({ outcome: 'cancelled', summary: 'Check cancelled by the learner.', criteria: [] });
        if (run.timedOut) return resolve({ outcome: 'error', summary: `Checker timed out after ${session.checker.timeoutSeconds}s.`, criteria: [] });
        const parsed = parseCheckerOutput(stdout, session);
        if (parsed.outcome === 'error' && code !== 0 && stderr.trim()) {
          parsed.summary = `${parsed.summary} stderr: ${redact(stderr.trim().split(/\r?\n/).slice(-3).join(' | ')).slice(0, 400)}`;
        }
        resolve(parsed);
      });
    });
  }

  updateBackoff(id, observation) {
    const definitive = ['pass', 'fail', 'cancelled'].includes(observation.outcome)
      || (observation.outcome === 'blocked' && observation.blockedReason === 'platform_stopped');
    this.failures.set(id, definitive ? 0 : (this.failures.get(id) ?? 0) + 1);
  }

  pollDelaySeconds(session) {
    const base = this.config.pollSecondsOverride || session.checker.pollSeconds;
    if (!base) return 0;
    const n = this.failures.get(session.id) ?? 0;
    return Math.min(base * 2 ** n, this.config.maxBackoffSeconds);
  }

  // (Re)arms the polling timer of a session. Called after every run and when
  // a session becomes active.
  schedulePoll(id, isActive) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const session = this.catalog.byId.get(id);
    if (!isActive || this.stopped || session.checker.status !== 'implemented') return null;
    const delay = this.pollDelaySeconds(session);
    if (!delay) return null;
    const timer = setTimeout(() => this.trigger(id, 'poll'), delay * 1000);
    timer.unref?.();
    this.timers.set(id, timer);
    return new Date(Date.now() + delay * 1000).toISOString();
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const id of [...this.running.keys()]) this.cancel(id);
  }
}
