import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { loadCatalog } from '../server/catalog.js';
import { ProgressStore } from '../server/progress.js';
import { SprintTracker } from '../server/sprint.js';
import { loadSchedule } from '../server/schedule.js';
import { loadReference } from '../server/reference.js';
import { annotateItems, buildToday, gapsOf, phaseOf, stageLabel } from '../server/phase.js';
import { createApp } from '../server/app.js';
import { loadConfig, PORTAL_ROOT } from '../server/config.js';
import { gitRepo, tempDir } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);
const block = (id) => catalog.sprint.byId.get(id);
const allAnswers = (id) => Object.fromEntries(block(id).recall.map((q) => [q.id, 'from memory']));
const ENGLISH = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');

function tracker(dataDir = tempDir()) {
  const store = new ProgressStore({ dataDir, catalog }).load();
  return { store, dataDir, sprint: new SprintTracker({ store, sprint: catalog.sprint }) };
}
const reload = (dataDir) => tracker(dataDir);

function recordEverything(sprint, id) {
  sprint.start(id);
  sprint.submitRecall(id, allAnswers(id));
  for (const s of block(id).steps) sprint.saveAttempt(id, s.id, `my attempt for ${s.id}`);
  for (const c of block(id).criteria.filter((x) => x.verify === 'review')) {
    sprint.recordReview(id, c.id, { verdict: 'pass', reviewer: 'self', evidence: 'pasted output and my explanation of it' });
  }
  sprint.recordEnglish(id, { answer: ENGLISH, spoken: false });
  sprint.recordFeedback(id, { technical: 2, autonomy: 1, english: 1, gaps: 'NSG default rules', next: 'Next block' });
}
const passingObservation = (id) => ({
  at: new Date().toISOString(),
  outcome: 'pass',
  summary: 'ok',
  criteria: block(id).criteria.filter((c) => c.verify === 'checker').map((c) => ({ id: c.id, status: 'pass', evidence: 'seen' })),
});
const views = (sprint) => catalog.sprint.blocks.map((b) => sprint.view(b.id));
const REVIEW_MODE = { active: true, since: '2026-11-05', focus: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], note: '' };

