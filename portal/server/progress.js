// Persistent learner progress and the session state machine.
//
// Stored facts (progress.json): when a session was started, every hint
// revealed, the latest checker observation, the completion snapshot and the
// learner's self-assessment. Everything else (state, XP, coins, rank) is
// derived, so a completion can only come from a recorded passing observation.
import fs from 'node:fs';
import path from 'node:path';

export const STATES = ['AVAILABLE', 'IN_PROGRESS', 'CHECKING', 'BLOCKED', 'FAILED', 'COMPLETED'];
export const BLOCKED_REASONS = [
  'locked',               // previous session not completed yet
  'platform_stopped',     // e.g. AKS stopped
  'missing_prerequisite', // tool, layer or resource that does not exist
  'auth_error',           // not signed in / token expired / wrong subscription
  'validation_error',     // the checker itself failed (bug, timeout, bad output)
];
const ASSESSMENT_KEYS = ['english', 'autonomy', 'tradeoffs'];

function emptyProgress() {
  return { version: 1, sessions: {} };
}

export class ProgressStore {
  constructor({ dataDir, catalog, unlockAll = false }) {
    this.file = path.join(dataDir, 'progress.json');
    this.dataDir = dataDir;
    this.catalog = catalog;
    this.unlockAll = unlockAll;
    this.data = emptyProgress();
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed.version !== 1 || typeof parsed.sessions !== 'object') throw new Error(`unsupported progress file ${this.file}`);
      this.data = parsed;
    }
    return this;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  record(id) {
    if (!this.data.sessions[id]) this.data.sessions[id] = { hints: [], attempts: 0 };
    return this.data.sessions[id];
  }

  peek(id) {
    return this.data.sessions[id] ?? { hints: [], attempts: 0 };
  }

  isUnlocked(id) {
    if (this.unlockAll) return true;
    const session = this.catalog.byId.get(id);
    if (session.number === 1) return true;
    const previous = this.catalog.sessions[session.number - 2];
    return Boolean(this.peek(previous.id).completedAt);
  }

  // Derives the state shown to the learner. `running` = a checker run is in
  // flight; `envBlock` = an environment requirement that is not met right now.
  stateOf(id, { running = false, envBlock = null } = {}) {
    const rec = this.peek(id);
    if (rec.completedAt) return { state: 'COMPLETED', reason: null };
    if (!this.isUnlocked(id)) return { state: 'BLOCKED', reason: 'locked' };
    if (!rec.startedAt) return { state: 'AVAILABLE', reason: null };
    if (running) return { state: 'CHECKING', reason: null };
    if (envBlock) return { state: 'BLOCKED', reason: envBlock };
    const obs = rec.lastObservation;
    if (!obs) return { state: 'IN_PROGRESS', reason: null };
    switch (obs.outcome) {
      case 'fail': return { state: 'FAILED', reason: null };
      case 'blocked': return { state: 'BLOCKED', reason: obs.blockedReason };
      case 'error': return { state: 'BLOCKED', reason: 'validation_error' };
      default: return { state: 'IN_PROGRESS', reason: null }; // cancelled / not run
    }
  }

  start(id) {
    if (!this.isUnlocked(id)) throw new UserError('This session is locked: complete the previous session first.');
    const rec = this.record(id);
    if (rec.completedAt) throw new UserError('This session is already completed.');
    if (!rec.startedAt) {
      rec.startedAt = new Date().toISOString();
      this.save();
    }
    return rec;
  }

  // Reveals the next hint. Any hint before completion makes the attempt AI-assisted.
  revealHint(id) {
    const session = this.catalog.byId.get(id);
    const rec = this.peek(id);
    if (!rec.startedAt) throw new UserError('Start the session before asking for hints.');
    const next = rec.hints.length;
    if (next >= session.hints.length) throw new UserError('All hints are already revealed.');
    const stored = this.record(id);
    stored.hints.push({ level: next + 1, at: new Date().toISOString(), afterCompletion: Boolean(rec.completedAt) });
    this.save();
    return { level: next + 1, text: session.hints[next] };
  }

  setAiAssisted(id, value) {
    const rec = this.peek(id);
    if (!rec.startedAt) throw new UserError('Start the session first.');
    if (rec.completedAt) throw new UserError('The mode is frozen once the session is completed.');
    this.record(id).aiAssisted = Boolean(value);
    this.save();
  }

  setAssessment(id, input) {
    const rec = this.peek(id);
    if (!rec.completedAt) throw new UserError('Self-assessment opens after the technical validation passes.');
    const assessment = {};
    for (const key of ASSESSMENT_KEYS) {
      const v = input[key];
      if (!Number.isInteger(v) || v < 0 || v > 2) throw new UserError(`"${key}" must be 0, 1 or 2.`);
      assessment[key] = v;
    }
    const notes = input.notes ?? '';
    if (typeof notes !== 'string' || notes.length > 1000) throw new UserError('"notes" must be a string up to 1000 characters.');
    assessment.notes = notes;
    assessment.at = new Date().toISOString();
    this.record(id).assessment = assessment;
    this.save();
    return assessment;
  }

  // Stores a checker observation. Returns { completed: true, rewards } exactly
  // once: on the first passing observation of a started, unlocked session.
  recordObservation(id, observation) {
    const rec = this.record(id);
    rec.lastObservation = observation;
    if (observation.outcome !== 'cancelled') rec.attempts = (rec.attempts ?? 0) + 1;
    let result = { completed: false };
    if (observation.outcome === 'pass' && !rec.completedAt && rec.startedAt && this.isUnlocked(id)) {
      const session = this.catalog.byId.get(id);
      const hintsBefore = rec.hints.filter((h) => !h.afterCompletion).length;
      const mode = hintsBefore === 0 && !rec.aiAssisted ? 'SOLO' : 'AI_ASSISTED';
      rec.completedAt = observation.at;
      rec.completion = {
        at: observation.at,
        mode,
        hintsUsed: hintsBefore,
        revision: observation.revision,
        criteria: observation.criteria,
        validationMode: this.unlockAll,
        rewards: rewardsFor(session, mode, hintsBefore),
      };
      result = { completed: true, rewards: rec.completion.rewards, mode };
    }
    this.save();
    return result;
  }

  totals() {
    let xp = 0;
    let coins = 0;
    let completed = 0;
    for (const s of this.catalog.sessions) {
      const c = this.peek(s.id).completion;
      if (c) {
        xp += c.rewards.xp;
        coins += c.rewards.coins;
        completed += 1;
      }
    }
    const ranks = this.catalog.track.ranks;
    let rank = ranks[0];
    let nextRank = null;
    for (let i = 0; i < ranks.length; i++) {
      if (xp >= ranks[i].minXp) {
        rank = ranks[i];
        nextRank = ranks[i + 1] ?? null;
      }
    }
    const badges = this.catalog.track.cycles
      .filter((cycle) => this.catalog.sessions.filter((s) => s.cycle === cycle.id).every((s) => this.peek(s.id).completedAt))
      .map((cycle) => ({ id: `cycle-${cycle.id}`, title: cycle.badge }));
    return { xp, coins, completed, rank, nextRank, badges };
  }
}

export function rewardsFor(session, mode, hintsUsed) {
  const xp = session.difficulty * 100;
  const base = session.difficulty * 10;
  const coins = Math.max(1, (mode === 'SOLO' ? base * 2 : base) - hintsUsed * 2);
  return { xp, coins };
}

export class UserError extends Error {}
