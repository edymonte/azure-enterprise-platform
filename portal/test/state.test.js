import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../server/catalog.js';
import { ProgressStore, UserError, rewardsFor } from '../server/progress.js';
import { parseCheckerOutput, Runner } from '../server/runner.js';
import { PORTAL_ROOT } from '../server/config.js';
import { tempDir, writeFiles } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);
const obs = (outcome, extra = {}) => ({ outcome, at: new Date().toISOString(), criteria: [], ...extra });
const passAll = (id) => obs('pass', { criteria: catalog.byId.get(id).criteria.map((c) => ({ id: c.id, status: 'pass', evidence: '' })) });

test('catalog: 30 contiguous sessions, every one with real content', () => {
  assert.equal(catalog.sessions.length, 30);
  for (const s of catalog.sessions) {
    assert.ok(s.steps.length >= 2, `${s.id} steps`);
    assert.ok(s.hints.length >= 3, `${s.id} hints`);
    assert.ok(s.criteria.length >= 2, `${s.id} criteria`);
    assert.ok(s.scenario.length > 40, `${s.id} scenario`);
    if (s.checker.status === 'planned') assert.equal(s.validation.status, 'pending', `${s.id} planned checker cannot be validated`);
  }
  assert.deepEqual(catalog.sessions.filter((s) => s.checker.status === 'implemented').map((s) => s.id), ['C001', 'C014']);
});

test('progress: sequential unlock, start, failures, blocks and a single completion', () => {
  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  assert.deepEqual(p.stateOf('C001'), { state: 'AVAILABLE', reason: null });
  assert.deepEqual(p.stateOf('C002'), { state: 'BLOCKED', reason: 'locked' });
  assert.throws(() => p.start('C002'), UserError);

  // A pass before the session is started never completes it.
  assert.equal(p.recordObservation('C001', passAll('C001')).completed, false);

  p.start('C001');
  assert.equal(p.stateOf('C001', { running: true }).state, 'CHECKING');
  p.recordObservation('C001', obs('fail'));
  assert.equal(p.stateOf('C001').state, 'FAILED');
  p.recordObservation('C001', obs('blocked', { blockedReason: 'auth_error' }));
  assert.deepEqual(p.stateOf('C001'), { state: 'BLOCKED', reason: 'auth_error' });
  p.recordObservation('C001', obs('error'));
  assert.deepEqual(p.stateOf('C001'), { state: 'BLOCKED', reason: 'validation_error' });
  assert.deepEqual(p.stateOf('C001', { envBlock: 'platform_stopped' }), { state: 'BLOCKED', reason: 'platform_stopped' });

  const first = p.recordObservation('C001', passAll('C001'));
  assert.equal(first.completed, true);
  assert.equal(first.mode, 'SOLO');
  assert.deepEqual(first.rewards, rewardsFor(catalog.byId.get('C001'), 'SOLO', 0));
  assert.equal(p.recordObservation('C001', passAll('C001')).completed, false, 'completion is recorded once');
  assert.equal(p.stateOf('C001').state, 'COMPLETED');
  // A later failure (e.g. platform destroyed) does not undo a verified completion.
  p.recordObservation('C001', obs('fail'));
  assert.equal(p.stateOf('C001').state, 'COMPLETED');
  assert.equal(p.stateOf('C002').state, 'AVAILABLE');
  assert.equal(p.totals().xp, 200);
});

