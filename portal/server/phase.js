// REVISAR → PRATICAR → VALIDAR, derived from what progress.json already holds.
//
// Nothing here writes progress or grants completion:
//   REVISADO  — the learner recorded at least one review pass (reading, maps, stories);
//   PRATICADO — a step attempt or a checker run exists;
//   VALIDADO  — the block's own criteria passed (completedAt). Only the tracker sets it.
// A review pass never touches the criteria, so reviewing cannot complete a block.

export const NO_MEMORY = "I don't remember";
const GAP_LIMIT = 8;

export function reviewStats(rec = {}) {
  const passes = rec.reviewPasses ?? [];
  return { passes: passes.length, lastReviewAt: passes.at(-1)?.at ?? null, lastNote: passes.at(-1)?.note ?? '' };
}

export function phaseOf(rec = {}) {
  const attempts = Object.values(rec.steps ?? {}).filter((s) => s?.attempt).length;
  const checked = Boolean(rec.lastObservation) || (rec.history?.length ?? 0) > 0;
  const { passes } = reviewStats(rec);
  return {
    reviewed: passes > 0,
    practiced: attempts > 0 || checked,
    validated: Boolean(rec.completedAt),
  };
}

export const stageLabel = (p) => (p.validated ? 'VALIDADO' : p.practiced ? 'PRATICADO' : p.reviewed ? 'REVISADO' : 'A REVISAR');

// Gaps come only from what the learner already recorded: forgotten recall,
// feedback gaps, reviews that were "not yet" and criteria the checker rejected.
export function gapsOf(rec = {}, block) {
  const out = [];
  const questions = new Map((block.recall ?? []).map((q) => [q.id, q.question]));
  for (const [qid, answer] of Object.entries(rec.recall?.answers ?? {})) {
    if (answer === NO_MEMORY) out.push(`Recall sem resposta: ${questions.get(qid) ?? qid}`);
  }
  if (rec.feedback?.gaps) out.push(`Lacuna registrada: ${rec.feedback.gaps.length > 160 ? `${rec.feedback.gaps.slice(0, 157)}…` : rec.feedback.gaps}`);
  const crit = new Map((block.criteria ?? []).map((c) => [c.id, c.text]));
  for (const [cid, review] of Object.entries(rec.reviews ?? {})) {
    if (review.verdict === 'fail') out.push(`Revisão "ainda não": ${crit.get(cid) ?? cid}`);
  }
  const lastFails = rec.history?.at(-1)?.learnerFails ?? [];
  for (const cid of lastFails) out.push(`Checker ainda não passa: ${crit.get(cid) ?? cid}`);
  return out.slice(0, GAP_LIMIT);
}

// First required step without a recorded attempt (title only: no hints, no solution).
export function nextPractice(rec = {}, block) {
  const required = (block.steps ?? []).filter((s) => s.level !== 'breakfix');
  const step = required.find((s) => !rec.steps?.[s.id]?.attempt) ?? null;
  return step ? { id: step.id, title: step.title } : null;
}

// Review mode annotates plan items without moving any date. Sprint blocks in
// the focus list are "in review"; everything else dated in the past is "on hold",
// so neither shows as a personal delay while the review is active.
export function annotateItems(items, reviewMode) {
  if (!reviewMode?.active) return items;
  const focus = new Set(reviewMode.focus ?? []);
  return items.map((it) => ({ ...it, review: it.kind === 'sprint' && focus.has(it.id) ? 'focus' : 'hold' }));
}

const byOrder = (focus) => (a, b) => focus.indexOf(a.id) - focus.indexOf(b.id);

// The home view: one priority for the day, what is being reviewed, the next
// practice, the open gaps and whether the priority block is ready to validate.
export function buildToday({ blocks, reviewMode, reference = {} }) {
  const focusIds = reviewMode?.focus?.length ? reviewMode.focus : blocks.map((b) => b.id);
  const inFocus = blocks.filter((b) => focusIds.includes(b.id)).sort(byOrder(focusIds));
  const stages = inFocus.map((b) => ({
    id: b.id,
    title: b.title,
    stage: b.phase.stage,
    reviewed: b.phase.reviewed,
    practiced: b.phase.practiced,
    validated: b.phase.validated,
    passes: b.review.passes,
    lastReviewAt: b.review.lastReviewAt,
    mode: b.mode,
    hasReference: Boolean(reference[b.id] && !reference[b.id].pending),
  }));

  const target = inFocus.find((b) => !b.phase.validated) ?? null;
  let priority = null;
  let validation = null;
  let practice = null;
  if (target) {
    const ready = target.validation.ready;
    const action = ready ? 'validar' : target.phase.practiced || target.review.passes > 0 ? 'praticar' : 'revisar';
    const headline = {
      revisar: `Revisar ${target.id} — ${target.title}`,
      praticar: `Praticar ${target.id} — ${target.title}`,
      validar: `Validar ${target.id} — ${target.title}`,
    }[action];
    const why = {
      revisar: 'Leia o guia técnico e o visual, olhe o mapa e a história. Sem nota e sem prazo; repita quantas vezes quiser.',
      praticar: target.nextStep ? `Próximo passo no ambiente: ${target.nextStep.title}.` : 'Rode os comandos você mesmo e registre evidências e dificuldades.',
      validar: 'Os passos têm tentativa registrada. Faltam só os critérios abaixo para a avaliação.',
    }[action];
    priority = { id: target.id, title: target.title, action, headline, why };
    validation = { id: target.id, ready, pending: target.validation.pending };
    practice = { id: target.id, step: target.nextStep, text: target.nextStep ? `${target.id}: ${target.nextStep.title}` : `${target.id}: sem passo pendente` };
  }

  // Optional second slot: the focus block with the fewest review passes.
  const complementary = [...inFocus]
    .filter((b) => b.id !== target?.id)
    .sort((a, b) => a.review.passes - b.review.passes || focusIds.indexOf(a.id) - focusIds.indexOf(b.id))[0] ?? null;

  const gaps = inFocus.flatMap((b) => b.gaps.map((text) => ({ block: b.id, text }))).slice(0, 12);
  return {
    reviewActive: Boolean(reviewMode?.active),
    note: reviewMode?.note ?? '',
    since: reviewMode?.since ?? null,
    focus: focusIds,
    priority,
    practice,
    validation,
    complementary: complementary ? { id: complementary.id, title: complementary.title, passes: complementary.review.passes } : null,
    gaps,
    stages,
    allValidated: inFocus.length > 0 && !target,
  };
}
