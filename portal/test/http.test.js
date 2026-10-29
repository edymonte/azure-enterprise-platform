import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { gitRepo, hasCommand, tempDir, writeFiles } from './helpers.js';

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('http: loopback only, host/origin/token checks, allow-listed ids, no secrets in state', async (t) => {
  assert.throws(() => loadConfig({ PORTAL_HOST: '0.0.0.0' }), /loopback/);

  const { root } = gitRepo({ 'README.md': 'x\n' });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const app = createApp({ ...loadConfig({ PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir(), PORTAL_PORT: String(port) }) });
  await app.start();
  t.after(() => app.stop());
  const json = { 'Content-Type': 'application/json', 'X-Portal-Token': app.token };

  const index = await request(port);
  assert.equal(index.status, 200);
  assert.match(index.body, new RegExp(app.token));
  assert.match(index.headers['content-security-policy'], /default-src 'none'/);

  assert.equal((await request(port, { headers: { Host: 'evil.example' } })).status, 421, 'DNS rebinding');
  assert.equal((await request(port, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } })).status, 200, 'opening the page from a link elsewhere works');
  assert.equal((await request(port, { path: '/api/state' })).status, 401, 'token required');
  assert.equal((await request(port, { path: '/api/events?token=wrong' })).status, 401);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, Origin: 'http://evil.example' }, body: '{}' })).status, 403, 'cross-origin');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, 'Content-Type': 'text/plain' }, body: '{}' })).status, 400, 'simple form posts refused');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C999/start', headers: json, body: '{}' })).status, 404, 'unknown session');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/..%2Fx/start', headers: json, body: '{}' })).status, 404);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/exec', headers: json, body: '{"cmd":"rm -rf /"}' })).status, 404, 'no arbitrary actions');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: json, body: 'x'.repeat(40000) })).status, 400, 'body limit');
  assert.equal((await request(port, { path: '/../server/app.js' })).status, 404, 'no static traversal');
  // Every session is dated in the current plan, so the sequential lock is covered in az400.test.js; here a dated session must start.
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C002/start', headers: json, body: '{}' })).status, 200, 'scheduled session starts');

  assert.equal((await request(port, { method: 'POST', path: '/api/terminal/input', headers: json, body: '{"line":"whoami"}' })).status, 404, 'terminal is off by default');

  const state = JSON.parse((await request(port, { path: '/api/state', headers: json })).body);
  assert.equal(state.sessions.length, 30);
  assert.ok(state.sessions.every((s) => s.hints === undefined && s.debrief === null), 'hints and debriefs are not sent before they are earned');
  assert.ok(!JSON.stringify(state).includes(app.token), 'token not echoed in state');
});

test('http: opt-in terminal runs a line and keeps the same protections', { skip: !hasCommand('pwsh', ['-NoLogo', '-NoProfile', '-Command', 'exit 0']) && 'pwsh not installed' }, async (t) => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const app = createApp({ ...loadConfig({ PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir(), PORTAL_PORT: String(port), PORTAL_TERMINAL: '1' }) });
  await app.start();
  t.after(() => app.stop());
  const json = { 'Content-Type': 'application/json', 'X-Portal-Token': app.token };

  assert.equal((await request(port, { method: 'POST', path: '/api/terminal/input', headers: { 'Content-Type': 'application/json' }, body: '{"line":"whoami"}' })).status, 401, 'token required');
  assert.equal((await request(port, { method: 'POST', path: '/api/terminal/input', headers: { ...json, Origin: 'http://evil.example' }, body: '{"line":"whoami"}' })).status, 403, 'cross-origin refused');
  assert.equal((await request(port, { method: 'POST', path: '/api/terminal/input', headers: json, body: JSON.stringify({ line: 'a\nb' }) })).status, 400, 'single line only');

  const deadline = Date.now() + 20000;
  while (app.terminal.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await request(port, { method: 'POST', path: '/api/terminal/input', headers: json, body: JSON.stringify({ line: 'Write-Output "portal-ok-$((1+1))"' }) })).status, 200);
  while (!/portal-ok-2/.test(app.terminal.buffer) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.match(app.terminal.buffer, /portal-ok-2/);
  const state = JSON.parse((await request(port, { path: '/api/state', headers: json })).body);
  assert.equal(state.meta.terminal.enabled, true);
});

test('http: AZ-400 questions hide the answers until the quiz is submitted', async (t) => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  const course = tempDir('az400-http-');
  writeFiles(course, {
    'curriculum/lab-content.yml': JSON.stringify({ labs: [{ id: '09', slug: '09-ci', title: 'CI', domain: 'pipelines', checkpoints: [{ id: 'CP1', title: 'T', commands: 'Write-Output 1' }] }] }),
    'labs/09-ci/questions.yml': JSON.stringify({ sources: [{ id: 'S1', url: 'https://docs.github.com/doc' }], questions: [{ id: 'L09-Q001', question: 'Q?', options: [{ key: 'A', text: 'a', rationale: 'right' }, { key: 'B', text: 'b', rationale: 'wrong' }], correctAnswers: ['A'], explanation: 'secret', sourceIds: ['S1'] }] }),
    'labs/09-ci/evidence.json': JSON.stringify({ schemaVersion: 1, labId: '09', items: { 'L09-Q001': { sourceId: 'S1', highlight: 'hidden proof phrase', support: 'direct', summary: 'hidden evidence summary' } } }),
  });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const app = createApp({ ...loadConfig({ PORTAL_REPO_ROOT: root, PORTAL_DATA_DIR: tempDir(), PORTAL_PORT: String(port), PORTAL_AZ400_ROOT: course }) });
  await app.start();
  t.after(() => app.stop());
  const json = { 'Content-Type': 'application/json', 'X-Portal-Token': app.token };

  assert.equal((await request(port, { path: '/api/az400/09/questions' })).status, 401, 'token required');
  const qs = await request(port, { path: '/api/az400/09/questions', headers: json });
  assert.equal(qs.status, 200);
  assert.doesNotMatch(qs.body, /right|wrong|secret|correct/, 'no answers, rationales or explanation before submission');
  assert.doesNotMatch(qs.body, /hidden|docs\.github\.com/, 'no evidence or sources before submission');
  assert.equal(JSON.parse(qs.body)[0].pick, 1);
  assert.match((await request(port, { path: '/api/az400/09/detail', headers: json })).body, /Write-Output 1/);
  assert.equal((await request(port, { path: '/api/az400/42/detail', headers: json })).status, 404);

  assert.equal((await request(port, { method: 'POST', path: '/api/az400/09/quiz', headers: json, body: '{"answers":[]}' })).status, 400);
  const graded = JSON.parse((await request(port, { method: 'POST', path: '/api/az400/09/quiz', headers: json, body: '{"answers":{"L09-Q001":["A"]}}' })).body);
  assert.equal(graded.pct, 100);
  assert.equal(graded.review[0].explanation, 'secret', 'answers come back with the grade');
  assert.equal(graded.review[0].evidence.summary, 'hidden evidence summary', 'evidence comes back with the grade');
  assert.equal(app.progress.az400().scores['09'], 100);
});
