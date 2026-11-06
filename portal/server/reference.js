// Short operational reference per sprint block (concept, where to configure,
// where to investigate, main commands, expected result, common mistakes),
// distilled from the guides in az400-reforcos. Read-only content: it never
// grants progress and does not generate flashcards.
import fs from 'node:fs';
import path from 'node:path';

const LISTS = ['configure', 'investigate', 'mistakes'];
const RISKS = new Set(['caution', 'sensitive']);
// Anything that applies, destroys, unlocks, restores or rewrites state, or changes access.
const RISKY = /\b(terraform\s+(apply|destroy|import)|force-unlock|state\s+(rm|push|mv)|blob\s+copy|lease\s+break|role\s+assignment\s+(create|delete)|group\s+delete|-auto-approve|-Execute)\b|\bazp\.ps1\s+(apply|destroy|bootstrap)\b/i;

export function loadReference(portalRoot, sprint) {
  const file = path.join(portalRoot, 'catalog', 'reference.json');
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [id, ref] of Object.entries(data)) {
    if (id.startsWith('_')) continue;
    if (!sprint?.byId.has(id)) throw new Error(`reference.json: unknown sprint block ${id}`);
    if (ref.pending) {
      if (typeof ref.note !== 'string' || !ref.note) throw new Error(`reference.json: ${id} is pending and needs a note`);
      out[id] = { pending: true, note: ref.note };
      continue;
    }
    if (typeof ref.concept !== 'string' || !ref.concept) throw new Error(`reference.json: ${id} needs a concept`);
    for (const key of LISTS) if (!Array.isArray(ref[key]) || !ref[key].every((x) => typeof x === 'string')) throw new Error(`reference.json: ${id}.${key} must be a list of text`);
    if (!Array.isArray(ref.commands) || !ref.commands.length) throw new Error(`reference.json: ${id} needs commands`);
    for (const c of ref.commands) {
      for (const k of ['what', 'cmd', 'expect']) if (typeof c[k] !== 'string' || !c[k]) throw new Error(`reference.json: ${id} command needs "${k}"`);
      if (c.risk !== undefined && !RISKS.has(c.risk)) throw new Error(`reference.json: ${id} command "${c.what}" has an unknown risk`);
      if (c.risk && (typeof c.warning !== 'string' || c.warning.length < 20)) throw new Error(`reference.json: ${id} command "${c.what}" needs an explicit warning`);
      // Sensitive commands are for reading only: they can never be a quick copy.
      if (RISKY.test(c.cmd) && c.risk !== 'sensitive') throw new Error(`reference.json: ${id} command "${c.what}" changes state and must be marked sensitive`);
    }
    if (typeof ref.expected !== 'string' || !ref.expected) throw new Error(`reference.json: ${id} needs the expected result`);
    out[id] = { pending: false, ...ref };
  }
  return out;
}
