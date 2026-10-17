// Loads and validates the track definition and the session catalog.
// The catalog is the allow-list: the browser can only refer to sessions (and
// therefore checkers) that exist here.
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_ID = /^C\d{3}$/;
const PLATFORM_REQUIREMENTS = new Set(['offline', 'azure', 'aks', 'github', 'azure-devops']);
const CHECKER_STATUS = new Set(['implemented', 'planned']);
// validated = proven end to end, including a real pass; partial = proven on the
// real environment for the failing paths, pass path proven with test doubles;
// pending = content ready, checker not validated yet.
const VALIDATION_STATUS = new Set(['validated', 'partial', 'pending']);

function fail(file, message) {
  throw new Error(`catalog: ${path.basename(file)}: ${message}`);
}

function requireString(obj, key, file) {
  if (typeof obj[key] !== 'string' || obj[key].trim() === '') fail(file, `"${key}" must be a non-empty string`);
}

function requireArray(obj, key, file, { min = 1 } = {}) {
  if (!Array.isArray(obj[key]) || obj[key].length < min) fail(file, `"${key}" must be an array with at least ${min} item(s)`);
}

// Relative, forward-slash paths that stay inside the repository.
function assertSafeRelative(p, file, what) {
  if (typeof p !== 'string' || p === '' || path.isAbsolute(p) || p.includes('\\') || p.split('/').includes('..')) {
    fail(file, `${what} "${p}" must be a relative path inside the repository (forward slashes, no "..")`);
  }
}

function validateSession(s, file, portalRoot) {
  requireString(s, 'id', file);
  if (!SESSION_ID.test(s.id)) fail(file, `id "${s.id}" must match ${SESSION_ID}`);
  if (path.basename(file, '.json') !== s.id) fail(file, 'file name must equal the session id');
  if (!Number.isInteger(s.number) || s.number < 1) fail(file, '"number" must be a positive integer');
  for (const key of ['title', 'topic', 'scenario', 'mission', 'expectedResult', 'cost', 'recovery', 'debrief']) {
    requireString(s, key, file);
  }
  if (!Number.isInteger(s.cycle) || s.cycle < 1) fail(file, '"cycle" must be a positive integer');
  if (![1, 2, 3].includes(s.difficulty)) fail(file, '"difficulty" must be 1, 2 or 3');
  if (!Number.isInteger(s.timeMinutes) || s.timeMinutes < 5) fail(file, '"timeMinutes" must be >= 5');
  requireArray(s, 'objectives', file);
  requireArray(s, 'steps', file);
  for (const step of s.steps) {
    if (typeof step.title !== 'string' || typeof step.detail !== 'string') fail(file, 'every step needs "title" and "detail"');
  }
  requireArray(s, 'dont', file);
  requireArray(s, 'hints', file, { min: 3 });
  if (!s.interview || typeof s.interview.question !== 'string') fail(file, '"interview.question" is required');
  const L = s.learn;
  if (!L || !Array.isArray(L.concepts) || L.concepts.length === 0) fail(file, '"learn.concepts" is required');
  for (const c of L.concepts) if (typeof c.title !== 'string' || typeof c.body !== 'string') fail(file, 'every learn concept needs "title" and "body"');
  if (!L.example || typeof L.example.title !== 'string' || typeof L.example.body !== 'string') fail(file, '"learn.example" needs "title" and "body"');
  if (!Array.isArray(L.glossary) || L.glossary.length < 2) fail(file, '"learn.glossary" needs at least 2 terms');

  const pre = s.prerequisites;
  if (!pre || !Array.isArray(pre.platform) || pre.platform.length === 0) fail(file, '"prerequisites.platform" is required');
  for (const p of pre.platform) if (!PLATFORM_REQUIREMENTS.has(p)) fail(file, `unknown platform requirement "${p}"`);
  if (!Array.isArray(pre.layers)) fail(file, '"prerequisites.layers" must be an array');

  requireArray(s, 'criteria', file);
  const ids = new Set();
  for (const c of s.criteria) {
    if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) fail(file, `criterion id "${c.id}" must be kebab-case`);
    if (ids.has(c.id)) fail(file, `duplicate criterion id "${c.id}"`);
    ids.add(c.id);
    if (typeof c.text !== 'string') fail(file, `criterion "${c.id}" needs "text"`);
  }

  const ch = s.checker;
  if (!ch || !CHECKER_STATUS.has(ch.status)) fail(file, '"checker.status" must be implemented or planned');
  if (!s.validation || !VALIDATION_STATUS.has(s.validation.status)) fail(file, '"validation.status" is invalid');
  if (ch.status === 'implemented') {
    requireString(ch, 'script', file);
    if (!/^checkers\/[a-z0-9-]+\.js$/.test(ch.script)) fail(file, `checker script "${ch.script}" must live in checkers/`);
    if (!fs.existsSync(path.join(portalRoot, ch.script))) fail(file, `checker script "${ch.script}" not found`);
    if (!Number.isInteger(ch.timeoutSeconds) || ch.timeoutSeconds < 5 || ch.timeoutSeconds > 900) fail(file, '"checker.timeoutSeconds" must be 5..900');
    if (!Number.isInteger(ch.pollSeconds) || ch.pollSeconds < 0) fail(file, '"checker.pollSeconds" must be >= 0');
    if (!Array.isArray(ch.watch)) fail(file, '"checker.watch" must be an array');
    for (const w of ch.watch) assertSafeRelative(w, file, 'watch path');
  } else if (s.validation.status !== 'pending') {
    fail(file, 'a planned checker cannot be marked as validated');
  }
}