test('progress: hints make the attempt AI-assisted and cost coins; assessment only after completion', () => {
  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  assert.throws(() => p.revealHint('C001'), UserError);
  p.start('C001');
  const h1 = p.revealHint('C001');
  assert.equal(h1.level, 1);
  assert.equal(h1.text, catalog.byId.get('C001').hints[0]);
  assert.throws(() => p.setAssessment('C001', { english: 2, autonomy: 2, tradeoffs: 2 }), UserError);
  const done = p.recordObservation('C001', passAll('C001'));
  assert.equal(done.mode, 'AI_ASSISTED');
  assert.equal(done.rewards.coins, 20 - 2);
  assert.throws(() => p.setAssessment('C001', { english: 3, autonomy: 0, tradeoffs: 0 }), UserError);
  const a = p.setAssessment('C001', { english: 1, autonomy: 2, tradeoffs: 1, notes: 'ok' });
  assert.equal(a.english, 1);
  // Persisted to disk and reloadable.
  const again = new ProgressStore({ dataDir: p.dataDir, catalog }).load();
  assert.equal(again.stateOf('C001').state, 'COMPLETED');
});

test('progress: the evidence-console history is bounded and carries no evidence text', () => {
  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  p.start('C001');
  for (let i = 0; i < 25; i++) p.recordObservation('C001', obs('fail', { trigger: `run ${i}`, criteria: [{ id: 'rule-accepted-syntax', status: 'fail', evidence: 'long text' }] }));
  const { history } = p.peek('C001');
  assert.equal(history.length, 20);
  assert.equal(history.at(-1).trigger, 'run 24');
  assert.deepEqual(history.at(-1).criteria, [{ id: 'rule-accepted-syntax', status: 'fail' }]);
});

test('progress: validation mode unlocks sessions but completion still needs a pass', () => {
  const p = new ProgressStore({ dataDir: tempDir(), catalog, unlockAll: true }).load();
  assert.equal(p.stateOf('C014').state, 'AVAILABLE');
  p.start('C014');
  p.recordObservation('C014', obs('fail'));
  assert.equal(p.stateOf('C014').state, 'FAILED');
});

test('checker contract: anything off-contract is an internal error, never a pass', () => {
  const s = catalog.byId.get('C014');
  const line = (o) => JSON.stringify({ schema: 'portal.checker/v1', ...o });
  assert.equal(parseCheckerOutput('garbage', s).outcome, 'error');
  assert.equal(parseCheckerOutput('{"broken', s).outcome, 'error');
  assert.equal(parseCheckerOutput(line({ outcome: 'pass', criteria: [{ id: 'helm-lint', status: 'pass' }] }), s).outcome, 'error', 'partial pass');
  assert.equal(parseCheckerOutput(line({ outcome: 'fail', criteria: [{ id: 'nope', status: 'pass' }] }), s).outcome, 'error', 'unknown criterion');
  assert.equal(parseCheckerOutput(line({ outcome: 'blocked', blockedReason: 'locked', criteria: [] }), s).outcome, 'error', 'locked is reserved');
  const all = s.criteria.map((c) => ({ id: c.id, status: 'pass', evidence: `Bearer eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(10)}` }));
  const ok = parseCheckerOutput(`noise before\n${line({ outcome: 'pass', criteria: all })}`, s);
  assert.equal(ok.outcome, 'pass');
  assert.ok(!ok.criteria[0].evidence.includes('eyJ'), 'evidence is redacted');
});

function fakeRunnerSetup(scriptBody, { timeoutSeconds = 30 } = {}) {
  const portalRoot = tempDir('portal-root-');
  writeFiles(portalRoot, { 'checkers/fake.js': scriptBody });
  const session = {
    id: 'C001', number: 1, prerequisites: { platform: ['offline'] }, criteria: [{ id: 'one', text: 'one' }],
    checker: { status: 'implemented', script: 'checkers/fake.js', timeoutSeconds, pollSeconds: 60, watch: [] },
  };
  const fakeCatalog = { sessions: [session], byId: new Map([['C001', session]]) };
  const probe = { blockFor: () => null };
  const runner = new Runner({ config: { portalRoot, repoRoot: portalRoot, pollSecondsOverride: 0, maxBackoffSeconds: 600 }, catalog: fakeCatalog, probe });
  const finished = [];
  runner.on('finished', (e) => finished.push(e.observation));
  const waitFor = (n) => new Promise((resolve) => {
    const t = setInterval(() => { if (finished.length >= n && !runner.isRunning('C001')) { clearInterval(t); resolve(); } }, 50);
  });
  return { runner, finished, waitFor, session };
}