test('review mode: the shipped schedule turns it on without moving any date or replanning record', () => {
  const schedule = loadSchedule(PORTAL_ROOT, catalog);
  assert.equal(schedule.reviewMode.active, true);
  assert.deepEqual(schedule.reviewMode.focus, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  const date = (kind, id) => schedule.items.find((i) => i.kind === kind && i.id === id).date;
  assert.equal(date('sprint', 'R1'), '2026-11-02');
  assert.equal(date('sprint', 'R3'), '2026-11-03');
  assert.equal(date('sprint', 'R5'), '2026-11-04');
  assert.equal(date('platform', 'C002'), '2026-11-05');
  assert.equal(date('platform', 'C003'), '2026-11-06');
  // The file keeps its replanning history untouched: every replanned item still ends on its own date.
  const cfg = JSON.parse(fs.readFileSync(path.join(PORTAL_ROOT, 'catalog', 'schedule.json'), 'utf8'));
  for (const r of cfg.replanned ?? []) {
    const it = schedule.items.find((i) => i.kind === r.kind && i.id === r.id);
    assert.equal(it.replans.at(-1).to, it.date);
  }
});

test('review mode: a bad reviewMode block in schedule.json is rejected', () => {
  const portalRoot = tempDir('portal-root-');
  const cfg = JSON.parse(fs.readFileSync(path.join(PORTAL_ROOT, 'catalog', 'schedule.json'), 'utf8'));
  const write = (rm) => {
    fs.mkdirSync(path.join(portalRoot, 'catalog'), { recursive: true });
    fs.writeFileSync(path.join(portalRoot, 'catalog', 'schedule.json'), JSON.stringify({ ...cfg, reviewMode: rm }));
  };
  write({ active: true, since: '2026-11-05', focus: ['R9'] });
  assert.throws(() => loadSchedule(portalRoot, catalog), /unknown sprint block R9/);
  write({ active: 'yes', since: '2026-11-05', focus: ['R1'] });
  assert.throws(() => loadSchedule(portalRoot, catalog), /active must be/);
  write({ active: true, since: 'soon', focus: ['R1'] });
  assert.throws(() => loadSchedule(portalRoot, catalog), /since/);
  write({ active: false, since: '2026-11-05', focus: ['R1'] });
  assert.equal(loadSchedule(portalRoot, catalog).reviewMode.active, false);
});

test('review mode: waiting items are annotated as in review or on hold, never as a delay, and no date changes', () => {
  const items = [
    { kind: 'sprint', id: 'R3', date: '2026-11-03' },
    { kind: 'platform', id: 'C002', date: '2026-11-05' },
    { kind: 'gitflow', id: 'G01', date: '2026-11-05' },
    { kind: 'az400', id: '00', date: '2026-10-19' },
  ];
  const out = annotateItems(items, REVIEW_MODE);
  assert.deepEqual(out.map((i) => i.review), ['focus', 'hold', 'hold', 'hold']);
  assert.deepEqual(out.map((i) => i.date), items.map((i) => i.date), 'dates are preserved');
  assert.equal(annotateItems(items, { ...REVIEW_MODE, active: false }), items, 'inactive review mode changes nothing');
  assert.equal(annotateItems(items, null), items);
});

test('review mode: the client never shows Late for an annotated item while the review is active', () => {
  const src = fs.readFileSync(path.join(PORTAL_ROOT, 'public', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('function itemStatus'), src.indexOf('const itemKey'));
  assert.ok(fn.indexOf('it.review') !== -1 && fn.indexOf('it.review') < fn.indexOf("'Late'"), 'the review/hold branch comes before Late');
  assert.match(fn, /'Em revisão'/);
  assert.match(fn, /'Em espera'/);
  const chrome = src.slice(src.indexOf('function renderChrome'), src.indexOf('// ------------------------------------------------------------ schedule view'));
  assert.match(chrome, /reviewMode\?\.active/, 'the pace band switches to the review message');
});

test('review pass: repeatable, free of criteria, and it never completes or starts a block', () => {
  const { sprint } = tracker();
  const before = sprint.criteria('R4').map((c) => c.status);
  for (let i = 0; i < 5; i++) sprint.recordReviewPass('R4', { note: i === 0 ? 'li o guia e vi o mapa' : '' });
  sprint.recordReviewPass('R4'); // no body at all: no scoring, no questions
  const v = sprint.view('R4');
  assert.equal(v.review.passes, 6, 'repeated passes are allowed and counted');
  assert.equal(v.state, 'NOT_STARTED', 'reviewing does not start the block');
  assert.equal(v.completedAt, null);
  assert.deepEqual(v.phase, { reviewed: true, practiced: false, validated: false, stage: 'REVISADO' });
  assert.deepEqual(sprint.criteria('R4').map((c) => c.status), before, 'no criterion changes status');
  assert.equal(sprint.view('R4').validation.ready, false);
  assert.throws(() => sprint.recordReviewPass('R9'), /Unknown sprint block/);
});

test('review pass: a completed block keeps its completion, mode and evidence', () => {
  const { sprint, dataDir } = tracker();
  recordEverything(sprint, 'R2');
  sprint.recordObservation('R2', passingObservation('R2'));
  const done = sprint.view('R2');
  assert.equal(done.state, 'COMPLETED');
  const snapshot = JSON.stringify(sprint.peek('R2').completion);
  sprint.recordReviewPass('R2', { note: 'revisão da semana' });
  sprint.recordReviewPass('R2');
  const after = reload(dataDir).sprint.view('R2');
  assert.equal(after.state, 'COMPLETED');
  assert.equal(JSON.stringify(reload(dataDir).sprint.peek('R2').completion), snapshot, 'completion record is untouched');
  assert.equal(after.mode, done.mode);
  assert.deepEqual(after.phase, { reviewed: true, practiced: true, validated: true, stage: 'VALIDADO' });
  assert.equal(after.review.passes, 2);
});

test('phases: REVISADO, PRATICADO and VALIDADO are separate and come only from recorded facts', () => {
  const { sprint } = tracker();
  assert.equal(stageLabel(phaseOf({})), 'A REVISAR');
  sprint.start('R3');
  assert.equal(sprint.view('R3').phase.practiced, false, 'starting is not practising');
  sprint.submitRecall('R3', allAnswers('R3'));
  assert.equal(sprint.view('R3').phase.practiced, false, 'recall alone is not practice');
  sprint.saveAttempt('R3', block('R3').steps[0].id, 'my attempt for step one');
  assert.deepEqual(sprint.view('R3').phase, { reviewed: false, practiced: true, validated: false, stage: 'PRATICADO' });
  sprint.recordReviewPass('R3');
  assert.deepEqual(sprint.view('R3').phase, { reviewed: true, practiced: true, validated: false, stage: 'PRATICADO' });
  recordEverything(sprint, 'R2');
  assert.equal(sprint.view('R2').phase.validated, false, 'recorded answers without the checker are not validated');
  sprint.recordObservation('R2', passingObservation('R2'));
  assert.equal(sprint.view('R2').phase.validated, true);
});

test('gaps: only what the learner recorded (forgotten recall, feedback gaps, rejected reviews, failing checker)', () => {
  const { sprint } = tracker();
  sprint.start('R3');
  const answers = allAnswers('R3');
  const [first] = block('R3').recall;
  answers[first.id] = '';
  sprint.submitRecall('R3', answers);
  sprint.recordFeedback('R3', { technical: 1, autonomy: 1, english: 1, gaps: 'lock vs key errors', next: 'repeat the lock step' });
  sprint.recordReview('R3', 'plan-and-runbook-reviewed', { verdict: 'fail', reviewer: 'instructor', evidence: 'runbook edits the JSON by hand' });
  const gaps = sprint.view('R3').gaps;
  assert.ok(gaps.some((g) => g.includes(first.question)), 'forgotten recall');
  assert.ok(gaps.some((g) => g.includes('lock vs key errors')), 'feedback gap');
  assert.ok(gaps.some((g) => g.startsWith('Revisão "ainda não"')), 'rejected review');
  assert.deepEqual(gapsOf({}, block('R3')), [], 'nothing recorded, no invented gaps');
});

test('today: one priority per day follows REVISAR → PRATICAR → VALIDAR and never invents progress', () => {
  const { sprint } = tracker();
  const today = () => buildToday({ blocks: views(sprint), reviewMode: REVIEW_MODE, reference: {} });

  let t = today();
  assert.equal(t.priority.id, 'R1');
  assert.equal(t.priority.action, 'revisar', 'nothing recorded: start by reviewing, no assessment required');
  assert.equal(t.complementary.id, 'R2', 'an optional second slot, never a second priority');

  sprint.recordReviewPass('R1');
  t = today();
  assert.equal(t.priority.action, 'praticar', 'after a review pass the next move is practice');
  assert.equal(t.priority.id, 'R1');

  recordEverything(sprint, 'R1');
  t = today();
  assert.equal(t.priority.action, 'validar', 'every step attempted: ready to validate');
  assert.equal(t.validation.ready, true);
  assert.ok(t.validation.pending.length > 0, 'still lists what validation needs; nothing is granted');
  assert.equal(sprint.view('R1').state, 'IN_PROGRESS');

  sprint.recordObservation('R1', passingObservation('R1'));
  t = today();
  assert.equal(t.priority.id, 'R2', 'the priority moves on only after real validation');
  assert.equal(t.stages.find((s) => s.id === 'R1').validated, true);
  assert.equal(t.stages.find((s) => s.id === 'R1').stage, 'VALIDADO');
});

test('today: with every focus block validated there is no priority, only the optional review', () => {
  const { sprint } = tracker();
  for (const b of catalog.sprint.blocks) {
    recordEverything(sprint, b.id);
    sprint.recordObservation(b.id, passingObservation(b.id));
  }
  const t = buildToday({ blocks: views(sprint), reviewMode: REVIEW_MODE, reference: {} });
  assert.equal(t.allValidated, true);
  assert.equal(t.priority, null);
  assert.ok(t.complementary, 'a complementary review is still offered');
});

test('today: the focus order is the review order, and review mode off falls back to the block order', () => {
  const { sprint } = tracker();
  const t = buildToday({ blocks: views(sprint), reviewMode: { ...REVIEW_MODE, focus: ['R3', 'R4'] }, reference: {} });
  assert.deepEqual(t.stages.map((s) => s.id), ['R3', 'R4']);
  assert.equal(t.priority.id, 'R3');
  assert.deepEqual(buildToday({ blocks: views(sprint), reviewMode: null, reference: {} }).stages.map((s) => s.id), catalog.sprint.blocks.map((b) => b.id));
});

test('progress is preserved: an existing progress.json keeps every recorded answer, attempt, review, mode and score', () => {
  const { sprint, dataDir } = tracker();
  recordEverything(sprint, 'R1');
  sprint.setAssisted('R1', true);
  sprint.recordObservation('R1', passingObservation('R1'));
  recordEverything(sprint, 'R2');
  sprint.recordObservation('R2', passingObservation('R2'));
  sprint.start('R3');
  sprint.submitRecall('R3', allAnswers('R3'));
  sprint.saveAttempt('R3', block('R3').steps[0].id, 'partial attempt');

  const file = path.join(dataDir, 'progress.json');
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));

  // A fresh process loads it, the learner reviews and the file is saved again.
  const next = reload(dataDir);
  for (const id of ['R1', 'R2', 'R3', 'R4']) next.sprint.recordReviewPass(id, { note: 'passada' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const id of ['R1', 'R2', 'R3']) {
    const { reviewPasses, ...rest } = saved.sprint.blocks[id];
    assert.deepEqual(rest, original.sprint.blocks[id], `${id}: every original key and value is intact`);
    assert.equal(reviewPasses.length, 1);
  }
  assert.equal(saved.sprint.blocks.R1.completion.mode, 'AI_ASSISTED', 'SOLO/AI_ASSISTED is preserved');
  assert.deepEqual(saved.sprint.blocks.R1.feedback, original.sprint.blocks.R1.feedback);
  assert.equal(saved.sprint.blocks.R2.english.answer, ENGLISH);
  assert.equal(next.sprint.view('R1').state, 'COMPLETED');
  assert.equal(next.sprint.view('R3').state, 'IN_PROGRESS');
  assert.equal(next.sprint.view('R4').state, 'NOT_STARTED');
  assert.deepEqual(Object.keys(saved).filter((k) => k !== 'sprint').sort(), Object.keys(original).filter((k) => k !== 'sprint').sort(), 'other sections untouched');
});

test('existing validation still works: criteria, recall freeze and completion rules are unchanged', () => {
  const { sprint } = tracker();
  recordEverything(sprint, 'R2');
  sprint.recordReviewPass('R2', { note: 'revisão não substitui o checker' });
  assert.equal(sprint.view('R2').state, 'IN_PROGRESS', 'recorded answers and reviews alone still do not complete the block');
  assert.throws(() => sprint.submitRecall('R2', allAnswers('R2')), /already recorded/);
  assert.throws(() => sprint.recordEnglish('R2', { answer: 'too short answer' }), /at least/);
  sprint.recordObservation('R2', passingObservation('R2'));
  assert.equal(sprint.view('R2').state, 'COMPLETED');
  assert.equal(sprint.view('R2').completion.mode, 'SOLO');
});

test('reference: R1–R6 have the six parts, point back to their guide, and nothing creates Anki cards', () => {
  const ref = loadReference(PORTAL_ROOT, catalog.sprint);
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    const r = ref[id];
    assert.equal(r.pending, false, id);
    for (const key of ['concept', 'expected']) assert.ok(r[key].length > 20, `${id}.${key}`);
    for (const key of ['configure', 'investigate', 'mistakes']) assert.ok(r[key].length >= 3, `${id}.${key}`);
    assert.ok(r.commands.length >= (id === 'R6' ? 4 : 5), `${id}.commands`);
    assert.ok(r.commands.every((c) => c.what && c.cmd && c.expect), `${id}: command, what and expected result`);
    assert.ok(!r.commands.some((c) => /\.\.\.|\?\?\?/.test(c.cmd)), `${id}: no placeholders in commands`);
    assert.match(r.guide, /^relatorios\/guia-sprint\/R\d-/, `${id}: points back to the guide`);
  }
  // R5 and R6 were written without a live run: the reference says so on its face.
  assert.match(ref.R5.note, /sem execucao ao vivo/, 'R5 is flagged as a script, not confirmed output');
  assert.match(ref.R6.note, /sem checker automatico/, 'R6 says there is no automatic checker');
  assert.ok(ref.R5.commands.every((c) => !c.risk), 'R5 commands are read-only; none needs a warning');
  assert.ok(ref.R5.commands.some((c) => /sprint-r5-ado\.js/.test(c.cmd)), 'R5 includes the structural checker');
  assert.ok(ref.R6.commands.every((c) => /^(Get-Content|Get-ChildItem|Select-String)/.test(c.cmd)), 'R6 commands only read local files');
  const server = fs.readFileSync(path.join(PORTAL_ROOT, 'server', 'reference.js'), 'utf8');
  assert.ok(!/anki/i.test(server.replace(/^\/\/.*$/gm, '')), 'the reference code has no flashcard generation');
  const dir = tempDir('portal-ref-');
  fs.mkdirSync(path.join(dir, 'catalog'));
  fs.writeFileSync(path.join(dir, 'catalog', 'reference.json'), JSON.stringify({ R9: { pending: true, note: 'x' } }));
  assert.throws(() => loadReference(dir, catalog.sprint), /unknown sprint block R9/);
});

