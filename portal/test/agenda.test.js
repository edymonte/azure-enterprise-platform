import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda, slotsFor } from '../server/agenda.js';
import { loadCatalog } from '../server/catalog.js';
import { loadSchedule } from '../server/schedule.js';
import { PORTAL_ROOT } from '../server/config.js';
import http from 'node:http';
import { ProgressStore } from '../server/progress.js';
import { recordSelfDone, selfDoneView } from '../server/selfdone.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { gitRepo, tempDir } from './helpers.js';

const FOCUS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
const reviewMode = { active: true, since: '2026-11-05', focus: FOCUS };
const availabilityCfg = { vacationEnds: '2026-11-12', workStarts: '2026-11-16', intensiveMinutes: 195, weekdayMaxMinutes: 120, saturdayMaxMinutes: 120, tracks: [], horizonDays: 60 };

const block = (id, o = {}) => ({
  id,
  title: `${id} title`,
  phase: { reviewed: (o.passes ?? 0) > 0, practiced: Boolean(o.practiced), validated: Boolean(o.validated) },
  review: { passes: o.passes ?? 0 },
  validation: { ready: Boolean(o.ready) },
});
// The shape of the real case: R1 and R2 validated, R3 ready to validate, R4 reviewed once, R5 and R6 untouched.
const blocks = () => [
  block('R1', { validated: true, passes: 2 }),
  block('R2', { validated: true, passes: 1 }),
  block('R3', { practiced: true, ready: true, passes: 2 }),
  block('R4', { passes: 1 }),
  block('R5'),
  block('R6'),
];
const others = [
  { kind: 'platform', id: 'C002', title: 'C002 · first' },
  { kind: 'platform', id: 'C003', title: 'C003 · second' },
  { kind: 'gitflow', id: 'G01', title: 'G01 · mission' },
];
const run = (o = {}) => buildAgenda({ todayIso: '2026-11-09', availabilityCfg, reviewMode, blocks: blocks(), others, ...o });
const ids = (day) => day.items.map((i) => i.id);

test('slots follow the availability ceiling and Sundays are rest', () => {
  assert.equal(slotsFor({ kind: 'vacation', maxMinutes: 195 }), 4);
  assert.equal(slotsFor({ kind: 'weekday', maxMinutes: 120 }), 2);
  assert.equal(slotsFor({ kind: 'weekday', maxMinutes: 30 }), 1);
  assert.equal(slotsFor({ kind: 'sunday', maxMinutes: 0 }), 0);
});

test('today leads with the block to validate, then the least reviewed ones', () => {
  const a = run();
  assert.equal(a.today.date, '2026-11-09');
  assert.equal(a.today.kind, 'vacation');
  // R5 and R6 have no pass yet, so they come before R4, which already has one.
  assert.deepEqual(ids(a.today), ['R3', 'R5', 'R6', 'R4']);
  assert.equal(a.today.items[0].action, 'validar');
  assert.equal(a.today.items[1].action, 'revisar');
  assert.equal(a.today.items[3].action, 'praticar');
  assert.equal(a.next.id, 'R3');
});

test('a block stays at the head of the queue while it is not validated, without hiding the others', () => {
  const a = run();
  assert.equal(a.today.items[0].id, 'R3');
  assert.ok(ids(a.today).includes('R5'), 'R5 must be on today, not stuck behind R3');
});

test('what was reviewed today is shown as done and, with review mode off, does not repeat on the next days', () => {
  const a = run({ reviewMode: { ...reviewMode, active: false }, passDates: { R2: ['2026-11-09'], R3: ['2026-11-09'], R4: ['2026-11-09'] } });
  const done = a.today.items.filter((i) => i.done).map((i) => i.id);
  assert.deepEqual(done, ['R2', 'R3', 'R4']);
  assert.equal(a.next.id, 'R5');
  const later = a.days.slice(1).flatMap(ids);
  for (const id of ['R2', 'R3', 'R4']) assert.ok(!later.includes(id), `${id} must not come back tomorrow`);
});

test('a pass on another day does not count as done today', () => {
  const a = run({ passDates: { R3: ['2026-11-08'] } });
  assert.ok(!a.today.items.find((i) => i.id === 'R3').done);
});

test('the route continues after the review focus, in plan order, across days, once review mode is off', () => {
  const a = run({ reviewMode: { ...reviewMode, active: false } });
  assert.deepEqual(ids(a.days[1]), ['C002', 'C003', 'G01']); // 2026-11-10, a vacation day with 4 slots
  assert.equal(a.remaining, 0);
});

