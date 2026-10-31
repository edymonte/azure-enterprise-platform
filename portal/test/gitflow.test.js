import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCatalog } from '../server/catalog.js';
import { ProgressStore } from '../server/progress.js';
import { SprintTracker } from '../server/sprint.js';
import { loadSchedule } from '../server/schedule.js';
import { PORTAL_ROOT } from '../server/config.js';
import { fakeAz, fakeGh, gitRepo, runNode, tempDir } from './helpers.js';

const catalog = loadCatalog(PORTAL_ROOT);
const S = catalog.gitflow.settings;
const CHECKER = path.join(PORTAL_ROOT, 'checkers', 'gitflow.js');
const parse = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
const statusOf = (out) => Object.fromEntries(out.criteria.map((c) => [c.id, c.status]));
const PRJ = `--org ${S.adoOrg} -p ${S.adoProject}`;
const item = (repo, p, version, type = 'branch') => `devops invoke --org ${S.adoOrg} --area git --resource items --route-parameters project=${S.adoProject} repositoryId=${repo} --query-parameters path=${p} includeContent=true versionDescriptor.version=${version} versionDescriptor.versionType=${type} --api-version 7.1`;
const run = (id, responses, gh) => {
  const { root } = gitRepo({ 'README.md': 'x\n' });
  return parse(runNode(CHECKER, { PORTAL_REPO_ROOT: root, PORTAL_SESSION_ID: id, PORTAL_FAKE_AZ: fakeAz(responses), ...(gh ? { PORTAL_FAKE_GH: fakeGh(gh) } : {}) }));
};

test('gitflow catalog: 12 missions from setup to GitHub, a self-hosted agent mission, one dated mission a day', () => {
  const g = catalog.gitflow;
  assert.equal(g.blocks.length, 12);
  assert.equal(g.blocks.find((b) => b.id === 'G06').title, 'Self-hosted agent on WSL');
  assert.deepEqual(g.blocks.at(-1).prerequisites.platform, ['github']);
  for (const b of g.blocks) assert.ok(b.criteria.some((c) => c.verify === 'checker'), `${b.id} has automatic checks`);
  const s = loadSchedule(PORTAL_ROOT, catalog);
  const missions = s.items.filter((i) => i.kind === 'gitflow');
  assert.equal(missions.length, 12);
  assert.equal(missions[0].date, '2026-11-02', 'the lab starts right after the sprint');
});

test('gitflow progress is stored apart from the sprint', () => {
  const store = new ProgressStore({ dataDir: tempDir(), catalog }).load();
  const gitflow = new SprintTracker({ store, sprint: catalog.gitflow, key: 'gitflow' });
  gitflow.start('G00');
  assert.ok(store.data.gitflow.blocks.G00.startedAt);
  assert.equal(store.data.sprint, undefined);
  assert.equal(gitflow.view('G00').kind, 'gitflow');
});

test('G00 checker: missing repository fails; repository with both branches and develop as default passes', () => {
  const missing = run('G00', { [`repos show --repository orders-app ${PRJ}`]: { code: 1, stderr: 'ERROR: TF401019: The Git repository with name or identifier orders-app does not exist' } });
  assert.equal(statusOf(missing)['repo-exists'], 'fail');
  const ok = run('G00', {
    [`repos show --repository orders-app ${PRJ}`]: { stdout: { id: 'r1', remoteUrl: 'https://dev.azure.com/x/_git/orders-app', defaultBranch: 'refs/heads/develop' } },
    [`repos ref list --repository orders-app --filter heads/ ${PRJ}`]: { stdout: [{ name: 'refs/heads/main' }, { name: 'refs/heads/develop' }] },
    [item('orders-app', '/app/package.json', 'develop')]: { stdout: { content: '{"name":"orders"}' } },
  });
  assert.equal(ok.outcome, 'pass', JSON.stringify(ok));
});

