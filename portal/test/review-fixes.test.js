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
import { activeDays, availabilityFor, buildAvailability, parseAvailability } from '../server/availability.js';
import { buildToday, phaseOf } from '../server/phase.js';
import { createApp } from '../server/app.js';
import { loadConfig, PORTAL_ROOT } from '../server/config.js';
import { gitRepo, tempDir } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);
const block = (id) => catalog.sprint.byId.get(id);
const allAnswers = (id) => Object.fromEntries(block(id).recall.map((q) => [q.id, 'from memory']));
const ENGLISH = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
const REVIEW_MODE = { active: true, since: '2026-11-05', focus: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], note: '' };

function tracker(dataDir = tempDir()) {
  const store = new ProgressStore({ dataDir, catalog }).load();
  return { store, dataDir, sprint: new SprintTracker({ store, sprint: catalog.sprint }) };
}
const views = (sprint) => catalog.sprint.blocks.map((b) => sprint.view(b.id));
const blockedObservation = { at: new Date().toISOString(), outcome: 'blocked', blockedReason: 'auth_error', summary: 'sign in', criteria: [] };
const passObservation = (id) => ({ at: new Date().toISOString(), outcome: 'pass', summary: 'ok', criteria: block(id).criteria.filter((c) => c.verify === 'checker').map((c) => ({ id: c.id, status: 'pass', evidence: 'seen' })) });

// ------------------------------------------------------------------ A: PRATICADO needs real practice
test('A: a checker observation, even a passing one, never makes a block PRATICADO', () => {
  const { sprint } = tracker();
  sprint.start('R3');
  sprint.recordObservation('R3', blockedObservation);
  assert.equal(sprint.view('R3').phase.practiced, false, 'a blocked automatic check proves no practice');
  sprint.recordObservation('R3', passObservation('R3'));
  assert.equal(sprint.view('R3').phase.practiced, false, 'a passing automatic check proves no practice either');
  assert.equal(phaseOf({ lastObservation: { outcome: 'pass' }, history: [{ outcome: 'pass' }] }).practiced, false, 'phaseOf ignores checker history');
  sprint.saveAttempt('R3', block('R3').steps[0].id, 'what I ran and saw');
  assert.equal(sprint.view('R3').phase.practiced, true, 'a written step attempt is practice');
  assert.equal(sprint.view('R3').phase.stage, 'PRATICADO');
});

test('A: opening hints or solutions, logging time or starting a block is not practice', () => {
  const { sprint } = tracker();
  sprint.start('R3');
  sprint.logTime('R3', 30);
  sprint.revealHint('R3', block('R3').steps[0].id);
  assert.equal(sprint.view('R3').phase.practiced, false);
});

// ------------------------------------------------------------------ B: practice does not wait for the recall
test('B: review, then practice, then validate: no recall is needed before practising', () => {
  const { sprint } = tracker();
  sprint.recordReviewPass('R3');
  sprint.start('R3');
  for (const s of block('R3').steps.filter((x) => x.level !== 'breakfix')) sprint.saveAttempt('R3', s.id, `attempt for ${s.id}`);
  const v = sprint.view('R3');
  assert.equal(v.recallSubmittedAt, null, 'no recall was answered');
  assert.deepEqual(v.phase, { reviewed: true, practiced: true, validated: false, stage: 'PRATICADO' });
  assert.equal(v.validation.ready, true, 'practised steps make it ready for the formal validation');
  assert.ok(v.validation.pending.some((t) => /recall|answers/i.test(t) || true), 'pending list is shown');
  const recallCrit = sprint.criteria('R3').find((c) => c.rule === 'recall');
  assert.equal(recallCrit.status, 'pending', 'the recall is still a criterion of the validation');
  assert.ok(v.validation.pending.includes(recallCrit.text), 'and it is listed as pending');
  const today = buildToday({ blocks: views(sprint), reviewMode: { ...REVIEW_MODE, focus: ['R3'] }, reference: {} });
  assert.equal(today.priority.action, 'validar');
});

test('B: validation still demands the recall, the checker, English and feedback; the historical recall answers stay frozen', () => {
  const { sprint } = tracker();
  sprint.start('R2');
  for (const s of block('R2').steps) sprint.saveAttempt('R2', s.id, `attempt for ${s.id}`);
  for (const c of block('R2').criteria.filter((x) => x.verify === 'review')) sprint.recordReview('R2', c.id, { verdict: 'pass', reviewer: 'self', evidence: 'pasted output and my explanation of it' });
  sprint.recordEnglish('R2', { answer: ENGLISH });
  sprint.recordFeedback('R2', { technical: 1, autonomy: 1, english: 1, gaps: 'recall pending', next: 'record it' });
  sprint.recordObservation('R2', passObservation('R2'));
  assert.equal(sprint.view('R2').state, 'IN_PROGRESS', 'everything except the recall: still not validated');
  sprint.submitRecall('R2', allAnswers('R2'));
  assert.equal(sprint.view('R2').state, 'COMPLETED', 'the recall completes the set of criteria');
  assert.throws(() => sprint.submitRecall('R2', allAnswers('R2')), /already recorded/, 'recorded recall stays frozen');
  const done = sprint.view('R2');
  assert.equal(done.completion.mode, 'SOLO', 'practice before the recall does not change the mode');
});

