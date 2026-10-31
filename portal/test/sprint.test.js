import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../server/catalog.js';
import { ProgressStore } from '../server/progress.js';
import { SprintTracker } from '../server/sprint.js';
import { loadSchedule } from '../server/schedule.js';
import { PORTAL_ROOT } from '../server/config.js';
import { fakeAz, fakeGh, gitRepo, runNode, tempDir, writeFiles } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);
const checker = (name) => path.join(PORTAL_ROOT, 'checkers', name);
const parse = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
const statusOf = (out) => Object.fromEntries(out.criteria.map((c) => [c.id, c.status]));

function tracker() {
  const store = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  return { store, sprint: new SprintTracker({ store, sprint: catalog.sprint }) };
}
const block = (id) => catalog.sprint.byId.get(id);
const allAnswers = (id) => Object.fromEntries(block(id).recall.map((q) => [q.id, 'from memory']));
const ENGLISH = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');

// Everything a learner records, except the automatic checks.
function recordEverything(sprint, id) {
  sprint.start(id);
  sprint.submitRecall(id, allAnswers(id));
  for (const s of block(id).steps) sprint.saveAttempt(id, s.id, `my attempt for ${s.id}`);
  for (const c of block(id).criteria.filter((x) => x.verify === 'review')) {
    sprint.recordReview(id, c.id, { verdict: 'pass', reviewer: 'instructor', evidence: 'pasted output and my explanation of it' });
  }
  sprint.recordEnglish(id, { answer: ENGLISH, spoken: true, seconds: 75 });
  sprint.recordFeedback(id, { technical: 2, autonomy: 1, english: 1, gaps: 'NSG default rules', next: 'Start the next block' });
}
const passingObservation = (id) => ({
  at: new Date().toISOString(),
  outcome: 'pass',
  summary: 'ok',
  criteria: block(id).criteria.filter((c) => c.verify === 'checker').map((c) => ({ id: c.id, status: 'pass', evidence: 'seen' })),
});

test('sprint catalog: six blocks of 8 hours, every block has recall, graduated steps, English and verifiable criteria', () => {
  const s = catalog.sprint;
  assert.deepEqual(s.blocks.map((b) => [b.id, b.day, b.minutes]), [['R1', 1, 60], ['R2', 1, 90], ['R3', 1, 90], ['R4', 2, 90], ['R5', 2, 90], ['R6', 2, 60]]);
  assert.equal(s.blocks.reduce((n, b) => n + b.minutes, 0), 480);
  for (const b of s.blocks) {
    assert.ok(b.recall.length >= 2, `${b.id}: recall questions`);
    assert.ok(b.steps.some((st) => st.level === 'guided') && b.steps.some((st) => st.level === 'solo'), `${b.id}: from guided to solo`);
    for (const rule of ['recall', 'attempts', 'english', 'feedback']) assert.ok(b.criteria.some((c) => c.rule === rule), `${b.id}: portal rule ${rule}`);
    assert.ok(b.criteria.some((c) => c.verify === 'review'), `${b.id}: a manual review`);
  }
  assert.deepEqual(s.byId.get('R2').reuse.sessions, ['C005']);
  assert.deepEqual(s.byId.get('R3').reuse.sessions, ['C002', 'C004']);
});

