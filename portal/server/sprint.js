// Recovery sprint progress. Stored in progress.json under "sprint" next to the
// sessions, so it survives restarts and can be resumed block by block.
//
// A block is COMPLETED only when every criterion passes:
//   checker — the latest run of the block's read-only checker passed it;
//   portal  — a fact the portal recorded (recall, attempts, English, feedback);
//   review  — an explicit review with pasted evidence and a named reviewer.
// Logged time never completes anything, and the sprint awards no XP.
import { UserError } from './progress.js';

const TEXT_MAX = 6000;
const HISTORY_LIMIT = 20;
const BLOCKER_KINDS = new Set(['environment', 'tool', 'access']);
const REVIEWERS = new Set(['self', 'instructor']);
const SCORE_KEYS = ['technical', 'autonomy', 'english'];
const MIN_ENGLISH_WORDS = 40;

function text(value, name, { min = 1, max = TEXT_MAX } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new UserError(`"${name}" must be ${min > 1 ? `at least ${min} characters` : 'non-empty'} (up to ${max}).`);
  }
  return value.trim();
}
const words = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

export class SprintTracker {
  constructor({ store, sprint, key = 'sprint' }) {
    this.store = store;
    this.sprint = sprint;
    this.key = key; // progress.json section: "sprint" or "gitflow"
  }

  get enabled() {
    return Boolean(this.sprint);
  }

  block(id) {
    const b = this.sprint?.byId.get(id);
    if (!b) throw new UserError('Unknown sprint block.');
    return b;
  }

  peek(id) {
    return this.store.data[this.key]?.blocks?.[id] ?? {};
  }

  rec(id) {
    this.store.data[this.key] ??= { blocks: {} };
    this.store.data[this.key].blocks[id] ??= {};
    return this.store.data[this.key].blocks[id];
  }

  started(id) {
    const r = this.peek(id);
    if (!r.startedAt) throw new UserError('Start the block first.');
    return this.rec(id);
  }

  save(id) {
    this.evaluate(id);
    this.store.save();
  }

  start(id) {
    this.block(id);
    const r = this.rec(id);
    if (!r.startedAt) {
      r.startedAt = new Date().toISOString();
      this.store.save();
    }
  }

  // Recall comes first and is frozen once submitted: it measures what you
  // remembered before reading anything.
  submitRecall(id, answers) {
    const b = this.block(id);
    const r = this.started(id);
    if (r.recall?.submittedAt) throw new UserError('Recall answers are already recorded.');
    if (!answers || typeof answers !== 'object') throw new UserError('"answers" must be an object.');
    const out = {};
    for (const q of b.recall) {
      const a = answers[q.id];
      if (typeof a !== 'string' || a.length > TEXT_MAX) throw new UserError(`Answer "${q.id}" must be text (write "I don't remember" if needed).`);
      out[q.id] = a.trim() || "I don't remember";
    }
    r.recall = { answers: out, submittedAt: new Date().toISOString() };
    this.store.bump('study');
    this.save(id);
  }

  step(id, stepId) {
    const s = this.block(id).steps.find((x) => x.id === stepId);
    if (!s) throw new UserError('Unknown step.');
    const r = this.started(id);
    if (!r.recall?.submittedAt) throw new UserError('Answer the recall questions first.');
    r.steps ??= {};
    r.steps[stepId] ??= { hints: 0 };
    return { s, st: r.steps[stepId], r };
  }

  saveAttempt(id, stepId, value) {
    const { st } = this.step(id, stepId);
    st.attempt = text(value, 'attempt', { min: 3 });
    st.attemptAt = new Date().toISOString();
    this.save(id);
  }

  revealHint(id, stepId) {
    const { s, st, r } = this.step(id, stepId);
    if (st.hints >= s.hints.length) throw new UserError('All hints for this step are already shown.');
    st.hints += 1;
    if (!r.completedAt) r.assistedBefore = true;
    this.store.bump('hints');
    this.save(id);
    return s.hints[st.hints - 1];
  }

  // The solution stays sealed until the learner's own attempt is recorded.
  revealSolution(id, stepId) {
    const { s, st, r } = this.step(id, stepId);
    if (!st.attempt) throw new UserError('Record your attempt first — the solution opens after it.');
    if (!st.solutionAt) {
      st.solutionAt = new Date().toISOString();
      if (!r.completedAt) r.assistedBefore = true;
      this.save(id);
    }
    return s.solution;
  }