test('http: the state exposes today, the reference and the review mode; a review pass is accepted and completes nothing', async (t) => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dataDir = tempDir();
  const app = createApp({ ...loadConfig({ PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: dataDir, PORTAL_PORT: String(port) }) });
  await app.start();
  t.after(() => app.stop());
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, 'X-Portal-Token': app.token, 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

  const s0 = (await call('GET', '/api/state')).json;
  assert.equal(s0.schedule.reviewMode.active, true);
  assert.ok(s0.schedule.items.filter((i) => i.kind === 'platform').every((i) => i.review === 'hold'));
  assert.ok(s0.schedule.items.filter((i) => i.kind === 'sprint').every((i) => i.review === 'focus'));
  assert.equal(s0.today.priority.id, 'R1');
  assert.equal(s0.today.priority.action, 'revisar');
  assert.equal(s0.reference.R3.pending, false);
  assert.equal(s0.reference.R5.pending, false);
  assert.equal(s0.reference.R6.pending, false);
  assert.ok(!JSON.stringify(s0.today).includes('"solution"'), 'no solution text in the home payload');

  const res = await call('POST', '/api/sprint/R4/reviewpass', { note: 'li o guia' });
  assert.equal(res.status, 200);
  assert.equal((await call('POST', '/api/sprint/R4/reviewpass', {})).status, 200, 'a pass needs no input');
  const s1 = (await call('GET', '/api/state')).json;
  const r4 = s1.sprint.blocks.find((b) => b.id === 'R4');
  assert.equal(r4.review.passes, 2);
  assert.equal(r4.state, 'NOT_STARTED');
  assert.equal(r4.phase.stage, 'REVISADO');
  assert.equal(s1.sprint.summary.done, 0, 'reviewing completes nothing');
  assert.equal((await call('POST', '/api/sprint/R9/reviewpass', {})).status, 404);
  assert.ok(fs.existsSync(path.join(dataDir, 'progress.json')));
});
