// Builds the dated plan shown in the timeline rail from catalog/schedule.json.
import fs from 'node:fs';
import path from 'node:path';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoDate(dt);
}

export function loadSchedule(portalRoot, catalog) {
  const file = path.join(portalRoot, 'catalog', 'schedule.json');
  if (!fs.existsSync(file)) return { title: '', items: [], start: null, lastDay: null };
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['start', 'lastDay']) if (!DATE.test(cfg[key] ?? '')) throw new Error(`schedule.json: "${key}" must be YYYY-MM-DD`);
  const items = [];
  for (const [date, ids] of Object.entries(cfg.sprint ?? {})) {
    for (const id of ids) {
      if (!catalog.sprint?.byId.has(id)) throw new Error(`schedule.json: unknown sprint block ${id}`);
      items.push({ kind: 'sprint', id, date });
    }
  }
  const az = cfg.az400 ?? {};
  if (az.prep) items.push({ kind: 'az400', id: 'prep', date: az.prep });
  for (const [id, date] of Object.entries(az.labs ?? {})) items.push({ kind: 'az400', id, date });
  if (az.dailyFrom) {
    const first = Number(az.dailyFrom.first);
    const last = Number(az.dailyFrom.last);
    for (let n = first; n <= last; n++) items.push({ kind: 'az400', id: String(n).padStart(2, '0'), date: addDays(az.dailyFrom.start, n - first) });
  }
  for (const [id, date] of Object.entries(az.after ?? {})) items.push({ kind: 'az400', id, date });
  for (const p of cfg.platform ?? []) {
    if (!catalog.byId.has(p.id)) throw new Error(`schedule.json: unknown platform session ${p.id}`);
    items.push({ kind: 'platform', id: p.id, date: p.date });
  }
  for (const it of items) if (!DATE.test(it.date)) throw new Error(`schedule.json: bad date for ${it.kind} ${it.id}`);
  // Replanning history: every move keeps its original date and reason; the
  // last move of an item must land on the item's current date.
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  for (const r of cfg.replanned ?? []) {
    const it = byKey.get(`${r.kind}:${r.id}`);
    if (!it) throw new Error(`schedule.json: replanned ${r.kind} ${r.id} is not in the plan`);
    if (!DATE.test(r.from ?? '') || !DATE.test(r.to ?? '') || typeof r.reason !== 'string' || !r.reason) throw new Error(`schedule.json: replanned ${r.kind} ${r.id} needs from, to and reason`);
    (it.replans ??= []).push({ from: r.from, to: r.to, decidedAt: r.decidedAt ?? null, reason: r.reason });
  }
  for (const it of items) {
    if (it.replans && it.replans.at(-1).to !== it.date) throw new Error(`schedule.json: the last replan of ${it.kind} ${it.id} must end on ${it.date}`);
  }
  // Stable order: date, then sprint → AZ-400 → platform on the same day, then id.
  const rank = (i) => (i.id === 'prep' ? '' : i.id);
  const kinds = ['sprint', 'az400', 'platform'];
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? rank(a).localeCompare(rank(b)) : kinds.indexOf(a.kind) - kinds.indexOf(b.kind)));
  return {
    title: cfg.title,
    subtitle: cfg.subtitle,
    start: cfg.start,
    lastDay: cfg.lastDay,
    dailyHours: cfg.dailyHours ?? 3,
    sprintDays: Object.keys(cfg.sprint ?? {}).sort(),
    items,
    scheduledSessions: new Set(items.filter((i) => i.kind === 'platform').map((i) => i.id)),
  };
}
