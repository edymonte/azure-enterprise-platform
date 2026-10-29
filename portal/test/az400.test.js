import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Az400 } from '../server/az400.js';
import { loadSchedule } from '../server/schedule.js';
import { loadCatalog } from '../server/catalog.js';
import { ProgressStore } from '../server/progress.js';
import { PORTAL_ROOT } from '../server/config.js';
import { tempDir, writeFiles } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);

function courseFixture() {
  const root = tempDir('az400-course-');
  const cp = (n) => ({ id: `CP${n}`, title: `Task ${n}`, expected: 'ok', fix: 'retry' });
  writeFiles(root, {
    'curriculum/lab-content.yml': JSON.stringify({ labs: [
      { id: '00', slug: '00-safe-bootstrap', title: 'Bootstrap', domain: 'foundation', minutes: 60, cost: 'none', platforms: ['local'], scenario: 's', role: 'r', primer: 'p', checkpoints: [1, 2, 3, 4, 5].map(cp) },
      { id: '09', slug: '09-github-actions-ci', title: 'GitHub Actions CI', domain: 'pipelines', minutes: 120, cost: 'none', platforms: ['local', 'github'], scenario: 's', role: 'r', primer: 'p', checkpoints: [1, 2, 3, 4, 5].map(cp) },
    ] }),
    'labs/09-github-actions-ci/questions.yml': JSON.stringify({ sources: [{ id: 'S1', url: 'https://docs.github.com/x' }], questions: [
      { id: 'L09-Q001', checkpointId: 'CP1', difficulty: 'foundational', question: 'One?', options: [{ key: 'A', text: 'a', rationale: 'yes' }, { key: 'B', text: 'b', rationale: 'no' }], correctAnswers: ['A'], explanation: 'because', sourceIds: ['S1'] },
      { id: 'L09-Q002', question: 'Two?', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }], correctAnswers: ['A', 'C'] },
    ] }),
  });
  return root;
}
const validation = (labId, runId, status, verifiedAt) => JSON.stringify({
  schemaVersion: '2.0.0', labId, runId, status, verifiedAt, breakFix: status === 'passed' ? 'passed' : 'missing', integration: 'not-required',
  checkpoints: [1, 2, 3, 4, 5].map((n) => ({ id: `CP${n}`, status: status === 'passed' ? 'passed' : 'failed' })),
});

test('az400: reads the course catalog and the latest validation.json per lab', async () => {
  const root = courseFixture();
  const az = await new Az400({ root }).load();
  assert.equal(az.available, true);
  assert.deepEqual(az.labs.map((l) => l.id), ['00', '09']);
  assert.equal(az.labs[1].checkpoints.length, 5);
  assert.deepEqual(az.evidence, {});

  writeFiles(root, {
    '.state/09/l09-a/validation.json': validation('09', 'l09-a', 'partial', '2026-10-27T10:00:00Z'),
    '.state/09/l09-b/validation.json': `﻿${validation('09', 'l09-b', 'passed', '2026-10-27T12:00:00Z')}`,
    '.state/09/../../escape/validation.json': validation('09', 'x', 'passed', '2026-10-27T13:00:00Z'),
    '.state/10/l10-a/validation.json': validation('09', 'l10-a', 'passed', '2026-10-28T10:00:00Z'),
  });
  assert.equal(az.scan(), true);
  assert.equal(az.evidence['09'].status, 'passed', 'latest run wins; BOM tolerated');
  assert.equal(az.evidence['09'].runId, 'l09-b');
  assert.equal(az.evidence['10'], undefined, 'labId inside the file must match the folder');
});

test('az400: task detail, questions and server-side grading', async () => {
  const root = courseFixture();
  const lc = JSON.parse(fs.readFileSync(path.join(root, 'curriculum/lab-content.yml'), 'utf8'));
  lc.labs[1].checkpoints[0].commands = 'Write-Output 1\r\nWrite-Output 2\n';
  lc.labs[1].breakFix = { trigger: 't', diagnose: 'd', repair: 'r', assert: 'a', expectedFailure: 'AZ400-L09-FAULT' };
  writeFiles(root, { 'curriculum/lab-content.yml': JSON.stringify(lc) });
  const az = await new Az400({ root }).load();
  const d = az.detail('09');
  assert.equal(d.checkpoints[0].commands, 'Write-Output 1\nWrite-Output 2', 'line endings normalised');
  assert.equal(d.breakFix.expectedFailure, 'AZ400-L09-FAULT');
  assert.equal(az.detail('42'), null);
  assert.equal(az.labs[1].breakFix, undefined, 'the pushed state keeps only the summary');

  const qs = az.questions('09');
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[0].sources, ['https://docs.github.com/x']);
  assert.deepEqual(az.questions('00'), [], 'no questions file');
  assert.equal(qs[0].evidence, null, 'no evidence file');
  writeFiles(root, { 'labs/09-github-actions-ci/evidence.json': JSON.stringify({ schemaVersion: 1, labId: '09', items: {
    'L09-Q001': { sourceId: 'S1', highlight: 'pull-request, checks & reviews', support: 'direct', summary: 'The page says so.' },
    'L09-Q002': { sourceId: 'S9', highlight: 'unknown source is dropped', support: 'direct', summary: 'x' },
  } }) });
  const withEv = az.questions('09');
  assert.equal(withEv[0].evidence.url, 'https://docs.github.com/x');
  assert.equal(withEv[0].evidence.highlightUrl, 'https://docs.github.com/x#:~:text=pull%2Drequest%2C%20checks%20%26%20reviews', 'text fragment escapes - , &');
  assert.equal(withEv[0].evidence.support, 'direct');
  assert.equal(withEv[1].evidence, null, 'evidence must point at a known source');
  assert.deepEqual(az.grade('09', { 'L09-Q001': ['A'], 'L09-Q002': ['C', 'A'] }), { total: 2, correct: 2, pct: 100, wrong: [] });
  assert.deepEqual(az.grade('09', { 'L09-Q001': ['A', 'B'], 'L09-Q002': ['A'] }), { total: 2, correct: 0, pct: 0, wrong: ['L09-Q001', 'L09-Q002'] }, 'exact set only');
  assert.equal(az.grade('00', {}), null);

  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  p.recordAz400Quiz('09', az.grade('09', { 'L09-Q001': ['A'] }));
  assert.equal(p.az400().scores['09'], 50, 'the quiz sets the score');
  assert.equal(p.az400().quizzes['09'].length, 1);
  assert.throws(() => p.recordAz400Quiz('../x', { correct: 0, total: 1, pct: 0, wrong: [] }));
});