test('sprint: recall first, solutions sealed until an attempt, hints and solutions make it AI-assisted', () => {
  const { sprint } = tracker();
  assert.throws(() => sprint.submitRecall('R1', allAnswers('R1')), /Start the block/);
  sprint.start('R1');
  assert.equal(sprint.view('R1').steps, null, 'no steps before the recall');
  assert.ok(sprint.view('R1').recall.every((q) => q.answer === null));
  assert.throws(() => sprint.saveAttempt('R1', 'tools', 'x'.repeat(5)), /recall/);
  sprint.submitRecall('R1', { ...allAnswers('R1'), layers: '' });
  assert.equal(sprint.view('R1').recall.find((q) => q.id === 'layers').mine, "I don't remember");
  assert.ok(sprint.view('R1').recall.every((q) => q.answer), 'reference answers after the recall');
  assert.throws(() => sprint.submitRecall('R1', allAnswers('R1')), /already recorded/, 'recall is frozen');
  assert.throws(() => sprint.revealSolution('R1', 'tools'), /attempt first/);
  assert.equal(sprint.view('R1').mode, 'SOLO');
  sprint.saveAttempt('R1', 'tools', 'az 2.87, terraform 1.15');
  assert.equal(sprint.view('R1').steps[0].solution, null, 'saving an attempt does not open the solution');
  assert.match(sprint.revealSolution('R1', 'tools'), /Azure CLI/);
  assert.equal(sprint.view('R1').mode, 'AI_ASSISTED');
  assert.equal(sprint.revealHint('R1', 'map'), block('R1').steps.find((s) => s.id === 'map').hints[0]);
});

test('sprint: a block completes only when every criterion passes; time and partial evidence never complete it', () => {
  const { store, sprint } = tracker();
  recordEverything(sprint, 'R2');
  sprint.logTime('R2', 240);
  assert.equal(sprint.view('R2').state, 'IN_PROGRESS', 'portal + review criteria alone are not enough');
  assert.equal(sprint.criteria('R2').find((c) => c.id === 'peering-connected').status, 'pending');

  const partial = passingObservation('R2');
  partial.outcome = 'fail';
  partial.criteria[0].status = 'fail';
  sprint.recordObservation('R2', partial);
  assert.equal(sprint.view('R2').state, 'IN_PROGRESS');

  sprint.recordObservation('R2', { at: new Date().toISOString(), outcome: 'blocked', blockedReason: 'auth_error', summary: 'sign in', criteria: [] });
  const v = sprint.view('R2');
  assert.equal(v.state, 'BLOCKED');
  assert.equal(v.reason, 'auth_error');
  assert.equal(v.counts.environmentIssues, 2, 'the failed environment criterion and the auth block are counted apart');
  assert.equal(v.counts.technicalErrors, 0, 'peering-connected is an environment criterion, not the learner\'s mistake');

  sprint.recordObservation('R2', passingObservation('R2'));
  const done = sprint.view('R2');
  assert.equal(done.state, 'COMPLETED');
  assert.equal(done.completion.mode, 'SOLO');
  assert.equal(done.completion.minutes, 240);
  assert.equal(store.totals().xp, 0, 'the sprint awards no XP');
  assert.equal(store.totals().completed, 0, 'and completes no platform session');

  const reloaded = new SprintTracker({ store: new ProgressStore({ dataDir: store.dataDir, catalog }).load(), sprint: catalog.sprint });
  assert.equal(reloaded.view('R2').state, 'COMPLETED', 'progress persists');
  assert.equal(reloaded.summary().next, 'R1', 'the first pending block is next');
});

test('sprint: reviews need evidence and a named reviewer; a failed review counts as a technical error; blockers are separate', () => {
  const { sprint } = tracker();
  sprint.start('R3');
  assert.throws(() => sprint.recordReview('R3', 'plan-and-runbook-reviewed', { verdict: 'pass', reviewer: 'instructor', evidence: 'ok' }), /at least 20/);
  assert.throws(() => sprint.recordReview('R3', 'plan-and-runbook-reviewed', { verdict: 'pass', reviewer: 'someone', evidence: 'x'.repeat(30) }), /reviewer/);
  assert.throws(() => sprint.recordReview('R3', 'shared-key-disabled', { verdict: 'pass', reviewer: 'self', evidence: 'x'.repeat(30) }), /Unknown review/, 'automatic criteria cannot be passed by hand');
  sprint.recordReview('R3', 'plan-and-runbook-reviewed', { verdict: 'fail', reviewer: 'instructor', evidence: 'runbook edits the JSON by hand', note: 'missing backup and version promotion' });
  assert.equal(sprint.view('R3').counts.technicalErrors, 1);
  assert.throws(() => sprint.recordEnglish('R3', { answer: 'too short answer' }), /at least/);
  sprint.addBlocker('R3', { kind: 'access', note: '403 on blob list' });
  assert.equal(sprint.view('R3').state, 'BLOCKED');
  sprint.resolveBlocker('R3', 0);
  assert.equal(sprint.view('R3').state, 'IN_PROGRESS');
  assert.throws(() => sprint.logTime('R3', 0), /minutes/);
});

