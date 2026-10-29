// Reads a learner drill (a pipeline YAML written from a blank file) for the
// structural checks of the recovery sprint. The drill lives in the portal data
// dir, so a missing or unparsable file fails the drill criteria with a reason.
import fs from 'node:fs';
import { drillFile } from './checker.js';
import { parseDocument } from './yaml-lite.js';

export function readDrill(name) {
  const file = drillFile(name);
  if (!fs.existsSync(file)) return { file, error: `${file} does not exist yet — create it from a blank file.` };
  const text = fs.readFileSync(file, 'utf8');
  try {
    const doc = parseDocument(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { file, text, error: 'The file is empty or its top level is not a map.' };
    return { file, text, doc };
  } catch (err) {
    return { file, text, error: `YAML could not be read: ${err.message}` };
  }
}

// Every object in the tree (depth first), for "is there any X anywhere" checks.
export function walk(node, out = []) {
  if (Array.isArray(node)) for (const n of node) walk(n, out);
  else if (node && typeof node === 'object') {
    out.push(node);
    for (const v of Object.values(node)) walk(v, out);
  }
  return out;
}

export const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// Secrets must never be in a pipeline: credentials JSON, client secrets, passwords.
const SECRET = /client[-_]?secret|clientsecret|ARM_CLIENT_SECRET|AZURE_CREDENTIALS|\bcreds\s*:|password/i;
export function secretFindings(text) {
  return text.split(/\r?\n/)
    .map((line, i) => ({ line: line.replace(/(^|\s)#.*$/, ''), n: i + 1 }))
    .filter((l) => SECRET.test(l.line))
    .map((l) => `line ${l.n}: ${l.line.trim().slice(0, 80)}`);
}
