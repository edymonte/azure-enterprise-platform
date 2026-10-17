// C014 — "Node drain is stuck": PodDisruptionBudgets that allow voluntary
// disruptions in every environment. Offline: renders the chart with helm.
import { runCommand } from '../lib/exec.js';
import { runChecker, repoRoot, git } from './lib/checker.js';
import { parseAllDocuments } from './lib/yaml-lite.js';
import { allowedDisruptions, selects } from './lib/k8s.js';

const CHART = 'gitops/charts/customer-portal';
const ENVS = ['dev', 'prod'];
const COMPONENTS = [
  { criterion: 'pdb-api', deployment: 'customer-portal-api' },
  { criterion: 'pdb-web', deployment: 'customer-portal-web' },
];

function valuesArgs(env) {
  return ['-f', `gitops/envs/${env}/platform.values.yaml`, '-f', `gitops/envs/${env}/values.yaml`];
}

async function helm(args) {
  return runCommand('helm', args, { cwd: repoRoot(), timeoutMs: 60000 });
}

async function render(env, extra = []) {
  const r = await helm(['template', 'customer-portal', CHART, ...valuesArgs(env), ...extra]);
  if (r.code !== 0) throw new Error(`helm template (${env}) failed: ${r.stderr.trim().split(/\r?\n/).pop()}`);
  return parseAllDocuments(r.stdout);
}

function minimumReplicas(docs, deployment) {
  const hpa = docs.find((d) => d.kind === 'HorizontalPodAutoscaler' && d.spec?.scaleTargetRef?.name === deployment.metadata.name);
  if (hpa) return { replicas: hpa.spec.minReplicas ?? 1, source: `HPA minReplicas` };
  return { replicas: deployment.spec?.replicas ?? 1, source: 'Deployment replicas' };
}

runChecker(async (result) => {
  const version = await helm(['version', '--short']);
  if (version.error === 'not_installed') {
    for (const id of ['helm-lint', 'pdb-api', 'pdb-web', 'drain-allowed', 'values-switch', 'committed']) {
      result.skip(id, 'missing_prerequisite', 'helm is not installed (winget install Helm.Helm).');
    }
    return 'helm is required for this session.';
  }

  // 1. Lint both environments.
  const lint = [];
  for (const env of ENVS) {
    const r = await helm(['lint', CHART, ...valuesArgs(env)]);
    lint.push({ env, ok: r.code === 0, detail: (r.code === 0 ? r.stdout : r.stdout + r.stderr).trim().split(/\r?\n/).pop() });
  }
  result.check('helm-lint', lint.every((l) => l.ok), lint.map((l) => `${l.env}: ${l.detail}`).join('\n'), 'helm lint must pass for dev and prod.');

  // 2. Render and inspect PDBs per environment.
  const rendered = {};
  for (const env of ENVS) rendered[env] = await render(env);

  const drainLines = [];
  let drainOk = true;
  for (const comp of COMPONENTS) {
    const lines = [];
    let ok = true;
    for (const env of ENVS) {
      const docs = rendered[env];
      const deploy = docs.find((d) => d.kind === 'Deployment' && d.metadata?.name === comp.deployment);
      if (!deploy) {
        ok = false;
        lines.push(`${env}: Deployment ${comp.deployment} not rendered`);
        continue;
      }
      const podLabels = deploy.spec?.template?.metadata?.labels ?? {};
      const pdbs = docs.filter((d) => d.kind === 'PodDisruptionBudget' && selects(d.spec?.selector, podLabels));
      const others = docs.filter((d) => d.kind === 'Deployment' && d.metadata?.name !== comp.deployment);
      if (pdbs.length !== 1) {
        ok = false;
        lines.push(`${env}: ${pdbs.length} PodDisruptionBudget(s) select the ${comp.deployment} pods (expected exactly 1)`);
        continue;
      }
      const pdb = pdbs[0];
      const overlapping = others.filter((o) => selects(pdb.spec.selector, o.spec?.template?.metadata?.labels));
      if (overlapping.length) {
        ok = false;
        lines.push(`${env}: PDB ${pdb.metadata.name} also selects ${overlapping.map((o) => o.metadata.name).join(', ')}`);
        continue;
      }
      lines.push(`${env}: PDB ${pdb.metadata.name} selects ${comp.deployment} (${JSON.stringify(pdb.spec.selector.matchLabels)})`);
      const min = minimumReplicas(docs, deploy);
      const allowed = allowedDisruptions(pdb.spec, min.replicas);
      const budget = pdb.spec.maxUnavailable !== undefined ? `maxUnavailable=${pdb.spec.maxUnavailable}` : `minAvailable=${pdb.spec.minAvailable}`;
      const okDrain = Number.isFinite(allowed) && allowed >= 1;
      if (!okDrain) drainOk = false;
      drainLines.push(`${env}/${comp.deployment}: ${budget}, ${min.source}=${min.replicas} -> allowed disruptions ${Number.isFinite(allowed) ? allowed : 'invalid'}${okDrain ? '' : '  <-- a node drain would block'}`);
    }
    result.check(comp.criterion, ok, lines.join('\n'), `Exactly one PDB must select only the ${comp.deployment} pods in dev and prod.`);
  }
  if (drainLines.length) {
    result.check('drain-allowed', drainOk, drainLines.join('\n'), 'Every PDB must allow at least 1 voluntary disruption at the minimum replica count of each environment.');
  } else {
    result.fail('drain-allowed', 'No PodDisruptionBudget rendered to evaluate.', 'Add the PDBs first.');
  }

  // 3. The budgets are behind a values switch.
  const switchLines = [];
  let switchOk = true;
  for (const env of ENVS) {
    const docs = await render(env, ['--set', 'pdb.enabled=false']);
    const count = docs.filter((d) => d.kind === 'PodDisruptionBudget').length;
    if (count !== 0) switchOk = false;
    switchLines.push(`${env} with --set pdb.enabled=false: ${count} PodDisruptionBudget(s)`);
  }
  result.check('values-switch', switchOk, switchLines.join('\n'), 'pdb.enabled=false must render no PodDisruptionBudget.');

  // 4. The change is committed (evidence lives in Git, not only on disk).
  const status = await git(['status', '--porcelain', '--', CHART, 'gitops/envs']);
  const head = await git(['log', '-1', '--format=%h %s', '--', CHART]);
  const clean = status.code === 0 && status.stdout.trim() === '';
  result.check('committed', clean, clean ? `Clean. Last chart commit: ${head.stdout.trim()}` : `Uncommitted changes:\n${status.stdout.trim()}`, 'Commit the chart change on your branch.');

  const failing = result.criteria.filter((c) => c.status === 'fail').map((c) => c.id);
  return failing.length ? `Not met yet: ${failing.join(', ')}.` : 'Disruption budgets render correctly in both environments and the change is committed.';
});
