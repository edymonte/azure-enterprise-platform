'use strict';

const fs = require('node:fs');
const express = require('express');
const client = require('prom-client');
const db = require('./db');

const VERSION = process.env.APP_VERSION || 'dev';
const BANNER_FILE = process.env.BANNER_FILE || '/mnt/secrets/portal-banner';

// ---------------------------------------------------------------------------
// Prometheus metrics (scraped by Azure Managed Prometheus via PodMonitor)
// ---------------------------------------------------------------------------
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route and status code',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Chaos flags — driven by Helm values through GitOps (game days)
// ---------------------------------------------------------------------------
function chaosSettings() {
  return {
    errorRate: Number(process.env.CHAOS_ERROR_RATE || 0),
    latencyMs: Number(process.env.CHAOS_LATENCY_MS || 0),
  };
}

function readBanner() {
  // Key Vault secret mounted by the Secrets Store CSI driver (rotates every 2m).
  try {
    return fs.readFileSync(BANNER_FILE, 'utf8').trim();
  } catch {
    return process.env.BANNER_MESSAGE || 'Welcome to Monteiro Financial Services';
  }
}

function log(level, msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, msg, version: VERSION, ...extra })}\n`);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Metrics middleware
  app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      end(labels);
    });
    next();
  });

  // Chaos middleware (only business routes, never probes/metrics)
  app.use('/api', async (req, res, next) => {
    const { errorRate, latencyMs } = chaosSettings();
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    if (errorRate > 0 && Math.random() < errorRate) {
      log('error', 'chaos: injected failure', { path: req.path });
      return res.status(500).json({ error: 'injected failure (chaos)' });
    }
    return next();
  });

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.get('/readyz', async (req, res) => {
    try {
      await db.ping();
      res.json({ status: 'ready', database: db.mode() });
    } catch (err) {
      log('warn', 'readiness failed', { error: err.message });
      res.status(503).json({ status: 'not-ready', error: err.message });
    }
  });

  app.get('/api/info', (req, res) => {
    res.json({
      service: 'customer-portal-api',
      version: VERSION,
      environment: process.env.DD_ENV || process.env.APP_ENV || 'local',
      pod: process.env.HOSTNAME,
      database: db.mode(),
      banner: readBanner(),
    });
  });

  app.get('/api/products', async (req, res) => {
    try {
      res.json(await db.listProducts());
    } catch (err) {
      log('error', 'listProducts failed', { error: err.message });
      res.status(500).json({ error: 'database unavailable' });
    }
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  return app;
}

module.exports = { createApp, log };