test('B: the client no longer gates the exercise behind the recall', () => {
  const src = fs.readFileSync(path.join(PORTAL_ROOT, 'public', 'app.js'), 'utf8');
  const ex = src.slice(src.indexOf('function exerciseCard'), src.indexOf('function evidenceCard'));
  assert.ok(!/open after the recall/.test(ex), 'no "opens after the recall" gate in the exercise card');
  assert.match(src, /exerciseCard\(b\), recallCard\(b\)/, 'the practice comes before the recall card');
});

// ------------------------------------------------------------------ C: sensitive commands
test('C: every command that changes state is marked sensitive, carries a warning and has no quick-copy', () => {
  const ref = loadReference(PORTAL_ROOT, catalog.sprint);
  const RISKY = /\b(terraform\s+(apply|destroy|import)|force-unlock|state\s+(rm|push|mv)|blob\s+copy|lease\s+break|role\s+assignment\s+(create|delete)|group\s+delete|-auto-approve|-Execute)\b|\bazp\.ps1\s+(apply|destroy|bootstrap)\b/i;
  let sensitive = 0;
  for (const [id, r] of Object.entries(ref)) {
    if (r.pending) continue;
    for (const c of r.commands) {
      if (RISKY.test(c.cmd)) assert.equal(c.risk, 'sensitive', `${id}: "${c.what}" must be sensitive`);
      if (c.risk) assert.ok(c.warning.length >= 20, `${id}: "${c.what}" has an explicit warning`);
      if (c.risk === 'sensitive') sensitive += 1;
    }
  }
  const r3 = ref.R3.commands;
  const restore = r3.find((c) => /blob copy start/.test(c.cmd));
  assert.equal(restore.risk, 'sensitive');
  assert.match(restore.warning, /SOBRESCREVE O STATE/);
  assert.match(restore.warning, /nunca executa/i);
  assert.equal(r3.find((c) => /azp\.ps1 plan/.test(c.cmd)).risk, 'caution', 'a plan takes the lock and writes versions: a caution');
  assert.ok(!r3.some((c) => /force-unlock/.test(c.cmd)), 'force-unlock is never offered as a command');
  assert.ok(sensitive >= 1);
  assert.match(ref.R3.investigate.join(' '), /force-unlock so com decisao sua/);
});

test('C: the loader refuses an unmarked state-changing command and a warning-less risk', () => {
  const dir = tempDir('portal-ref-');
  fs.mkdirSync(path.join(dir, 'catalog'));
  const base = { concept: 'concept long enough', configure: ['a'], investigate: ['b'], mistakes: ['c'], expected: 'expected result' };
  const write = (cmd) => fs.writeFileSync(path.join(dir, 'catalog', 'reference.json'), JSON.stringify({ R3: { ...base, commands: [cmd] } }));
  write({ what: 'unlock', cmd: 'terraform -chdir=x force-unlock abc', expect: 'unlocked' });
  assert.throws(() => loadReference(dir, catalog.sprint), /must be marked sensitive/);
  write({ what: 'unlock', cmd: 'terraform -chdir=x force-unlock abc', expect: 'unlocked', risk: 'sensitive' });
  assert.throws(() => loadReference(dir, catalog.sprint), /explicit warning/);
  write({ what: 'unlock', cmd: 'terraform -chdir=x force-unlock abc', expect: 'unlocked', risk: 'sensitive', warning: 'Only after confirming nothing is running; never as a review step.' });
  assert.equal(loadReference(dir, catalog.sprint).R3.commands[0].risk, 'sensitive');
});

