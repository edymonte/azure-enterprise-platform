// "Concluído por mim": a mark the learner owns.
//
// It is a plain click, it can be undone, and the item stays open for as many
// return visits as the learner wants. It is NOT validation: it never touches
// criteria, completedAt, XP or unlocks. Evidence-based validation (the tracker)
// and this self-declared mark are shown side by side and never mixed.
import { UserError } from './progress.js';

const KINDS = new Set(['sprint', 'gitflow', 'platform']);
const ACTIONS = new Set(['done', 'undo', 'revisit']);
const MAX_VISITS = 100;

export const selfKey = (kind, id) => `${kind}:${id}`;

// catalogs: { sprint: Map, gitflow: Map, platform: Map } of known ids.
export function recordSelfDone(store, { kind, id, action }, catalogs) {
  if (!KINDS.has(kind)) throw new UserError('"kind" must be sprint, gitflow or platform.');
  if (!catalogs[kind]?.has(id)) throw new UserError('Unknown item.');
  if (!ACTIONS.has(action)) throw new UserError('"action" must be done, undo or revisit.');
  store.data.selfDone ??= {};
  const key = selfKey(kind, id);
  const rec = store.data.selfDone[key] ?? { done: false, at: null, revisits: [] };
  const now = new Date().toISOString();
  if (action === 'done') { rec.done = true; rec.at = now; }
  if (action === 'undo') { rec.done = false; rec.at = null; }
  // Returning to an item is always allowed, done or not, and never changes the mark.
  if (action === 'revisit') rec.revisits = [...rec.revisits, now].slice(-MAX_VISITS);
  store.data.selfDone[key] = rec;
  store.save();
  return rec;
}

export function selfDoneView(store) {
  const out = {};
  for (const [key, rec] of Object.entries(store.data.selfDone ?? {})) {
    out[key] = { done: Boolean(rec.done), at: rec.at ?? null, visits: (rec.revisits ?? []).length, lastVisitAt: (rec.revisits ?? []).at(-1) ?? null, visitDates: rec.revisits ?? [] };
  }
  return out;
}
