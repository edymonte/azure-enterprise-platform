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
const HISTORY_LIMIT = 20;

function emptyProgress() {
  return { version: 1, sessions: {} };
}

export class ProgressStore {
  constructor({ dataDir, catalog, unlockAll = false, scheduledSessions = new Set() }) {
    this.file = path.join(dataDir, 'progress.json');
    this.dataDir = dataDir;
    this.catalog = catalog;
    this.unlockAll = unlockAll;
    // Sessions placed on the dated schedule are unlocked by the plan itself.
    this.scheduledSessions = scheduledSessions;
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
    if (this.unlockAll || this.scheduledSessions.has(id)) return true;
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
    this.bump('hints');
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
    // Compact run log for the evidence console (evidence text stays in lastObservation only).
    rec.history = [...(rec.history ?? []), {
      at: observation.at,
      outcome: observation.outcome,
      blockedReason: observation.blockedReason ?? null,
      trigger: observation.trigger ?? null,
      durationMs: observation.durationMs ?? null,
      revision: observation.revision ?? null,
      summary: observation.summary ?? '',
      criteria: (observation.criteria ?? []).map((c) => ({ id: c.id, status: c.status })),
    }].slice(-HISTORY_LIMIT);
    if (observation.outcome !== 'cancelled') {
      rec.attempts = (rec.attempts ?? 0) + 1;
      this.bump('checks');
    }
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
      this.bump('completions');
    }
    this.save();
    return result;
  }

  // Daily activity counters for the progress charts (local date).
  bump(kind) {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.data.activity ??= {};
    const day = this.data.activity[key] ?? { checks: 0, completions: 0, hints: 0, interview: 0, study: 0 };
    day[kind] = (day[kind] ?? 0) + 1;
    this.data.activity[key] = day;
  }

  // Last `days` days (oldest first) and cumulative XP per day.
  timeline(days = 30) {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const completions = [
      ...this.catalog.sessions.map((s) => this.peek(s.id).completion).filter(Boolean),
      ...Object.values(this.az400().completions),
    ].map((c) => ({ t: new Date(c.at).getTime(), xp: c.rewards.xp }));
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const end = d.getTime() + 86400000;
      const xp = completions.filter((c) => c.t < end).reduce((a, c) => a + c.xp, 0);
      out.push({ date: key, xp, checks: 0, completions: 0, hints: 0, interview: 0, study: 0, steps: 0, ...(this.data.activity?.[key] ?? {}) });
    }
    return out;
  }

  // Personal course links (e.g. a lesson in a paid training platform). Kept in
  // their own file in the data dir — never in the repository catalog.
  get linksFile() {
    return path.join(this.dataDir, 'links.json');
  }

  links() {
    if (this.linksCache) return this.linksCache;
    try {
      this.linksCache = JSON.parse(fs.readFileSync(this.linksFile, 'utf8'));
    } catch {
      this.linksCache = {};
    }
    return this.linksCache;
  }

  isLinkTarget(target) {
    return this.catalog.byId.has(target) || this.catalog.studyPlan.itemIds.has(target) || /^az400-([0-2][0-9]|prep)$/.test(target);
  }

  addLink(target, label, url) {
    if (!this.isLinkTarget(target)) throw new UserError('Unknown session or study item.');
    if (typeof label !== 'string' || !label.trim() || label.length > 80) throw new UserError('"label" must be 1–80 characters.');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new UserError('"url" must be a valid URL.');
    }
    if (parsed.protocol !== 'https:' || url.length > 500) throw new UserError('Only https:// links up to 500 characters are accepted.');
    const all = this.links();
    const list = all[target] ?? [];
    if (list.length >= 10) throw new UserError('At most 10 links per item.');
    list.push({ label: label.trim(), url: parsed.href, at: new Date().toISOString() });
    all[target] = list;
    this.saveLinks();
  }

  removeLink(target, index) {
    const list = this.links()[target];
    if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) throw new UserError('Unknown link.');
    list.splice(index, 1);
    this.saveLinks();
  }

  saveLinks() {
    const tmp = `${this.linksFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.links(), null, 2));
    fs.renameSync(tmp, this.linksFile);
  }

  // Self-tracked: ticked by the learner, never used for unlocking sessions.
  setStudyItem(itemId, done) {
    if (!this.catalog.studyPlan.itemIds.has(itemId)) throw new UserError('Unknown study item.');
    if (typeof done !== 'boolean') throw new UserError('"done" must be a boolean.');
    this.data.study ??= {};
    this.data.study[itemId] = { done, at: new Date().toISOString() };
    if (done) this.bump('study');
    this.save();
  }

  recordInterviewPractice(id) {
    this.data.interview ??= {};
    const rec = this.data.interview[id] ?? { passes: 0 };
    rec.passes += 1;
    rec.lastAt = new Date().toISOString();
    this.data.interview[id] = rec;
    this.bump('interview');
    this.save();
    return rec;
  }

  // ---------------------------------------------------------------- AZ-400
  // Steps and the question score are self-tracked; a lab is COMPLETED only
  // when the course's own Validate.ps1 wrote a passing validation.json.
  az400() {
    this.data.az400 ??= { steps: {}, scores: {}, run: 'vacation', completions: {} };
    return this.data.az400;
  }

  setAz400Step(labId, key, done) {
    if (!/^([0-2][0-9]|prep)$/.test(labId) || !/^[a-z0-9]{1,12}$/.test(key)) throw new UserError('Unknown lab step.');
    if (typeof done !== 'boolean') throw new UserError('"done" must be a boolean.');
    const a = this.az400();
    if (done) {
      a.steps[`${labId}:${key}`] = new Date().toISOString();
      this.bump('steps');
    } else delete a.steps[`${labId}:${key}`];
    this.save();
  }

  setAz400Score(labId, value) {
    if (!/^[0-2][0-9]$/.test(labId)) throw new UserError('Unknown lab.');
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw new UserError('Score must be 0–100 or empty.');
    const a = this.az400();
    if (value === null) delete a.scores[labId];
    else a.scores[labId] = Math.round(value);
    this.save();
  }

  // A graded quiz attempt: the latest percentage becomes the lab's score.
  recordAz400Quiz(labId, result) {
    if (!/^[0-2][0-9]$/.test(labId)) throw new UserError('Unknown lab.');
    const a = this.az400();
    a.quizzes ??= {};
    const list = a.quizzes[labId] ?? [];
    list.push({ at: new Date().toISOString(), correct: result.correct, total: result.total, pct: result.pct, wrong: result.wrong });
    a.quizzes[labId] = list.slice(-20);
    a.scores[labId] = result.pct;
    this.bump('quiz');
    this.save();
    return a.quizzes[labId];
  }

  setAz400Run(suffix) {
    if (typeof suffix !== 'string' || !/^[a-z0-9-]{1,16}$/.test(suffix)) throw new UserError('Run suffix: 1–16 lowercase letters, digits or hyphens.');
    this.az400().run = suffix;
    this.save();
  }

  // Called when the course evidence changes. Returns newly completed labs.
  recordAz400Evidence(evidence, labs) {
    const a = this.az400();
    const fresh = [];
    for (const lab of labs) {
      const ev = evidence[lab.id];
      if (!ev || ev.status !== 'passed' || a.completions[lab.id]) continue;
      const capstone = lab.domain === 'capstone';
      const rewards = { xp: capstone ? 300 : 150, coins: capstone ? 30 : 15 };
      a.completions[lab.id] = { at: ev.verifiedAt ?? new Date().toISOString(), runId: ev.runId, rewards };
      this.bump('completions');
      fresh.push({ lab, rewards });
    }
    if (fresh.length) this.save();
    return fresh;
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
    for (const c of Object.values(this.az400().completions)) {
      xp += c.rewards.xp;
      coins += c.rewards.coins;
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