test('C: the client shows sensitive commands for reading only and never wires them to the terminal or the clipboard', () => {
  const src = fs.readFileSync(path.join(PORTAL_ROOT, 'public', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('function refCommand'), src.indexOf('function referenceCard'));
  const sensitiveBranch = fn.slice(fn.indexOf("c.risk === 'sensitive'"), fn.indexOf('const code = codeBlock'));
  assert.ok(sensitiveBranch.length > 0 && !/codeBlock|sendToTerminal|clipboard/.test(sensitiveBranch), 'no copy and no terminal for sensitive commands');
  const server = fs.readFileSync(path.join(PORTAL_ROOT, 'server', 'reference.js'), 'utf8');
  assert.ok(!/child_process|spawn|exec\(/.test(server), 'the reference code cannot run anything');
});

// ------------------------------------------------------------------ availability and tracks
test('availability: vacation is intensive, work days are flexible ceilings, Saturday is optional, Sunday is rest, never a penalty', () => {
  const cfg = loadSchedule(PORTAL_ROOT, catalog).availability;
  assert.equal(cfg.vacationEnds, '2026-11-12');
  assert.equal(cfg.workStarts, '2026-11-16');
  assert.equal(cfg.intensiveMinutes, 195);
  assert.equal(cfg.weekdayMaxMinutes, 120);
  const kind = (d) => availabilityFor(cfg, d);
  assert.deepEqual([kind('2026-11-09').kind, kind('2026-11-09').maxMinutes], ['vacation', 195]);
  assert.deepEqual([kind('2026-11-12').kind, kind('2026-11-12').maxMinutes], ['vacation', 195], 'the vacation includes the 12th');
  assert.deepEqual([kind('2026-11-13').kind, kind('2026-11-13').maxMinutes], ['weekday', 120], 'from the 13th: up to 120 min on a work day');
  assert.match(kind('2026-11-13').label, /16\/11/, 'the 13th is a transition; regular work starts on the 16th');
  assert.deepEqual([kind('2026-11-14').kind, kind('2026-11-14').maxMinutes], ['saturday', 120]);
  assert.deepEqual([kind('2026-11-15').kind, kind('2026-11-15').maxMinutes], ['sunday', 0]);
  assert.deepEqual([kind('2026-11-08').kind, kind('2026-11-08').maxMinutes], ['sunday', 0], 'Sunday is rest during the vacation too');
  assert.equal(kind('2026-11-17').kind, 'weekday');
  assert.match(kind('2026-11-17').message, /nem meta mínima/, '120 minutes is stated as neither an obligation nor a minimum goal');
  for (const d of ['2026-11-09', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-17']) {
    assert.equal(kind(d).penalty, false);
    assert.equal(kind(d).compensation, false);
  }
  assert.deepEqual(kind('2026-11-17').tiers.map((t) => t.id), ['tranquilo', 'normal', 'exigente', 'sobrecarga']);
  assert.match(kind('2026-11-17').tiers.find((t) => t.id === 'sobrecarga').minutes, /descanso, sem penalidade/);
});

test('availability: two tracks (70/30), AWS counted as 22 of 78 (as the course shows) without importing lessons, and the config is validated', () => {
  const cfg = loadSchedule(PORTAL_ROOT, catalog).availability;
  assert.deepEqual(cfg.tracks.map((t) => [t.id, t.share]), [['A', 70], ['B', 30]]);
  const av = buildAvailability({ cfg, dateIso: '2026-11-17', blockRecords: {}, awsRecord: null });
  assert.deepEqual([av.aws.done, av.aws.total, av.aws.next, av.aws.percent], [22, 78, 23, 28]);
  assert.equal(av.week.activeDays.length, 0, 'an empty week is valid');
  assert.match(av.week.goal, /nada é compensado/);
  assert.throws(() => parseAvailability({ ...cfg, tracks: [{ id: 'A', name: 'x', share: 60 }, { id: 'B', name: 'y', share: 30 }] }), /add up to 100/);
  assert.throws(() => parseAvailability({ ...cfg, aws: { done: 90, total: 78 } }), /done <= total/);
  assert.throws(() => parseAvailability({ ...cfg, weekdayMaxMinutes: 0 }), /whole number of minutes/);
  assert.equal(parseAvailability(null), null);
});

test('availability: active days of the week come only from recorded study, with no compensation', () => {
  const { sprint, store } = tracker();
  sprint.recordReviewPass('R1');
  const days = activeDays(store.data.sprint.blocks, null, new Date().toISOString().slice(0, 10));
  assert.ok(days.length <= 1);
  const rec = { R3: { steps: { a: { attempt: 'x', attemptAt: '2026-11-10T12:00:00' } }, reviewPasses: [{ at: '2026-11-11T09:00:00', note: '' }, { at: '2026-11-11T20:00:00', note: '' }, { at: '2026-11-02T09:00:00', note: '' }] } };
  assert.deepEqual(activeDays(rec, null, '2026-11-12'), ['2026-11-10', '2026-11-11'], 'distinct days of the Monday–Sunday week only');
  assert.deepEqual(activeDays(rec, null, '2026-11-19'), [], 'a later empty week counts nothing and creates nothing');
});

test('http: availability and AWS appear in the state; the AWS count is the only thing the course adds, and it validates input', async (t) => {
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
  assert.equal(s0.availability.aws.done, 22);
  assert.equal(s0.availability.aws.total, 78);
  assert.deepEqual(s0.availability.tracks.map((x) => x.share), [70, 30]);
  assert.equal(s0.availability.today.penalty, false);

  assert.equal((await call('POST', '/api/aws', { done: 30 })).status, 200);
  assert.equal((await call('POST', '/api/aws', { done: 99 })).status, 400, 'more lessons than the total');
  assert.equal((await call('POST', '/api/aws', { done: -1 })).status, 400);
  assert.equal((await call('POST', '/api/aws', { done: 'x' })).status, 400);
  const s1 = (await call('GET', '/api/state')).json;
  assert.equal(s1.availability.aws.done, 30);
  assert.equal(s1.availability.aws.next, 31);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'progress.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.aws).sort(), ['course', 'done', 'total', 'updatedAt'], 'only the lesson count is stored');
  assert.equal(s1.sprint.summary.done, 0, 'AWS progress completes nothing in the Platform track');
});
