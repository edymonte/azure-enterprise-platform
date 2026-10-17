import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Terminal } from '../server/terminal.js';
import { hasCommand, tempDir } from './helpers.js';

const skip = !hasCommand('pwsh', ['-NoLogo', '-NoProfile', '-Command', 'exit 0']) && 'pwsh not installed';

function waitIdle(term, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`terminal still busy. Output:\n${term.buffer}`)), timeoutMs);
    const check = () => {
      if (!term.busy && term.child) {
        clearTimeout(t);
        term.off('status', check);
        resolve();
      }
    };
    term.on('status', check);
    check();
  });
}

test('terminal: commands, persistent cwd, prompts, errors and restart', { skip }, async (t) => {
  const root = tempDir('portal-term-');
  fs.mkdirSync(path.join(root, 'sub'));
  const term = new Terminal({ repoRoot: root });
  t.after(() => term.stop());

  term.ensure();
  await waitIdle(term);

  term.input('Write-Output "hello ✓"');
  await waitIdle(term);
  assert.match(term.buffer, /hello ✓/, 'UTF-8 round trip');
  assert.equal(term.lastOk, true);

  term.input('cd sub');
  await waitIdle(term);
  assert.equal(path.basename(term.cwd), 'sub', 'cd persists like a normal shell');

  // A script prompt: the prompt text is shown and the next line answers it.
  term.input('$a = Read-Host "Apply 20-governance? [y/N]"; Write-Output "answer=[$a]"');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(term.busy, true, 'waiting for the answer');
  assert.match(term.buffer, /Apply 20-governance\? \[y\/N\]: /);
  term.input('y');
  await waitIdle(term);
  assert.match(term.buffer, /answer=\[y\]/);

  term.input('Get-Item does-not-exist');
  await waitIdle(term);
  assert.equal(term.lastOk, false, 'failed command reported');
  term.input('node -e "process.exit(3)"');
  await waitIdle(term);
  assert.equal(term.lastOk, false, 'native non-zero exit reported');
  term.input('Write-Output ok');
  await waitIdle(term);
  assert.equal(term.lastOk, true, 'status resets on the next command');

  assert.throws(() => term.input('a\nb'), /single line/);

  // cls/clear are handled by the portal (no console to clear in a piped shell).
  let cleared = false;
  term.once('cleared', () => { cleared = true; });
  term.input('cls');
  assert.equal(cleared, true);
  assert.equal(term.buffer, '');
  assert.equal(term.busy, false);

  term.restart();
  await waitIdle(term);
  assert.equal(path.resolve(term.cwd), path.resolve(root), 'restart returns to the repository root');
});