test('review mode holds the route and keeps rotating R1-R6 by fewest passes', () => {
  const a = run();
  const all = a.days.flatMap(ids);
  assert.ok(!all.some((id) => id.startsWith('C') || id.startsWith('G')), 'no platform session or Git Flow mission while review mode is on');
  assert.equal(a.routeOnHold, 3);
  // Tomorrow has 4 slots: nothing is open any more, so they are free passes on the least reviewed blocks.
  const tomorrow = a.days[1].items;
  assert.equal(tomorrow.length, 4);
  assert.ok(tomorrow.every((i) => i.action === 'passada' || i.action === 'validar' || i.action === 'praticar' || i.action === 'revisar'));
  assert.equal(new Set(tomorrow.map((i) => i.id)).size, 4, 'no block twice on the same day');
});

test('review mode: what was reviewed today comes back on later days, least reviewed first', () => {
  const a = run({ passDates: { R2: ['2026-11-09'], R3: ['2026-11-09'], R4: ['2026-11-09'] } });
  assert.deepEqual(a.today.items.filter((i) => i.done).map((i) => i.id), ['R2', 'R3', 'R4']);
  const later = a.days.slice(1).flatMap(ids);
  assert.ok(later.includes('R3'), 'R3 returns for more passes');
  assert.equal(a.today.items.find((i) => i.id === 'R5')?.done, false, 'R5 is the one still to do today');
  assert.equal(a.days[1].items[0].id, 'R6', 'tomorrow starts with R6, the only block never reviewed');
});

test('review mode spreads the passes: after a week every block was planned, none starves', () => {
  const a = run();
  const seen = new Set(a.days.flatMap(ids));
  for (const id of FOCUS) assert.ok(seen.has(id), `${id} appears somewhere in the week`);
});

test('turning review mode off releases the route and drops the free passes', () => {
  const a = run({ reviewMode: { ...reviewMode, active: false } });
  assert.equal(a.routeOnHold, 0);
  assert.ok(a.days.flatMap((d) => d.items).every((i) => i.action !== 'passada'));
});

test('Sundays are rest days and carry no items', () => {
  const a = run({ todayIso: '2026-11-14' }); // Saturday
  const sunday = a.days.find((d) => d.date === '2026-11-15');
  assert.equal(sunday.rest, true);
  assert.deepEqual(sunday.items, []);
});

test('after the vacation a work day gets two items, not the intensive four', () => {
  const a = run({ todayIso: '2026-11-17' });
  assert.equal(a.today.kind, 'weekday');
  assert.equal(a.today.items.length, 2);
});

test('the agenda advances by itself when a block is validated', () => {
  const advanced = blocks().map((b) => (b.id === 'R3' ? block('R3', { validated: true, passes: 2 }) : b));
  const a = run({ blocks: advanced });
  assert.deepEqual(ids(a.today).slice(0, 3), ['R4', 'R5', 'R6']);
  assert.ok(!ids(a.today).includes('R3'));
});

test('with everything validated the agenda falls through to the route', () => {
  const all = blocks().map((b) => block(b.id, { validated: true, passes: 3 }));
  const a = run({ blocks: all, reviewMode: { ...reviewMode, active: false } });
  assert.deepEqual(ids(a.today), ['C002', 'C003', 'G01']);
  assert.equal(a.today.items[0].action, 'sessão');
});

test('the shipped catalog works with the agenda (no unknown ids, plan order kept)', () => {
  const catalog = loadCatalog(PORTAL_ROOT);
  const schedule = loadSchedule(PORTAL_ROOT, catalog);
  const open = schedule.items.filter((i) => i.kind === 'platform' || i.kind === 'gitflow').map((i) => ({ kind: i.kind, id: i.id, title: i.id }));
  const a = buildAgenda({ todayIso: '2026-11-09', availabilityCfg: schedule.availability, reviewMode: schedule.reviewMode, blocks: [], others: open });
  assert.equal(a.days.length, 7);
  assert.ok(a.today.items.length > 0);
});

// ---- "Concluído por mim": the learner's own mark, never validation ------------------------------

const catalogs = (c) => ({ sprint: c.sprint.byId, gitflow: c.gitflow?.byId ?? new Map(), platform: c.byId });
const storeOf = () => { const c = loadCatalog(PORTAL_ROOT); return { c, store: new ProgressStore({ dataDir: tempDir(), catalog: c }).load() }; };

