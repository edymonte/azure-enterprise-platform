// Runs a fixed, allow-listed command with a timeout. Arguments always come from
// code (checkers, the environment probe), never from the browser.
import { spawn } from 'node:child_process';

// On Windows some CLIs (az, npm) are .cmd shims, which Node can only start
// through a shell. Those arguments are quoted defensively.
const WINDOWS_SHELL_COMMANDS = new Set(['az', 'npm']);

function quoteWindows(arg) {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function runCommand(command, args = [], { cwd, timeoutMs = 60000, env, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32' && WINDOWS_SHELL_COMMANDS.has(command);
    const child = useShell
      ? spawn([command, ...args.map(quoteWindows)].join(' '), { cwd, env, shell: true, windowsHide: true })
      : spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (stdout.length < maxBytes) stdout += d;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < maxBytes) stderr += d;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.code === 'ENOENT' ? 'not_installed' : error.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // A shell reports a missing command as exit 9009 (cmd) or 127 (sh).
      const missing = useShell && (code === 9009 || /is not recognized as an internal or external command/i.test(stderr));
      resolve({ code, stdout, stderr, error: missing ? 'not_installed' : null, timedOut });
    });
  });
}
