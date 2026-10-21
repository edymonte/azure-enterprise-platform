import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Notebook } from '../server/notebook.js';
import { tempDir } from './helpers.js';

const sample = {
  entries: [{
    id: 'lab01', date: '2026-10-21', kind: 'lab', title: 'Lab 01', labs: ['01', 'xx'],
    keyPoints: ['A link proves navigation, not delivery.'],
    questions: [{ id: 'q1', question: 'Why?', answer: 'Because.', myAnswer: 'Maybe.', verdict: 'partial' }],
  }],
};

test('notebook: missing file is empty, valid file is read and filtered', () => {
  const dir = tempDir();
  const nb = new Notebook({ dataDir: dir });
  assert.deepEqual(nb.read(), { entries: [], error: null });
  fs.writeFileSync(path.join(dir, 'notebook.json'), JSON.stringify(sample));
  const { entries, error } = nb.read();
  assert.equal(error, null);
  assert.deepEqual(entries[0].labs, ['01']);
  assert.equal(entries[0].questions[0].verdict, 'partial');
  assert.ok(nb.hasQuestion('lab01', 'q1'));
  assert.ok(!nb.hasQuestion('lab01', 'q2'));
});

test('notebook: a broken file is reported, never thrown', () => {
  const dir = tempDir();
  const nb = new Notebook({ dataDir: dir });
  fs.writeFileSync(path.join(dir, 'notebook.json'), '{ not json');
  assert.match(nb.read().error, /notebook\.json/);
  fs.writeFileSync(path.join(dir, 'notebook.json'), JSON.stringify({ entries: [{ ...sample.entries[0], kind: 'nope' }] }));
  nb.mtime = null;
  assert.match(nb.read().error, /kind must be one of/);
  assert.deepEqual(nb.read().entries, []);
});