test('G05 checker: CD with a pipeline resource, a template pinned to a tag and a DEV deployment passes', () => {
  const cd = "trigger: none\nresources:\n  pipelines:\n    - pipeline: ci\n      source: orders-ci\n  repositories:\n    - repository: templates\n      type: git\n      name: lab-gitflow/pipeline-templates\n      ref: refs/tags/v1.0.0\nstages:\n  - template: templates/deploy-stage.yml@templates\n";
  const responses = {
    [`pipelines show --name orders-cd ${PRJ}`]: { stdout: { id: 7, repository: { name: 'orders-app' }, process: { yamlFilename: 'azure-pipelines/cd.yml' } } },
    [item('orders-app', '/azure-pipelines/cd.yml', 'develop')]: { stdout: { content: cd } },
    [`devops invoke --org ${S.adoOrg} --area distributedtask --resource environments --route-parameters project=${S.adoProject} --query-parameters name=DEV --api-version 7.1`]: { stdout: { value: [{ id: 3, name: 'DEV' }] } },
    [`devops invoke --org ${S.adoOrg} --area distributedtask --resource environmentdeploymentrecords --route-parameters project=${S.adoProject} environmentId=3 --query-parameters top=20 --api-version 7.1`]: { stdout: { value: [{ result: 'succeeded' }] } },
  };
  assert.equal(run('G05', responses).outcome, 'pass');
  const unpinned = { ...responses, [item('orders-app', '/azure-pipelines/cd.yml', 'develop')]: { stdout: { content: cd.replace('refs/tags/v1.0.0', 'refs/heads/main') } } };
  assert.equal(statusOf(run('G05', unpinned))['cd-resources'], 'fail', 'a template on a branch is not pinned');
});

test('G06 checker: an offline agent is an environment criterion; signed out blocks everything', () => {
  const out = run('G06', {
    [`pipelines pool list --org ${S.adoOrg}`]: { stdout: [{ id: 12, name: 'lab-wsl', isHosted: false }] },
    [`pipelines agent list --pool-id 12 --org ${S.adoOrg}`]: { stdout: [{ name: 'wsl-01', status: 'offline', enabled: true, version: '4.0' }] },
    [`devops invoke --org ${S.adoOrg} --area distributedtask --resource jobrequests --route-parameters poolId=12 --query-parameters top=20 --api-version 7.1`]: { stdout: { value: [{ result: 'succeeded', reservedAgent: { name: 'wsl-01' }, definition: { name: 'orders-cd' } }] } },
  });
  assert.deepEqual(statusOf(out), { 'pool-exists': 'pass', 'agent-online': 'fail', 'job-ran-on-agent': 'pass' });
  const blocked = run('G06', { [`pipelines pool list --org ${S.adoOrg}`]: { code: 1, stderr: 'Please run az login to setup account.' } });
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.blockedReason, 'auth_error');
});

test('G11 checker: Git Flow workflows, a reusable deploy, a protected prd and protected branches pass', () => {
  const b64 = (t) => Buffer.from(t).toString('base64');
  const ci = "on:\n  push:\n    branches: [develop, 'release/**', 'hotfix/**', main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n  deploy-dev:\n    needs: build\n    if: github.ref == 'refs/heads/develop'\n    uses: ./.github/workflows/deploy.yml\n";
  const deploy = "on:\n  workflow_call:\n    inputs:\n      environment:\n        type: string\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo deploy\n";
  const R = S.githubRepo;
  const out = run('G11', {}, {
    [`api repos/${R}/contents/.github/workflows`]: { stdout: [{ name: 'ci.yml', path: '.github/workflows/ci.yml' }, { name: 'deploy.yml', path: '.github/workflows/deploy.yml' }] },
    [`api repos/${R}/contents/.github/workflows/ci.yml`]: { stdout: { content: b64(ci) } },
    [`api repos/${R}/contents/.github/workflows/deploy.yml`]: { stdout: { content: b64(deploy) } },
    [`api repos/${R}/environments`]: { stdout: { environments: [{ name: 'dev' }, { name: 'prd', protection_rules: [{ type: 'required_reviewers' }] }] } },
    [`api repos/${R}/branches/main/protection`]: { stdout: { url: 'x' } },
    [`api repos/${R}/branches/develop/protection`]: { stdout: { url: 'x' } },
  });
  assert.equal(out.outcome, 'pass', JSON.stringify(out));
});
