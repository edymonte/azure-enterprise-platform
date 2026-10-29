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
    if (c.how !== undefined && typeof c.how !== 'string') fail(file, `criterion "${c.id}" "how" must be a string`);
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
  return { track, sessions, byId, studyPlan: loadStudyPlan(catalogDir), tftec: loadTftec(catalogDir), sprint: loadSprint(catalogDir, portalRoot, byId) };
}

// Recovery sprint: dated blocks with recall, exercise, criteria and English.
// Criteria are verified by the block checker, by the portal (recorded facts)
// or by an explicit review — never assumed.
export const SPRINT_BLOCK_ID = /^R\d$/;
const SPRINT_VERIFY = new Set(['checker', 'portal', 'review']);
const SPRINT_RULES = new Set(['recall', 'attempts', 'english', 'feedback']);
const SPRINT_OWNERS = new Set(['learner', 'environment']);
const SPRINT_LEVELS = new Set(['guided', 'partial', 'solo', 'breakfix']);
function loadSprint(catalogDir, portalRoot, sessionsById) {
  const file = path.join(catalogDir, 'sprint.json');
  if (!fs.existsSync(file)) return null;
  const sprint = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['id', 'title', 'intro']) requireString(sprint, key, file);
  requireArray(sprint, 'blocks', file);
  const byId = new Map();
  sprint.blocks.forEach((b, i) => {
    const where = `block ${b.id ?? i + 1}`;
    if (!SPRINT_BLOCK_ID.test(b.id ?? '')) fail(file, `${where}: id must match ${SPRINT_BLOCK_ID}`);
    if (byId.has(b.id)) fail(file, `duplicate block id "${b.id}"`);
    if (b.number !== i + 1) fail(file, `${where}: numbers must be contiguous from 1`);
    for (const key of ['title', 'objective', 'english']) if (!b[key]) fail(file, `${where}: "${key}" is required`);
    if (!Number.isInteger(b.minutes) || b.minutes < 15) fail(file, `${where}: "minutes" must be >= 15`);
    if (!b.prerequisites || !Array.isArray(b.prerequisites.platform)) fail(file, `${where}: "prerequisites.platform" is required`);
    for (const p of b.prerequisites.platform) if (!PLATFORM_REQUIREMENTS.has(p)) fail(file, `${where}: unknown platform requirement "${p}"`);
    for (const s of b.reuse?.sessions ?? []) if (!sessionsById.has(s)) fail(file, `${where}: reuse refers to unknown session ${s}`);
    for (const l of b.reuse?.az400 ?? []) if (!/^[0-2][0-9]$/.test(l)) fail(file, `${where}: reuse AZ-400 lab "${l}" must be a two-digit id`);
    requireArray(b, 'recall', file);
    requireArray(b, 'steps', file);
    for (const list of [b.recall, b.steps]) {
      const ids = new Set();
      for (const s of list) {
        if (typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id)) fail(file, `${where}: recall and step ids must be unique kebab-case`);
        ids.add(s.id);
      }
    }
    for (const q of b.recall) if (typeof q.question !== 'string' || typeof q.answer !== 'string') fail(file, `${where}: recall "${q.id}" needs question and answer`);
    for (const s of b.steps) {
      if (!SPRINT_LEVELS.has(s.level)) fail(file, `${where}: step "${s.id}" level must be one of ${[...SPRINT_LEVELS].join(', ')}`);
      if (typeof s.title !== 'string' || typeof s.detail !== 'string' || typeof s.solution !== 'string') fail(file, `${where}: step "${s.id}" needs title, detail and solution`);
      if (!Array.isArray(s.hints) || s.hints.length < 2) fail(file, `${where}: step "${s.id}" needs at least 2 hints`);
    }
    requireArray(b, 'criteria', file);
    const cids = new Set();
    for (const c of b.criteria) {
      if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id) || cids.has(c.id)) fail(file, `${where}: criterion ids must be unique kebab-case`);
      cids.add(c.id);
      if (typeof c.text !== 'string') fail(file, `${where}: criterion "${c.id}" needs text`);
      if (!SPRINT_VERIFY.has(c.verify)) fail(file, `${where}: criterion "${c.id}" verify must be checker, portal or review`);
      if (c.verify === 'portal' && !SPRINT_RULES.has(c.rule)) fail(file, `${where}: portal criterion "${c.id}" needs a rule (${[...SPRINT_RULES].join(', ')})`);
      if (c.verify !== 'portal' && !SPRINT_OWNERS.has(c.owner)) fail(file, `${where}: criterion "${c.id}" owner must be learner or environment`);
    }
    const checked = b.criteria.filter((c) => c.verify === 'checker');
    if (checked.length) {
      const ch = b.checker;
      if (!ch || !/^checkers\/[a-z0-9-]+\.js$/.test(ch.script ?? '')) fail(file, `${where}: checker criteria need checker.script in checkers/`);
      if (!fs.existsSync(path.join(portalRoot, ch.script))) fail(file, `${where}: checker script "${ch.script}" not found`);
      if (!Number.isInteger(ch.timeoutSeconds) || ch.timeoutSeconds < 5 || ch.timeoutSeconds > 900) fail(file, `${where}: checker.timeoutSeconds must be 5..900`);
    }
    if (typeof b.english.question !== 'string' || typeof b.english.modelAnswer !== 'string') fail(file, `${where}: english needs question and modelAnswer`);
    byId.set(b.id, b);
  });
  return { ...sprint, byId };
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

// TFTEC video course: lesson-level checklist, self-tracked like the study plan.
const TFTEC_KINDS = new Set(['pdf', 'class', 'hands-on', 'exam']);
function loadTftec(catalogDir) {
  const file = path.join(catalogDir, 'tftec.json');
  if (!fs.existsSync(file)) return { title: 'TFTEC', intro: '', dailyOrder: [], modules: [], itemIds: new Set() };
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  requireString(course, 'title', file);
  requireArray(course, 'modules', file);
  const itemIds = new Set();
  for (const mod of course.modules) {
    requireString(mod, 'id', file);
    requireString(mod, 'title', file);
    requireArray(mod, 'items', file);
    if (!Number.isInteger(mod.number)) fail(file, `module "${mod.id}" needs an integer number`);
    if (!Array.isArray(mod.labs) || mod.labs.some((l) => !/^[0-2][0-9]$/.test(l))) fail(file, `module "${mod.id}" labs must be two-digit AZ-400 lab ids`);
    for (const item of mod.items) {
      if (typeof item.id !== 'string' || !/^tftec-[a-z0-9-]+$/.test(item.id)) fail(file, `TFTEC item id "${item.id}" must be kebab-case and start with "tftec-"`);
      if (itemIds.has(item.id)) fail(file, `duplicate TFTEC item id "${item.id}"`);
      requireString(item, 'title', file);
      if (!TFTEC_KINDS.has(item.kind)) fail(file, `TFTEC item "${item.id}" kind must be one of ${[...TFTEC_KINDS].join(', ')}`);
      itemIds.add(item.id);
    }
  }
  return { ...course, itemIds };
}
