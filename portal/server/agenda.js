// A rolling daily agenda: what to study today and over the next days.
//
// The dated plan in schedule.json is never touched. While review mode is on,
// its past dates are frozen on purpose, so nothing in it says "today". This
// module derives the answer from what is still open and from the availability
// ceiling of each day, and recomputes it on every request: the agenda moves
// as soon as the learner records a pass, validates a block or finishes a session.
//
// Nothing here writes progress or marks anything done. "Done today" only reads
// review passes the learner already recorded.
import { availabilityFor } from './availability.js';
import { isoDate } from './schedule.js';

const SLOT_MINUTES = 45; // one block of attention, as in the lab rules
const MAX_SLOTS = 4;
const DAYS = 7;

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const dayOf = (stamp) => isoDate(new Date(stamp));

export function slotsFor(day) {
  if (!day || day.kind === 'sunday') return 0;
  return Math.min(MAX_SLOTS, Math.max(1, Math.floor(day.maxMinutes / SLOT_MINUTES)));
}

// Same decision as the home view, so both screens always say the same thing.
function actionOf(block) {
  if (block.validation?.ready) return 'validar';
  return block.phase.practiced || block.review.passes > 0 ? 'praticar' : 'revisar';
}

// blocks     sprint block views (id, title, phase, review, validation)
// passDates  { R3: ['2026-11-09', ...] } days with a review pass the learner recorded
// others     open items outside the review focus, already in plan order:
//            [{ kind: 'platform'|'gitflow', id, title }]
// selfDone   { 'sprint:R3': { done, at, visitDates: [...] } }: the learner's own
//            "concluído" mark and return visits. A closed item leaves the queue but
//            is never locked: the learner can go back to it at any time.
export function buildAgenda({ todayIso, availabilityCfg, reviewMode, blocks, passDates = {}, others = [], selfDone = {} }) {
  const focusIds = reviewMode?.focus?.length ? reviewMode.focus : blocks.map((b) => b.id);
  const inFocus = blocks.filter((b) => focusIds.includes(b.id)).sort((a, b) => focusIds.indexOf(a.id) - focusIds.indexOf(b.id));
  const mine = (kind, id) => selfDone[`${kind}:${id}`] ?? null;
  const closed = (kind, id) => Boolean(mine(kind, id)?.done);
  const dayOfMark = (m) => (m?.at ? dayOf(m.at) : null);
  const visitedToday = (kind, id) => (mine(kind, id)?.visitDates ?? []).some((t) => dayOf(t) === todayIso);
  const studiedToday = (b) => (passDates[b.id] ?? []).includes(todayIso) || dayOfMark(mine('sprint', b.id)) === todayIso || visitedToday('sprint', b.id);

  // Blocks already reviewed today are shown as done, even when validated.
  const doneToday = inFocus.filter(studiedToday).map((b) => ({ kind: 'sprint', id: b.id, title: b.title, action: actionOf(b), done: true, mine: closed('sprint', b.id) }));
  const doneIds = new Set(doneToday.map((i) => i.id));

  // Open blocks: the first unvalidated one keeps the lead, then fewest passes.
  const isOpen = (b) => !b.phase.validated && !closed('sprint', b.id) && !doneIds.has(b.id);
  const open = inFocus.filter(isOpen);
  const lead = inFocus.find(isOpen) ?? null;
  const tail = open.filter((b) => b !== lead).sort((a, b) => a.review.passes - b.review.passes || focusIds.indexOf(a.id) - focusIds.indexOf(b.id));
  const queue = [...(lead ? [lead] : []), ...tail].map((b) => ({ kind: 'sprint', id: b.id, title: b.title, action: actionOf(b), done: false }));
  // After the review focus, the rest of the plan in its own order.
  for (const o of others.filter((x) => !closed(x.kind, x.id))) queue.push({ kind: o.kind, id: o.id, title: o.title, action: o.kind === 'platform' ? 'sessão' : 'missão', done: false });

  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(todayIso, i);
    const av = availabilityFor(availabilityCfg, date);
    const resting = av?.kind === 'sunday';
    const slots = av ? slotsFor(av) : 2;
    const items = i === 0 ? [...doneToday] : [];
    const room = Math.max(0, slots - items.length);
    for (let n = 0; n < room && queue.length; n++) items.push(queue.shift());
    days.push({
      date,
      kind: av?.kind ?? 'weekday',
      label: av?.label ?? '',
      maxMinutes: av?.maxMinutes ?? 0,
      slots,
      rest: resting,
      items,
    });
  }
  const today = days[0];
  const next = today.items.find((i) => !i.done) ?? null;
  return { today, days, next, remaining: queue.length };
}
