// Runtime configuration. Everything comes from environment variables with safe
// defaults; the server always binds to loopback.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORTAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function intFrom(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${value}")`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const host = env.PORTAL_HOST ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) {
    throw new Error(`PORTAL_HOST must be a loopback address (127.0.0.1, ::1 or localhost), got "${host}"`);
  }
  const repoRoot = path.resolve(env.PORTAL_REPO_ROOT ?? path.join(PORTAL_ROOT, '..'));
  return {
    portalRoot: PORTAL_ROOT,
    repoRoot,
    dataDir: path.resolve(env.PORTAL_DATA_DIR ?? path.join(PORTAL_ROOT, '.data')),
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: intFrom(env.PORTAL_PORT, 4317, 1024, 65535, 'PORTAL_PORT'),
    // How often the environment probe (Azure sign-in, AKS power state) runs.
    envPollSeconds: intFrom(env.PORTAL_ENV_POLL_SECONDS, 300, 30, 3600, 'PORTAL_ENV_POLL_SECONDS'),
    // Overrides every checker's own polling interval for external services (0 = keep catalog values).
    pollSecondsOverride: intFrom(env.PORTAL_POLL_SECONDS, 0, 0, 3600, 'PORTAL_POLL_SECONDS'),
    maxBackoffSeconds: intFrom(env.PORTAL_MAX_BACKOFF_SECONDS, 1800, 60, 7200, 'PORTAL_MAX_BACKOFF_SECONDS'),
    watchDebounceMs: intFrom(env.PORTAL_WATCH_DEBOUNCE_MS, 1500, 200, 30000, 'PORTAL_WATCH_DEBOUNCE_MS'),
    // Validation mode: every session is unlocked (used to test checkers out of order).
    // Completions still require a passing checker; the UI shows a banner.
    unlockAll: env.PORTAL_UNLOCK_ALL === '1',
    // Opt-in: a real PowerShell inside the portal page. Off by default because
    // it lets the page run commands on this machine (see README, Security).
    terminal: env.PORTAL_TERMINAL === '1',
    terminalShell: env.PORTAL_TERMINAL_SHELL || 'pwsh',
  };
}
