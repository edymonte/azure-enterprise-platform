'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  delete process.env.SQL_SERVER; // force in-memory mode
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('healthz returns ok', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('products are served from the in-memory catalog', async () => {
  const res = await fetch(`${base}/api/products`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 3);
});

test('metrics expose http_requests_total', async () => {
  const body = await (await fetch(`${base}/metrics`)).text();
  assert.match(body, /http_requests_total/);
});

test('chaos error rate 1 fails business routes but not probes', async () => {
  process.env.CHAOS_ERROR_RATE = '1';
  try {
    assert.equal((await fetch(`${base}/api/products`)).status, 500);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally {
    delete process.env.CHAOS_ERROR_RATE;
  }
});
