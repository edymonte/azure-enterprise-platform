// Helpers shared by checkers. A checker is a read-only Node script that prints
// exactly one JSON line following portal.checker/v1 (see portal/CONTRACT.md).
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../lib/exec.js';

export const SCHEMA = 'portal.checker/v1';

export function repoRoot() {
  return path.resolve(process.env.PORTAL_REPO_ROOT ?? process.cwd());
}

export class Result {
  constructor() {
    this.criteria = [];
    this.blockedReason = null;
    this.summary = '';
  }

  pass(id, evidence) {
    this.criteria.push({ id, status: 'pass', evidence });
  }

  fail(id, evidence, reason) {
    this.criteria.push({ id, status: 'fail', evidence, reason });
  }

  check(id, ok, evidence, reason) {
    if (ok) this.pass(id, evidence);
    else this.fail(id, evidence, reason);
    return ok;
  }

  // A criterion that could not be evaluated because of the environment.
  skip(id, blockedReason, reason) {
    this.criteria.push({ id, status: 'skipped', reason });
    this.blockedReason ??= blockedReason;
  }

  outcome() {
    if (this.criteria.some((c) => c.status === 'fail')) return 'fail';
    if (this.criteria.some((c) => c.status === 'skipped')) return this.blockedReason ? 'blocked' : 'error';
    return this.criteria.length ? 'pass' : 'error';
  }

  emit(summary) {
    const outcome = this.outcome();
    const out = { schema: SCHEMA, outcome, summary: summary ?? this.summary, criteria: this.criteria };
    if (outcome === 'blocked') out.blockedReason = this.blockedReason;
    process.stdout.write(`${JSON.stringify(out)}\n`);
  }
}

// Runs the checker body and turns any crash into an "error" outcome (never a pass).
export async function runChecker(body) {
  const result = new Result();
  try {
    const summary = await body(result);
    result.emit(summary);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ schema: SCHEMA, outcome: 'error', summary: `Checker crashed: ${err.message}`, criteria: result.criteria })}\n`);
  }
}

export function readText(rel) {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

export async function git(args) {
  return runCommand('git', args, { cwd: repoRoot(), timeoutMs: 20000 });
}

// Azure CLI, read-only calls only. PORTAL_FAKE_AZ points tests at a fake CLI.
export async function az(args, { timeoutMs = 60000 } = {}) {
  const fake = process.env.PORTAL_FAKE_AZ;
  const r = fake
    ? await runCommand(process.execPath, [fake, ...args, '-o', 'json'], { cwd: repoRoot(), timeoutMs })
    : await runCommand('az', [...args, '-o', 'json'], { cwd: repoRoot(), timeoutMs });
  const stderr = r.stderr ?? '';
  return {
    ok: r.code === 0 && !r.timedOut,
    json: r.code === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : null,
    notInstalled: r.error === 'not_installed',
    timedOut: r.timedOut,
    authError: /az login|AADSTS|expired|refresh token|not logged in|No subscription found/i.test(stderr),
    notFound: /NotFound|could not be found|was not found|does not exist/i.test(stderr),
    stderr: stderr.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300),
  };
}

// Common gate for Azure criteria: signed in, and on the lab subscription.
export async function azureGate() {
  const account = await az(['account', 'show']);
  if (account.notInstalled) return { blocked: 'missing_prerequisite', reason: 'Azure CLI (az) is not installed.' };
  if (account.timedOut) return { blocked: 'auth_error', reason: 'az account show timed out.' };
  if (!account.ok) return { blocked: 'auth_error', reason: `Not signed in to Azure: ${account.stderr || 'run az login'}` };
  let expected = null;
  try {
    expected = JSON.parse(readText('config/lab.settings.json')).subscriptionId ?? null;
  } catch {
    // Settings are optional for the gate; without them any subscription is accepted.
  }
  if (expected && account.json.id !== expected) {
    return { blocked: 'auth_error', reason: `Signed in to subscription "${account.json.name}", not the lab subscription from config/lab.settings.json.` };
  }
  return { blocked: null, account: account.json };
}
