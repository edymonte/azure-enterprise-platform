// Short operational reference per sprint block (concept, where to configure,
// where to investigate, main commands, expected result, common mistakes),
// distilled from the guides in az400-reforcos. Read-only content: it never
// grants progress and does not generate flashcards.
import fs from 'node:fs';
import path from 'node:path';

const LISTS = ['configure', 'investigate', 'mistakes'];

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
    for (const c of ref.commands) for (const k of ['what', 'cmd', 'expect']) if (typeof c[k] !== 'string' || !c[k]) throw new Error(`reference.json: ${id} command needs "${k}"`);
    if (typeof ref.expected !== 'string' || !ref.expected) throw new Error(`reference.json: ${id} needs the expected result`);
    out[id] = { pending: false, ...ref };
  }
  return out;
}
