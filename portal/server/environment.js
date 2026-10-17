// Read-only probe of the learner's environment: Azure sign-in (and whether it is
// the lab subscription), AKS power state and local tools. Sessions use it to be
// BLOCKED with the right reason instead of running a checker that cannot pass.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runCommand } from '../lib/exec.js';

const TOOLS = [
  ['node', ['--version']],
  ['git', ['--version']],
  ['terraform', ['version']],
  ['helm', ['version', '--short']],
  ['kubectl', ['version', '--client']],
  ['gh', ['--version']],
  ['az', ['version', '-o', 'tsv']],
];

function firstLine(text) {
  return (text || '').split(/\r?\n/).find((l) => l.trim()) ?? '';
}

export function classifyAzError(text) {
  if (/az login|AADSTS|expired|refresh token|Please run 'az login'|not logged in|No subscription found/i.test(text)) return 'auth_error';
  return 'error';
}

export class EnvironmentProbe extends EventEmitter {
  constructor({ repoRoot, track }) {
    super();
    this.repoRoot = repoRoot;
    this.env = track.environment ?? {};
    this.snapshot = { at: null, azure: { status: 'unknown' }, aks: { status: 'unknown' }, tools: {} };
    this.running = null;
  }

  expectedSubscriptionId() {
    const file = path.join(this.repoRoot, this.env.settingsFile ?? 'config/lab.settings.json');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).subscriptionId ?? null;
    } catch {
      return null;
    }
  }

  async probeTools() {
    const tools = {};
    await Promise.all(TOOLS.map(async ([name, args]) => {
      const r = await runCommand(name, args, { timeoutMs: 20000 });
      tools[name] = r.error === 'not_installed' ? { installed: false } : { installed: r.code === 0, version: firstLine(r.stdout).slice(0, 80) };
    }));
    return tools;
  }

  async probeAzure() {
    const r = await runCommand('az', ['account', 'show', '-o', 'json'], { timeoutMs: 30000 });
    if (r.error === 'not_installed') return { status: 'not_installed' };
    if (r.timedOut) return { status: 'error', detail: 'az account show timed out' };
    if (r.code !== 0) {
      const kind = classifyAzError(r.stderr);
      return { status: kind === 'auth_error' ? 'signed_out' : 'error', detail: firstLine(r.stderr).slice(0, 200) };
    }
    const account = JSON.parse(r.stdout);
    const expected = this.expectedSubscriptionId();
    return {
      status: 'signed_in',
      user: account.user?.name ?? null,
      subscriptionName: account.name,
      subscriptionId: account.id,
      expectedSubscription: expected ? expected === account.id : null,
    };
  }

  async probeAks(azure) {
    const aks = this.env.aks;
    if (!aks) return { status: 'not_configured' };
    if (azure.status !== 'signed_in') return { status: 'unknown', detail: 'Azure sign-in required' };
    const r = await runCommand('az', ['aks', 'show', '-g', aks.resourceGroup, '-n', aks.name, '-o', 'json'], { timeoutMs: 45000 });
    if (r.code !== 0) {
      if (/ResourceNotFound|ResourceGroupNotFound|was not found/i.test(r.stderr)) return { status: 'not_deployed' };
      return { status: classifyAzError(r.stderr) === 'auth_error' ? 'auth_error' : 'error', detail: firstLine(r.stderr).slice(0, 200) };
    }
    const cluster = JSON.parse(r.stdout);
    return {
      status: cluster.powerState?.code === 'Running' ? 'running' : 'stopped',
      powerState: cluster.powerState?.code ?? null,
      provisioningState: cluster.provisioningState,
    };
  }

  async refresh({ tools = false } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const azure = await this.probeAzure();
        const aks = await this.probeAks(azure);
        const next = { ...this.snapshot, at: new Date().toISOString(), azure, aks };
        if (tools || !this.snapshot.at) next.tools = await this.probeTools();
        this.snapshot = next;
        this.emit('change', this.snapshot);
        return this.snapshot;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // Why a session cannot run right now, or null. Unknown states never block:
  // the checker then decides (and reports) on its own.
  blockFor(session) {
    const need = new Set(session.prerequisites.platform);
    const { azure, aks, tools } = this.snapshot;
    if (need.has('azure') || need.has('aks')) {
      if (azure.status === 'not_installed') return 'missing_prerequisite';
      if (azure.status === 'signed_out') return 'auth_error';
      if (azure.status === 'signed_in' && azure.expectedSubscription === false) return 'auth_error';
    }
    if (need.has('aks')) {
      if (aks.status === 'not_deployed') return 'missing_prerequisite';
      if (aks.status === 'stopped') return 'platform_stopped';
      if (aks.status === 'auth_error') return 'auth_error';
    }
    if (need.has('github') && tools.gh && tools.gh.installed === false) return 'missing_prerequisite';
    return null;
  }
}
