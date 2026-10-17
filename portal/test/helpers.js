// Test helpers: temporary git repositories and a fake Azure CLI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tempDir(prefix = 'portal-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function gitRepo(files) {
  const root = tempDir('portal-repo-');
  writeFiles(root, files);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Portal Test');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { root, git };
}

// Writes a fake `az` (a Node script) that answers from a map of
// "<args joined by space>" -> { code, stdout, stderr }.
export function fakeAz(responses) {
  const dir = tempDir('portal-fakeaz-');
  const file = path.join(dir, 'az.js');
  fs.writeFileSync(file, `
const responses = ${JSON.stringify(responses)};
const args = process.argv.slice(2).filter((a, i, all) => !(a === '-o' || all[i - 1] === '-o')).join(' ');
const r = responses[args] ?? { code: 3, stderr: 'ERROR: (NotFound) fake az has no answer for: ' + args };
if (r.stdout) process.stdout.write(typeof r.stdout === 'string' ? r.stdout : JSON.stringify(r.stdout));
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.code ?? 0);
`);
  return file;
}

export function runNode(script, env) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [script], { env: { ...process.env, ...env }, stdio: 'pipe' }).toString() };
  } catch (err) {
    return { code: err.status, stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '' };
  }
}

export function hasCommand(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
