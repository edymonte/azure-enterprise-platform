// Wires catalog, progress, environment probe, runner and watcher together and
// exposes them over a small local HTTP API + Server-Sent Events.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCatalog, SESSION_ID } from './catalog.js';
import { ProgressStore, UserError } from './progress.js';
import { EnvironmentProbe } from './environment.js';
import { Runner } from './runner.js';
import { RepoWatcher } from './watcher.js';
import { Terminal } from './terminal.js';

const STATIC_FILES = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/celebrate.js': ['celebrate.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};
const ACTIONS = new Set(['start', 'check', 'cancel', 'hint', 'assisted', 'assessment']);
const MAX_BODY = 4096;

const BLOCK_MESSAGES = {
  locked: 'Locked: complete the previous session to unlock it.',
  platform_stopped: 'The platform is stopped (e.g. AKS). Start it, then the check runs again automatically.',
  missing_prerequisite: 'A prerequisite does not exist yet (tool, layer or resource). Check the prerequisites panel.',
  auth_error: 'Authentication problem: sign in with the lab account (az login) and make sure the lab subscription is selected.',
  validation_error: 'The checker itself failed (not your exercise). See the summary; retry or report it.',
};

export function createApp(config) {
  const catalog = loadCatalog(config.portalRoot);
  const progress = new ProgressStore({ dataDir: config.dataDir, catalog, unlockAll: config.unlockAll }).load();
  const probe = new EnvironmentProbe({ repoRoot: config.repoRoot, track: catalog.track });
  const runner = new Runner({ config, catalog, probe });
  const watcher = new RepoWatcher({ repoRoot: config.repoRoot, catalog, debounceMs: config.watchDebounceMs });
  const terminal = config.terminal ? new Terminal({ repoRoot: config.repoRoot, shell: config.terminalShell }) : null;
  const token = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  const nextPoll = new Map();
  const indexHtml = fs.readFileSync(path.join(config.portalRoot, 'public', 'index.html'), 'utf8');

  const isActive = (id) => {
    const { state } = progress.stateOf(id);
    return ['IN_PROGRESS', 'FAILED', 'BLOCKED', 'CHECKING'].includes(state) && progress.isUnlocked(id) && Boolean(progress.peek(id).startedAt);
  };

  function sessionView(s) {
    const rec = progress.peek(s.id);
    const { state, reason } = progress.stateOf(s.id, { running: runner.isRunning(s.id), envBlock: rec.startedAt ? probe.blockFor(s) : null });
    const completed = Boolean(rec.completedAt);
    const { hints, debrief, checker, ...content } = s;
    return {
      ...content,
      xp: s.difficulty * 100,
      state,
      reason,
      reasonMessage: reason ? BLOCK_MESSAGES[reason] : null,
      startedAt: rec.startedAt ?? null,
      completedAt: rec.completedAt ?? null,
      completion: rec.completion ?? null,
      attempts: rec.attempts ?? 0,
      aiAssisted: Boolean(rec.aiAssisted),
      assessment: rec.assessment ?? null,
      lastObservation: rec.lastObservation ?? null,
      history: rec.history ?? [],
      hintsTotal: hints.length,
      hintsRevealed: rec.hints.map((h) => ({ level: h.level, at: h.at, text: hints[h.level - 1] })),
      // The debrief explains the solution: only after the technical validation passed.
      debrief: completed ? debrief : null,
      checker: {
        status: checker.status,
        watch: checker.watch ?? [],
        watchGit: Boolean(checker.watchGit),
        pollSeconds: checker.pollSeconds ?? 0,
        plan: checker.plan ?? null,
        nextPollAt: nextPoll.get(s.id) ?? null,
      },
    };
  }

  function nextStep(sessions) {
    const current = sessions.find((s) => s.state !== 'COMPLETED' && s.state !== 'BLOCKED') ?? sessions.find((s) => s.state === 'BLOCKED' && s.reason !== 'locked');
    if (!current) {
      return sessions.every((s) => s.state === 'COMPLETED')
        ? { sessionId: null, text: 'Track complete. Run the final narration and tear the platform down.' }
        : { sessionId: null, text: 'No session available.' };
    }
    // The first criterion not yet passing is "what to do now"; its `how`
    // tells the learner the concrete action.
    const observed = new Map((current.lastObservation?.criteria ?? []).map((c) => [c.id, c.status]));
    const passed = current.criteria.filter((c) => observed.get(c.id) === 'pass').length;
    const pending = current.criteria.find((c) => observed.get(c.id) !== 'pass');
    const base = {
      sessionId: current.id,
      session: `Session ${current.number} · ${current.title}`,
      progress: current.checker.status === 'implemented' ? { passed, total: current.criteria.length } : null,
      checking: current.state === 'CHECKING',
      how: null,
    };
    if (current.state === 'AVAILABLE') {
      return { ...base, text: 'Press Start, then read the Learn tab.', how: 'The Learn tab explains the concepts from zero; the Task tab lists the steps. Commands run in Terminal 1.' };
    }
    if (current.state === 'BLOCKED') return { ...base, text: current.reasonMessage };
    if (current.checker.status !== 'implemented') {
      return { ...base, text: 'Work through the steps of the Task tab.', how: 'Automatic validation for this session is not implemented yet, so it cannot be completed in the portal for now.' };
    }
    if (!pending) return { ...base, text: 'All criteria pass — finishing the check…' };
    return { ...base, text: pending.text, how: pending.how ?? 'Follow the steps in the Task tab; the check runs by itself when you save watched files or commit.' };
  }

  function state() {
    const sessions = catalog.sessions.map(sessionView);
    return {
      meta: {
        title: catalog.track.title,
        subtitle: catalog.track.subtitle,
        validationMode: config.unlockAll,
        now: new Date().toISOString(),
        terminal: terminal ? { enabled: true, ...terminal.status() } : { enabled: false },
      },
      totals: progress.totals(),
      track: { cycles: catalog.track.cycles, ranks: catalog.track.ranks },
      environment: probe.snapshot,
      studyPlan: {
        title: catalog.studyPlan.title,
        intro: catalog.studyPlan.intro,
        sections: (catalog.studyPlan.sections ?? []).map((sec) => ({
          ...sec,
          items: sec.items.map((item) => ({ ...item, done: Boolean(progress.data.study?.[item.id]?.done), at: progress.data.study?.[item.id]?.at ?? null })),
        })),
      },
      timeline: progress.timeline(30),
      links: progress.links(),
      interview: Object.fromEntries(catalog.sessions.map((s) => [s.id, progress.data.interview?.[s.id] ?? { passes: 0 }])),
      sessions,
      next: nextStep(sessions),
    };
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  }
  const pushState = () => broadcast('state', state());

  if (terminal) {
    terminal.on('output', (chunk) => broadcast('term', { chunk }));
    terminal.on('status', (status) => broadcast('term-status', status));
    terminal.on('cleared', () => broadcast('term-clear', {}));
  }

  runner.on('started', ({ id }) => pushState());
  runner.on('finished', ({ id, observation }) => {
    const result = progress.recordObservation(id, observation);
    nextPoll.set(id, runner.schedulePoll(id, isActive(id)));
    if (result.completed) {
      nextPoll.delete(id);
      const s = catalog.byId.get(id);
      const nextSession = catalog.sessions[s.number];
      broadcast('celebrate', { id, number: s.number, title: s.title, rewards: result.rewards, mode: result.mode, badges: progress.totals().badges, unlocked: nextSession ? { id: nextSession.id, title: nextSession.title } : null });
    }
    pushState();
  });
  let envSignature = null;
  probe.on('change', (snap) => {
    // Only a real transition (signed in/out, AKS started/stopped) re-checks the
    // active cloud sessions; routine probes just refresh the header.
    const signature = `${snap.azure.status}|${snap.azure.expectedSubscription}|${snap.aks.status}`;
    if (envSignature !== null && signature !== envSignature) {
      for (const s of catalog.sessions) if (isActive(s.id) && s.prerequisites.platform.some((p) => p !== 'offline')) runner.trigger(s.id, 'environment change');
    }
    envSignature = signature;
    pushState();
  });
  watcher.on('affected', ({ id, path: changed }) => {
    if (isActive(id)) runner.trigger(id, `file change: ${changed}`);
  });

  // ---------------------------------------------------------------- HTTP
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] ?? 'text/plain; charset=utf-8', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function tokenOk(received) {
    if (typeof received !== 'string' || received.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(token));
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reject(new UserError('Content-Type must be application/json.'));
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        // Keep draining (so the client gets a clean 400) but stop buffering.
        if (size > MAX_BODY) tooLarge = true;
        else chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge) return reject(new UserError('Request body too large.'));
        try {
          const text = Buffer.concat(chunks).toString('utf8') || '{}';
          const body = JSON.parse(text);
          if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
          resolve(body);
        } catch {
          reject(new UserError('Body must be a JSON object.'));
        }
      });
    });
  }

  async function handleAction(id, action, body) {
    const session = catalog.byId.get(id);
    switch (action) {
      case 'start': {
        progress.start(id);
        runner.trigger(id, 'session started');
        return { ok: true };
      }
      case 'check': {
        const rec = progress.peek(id);
        if (!rec.startedAt) throw new UserError('Start the session first.');
        if (session.checker.status !== 'implemented') throw new UserError('This session has no automatic checker yet.');
        runner.trigger(id, rec.completedAt ? 'revise' : 'manual');
        return { ok: true };
      }
      case 'cancel':
        return { ok: runner.cancel(id) };
      case 'hint':
        return { ok: true, hint: progress.revealHint(id) };
      case 'assisted':
        if (typeof body.value !== 'boolean') throw new UserError('"value" must be a boolean.');
        progress.setAiAssisted(id, body.value);
        return { ok: true };
      case 'assessment':
        return { ok: true, assessment: progress.setAssessment(id, body) };
      default:
        throw new UserError('Unknown action.');
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding and cross-origin protection.
      if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 421, 'Misdirected request');
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return send(res, 403, 'Cross-origin request refused');
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Cross-site request refused');

      const url = new URL(req.url, `http://${req.headers.host}`);
      const { pathname } = url;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return send(res, 200, indexHtml.replace('%%PORTAL_TOKEN%%', token), { 'Content-Type': 'text/html; charset=utf-8' });
      }
      if (req.method === 'GET' && STATIC_FILES[pathname]) {
        const [file, type] = STATIC_FILES[pathname];
        return send(res, 200, fs.readFileSync(path.join(config.portalRoot, 'public', file)), { 'Content-Type': type });
      }
      if (!pathname.startsWith('/api/')) return send(res, 404, 'Not found');

      if (req.method === 'GET' && pathname === '/api/events') {
        if (!tokenOk(url.searchParams.get('token'))) return send(res, 401, { error: 'Invalid token' });
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        if (terminal) res.write(`event: term-snapshot\ndata: ${JSON.stringify({ buffer: terminal.buffer })}\n\n`);
        clients.add(res);
        const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
        req.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return undefined;
      }

      if (!tokenOk(req.headers['x-portal-token'])) return send(res, 401, { error: 'Invalid token' });
      if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, state());
      if (req.method === 'POST' && pathname === '/api/environment/refresh') {
        await readJson(req);
        probe.refresh({ tools: true });
        return send(res, 202, { ok: true });
      }
      const link = pathname.match(/^\/api\/links\/([A-Za-z0-9-]{1,80})(\/remove)?$/);
      if (req.method === 'POST' && link) {
        const body = await readJson(req);
        if (link[2]) progress.removeLink(link[1], body.index);
        else progress.addLink(link[1], body.label, body.url);
        pushState();
        return send(res, 200, { ok: true });
      }
      const study = pathname.match(/^\/api\/study\/([a-z0-9-]{1,80})$/);
      if (req.method === 'POST' && study) {
        const body = await readJson(req);
        progress.setStudyItem(study[1], body.done);
        pushState();
        return send(res, 200, { ok: true });
      }
      const practice = pathname.match(/^\/api\/interview\/([^/]+)\/practised$/);
      if (req.method === 'POST' && practice) {
        if (!SESSION_ID.test(practice[1]) || !catalog.byId.has(practice[1])) return send(res, 404, { error: 'Unknown session' });
        await readJson(req);
        const rec = progress.recordInterviewPractice(practice[1]);
        pushState();
        return send(res, 200, { ok: true, passes: rec.passes });
      }
      const t = pathname.match(/^\/api\/terminal\/(input|restart|clear)$/);
      if (req.method === 'POST' && t) {
        if (!terminal) return send(res, 404, { error: 'The terminal is disabled. Start the portal with PORTAL_TERMINAL=1 to enable it.' });
        const body = await readJson(req);
        if (t[1] === 'input') {
          try {
            terminal.input(body.line);
          } catch (err) {
            throw new UserError(err.message);
          }
        } else if (t[1] === 'restart') terminal.restart();
        else terminal.clear();
        return send(res, 200, { ok: true });
      }
      const m = pathname.match(/^\/api\/sessions\/([^/]+)\/([a-z]+)$/);
      if (req.method === 'POST' && m) {
        const [, id, action] = m;
        if (!SESSION_ID.test(id) || !catalog.byId.has(id)) return send(res, 404, { error: 'Unknown session' });
        if (!ACTIONS.has(action)) return send(res, 404, { error: 'Unknown action' });
        const body = await readJson(req);
        const result = await handleAction(id, action, body);
        nextPoll.set(id, runner.isRunning(id) ? nextPoll.get(id) ?? null : runner.schedulePoll(id, isActive(id)));
        pushState();
        return send(res, 200, result);
      }
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof UserError) return send(res, 400, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Internal error' });
    }
  });

  let envTimer;
  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
    await watcher.start();
    terminal?.ensure();
    watcher.on('error', (err) => console.error('watcher:', err.message));
    probe.refresh({ tools: true }).then(() => {
      // Resume active sessions after a restart.
      for (const s of catalog.sessions) if (isActive(s.id)) runner.trigger(s.id, 'portal started');
    }).catch((err) => console.error('environment probe:', err.message));
    envTimer = setInterval(() => probe.refresh().catch(() => {}), config.envPollSeconds * 1000);
    envTimer.unref();
  }

  async function stop() {
    clearInterval(envTimer);
    terminal?.stop();
    runner.stop();
    watcher.stop();
    for (const res of clients) res.end();
    await new Promise((resolve) => server.close(resolve));
  }

  return { start, stop, server, token, state, progress, runner, probe, catalog, terminal };
}