test('sprint: break/fix steps are optional for completion', () => {
  const { sprint } = tracker();
  sprint.start('R3');
  sprint.submitRecall('R3', allAnswers('R3'));
  for (const s of block('R3').steps.filter((x) => x.level !== 'breakfix')) sprint.saveAttempt('R3', s.id, 'my attempt');
  assert.equal(sprint.criteria('R3').find((c) => c.id === 'attempts-recorded').status, 'pass');
});

test('sprint: R6 is a recap with no incident and no cloud call', () => {
  const r6 = block('R6');
  assert.deepEqual(r6.prerequisites.platform, ['offline']);
  assert.ok(!r6.checker && !r6.steps.some((s) => s.level === 'breakfix'));
  assert.ok(catalog.byId.get('C003').steps[0].title.startsWith('Opening incident'), 'the incident opens C003');
});

test('schedule: replanning history must end on the current date', () => {
  const root = tempDir('portal-root-');
  const base = { start: '2026-10-19', lastDay: '2026-11-12', platform: [{ id: 'C002', date: '2026-11-01' }] };
  writeFiles(root, { 'catalog/schedule.json': JSON.stringify({ ...base, replanned: [{ kind: 'platform', id: 'C002', from: '2026-10-30', to: '2026-11-02', reason: 'x' }] }) });
  assert.throws(() => loadSchedule(root, catalog), /must end on 2026-11-01/);
  writeFiles(root, { 'catalog/schedule.json': JSON.stringify({ ...base, replanned: [{ kind: 'platform', id: 'C002', from: '2026-10-30', to: '2026-11-01', reason: 'sprint' }] }) });
  assert.deepEqual(loadSchedule(root, catalog).items[0].replans, [{ from: '2026-10-30', to: '2026-11-01', decidedAt: null, reason: 'sprint' }]);
  writeFiles(root, { 'catalog/schedule.json': JSON.stringify({ ...base, sprint: { '2026-10-30': ['R7'] } }) });
  assert.throws(() => loadSchedule(root, catalog), /unknown sprint block R7/);
});

// ---------------------------------------------------------------- checkers
const drillSolution = (id) => block(id).steps.find((s) => s.id === 'drill').solution;
function dataDirWith(files) {
  const dir = tempDir('portal-data-');
  writeFiles(dir, Object.fromEntries(Object.entries(files).map(([k, v]) => [`drills/${k}`, v])));
  return dir;
}

test('R4 checker: the reference drill passes, a missing file and a secret fail', () => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const missing = parse(runNode(checker('sprint-r4-github.js'), { PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir() }));
  assert.equal(statusOf(missing)['drill-triggers'], 'fail');
  assert.equal(statusOf(missing)['lab-environment-protected'], 'skipped', 'no GitHub remote: environment, not the learner');

  const env = { PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: dataDirWith({ 'r4-infra-plan.yml': drillSolution('R4') }) };
  const ok = parse(runNode(checker('sprint-r4-github.js'), env));
  assert.deepEqual([statusOf(ok)['drill-triggers'], statusOf(ok)['drill-oidc'], statusOf(ok)['drill-gated-apply']], ['pass', 'pass', 'pass'], JSON.stringify(ok));

  const leaky = drillSolution('R4').replace('ARM_USE_OIDC: \'true\'', "ARM_CLIENT_SECRET: ${{ secrets.SP_SECRET }}");
  const bad = parse(runNode(checker('sprint-r4-github.js'), { ...env, PORTAL_DATA_DIR: dataDirWith({ 'r4-infra-plan.yml': leaky.replace('  id-token: write\n', '') }) }));
  assert.equal(statusOf(bad)['drill-oidc'], 'fail');
});

