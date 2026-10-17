// Watches the repository and the git directory, and tells which sessions are
// affected by a change. Events are debounced per session.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runCommand } from '../lib/exec.js';

const IGNORED_PREFIXES = ['.git/', 'node_modules/', 'portal/.data/', '.runtime/plans/'];
const IGNORED_SEGMENTS = ['/node_modules/', '/.terraform/'];
const GIT_RELEVANT = /^(HEAD|packed-refs|refs\/heads\/.*)$/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function matchesWatch(rel, watchPaths) {
  return watchPaths.some((w) => (w.endsWith('/') ? rel.startsWith(w) : rel === w));
}

export class RepoWatcher extends EventEmitter {
  constructor({ repoRoot, catalog, debounceMs }) {
    super();
    this.repoRoot = repoRoot;
    this.catalog = catalog;
    this.debounceMs = debounceMs;
    this.timers = new Map();
    this.watchers = [];
    this.signatures = new Map();
  }

  // Records the current signature of every watched file so that the first
  // read-only access after start-up is not mistaken for a change.
  prime() {
    const walk = (rel) => {
      const abs = path.join(this.repoRoot, rel);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        return;
      }
      if (st.isDirectory()) {
        for (const entry of fs.readdirSync(abs)) walk(rel ? `${rel.replace(/\/$/, '')}/${entry}` : entry);
      } else {
        this.signatures.set(rel, `${st.mtimeMs}:${st.size}`);
      }
    };
    for (const s of this.catalog.sessions) {
      if (s.checker.status === 'implemented') for (const w of s.checker.watch) walk(w.replace(/\/$/, ''));
    }
  }

  async start() {
    this.prime();
    const repoWatcher = fs.watch(this.repoRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = toPosix(filename);
      if (IGNORED_PREFIXES.some((p) => rel.startsWith(p)) || IGNORED_SEGMENTS.some((s) => `/${rel}`.includes(s))) return;
      this.onChange({ rel, git: false });
    });
    this.watchers.push(repoWatcher);

    // Commits and branch switches: watch the real git dir (works for worktrees too).
    const gitDir = await runCommand('git', ['rev-parse', '--absolute-git-dir'], { cwd: this.repoRoot, timeoutMs: 10000 });
    if (gitDir.code === 0) {
      const dir = gitDir.stdout.trim();
      const gitWatcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = toPosix(filename);
        if (GIT_RELEVANT.test(rel)) this.onChange({ rel: `.git/${rel}`, git: true });
      });
      this.watchers.push(gitWatcher);
      // Branch refs of a worktree live in the common dir.
      const common = await runCommand('git', ['rev-parse', '--git-common-dir'], { cwd: this.repoRoot, timeoutMs: 10000 });
      const commonDir = common.code === 0 ? path.resolve(this.repoRoot, common.stdout.trim()) : dir;
      if (commonDir !== dir) {
        this.watchers.push(fs.watch(commonDir, { recursive: true }, (_event, filename) => {
          if (filename && GIT_RELEVANT.test(toPosix(filename))) this.onChange({ rel: `.git/${toPosix(filename)}`, git: true });
        }));
      }
    }
    for (const w of this.watchers) w.on('error', (err) => this.emit('error', err));
  }

  // fs.watch also fires on reads (Windows last-access updates) and on
  // directories. Only a real change of a file (mtime/size, or deletion) counts,
  // otherwise a checker reading its files would re-trigger itself forever.
  changed(rel) {
    let signature;
    try {
      const st = fs.statSync(path.join(this.repoRoot, rel));
      if (st.isDirectory()) return false;
      signature = `${st.mtimeMs}:${st.size}`;
    } catch {
      signature = 'deleted';
    }
    if (this.signatures.get(rel) === signature) return false;
    const known = this.signatures.has(rel);
    this.signatures.set(rel, signature);
    // A new file counts; a deleted file we never knew about (editor temp file) does not.
    return known || signature !== 'deleted';
  }

  onChange({ rel, git }) {
    if (!git && !this.changed(rel)) return;
    for (const s of this.catalog.sessions) {
      const ch = s.checker;
      if (ch.status !== 'implemented') continue;
      const hit = git ? ch.watchGit === true : matchesWatch(rel, ch.watch);
      if (!hit) continue;
      clearTimeout(this.timers.get(s.id));
      this.timers.set(s.id, setTimeout(() => {
        this.timers.delete(s.id);
        this.emit('affected', { id: s.id, path: rel });
      }, this.debounceMs));
    }
  }

  stop() {
    for (const w of this.watchers) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