export function loadCatalog(portalRoot) {
  const catalogDir = path.join(portalRoot, 'catalog');
  const trackFile = path.join(catalogDir, 'track.json');
  const track = JSON.parse(fs.readFileSync(trackFile, 'utf8'));
  for (const key of ['title', 'cycles', 'ranks']) if (!track[key]) fail(trackFile, `"${key}" is required`);

  const sessionDir = path.join(catalogDir, 'sessions');
  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json')).sort();
  const sessions = files.map((f) => {
    const file = path.join(sessionDir, f);
    let s;
    try {
      s = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      fail(file, `invalid JSON (${err.message})`);
    }
    validateSession(s, file, portalRoot);
    return s;
  });
  sessions.sort((a, b) => a.number - b.number);
  sessions.forEach((s, i) => {
    if (s.number !== i + 1) throw new Error(`catalog: session numbers must be contiguous from 1 (found ${s.number} at position ${i + 1})`);
  });
  const cycleIds = new Set(track.cycles.map((c) => c.id));
  for (const s of sessions) if (!cycleIds.has(s.cycle)) throw new Error(`catalog: ${s.id} refers to unknown cycle ${s.cycle}`);

  const byId = new Map(sessions.map((s) => [s.id, s]));
  return { track, sessions, byId, studyPlan: loadStudyPlan(catalogDir) };
}

// Self-tracked study recommendations (not verified by checkers).
function loadStudyPlan(catalogDir) {
  const file = path.join(catalogDir, 'study-plan.json');
  if (!fs.existsSync(file)) return { title: 'Study plan', intro: '', sections: [], itemIds: new Set() };
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const itemIds = new Set();
  for (const section of plan.sections ?? []) {
    requireString(section, 'id', file);
    requireString(section, 'title', file);
    requireArray(section, 'items', file);
    for (const item of section.items) {
      if (typeof item.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id)) fail(file, `study item id "${item.id}" must be kebab-case`);
      if (itemIds.has(item.id)) fail(file, `duplicate study item id "${item.id}"`);
      requireString(item, 'title', file);
      if (item.link !== undefined && !/^https:\/\//.test(item.link)) fail(file, `study item "${item.id}" link must be https`);
      itemIds.add(item.id);
    }
  }
  return { ...plan, itemIds };
}