test('az400: a missing course is reported, not fatal', async () => {
  const az = await new Az400({ root: path.join(tempDir(), 'nope') }).load();
  assert.equal(az.available, false);
  assert.match(az.error, /not found/);
});

test('az400: a passing validation completes a lab once, with XP; steps and scores are self-tracked', async () => {
  const root = courseFixture();
  const az = await new Az400({ root }).load();
  const p = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  p.setAz400Step('09', 'read', true);
  p.setAz400Score('09', 88);
  p.setAz400Run('holiday');
  assert.throws(() => p.setAz400Step('../x', 'read', true));
  assert.throws(() => p.setAz400Score('09', 140));
  assert.throws(() => p.setAz400Run('Bad Suffix!'));
  assert.equal(p.az400().run, 'holiday');

  writeFiles(root, { '.state/09/l09-holiday/validation.json': validation('09', 'l09-holiday', 'failed', '2026-10-27T10:00:00Z') });
  az.scan();
  assert.deepEqual(p.recordAz400Evidence(az.evidence, az.labs), [], 'a failed validation completes nothing');

  writeFiles(root, { '.state/09/l09-holiday2/validation.json': validation('09', 'l09-holiday2', 'passed', '2026-10-27T11:00:00Z') });
  az.scan();
  const fresh = p.recordAz400Evidence(az.evidence, az.labs);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].rewards.xp, 150);
  assert.equal(p.recordAz400Evidence(az.evidence, az.labs).length, 0, 'only once');
  assert.equal(p.totals().xp, 150);
  const today = p.timeline(30).at(-1);
  assert.ok(today.steps >= 1 && today.completions >= 1);
});

test('schedule: recovery sprint first, then one sequence with every session and lab dated, scheduled sessions unlocked', () => {
  const s = loadSchedule(PORTAL_ROOT, catalog);
  const az = s.items.filter((i) => i.kind === 'az400');
  assert.equal(az[0].id, 'prep', 'preparation first on day one');
  assert.equal(az.find((i) => i.id === '01').date, '2026-10-20');
  assert.deepEqual(s.sprintDays, ['2026-10-30', '2026-10-31']);
  const sprint = s.items.filter((i) => i.kind === 'sprint');
  assert.deepEqual(sprint.map((i) => `${i.id}@${i.date}`), ['R1@2026-10-30', 'R2@2026-10-30', 'R3@2026-10-30', 'R4@2026-10-31', 'R5@2026-10-31', 'R6@2026-10-31']);
  const pending = s.items.filter((i) => i.kind !== 'sprint' && i.date > '2026-10-22');
  assert.ok(pending.every((i) => i.date > '2026-10-31'), 'everything still pending comes after the sprint');
  assert.equal(az.length, 29, 'preparation + all 28 AZ-400 labs are back in the sequence');
  const lab04 = az.find((i) => i.id === '04');
  assert.equal(lab04.date, '2026-11-01');
  assert.equal(lab04.replans[0].from, '2026-10-28', 'the overdue original date is kept');
  assert.match(lab04.replans[0].reason, /overdue/i);
  for (const day of new Set(s.items.filter((i) => i.date <= s.lastDay && i.date > '2026-10-31').map((i) => i.date))) {
    assert.ok(s.items.filter((i) => i.date === day).length <= 2, `${day}: at most one platform session and one AZ-400 lab (4 h a day)`);
  }
  assert.equal(s.scheduledSessions.size, 30, 'every platform session has a date');
  const p = new ProgressStore({ dataDir: tempDir(), catalog, scheduledSessions: s.scheduledSessions }).load();
  assert.equal(p.stateOf('C014').state, 'AVAILABLE', 'scheduled session is unlocked');
  fs.rmSync(tempDir(), { recursive: true, force: true });
  const unplanned = new ProgressStore({ dataDir: tempDir(), catalog, scheduledSessions: new Set() }).load();
  assert.equal(unplanned.stateOf('C002').state, 'BLOCKED', 'unscheduled sessions keep the sequential lock');
  fs.rmSync(tempDir(), { recursive: true, force: true });
});