const PASS_LINE = 'console.log(JSON.stringify({schema:"portal.checker/v1",outcome:"pass",criteria:[{id:"one",status:"pass",evidence:"ok"}]}))';

test('runner: concurrent triggers coalesce into one extra run', async () => {
  const counter = path.join(tempDir(), 'count');
  // The fake checker lives in a temp dir without package.json, so it runs as CommonJS.
  const { runner, finished, waitFor } = fakeRunnerSetup(`
    require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');
    setTimeout(() => { ${PASS_LINE} }, 400);`);
  runner.trigger('C001', 'a');
  runner.trigger('C001', 'b');
  runner.trigger('C001', 'c');
  await waitFor(2);
  assert.equal(finished.length, 2, 'one run + one coalesced re-run');
  assert.equal(fs.readFileSync(counter, 'utf8').length, 2);
  assert.match(finished[1].trigger, /coalesced/);
  runner.stop();
});

test('runner: timeout and cancellation never produce a pass', async () => {
  const slow = fakeRunnerSetup('setTimeout(() => {}, 60000);', { timeoutSeconds: 5 });
  slow.runner.trigger('C001', 'manual');
  await slow.waitFor(1);
  assert.equal(slow.finished[0].outcome, 'error');
  assert.match(slow.finished[0].summary, /timed out/);
  slow.runner.stop();

  const cancel = fakeRunnerSetup('setTimeout(() => {}, 60000);');
  cancel.runner.trigger('C001', 'manual');
  setTimeout(() => cancel.runner.cancel('C001'), 300);
  await cancel.waitFor(1);
  assert.equal(cancel.finished[0].outcome, 'cancelled');
  cancel.runner.stop();
});

test('runner: backoff doubles on non-definitive outcomes and resets on a definitive one', async () => {
  const { runner, session } = fakeRunnerSetup(PASS_LINE);
  assert.equal(runner.pollDelaySeconds(session), 60);
  runner.updateBackoff('C001', { outcome: 'error' });
  runner.updateBackoff('C001', { outcome: 'blocked', blockedReason: 'auth_error' });
  assert.equal(runner.pollDelaySeconds(session), 240);
  for (let i = 0; i < 10; i++) runner.updateBackoff('C001', { outcome: 'error' });
  assert.equal(runner.pollDelaySeconds(session), 600, 'capped');
  runner.updateBackoff('C001', { outcome: 'fail' });
  assert.equal(runner.pollDelaySeconds(session), 60);
  runner.stop();
});

test('runner: environment blocks skip the checker with the right reason', async () => {
  const setup = fakeRunnerSetup(PASS_LINE);
  setup.runner.probe = { blockFor: () => 'platform_stopped' };
  setup.runner.trigger('C001', 'manual');
  await setup.waitFor(1);
  assert.equal(setup.finished[0].outcome, 'blocked');
  assert.equal(setup.finished[0].blockedReason, 'platform_stopped');
  setup.runner.stop();
});

test('study plan and interview practice are self-tracked and allow-listed', () => {
  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  assert.ok(catalog.studyPlan.itemIds.size >= 10);
  p.setStudyItem('az400-m12', true);
  assert.equal(p.data.study['az400-m12'].done, true);
  assert.throws(() => p.setStudyItem('../etc', true), UserError);
  assert.throws(() => p.setStudyItem('az400-m12', 'yes'), UserError);
  assert.equal(p.recordInterviewPractice('C001').passes, 1);
  assert.equal(p.recordInterviewPractice('C001').passes, 2);
  // Self-tracked marks never unlock sessions.
  assert.equal(p.stateOf('C002').state, 'BLOCKED');
});
