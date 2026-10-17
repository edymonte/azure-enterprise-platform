import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { gitRepo, hasCommand, tempDir } from './helpers.js';

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
  assert.equal((await request(port, { path: '/api/state' })).status, 401, 'token required');
  assert.equal((await request(port, { path: '/api/events?token=wrong' })).status, 401);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, Origin: 'http://evil.example' }, body: '{}' })).status, 403, 'cross-origin');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: { ...json, 'Content-Type': 'text/plain' }, body: '{}' })).status, 400, 'simple form posts refused');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C999/start', headers: json, body: '{}' })).status, 404, 'unknown session');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/..%2Fx/start', headers: json, body: '{}' })).status, 404);
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/exec', headers: json, body: '{"cmd":"rm -rf /"}' })).status, 404, 'no arbitrary actions');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C001/start', headers: json, body: 'x'.repeat(5000) })).status, 400, 'body limit');
  assert.equal((await request(port, { path: '/../server/app.js' })).status, 404, 'no static traversal');
  assert.equal((await request(port, { method: 'POST', path: '/api/sessions/C002/start', headers: json, body: '{}' })).status, 400, 'locked');

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