  setAssisted(id, value) {
    if (typeof value !== 'boolean') throw new UserError('"value" must be a boolean.');
    const r = this.started(id);
    if (r.completedAt) throw new UserError('The mode is frozen once the block is completed.');
    r.aiAssisted = value;
    this.save(id);
  }

  recordReview(id, criterionId, input) {
    const c = this.block(id).criteria.find((x) => x.id === criterionId && x.verify === 'review');
    if (!c) throw new UserError('Unknown review criterion.');
    const r = this.started(id);
    if (!['pass', 'fail'].includes(input.verdict)) throw new UserError('"verdict" must be pass or fail.');
    if (!REVIEWERS.has(input.reviewer)) throw new UserError('"reviewer" must be self or instructor.');
    const review = {
      verdict: input.verdict,
      reviewer: input.reviewer,
      evidence: text(input.evidence, 'evidence', { min: 20 }),
      note: typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : '',
      at: new Date().toISOString(),
    };
    r.reviews ??= {};
    r.reviewLog = [...(r.reviewLog ?? []), { criterion: criterionId, verdict: review.verdict, reviewer: review.reviewer, at: review.at }].slice(-HISTORY_LIMIT);
    r.reviews[criterionId] = review;
    this.save(id);
  }

  recordEnglish(id, input) {
    const r = this.started(id);
    const answer = text(input.answer, 'answer', { min: 20 });
    if (words(answer) < MIN_ENGLISH_WORDS) throw new UserError(`Write what you said: at least ${MIN_ENGLISH_WORDS} words (60–90 seconds is about 150–220).`);
    const seconds = input.seconds === undefined || input.seconds === null || input.seconds === '' ? null : Number(input.seconds);
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 10 || seconds > 600)) throw new UserError('"seconds" must be 10–600.');
    r.english = { answer, spoken: Boolean(input.spoken), seconds, at: new Date().toISOString() };
    this.store.bump('interview');
    this.save(id);
  }

  recordFeedback(id, input) {
    const r = this.started(id);
    const scores = {};
    for (const key of SCORE_KEYS) {
      const v = input[key];
      if (!Number.isInteger(v) || v < 0 || v > 2) throw new UserError(`"${key}" must be 0, 1 or 2.`);
      scores[key] = v;
    }
    r.feedback = { ...scores, gaps: text(input.gaps, 'gaps', { min: 3 }), next: text(input.next, 'next', { min: 3 }), at: new Date().toISOString() };
    this.save(id);
  }

  logTime(id, minutes) {
    const r = this.started(id);
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 240) throw new UserError('"minutes" must be a whole number between -240 and 240 (not 0).');
    const total = (r.minutes ?? 0) + minutes;
    if (total < 0) throw new UserError('Logged time cannot go below zero.');
    r.minutes = total;
    this.store.save();
  }

  // Environment/tool/access blockers are kept apart from technical mistakes.
  addBlocker(id, input) {
    const r = this.started(id);
    if (!BLOCKER_KINDS.has(input.kind)) throw new UserError('"kind" must be environment, tool or access.');
    r.blockers = [...(r.blockers ?? []), { kind: input.kind, note: text(input.note, 'note', { min: 5, max: 1000 }), at: new Date().toISOString(), resolvedAt: null }];
    this.store.save();
  }

  resolveBlocker(id, index) {
    const r = this.started(id);
    const b = r.blockers?.[index];
    if (!Number.isInteger(index) || !b) throw new UserError('Unknown blocker.');
    if (b.resolvedAt) throw new UserError('Already resolved.');
    b.resolvedAt = new Date().toISOString();
    this.store.save();
  }

  recordObservation(id, observation) {
    const b = this.block(id);
    const r = this.rec(id);
    r.lastObservation = observation;
    const owner = new Map(b.criteria.map((c) => [c.id, c.owner]));
    r.history = [...(r.history ?? []), {
      at: observation.at,
      outcome: observation.outcome,
      blockedReason: observation.blockedReason ?? null,
      summary: observation.summary ?? '',
      learnerFails: (observation.criteria ?? []).filter((c) => c.status === 'fail' && owner.get(c.id) === 'learner').map((c) => c.id),
      environmentFails: (observation.criteria ?? []).filter((c) => c.status === 'fail' && owner.get(c.id) === 'environment').map((c) => c.id),
    }].slice(-HISTORY_LIMIT);
    this.save(id);
  }

  // ---------------------------------------------------------------- evaluation
  criteria(id) {
    const b = this.block(id);
    const r = this.peek(id);
    const observed = new Map((r.lastObservation?.criteria ?? []).map((c) => [c.id, c]));
    const blocked = r.lastObservation?.outcome === 'blocked';
    return b.criteria.map((c) => {
      const base = { id: c.id, text: c.text, verify: c.verify, owner: c.owner ?? 'learner', rule: c.rule ?? null, how: c.how ?? null };
      if (c.verify === 'checker') {
        const o = observed.get(c.id);
        if (!o) return { ...base, status: blocked ? 'blocked' : 'pending', evidence: null, reason: blocked ? r.lastObservation.summary : null, at: null };
        return { ...base, status: o.status === 'skipped' ? 'blocked' : o.status, evidence: o.evidence ?? '', reason: o.reason ?? null, at: r.lastObservation.at };
      }
      if (c.verify === 'review') {
        const v = r.reviews?.[c.id];
        return { ...base, status: v ? v.verdict : 'pending', evidence: v?.evidence ?? null, reason: v?.note || null, reviewer: v?.reviewer ?? null, at: v?.at ?? null };
      }
      const done = this.portalRule(b, r, c.rule);
      return { ...base, status: done ? 'pass' : 'pending', evidence: done, reason: null, at: null };
    });
  }

  // Returns a short evidence string when the recorded fact exists.
  portalRule(b, r, rule) {
    switch (rule) {
      case 'recall':
        return r.recall?.submittedAt ? `Recorded ${r.recall.submittedAt} (${b.recall.length} answers)` : null;
      case 'attempts': {
        // Break/fix steps are optional extras: incidents come after the sprint.
        const required = b.steps.filter((s) => s.level !== 'breakfix');
        const done = required.filter((s) => r.steps?.[s.id]?.attempt).length;
        return done === required.length ? `${done}/${required.length} attempts recorded` : null;
      }
      case 'english':
        return r.english ? `${words(r.english.answer)} words${r.english.spoken ? ', said aloud' : ''}${r.english.seconds ? ` in ${r.english.seconds} s` : ''}` : null;
      case 'feedback':
        return r.feedback ? `technical ${r.feedback.technical}/2 · autonomy ${r.feedback.autonomy}/2 · English ${r.feedback.english}/2` : null;
      default:
        return null;
    }
  }

  evaluate(id) {
    const r = this.peek(id);
    if (r.completedAt || !r.startedAt) return false;
    const crit = this.criteria(id);
    if (!crit.every((c) => c.status === 'pass')) return false;
    const rec = this.rec(id);
    rec.completedAt = new Date().toISOString();
    rec.completion = {
      at: rec.completedAt,
      mode: rec.assistedBefore || rec.aiAssisted ? 'AI_ASSISTED' : 'SOLO',
      minutes: rec.minutes ?? 0,
      criteria: crit.map((c) => ({ id: c.id, verify: c.verify, reviewer: c.reviewer ?? null })),
    };
    this.store.bump('completions');
    return true;
  }

  stateOf(id, { running = false } = {}) {
    const r = this.peek(id);
    if (r.completedAt) return { state: 'COMPLETED', reason: null };
    if (!r.startedAt) return { state: 'NOT_STARTED', reason: null };
    if (running) return { state: 'CHECKING', reason: null };
    const open = (r.blockers ?? []).find((b) => !b.resolvedAt);
    if (open) return { state: 'BLOCKED', reason: open.kind };
    if (r.lastObservation?.outcome === 'blocked') return { state: 'BLOCKED', reason: r.lastObservation.blockedReason };
    return { state: 'IN_PROGRESS', reason: null };
  }

  // What the browser may see: recall answers only after submitting, steps only
  // after recall, solutions only after they were opened (which needs an attempt).
  view(id, { running = false } = {}) {
    const b = this.block(id);
    const r = this.peek(id);
    const { state, reason } = this.stateOf(id, { running });
    const recallDone = Boolean(r.recall?.submittedAt);
    const criteria = this.criteria(id);
    const history = r.history ?? [];
    const { recall, steps, english, criteria: _c, checker, ...content } = b;
    return {
      ...content,
      kind: this.key,
      state,
      reason,
      startedAt: r.startedAt ?? null,
      completedAt: r.completedAt ?? null,
      completion: r.completion ?? null,
      minutesLogged: r.minutes ?? 0,
      mode: r.completion?.mode ?? (r.assistedBefore || r.aiAssisted ? 'AI_ASSISTED' : 'SOLO'),
      aiAssisted: Boolean(r.aiAssisted),
      hasChecker: Boolean(checker),
      recall: b.recall.map((q) => ({ id: q.id, question: q.question, mine: r.recall?.answers?.[q.id] ?? null, answer: recallDone ? q.answer : null })),
      recallSubmittedAt: r.recall?.submittedAt ?? null,
      steps: recallDone
        ? steps.map((s) => {
          const st = r.steps?.[s.id] ?? {};
          return {
            id: s.id, level: s.level, title: s.title, detail: s.detail, command: s.command ?? null,
            hintsTotal: s.hints.length, hints: s.hints.slice(0, st.hints ?? 0),
            attempt: st.attempt ?? null, attemptAt: st.attemptAt ?? null,
            solution: st.solutionAt ? s.solution : null,
          };
        })
        : null,
      stepsCount: steps.length,
      english: { question: english.question, followUps: english.followUps ?? [], mine: r.english ?? null, modelAnswer: r.english ? english.modelAnswer : null },
      criteria,
      feedback: r.feedback ?? null,
      blockers: r.blockers ?? [],
      lastObservation: r.lastObservation ? { at: r.lastObservation.at, outcome: r.lastObservation.outcome, blockedReason: r.lastObservation.blockedReason ?? null, summary: r.lastObservation.summary, durationMs: r.lastObservation.durationMs ?? null } : null,
      history: history.map((h) => ({ at: h.at, outcome: h.outcome, blockedReason: h.blockedReason, learnerFails: h.learnerFails, environmentFails: h.environmentFails })),
      counts: {
        technicalErrors: history.reduce((n, h) => n + (h.learnerFails?.length ? 1 : 0), 0) + Object.values(r.reviews ?? {}).filter((v) => v.verdict === 'fail').length,
        environmentIssues: history.filter((h) => h.outcome === 'blocked' || h.environmentFails?.length).length + (r.blockers ?? []).length,
        hints: Object.values(r.steps ?? {}).reduce((n, st) => n + (st.hints ?? 0), 0),
        solutions: Object.values(r.steps ?? {}).filter((st) => st.solutionAt).length,
      },
    };
  }

  // Pseudo-sessions for the Runner: one per block with a checker, limited to
  // the checker criteria (the runner validates the output against them).
  runnerCatalog() {
    const byId = new Map();
    for (const b of this.sprint?.blocks ?? []) {
      if (!b.checker) continue;
      byId.set(b.id, {
        id: b.id,
        criteria: b.criteria.filter((c) => c.verify === 'checker').map((c) => ({ id: c.id, text: c.text })),
        prerequisites: { platform: b.prerequisites.platform },
        checker: { status: 'implemented', script: b.checker.script, timeoutSeconds: b.checker.timeoutSeconds, pollSeconds: 0 },
      });
    }
    return { byId };
  }

  summary() {
    if (!this.sprint) return null;
    const blocks = this.sprint.blocks.map((b) => ({ id: b.id, minutes: b.minutes, state: this.stateOf(b.id).state, logged: this.peek(b.id).minutes ?? 0 }));    return {
      done: blocks.filter((b) => b.state === 'COMPLETED').length,
      total: blocks.length,
      estimatedMinutes: blocks.reduce((n, b) => n + b.minutes, 0),
      loggedMinutes: blocks.reduce((n, b) => n + b.logged, 0),
      next: blocks.find((b) => b.state !== 'COMPLETED')?.id ?? null,
    };
  }
}