test('R4 checker: lab environment protection read through gh', () => {
  const { root, git } = gitRepo({ 'README.md': 'x\n' });
  git('remote', 'add', 'origin', 'https://github.com/acme/platform.git');
  const gh = fakeGh({ 'api repos/acme/platform/environments/lab': { stdout: { protection_rules: [{ type: 'required_reviewers' }] } } });
  const out = parse(runNode(checker('sprint-r4-github.js'), { PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir(), PORTAL_FAKE_GH: gh }));
  assert.equal(statusOf(out)['lab-environment-protected'], 'pass');
});

test('R5 checker: the reference drill passes; parallel apply, no template and a password fail', () => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const run = (yml) => parse(runNode(checker('sprint-r5-ado.js'), { PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: dataDirWith({ 'r5-infra-pipeline.yml': yml }) }));
  const ok = run(drillSolution('R5'));
  assert.equal(ok.outcome, 'pass', JSON.stringify(ok));
  const parallel = run(drillSolution('R5').replace('dependsOn: Plan', 'dependsOn: []'));
  assert.equal(statusOf(parallel)['drill-stages'], 'fail');
  const flat = run(drillSolution('R5').replaceAll('- template: templates/terraform-layer.yml', '- script: echo plan').replace('  - group: mfs-lab-common\n', '  - name: password\n    value: hunter2\n'));
  assert.equal(statusOf(flat)['drill-template'], 'fail');
  assert.equal(statusOf(flat)['drill-variables'], 'fail');
  assert.equal(statusOf(flat)['drill-service-connection'], 'fail');
});

test('R3 checker: protected state passes; a leased blob is a stale lock; no sign-in is an environment block', () => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const blobs = (lease) => ['05-identity', '10-foundation', '20-governance'].map((l) => ({ name: `${l}.tfstate`, version: '1', lease: l === '10-foundation' ? lease : 'available' }));
  const responses = (lease) => ({
    'account show': { stdout: { id: 'sub-1', name: 'lab' } },
    'storage account list -g rg-mfs-tfstate --query [].{name:name, id:id}': { stdout: [{ name: 'sttf', id: '/sa' }] },
    'storage account show -n sttf -g rg-mfs-tfstate': { stdout: { allowSharedKeyAccess: false, allowBlobPublicAccess: false, minimumTlsVersion: 'TLS1_2' } },
    'storage account blob-service-properties show -n sttf -g rg-mfs-tfstate': { stdout: { isVersioningEnabled: true, deleteRetentionPolicy: { enabled: true, days: 7 } } },
    'storage blob list --account-name sttf -c tfstate --auth-mode login --query [].{name:name, version:versionId, lease:properties.lease.state} --include v': { stdout: [...blobs('available'), { name: '20-governance.tfstate', version: '2' }] },
    'storage blob list --account-name sttf -c tfstate --auth-mode login --query [].{name:name, version:versionId, lease:properties.lease.state}': { stdout: blobs(lease) },
  });
  const ok = parse(runNode(checker('sprint-r3-state.js'), { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz(responses('available')) }));
  assert.equal(ok.outcome, 'pass', JSON.stringify(ok));
  const locked = parse(runNode(checker('sprint-r3-state.js'), { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz(responses('leased')) }));
  assert.equal(statusOf(locked)['no-stale-lock'], 'fail');
  const signedOut = parse(runNode(checker('sprint-r3-state.js'), { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz({ 'account show': { code: 1, stderr: 'Please run az login' } }) }));
  assert.equal(signedOut.outcome, 'blocked');
  assert.equal(signedOut.blockedReason, 'auth_error');
});

test('sprint checkers never write: no az/gh mutation verbs in their source', () => {
  for (const f of fs.readdirSync(path.join(PORTAL_ROOT, 'checkers')).filter((x) => x.startsWith('sprint-'))) {
    const src = fs.readFileSync(path.join(PORTAL_ROOT, 'checkers', f), 'utf8');
    assert.ok(!/'(create|delete|update|set|apply|destroy|start|stop|break|lock|unlock|rerun|edit)'/.test(src), `${f} uses only read verbs`);
  }
});