test('self done: mark, undo and come back as many times as wanted', () => {
  const { c, store } = storeOf();
  recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'done' }, catalogs(c));
  assert.equal(selfDoneView(store)['sprint:R3'].done, true);
  for (let i = 0; i < 3; i++) recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'revisit' }, catalogs(c));
  assert.equal(selfDoneView(store)['sprint:R3'].visits, 3);
  recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'undo' }, catalogs(c));
  const v = selfDoneView(store)['sprint:R3'];
  assert.equal(v.done, false);
  assert.equal(v.visits, 3, 'undoing keeps the visit history');
  recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'done' }, catalogs(c)); // can be marked again
  assert.equal(selfDoneView(store)['sprint:R3'].done, true);
});

test('self done: it is not validation and unlocks nothing', () => {
  const { c, store } = storeOf();
  const before = JSON.stringify(store.data.sprint ?? null) + JSON.stringify(store.data.sessions);
  recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'done' }, catalogs(c));
  recordSelfDone(store, { kind: 'platform', id: 'C002', action: 'done' }, catalogs(c));
  assert.equal(JSON.stringify(store.data.sprint ?? null) + JSON.stringify(store.data.sessions), before, 'criteria, completedAt and session state stay untouched');
  assert.equal(store.data.sessions.C002?.completedAt, undefined);
});

test('self done: unknown items and actions are rejected and survive a reload', () => {
  const { c, store } = storeOf();
  assert.throws(() => recordSelfDone(store, { kind: 'sprint', id: 'R99', action: 'done' }, catalogs(c)), /Unknown item/);
  assert.throws(() => recordSelfDone(store, { kind: 'az400', id: '01', action: 'done' }, catalogs(c)), /kind/);
  assert.throws(() => recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'grade' }, catalogs(c)), /action/);
  recordSelfDone(store, { kind: 'sprint', id: 'R3', action: 'done' }, catalogs(c));
  const again = new ProgressStore({ dataDir: store.dataDir, catalog: c }).load();
  assert.equal(selfDoneView(again)['sprint:R3'].done, true);
});

test('agenda: an item the learner closed leaves the queue, and coming back counts as studied today', () => {
  const closed = { 'sprint:R3': { done: true, at: '2026-11-08T12:00:00.000Z', visitDates: [] } };
  const a = run({ selfDone: closed });
  assert.ok(!ids(a.today).includes('R3'), 'R3 is closed by the learner');
  assert.deepEqual(ids(a.today).slice(0, 3), ['R4', 'R5', 'R6']);
  const back = run({ selfDone: { 'sprint:R3': { done: true, at: '2026-11-08T12:00:00.000Z', visitDates: ['2026-11-09T15:00:00'] } } });
  assert.ok(back.today.items.find((i) => i.id === 'R3')?.done, 'a visit today shows as done today');
});

test('agenda: a platform session the learner closed is skipped', () => {
  const a = run({ reviewMode: { ...reviewMode, active: false }, blocks: blocks().map((b) => block(b.id, { validated: true, passes: 3 })), selfDone: { 'platform:C002': { done: true, at: '2026-11-08T12:00:00.000Z', visitDates: [] } } });
  assert.ok(!ids(a.today).includes('C002'));
  assert.equal(a.today.items[0].id, 'C003');
});

test('self done over HTTP: mark, visit, undo, and the agenda follows', async (t) => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const app = createApp({ ...loadConfig({ PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir(), PORTAL_PORT: String(port) }) });
  await app.start();
  t.after(() => app.stop());
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, 'X-Portal-Token': app.token, 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (x) => { data += x; });
      res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  const first = (await call('GET', '/api/state')).json;
  assert.equal(first.agenda.today.items[0].id, 'R1');
  assert.deepEqual(first.selfDone, {});
  assert.equal((await call('POST', '/api/self-done', { kind: 'sprint', id: 'R1', action: 'done' })).status, 200);
  assert.equal((await call('POST', '/api/self-done', { kind: 'sprint', id: 'R1', action: 'revisit' })).status, 200);
  const s = (await call('GET', '/api/state')).json;
  assert.equal(s.selfDone['sprint:R1'].done, true);
  assert.equal(s.agenda.completed[0].id, 'R1');
  assert.equal(s.agenda.completed[0].visits, 1);
  assert.ok(s.agenda.today.items.find((i) => i.id === 'R1').done, 'studied today (it was marked today)');
  assert.equal(s.sprint.blocks.find((b) => b.id === 'R1').state, 'NOT_STARTED', 'the evidence state is untouched');
  assert.equal((await call('POST', '/api/self-done', { kind: 'sprint', id: 'R1', action: 'undo' })).status, 200);
  assert.equal((await call('GET', '/api/state')).json.selfDone['sprint:R1'].done, false);
  assert.equal((await call('POST', '/api/self-done', { kind: 'sprint', id: 'R77', action: 'done' })).status, 400);
});
