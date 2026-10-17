// Opt-in terminal (PORTAL_TERMINAL=1): one real PowerShell in the repository,
// driven from the portal page. Without native dependencies there is no PTY:
// line-based commands and y/N prompts work; full-screen programs (vim, less)
// do not. Output is redacted like checker evidence.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { killTree } from '../lib/exec.js';
import { redact } from '../lib/redact.js';

const MARKER = /\x1b\]9999;portal;([^;\x07]*);(\w*)\x07/g;
const MAX_BUFFER = 256 * 1024;
const MAX_LINE = 4000;

// Prints a marker after every command so the page knows the shell is idle
// again, its working directory and whether the command succeeded.
// Success = no new PowerShell error and native exit code 0 ($? is already reset inside finally).
const MARK = '[Console]::Out.Write("`e]9999;portal;" + (Get-Location).Path + ";" + $(if (($Error.Count -eq $__portalErrors) -and (-not $LASTEXITCODE)) { "ok" } else { "err" }) + "`a")';
const BEFORE = '$__portalErrors = $Error.Count; $global:LASTEXITCODE = 0';

const BOOTSTRAP = [
  '[Console]::InputEncoding = [Text.Encoding]::UTF8',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$OutputEncoding = [Text.Encoding]::UTF8',
  "$ProgressPreference = 'SilentlyContinue'",
  // Read-Host does not print its prompt when stdout is redirected: show it.
  BEFORE,
  'function global:Read-Host { param([Parameter(Position = 0)][object]$Prompt, [switch]$AsSecureString, [switch]$MaskInput) if ($Prompt) { [Console]::Out.Write("$Prompt" + ": "); [Console]::Out.Flush() }; $line = [Console]::In.ReadLine(); if ($AsSecureString) { ConvertTo-SecureString $line -AsPlainText -Force } else { $line } }',
  MARK,
].join('; ');

export class Terminal extends EventEmitter {
  constructor({ repoRoot, shell }) {
    super();
    this.repoRoot = repoRoot;
    this.shell = shell ?? 'pwsh';
    this.child = null;
    this.buffer = '';
    this.busy = false;
    this.cwd = repoRoot;
    this.lastOk = null;
    this.error = null;
  }

  status() {
    return { alive: Boolean(this.child), busy: this.busy, cwd: this.cwd, lastOk: this.lastOk, error: this.error, shell: path.basename(this.shell) };
  }

  append(text) {
    if (!text) return;
    const clean = redact(text);
    this.buffer = (this.buffer + clean).slice(-MAX_BUFFER);
    this.emit('output', clean);
  }

  ensure() {
    if (this.child) return;
    this.error = null;
    const child = spawn(this.shell, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-'], {
      cwd: this.repoRoot,
      env: { ...process.env, PORTAL_TERMINAL_SESSION: '1' },
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.child = child;
    this.busy = true;
    const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
    let pending = '';
    const onOut = (chunk) => {
      pending += decoders.out.write(chunk);
      // Keep a possibly incomplete marker for the next chunk.
      const cut = pending.lastIndexOf('\x1b]9999;');
      let ready = pending;
      if (cut >= 0 && pending.indexOf('\x07', cut) < 0) {
        ready = pending.slice(0, cut);
        pending = pending.slice(cut);
      } else pending = '';
      let idle = null;
      ready = ready.replace(MARKER, (_m, cwd, ok) => {
        idle = { cwd, ok };
        return '';
      });
      this.append(ready);
      if (idle) {
        this.busy = false;
        this.cwd = idle.cwd || this.cwd;
        this.lastOk = idle.ok === 'ok';
        this.emit('status', this.status());
      }
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', (chunk) => this.append(decoders.err.write(chunk)));
    child.on('error', (err) => {
      this.error = err.code === 'ENOENT' ? `${this.shell} is not installed (install PowerShell 7: winget install Microsoft.PowerShell)` : err.message;
      this.child = null;
      this.busy = false;
      this.append(`\n[terminal] ${this.error}\n`);
      this.emit('status', this.status());
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.busy = false;
      this.append(`\n[terminal] shell exited (code ${code}). Press Restart or type a command to start a new one.\n`);
      this.emit('status', this.status());
    });
    child.stdin.write(`${BOOTSTRAP}\n`);
    this.emit('status', this.status());
  }

  // One line typed by the learner. While a command runs, the line is passed
  // through unchanged (it is the answer to a prompt such as "Apply? [y/N]").
  input(line) {
    if (typeof line !== 'string' || line.length > MAX_LINE || /[\0\r\n]/.test(line)) {
      throw new Error(`A terminal line must be a single line up to ${MAX_LINE} characters.`);
    }
    this.ensure();
    if (this.busy) {
      this.append(`${line}\n`);
      this.child.stdin.write(`${line}\n`);
      return;
    }
    this.append(`PS ${this.cwd}> ${line}\n`);
    if (line.trim() === '') {
      this.emit('status', this.status());
      return;
    }
    this.busy = true;
    this.emit('status', this.status());
    // try/finally keeps the marker even when the command throws; it does not
    // create a new scope, so `cd` and variables persist like in a normal shell.
    this.child.stdin.write(`${BEFORE}; try { ${line} } finally { ${MARK} }\n`);
  }

  restart() {
    const old = this.child;
    this.child = null;
    if (old) killTree(old);
    this.busy = false;
    this.append('\n[terminal] restarted\n');
    this.ensure();
  }

  clear() {
    this.buffer = '';
    this.emit('cleared');
  }

  stop() {
    const old = this.child;
    this.child = null;
    if (old) killTree(old);
  }
}
