// Personal review notebook: key points and corrected interview questions per
// lab or reinforcement session. The content lives in <dataDir>/notebook.json
// (git-ignored, written by the learner or their assistant) and is re-read when
// the file changes. Review flags are stored separately in progress.json.
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z0-9-]{1,60}$/;
const KINDS = new Set(['lab', 'reinforcement', 'tftec', 'other']);
const VERDICTS = new Set(['correct', 'partial', 'wrong', 'unanswered']);
const EMPTY = { entries: [], error: null };

export class Notebook {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'notebook.json');
    this.cache = null;
    this.mtime = null;
  }

  // Never throws: a broken file is reported in the UI instead of taking the portal down.
  read() {
    let stat;
    try {
      stat = fs.statSync(this.file);
    } catch {
      return EMPTY;
    }
    if (this.cache && this.mtime === stat.mtimeMs) return this.cache;
    this.mtime = stat.mtimeMs;
    try {
      this.cache = { entries: validate(JSON.parse(fs.readFileSync(this.file, 'utf8'))), error: null };
    } catch (err) {
      this.cache = { entries: [], error: `notebook.json: ${err.message}` };
    }
    return this.cache;
  }

  hasQuestion(entryId, questionId) {
    const entry = this.read().entries.find((e) => e.id === entryId);
    return Boolean(entry?.questions.some((q) => q.id === questionId));
  }

  watch(onChange) {
    this.listener = () => onChange();
    fs.watchFile(this.file, { interval: 1000, persistent: false }, this.listener);
  }

  stop() {
    if (this.listener) fs.unwatchFile(this.file, this.listener);
    this.listener = null;
  }
}

function str(obj, key, where, { optional = false } = {}) {
  const v = obj[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where}: "${key}" must be a non-empty string`);
  return v;
}

function validate(doc) {
  if (!doc || !Array.isArray(doc.entries)) throw new Error('top level must be { "entries": [...] }');
  const seen = new Set();
  return doc.entries.map((e, i) => {
    const where = `entry ${i + 1}`;
    if (typeof e.id !== 'string' || !ID.test(e.id)) throw new Error(`${where}: id must be kebab-case`);
    if (seen.has(e.id)) throw new Error(`${where}: duplicate id "${e.id}"`);
    seen.add(e.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) throw new Error(`${where}: date must be YYYY-MM-DD`);
    if (!KINDS.has(e.kind)) throw new Error(`${where}: kind must be one of ${[...KINDS].join(', ')}`);
    const qids = new Set();
    return {
      id: e.id,
      date: e.date,
      kind: e.kind,
      title: str(e, 'title', where),
      summary: str(e, 'summary', where, { optional: true }),
      labs: Array.isArray(e.labs) ? e.labs.filter((l) => /^[0-2][0-9]$/.test(l)) : [],
      keyPoints: (e.keyPoints ?? []).map((p, j) => {
        if (typeof p !== 'string' || !p.trim()) throw new Error(`${where}: key point ${j + 1} must be a non-empty string`);
        return p;
      }),
      questions: (e.questions ?? []).map((q, j) => {
        const qw = `${where}, question ${j + 1}`;
        if (typeof q.id !== 'string' || !ID.test(q.id)) throw new Error(`${qw}: id must be kebab-case`);
        if (qids.has(q.id)) throw new Error(`${qw}: duplicate id "${q.id}"`);
        qids.add(q.id);
        const verdict = q.verdict ?? 'unanswered';
        if (!VERDICTS.has(verdict)) throw new Error(`${qw}: verdict must be one of ${[...VERDICTS].join(', ')}`);
        return {
          id: q.id,
          question: str(q, 'question', qw),
          answer: str(q, 'answer', qw),
          myAnswer: str(q, 'myAnswer', qw, { optional: true }),
          feedback: str(q, 'feedback', qw, { optional: true }),
          verdict,
        };
      }),
    };
  });
}
