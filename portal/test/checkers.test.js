import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PORTAL_ROOT } from '../server/config.js';
import { fakeAz, gitRepo, hasCommand, runNode } from './helpers.js';

const C001 = path.join(PORTAL_ROOT, 'checkers', 'c001-policy-rule.js');
const C014 = path.join(PORTAL_ROOT, 'checkers', 'c014-helm-pdb.js');
const RULE = 'infra/policies/require-rg-tags.rule.json';

function rule(where) {
  return JSON.stringify({
    if: { allOf: [
      { field: 'type', equals: 'Microsoft.Resources/subscriptions/resourceGroups' },
      { count: { value: "[parameters('tagNames')]", name: 'tagName', where }, greater: 0 },
    ] },
    then: { effect: "[parameters('effect')]" },
  }, null, 2);
}
const BROKEN = { field: "[concat('tags[', current('tagName'), ']')]", exists: 'false' };
const FIXED = { field: 'tags', notContainsKey: "[current('tagName')]" };
// The first suggested fix: current() nested in field() — Azure rejects it too.
const NESTED = { value: "[coalesce(field(concat('tags[', current('tagName'), ']')), '')]", equals: '' };

const parse = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
const statusOf = (out) => Object.fromEntries(out.criteria.map((c) => [c.id, c.status]));

const azDeployed = (where) => ({
  'account show': { stdout: { id: 'sub-1', name: 'lab', user: { name: 'learner' } } },
  'policy definition show -n mfs-require-rg-tags': { stdout: { id: '/subscriptions/sub-1/providers/Microsoft.Authorization/policyDefinitions/mfs-require-rg-tags', policyRule: JSON.parse(rule(where)) } },
  'policy assignment show -n mfs-platform-guardrails': { stdout: { scope: '/subscriptions/sub-1' } },
  'policy set-definition show -n mfs-platform-guardrails': { stdout: { policyDefinitions: [{ policyDefinitionReferenceId: 'allowedLocations' }, { policyDefinitionReferenceId: 'requireRgTags' }] } },
});

test('C001: broken rule fails every criterion', () => {
  const { root } = gitRepo({ [RULE]: rule(BROKEN) });
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz({ 'account show': { stdout: { id: 'sub-1', name: 'lab' } } }) }));
  assert.equal(out.outcome, 'fail');
  assert.deepEqual(statusOf(out), {
    'rule-accepted-syntax': 'fail', 'rule-detects-missing-tag': 'fail', 'fix-committed': 'fail', 'definition-deployed': 'fail', 'initiative-assigned': 'fail',
  });
});

test('C001: fixed but uncommitted rule is not enough', () => {
  const { root } = gitRepo({ [RULE]: rule(BROKEN) });
  fs.writeFileSync(path.join(root, RULE), rule(FIXED));
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz(azDeployed(FIXED)) }));
  assert.equal(out.outcome, 'fail');
  assert.equal(statusOf(out)['fix-committed'], 'fail');
  assert.equal(statusOf(out)['rule-accepted-syntax'], 'pass');
});

test('C001: committed fix + deployed definition + assigned initiative passes', () => {
  const { root, git } = gitRepo({ [RULE]: rule(BROKEN) });
  git('switch', '-q', '-c', 'fix/policy');
  fs.writeFileSync(path.join(root, RULE), rule(FIXED));
  git('commit', '-qam', 'fix');
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz(azDeployed(FIXED)) }));
  assert.equal(out.outcome, 'pass', JSON.stringify(out));
});

test('C001: Azure still running the broken definition fails definition-deployed', () => {
  const { root, git } = gitRepo({ [RULE]: rule(FIXED) });
  git('commit', '--allow-empty', '-qm', 'noop');
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz(azDeployed(BROKEN)) }));
  assert.equal(statusOf(out)['definition-deployed'], 'fail');
});

test('C001: not signed in => blocked auth_error, never pass', () => {
  const { root } = gitRepo({ [RULE]: rule(FIXED) });
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz({ 'account show': { code: 1, stderr: "ERROR: Please run 'az login' to setup account." } }) }));
  assert.equal(out.outcome, 'blocked');
  assert.equal(out.blockedReason, 'auth_error');
  assert.equal(statusOf(out)['definition-deployed'], 'skipped');
});

// A synthetic chart (not the course chart) so the tests never contain the exercise answer.
function chart({ budget, withSwitch }) {
  const pdb = (name) => `---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}
spec:
  ${budget}
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
`;
  const deploy = (name) => `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
spec:
  replicas: {{ .Values.replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: app
          image: nginx:1.27
`;
  const budgets = pdb('customer-portal-api') + pdb('customer-portal-web');
  return {
    'gitops/charts/customer-portal/Chart.yaml': 'apiVersion: v2\nname: customer-portal\nversion: 0.1.0\n',
    'gitops/charts/customer-portal/values.yaml': `replicas: 1\npdb:\n  enabled: true\n`,
    'gitops/charts/customer-portal/templates/app.yaml': deploy('customer-portal-api') + deploy('customer-portal-web')
      + (withSwitch ? `{{- if .Values.pdb.enabled }}\n${budgets}{{- end }}\n` : budgets),
    'gitops/envs/dev/platform.values.yaml': '{}\n',
    'gitops/envs/dev/values.yaml': 'replicas: 1\n',
    'gitops/envs/prod/platform.values.yaml': '{}\n',
    'gitops/envs/prod/values.yaml': 'replicas: 2\n',
  };
}

test('C014: budgets that block drains and ignore the switch fail', { skip: !hasCommand('helm', ['version', '--short']) && 'helm not installed' }, () => {
  const { root } = gitRepo(chart({ budget: 'minAvailable: 1', withSwitch: false }));
  const out = parse(runNode(C014, { PORTAL_REPO_ROOT: root }));
  assert.equal(out.outcome, 'fail');
  const s = statusOf(out);
  assert.equal(s['helm-lint'], 'pass');
  assert.equal(s['pdb-api'], 'pass');
  assert.equal(s['drain-allowed'], 'fail');
  assert.equal(s['values-switch'], 'fail');
});

test('C014: drain-friendly budgets behind a switch, committed, pass', { skip: !hasCommand('helm', ['version', '--short']) && 'helm not installed' }, () => {
  const { root } = gitRepo(chart({ budget: 'maxUnavailable: 1', withSwitch: true }));
  const out = parse(runNode(C014, { PORTAL_REPO_ROOT: root }));
  assert.equal(out.outcome, 'pass', JSON.stringify(out, null, 1));
  fs.appendFileSync(path.join(root, 'gitops/envs/dev/values.yaml'), '# local edit\n');
  const dirty = parse(runNode(C014, { PORTAL_REPO_ROOT: root }));
  assert.equal(statusOf(dirty).committed, 'fail');
});

test('C001: current() nested in field() is rejected like Azure does', () => {
  const { root, git } = gitRepo({ [RULE]: rule(BROKEN) });
  fs.writeFileSync(path.join(root, RULE), rule(NESTED));
  git('commit', '-qam', 'nested');
  const out = parse(runNode(C001, { PORTAL_REPO_ROOT: root, PORTAL_FAKE_AZ: fakeAz({ 'account show': { stdout: { id: 'sub-1', name: 'lab' } } }) }));
  assert.equal(statusOf(out)['rule-accepted-syntax'], 'fail');
  assert.equal(statusOf(out)['fix-committed'], 'fail');
});
