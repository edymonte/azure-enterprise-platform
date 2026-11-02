// Git Flow lab (G00–G11) — read-only checks against Azure DevOps and GitHub.
// One script for every mission: PORTAL_SESSION_ID says which mission runs.
// Settings (organization, project, repositories) come from catalog/gitflow.json.
import fs from 'node:fs';
import { runChecker, az, gh } from './lib/checker.js';
import { parseDocument } from './lib/yaml-lite.js';

const S = JSON.parse(fs.readFileSync(new URL('../catalog/gitflow.json', import.meta.url), 'utf8')).settings;
const ORG = ['--org', S.adoOrg];
const PRJ = [...ORG, '-p', S.adoProject];
const GIT_FLOW_BRANCHES = ['develop', 'release/*', 'hotfix/*', 'main'];

// A call that failed because of sign-in, a missing tool or a timeout blocks the
// criteria (environment); "not found" is a normal fail (not created yet).
class Blocked extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
async function call(args, what) {
  const r = await az(args);
  if (r.notInstalled) throw new Blocked('missing_prerequisite', 'Azure CLI (az) with the azure-devops extension is not installed.');
  if (r.authError || r.timedOut || /TF400813|not authorized|az login|az devops login/i.test(r.stderr)) throw new Blocked('auth_error', `${what}: ${r.stderr || 'timed out'}`);
  return r;
}
const invoke = (area, resource, route, query = [], version = '7.1') => call(['devops', 'invoke', ...ORG, '--area', area, '--resource', resource,
  '--route-parameters', `project=${S.adoProject}`, ...route, ...(query.length ? ['--query-parameters', ...query] : []), '--api-version', version], `${area}/${resource}`);

async function repo(name) {
  const r = await call(['repos', 'show', '--repository', name, ...PRJ], `repository ${name}`);
  return r.ok ? r.json : null;
}
async function refs(name, filter) {
  const r = await call(['repos', 'ref', 'list', '--repository', name, '--filter', filter, ...PRJ], `refs of ${name}`);
  return r.ok ? r.json.map((x) => x.name) : [];
}
async function file(repoName, path, version, versionType = 'branch') {
  const r = await invoke('git', 'items', [`repositoryId=${repoName}`], [`path=${path}`, 'includeContent=true', `versionDescriptor.version=${version}`, `versionDescriptor.versionType=${versionType}`]);
  return r.ok ? r.json.content ?? null : null;
}
async function pipeline(name) {
  const r = await call(['pipelines', 'show', '--name', name, ...PRJ], `pipeline ${name}`);
  return r.ok ? r.json : null;
}
async function completedPrs(target) {
  const r = await call(['repos', 'pr', 'list', '--repository', S.appRepo, '--status', 'completed', '--target-branch', target, '--top', '100', ...PRJ], 'pull requests');
  return r.ok ? r.json : [];
}
async function environment(name) {
  const r = await invoke('distributedtask', 'environments', [], [`name=${name}`]);
  return r.ok ? (r.json.value ?? []).find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null : null;
}
async function deployments(env) {
  const r = await invoke('distributedtask', 'environmentdeploymentrecords', [`environmentId=${env.id}`], ['top=20']);
  return r.ok ? r.json.value ?? [] : [];
}
async function pool(name) {
  const r = await call(['pipelines', 'pool', 'list', ...ORG], 'agent pools');
  return r.ok ? r.json.find((p) => p.name === name) ?? null : null;
}
async function policies(repoId, branch) {
  const r = await call(['repos', 'policy', 'list', '--repository-id', repoId, '--branch', branch, ...PRJ], `policies on ${branch}`);
  return r.ok ? r.json.filter((p) => p.isEnabled && p.isBlocking) : [];
}
const parse = (text) => {
  try {
    return text ? parseDocument(text) : null;
  } catch {
    return null;
  }
};
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const prFrom = (prs, prefix) => prs.filter((p) => p.sourceRefName?.startsWith(`refs/heads/${prefix}`));

// ---------------------------------------------------------------- missions
const MISSIONS = {
  async G00(r) {
    const app = await repo(S.appRepo);
    r.check('repo-exists', Boolean(app), app ? `${S.appRepo}: ${app.remoteUrl}` : `${S.appRepo} not found in ${S.adoProject}`, `Create it: az repos create --name ${S.appRepo}`);
    const heads = app ? await refs(S.appRepo, 'heads/') : [];
    const pkg = heads.includes('refs/heads/develop') ? await file(S.appRepo, '/app/package.json', 'develop') : null;
    r.check('long-lived-branches', heads.includes('refs/heads/main') && heads.includes('refs/heads/develop') && Boolean(pkg),
      `Branches: ${heads.join(', ') || '(none)'}; app/package.json on develop: ${pkg ? 'yes' : 'no'}`, 'Push main and develop with the app folder.');
    r.check('develop-default', app?.defaultBranch === 'refs/heads/develop', `defaultBranch: ${app?.defaultBranch ?? '-'}`, 'az repos update --repository orders-app --default-branch develop');
  },

  async G01(r) {
    const p = await pipeline('orders-ci');
    r.check('ci-pipeline', p?.process?.yamlFilename?.replace(/^\//, '') === 'azure-pipelines/ci.yml' && p?.repository?.name === S.appRepo,
      p ? `orders-ci → ${p.repository?.name}/${p.process?.yamlFilename}` : 'Pipeline orders-ci not found', 'az pipelines create --name orders-ci … --yml-path azure-pipelines/ci.yml');
    const doc = parse(await file(S.appRepo, '/azure-pipelines/ci.yml', 'develop'));
    const include = list(doc?.trigger?.branches?.include ?? (Array.isArray(doc?.trigger) ? doc.trigger : [])).map(String);
    const missing = GIT_FLOW_BRANCHES.filter((b) => !include.includes(b));
    r.check('ci-triggers', Boolean(doc) && missing.length === 0, `trigger include on develop: ${include.join(', ') || '(none or file missing)'}`, `Missing: ${missing.join(', ')}`);
    const runs = p ? await call(['pipelines', 'runs', 'list', '--pipeline-ids', String(p.id), '--branch', 'refs/heads/develop', '--result', 'succeeded', '--top', '1', ...PRJ], 'runs') : null;
    const run = runs?.ok ? runs.json[0] : null;
    r.check('ci-green-develop', Boolean(run), run ? `Run ${run.buildNumber} succeeded on develop (${run.finishTime})` : 'No succeeded run of orders-ci on develop', 'Merge to develop and let the trigger run.');
  },

  async G02(r) {
    const app = await repo(S.appRepo);
    const ci = await pipeline('orders-ci');
    for (const [id, branch] of [['policies-develop', 'develop'], ['policies-main', 'main']]) {
      const ps = app ? await policies(app.id, branch) : [];
      const reviewers = ps.find((p) => p.type?.displayName === 'Minimum number of reviewers' && p.settings?.minimumApproverCount >= 1);
      const build = ps.find((p) => p.type?.displayName === 'Build' && (!ci || p.settings?.buildDefinitionId === ci.id));
      r.check(id, Boolean(reviewers && build), `Blocking policies on ${branch}: ${ps.map((p) => p.type?.displayName).join(', ') || '(none)'}`,
        `Add ${[reviewers ? null : 'minimum reviewers', build ? null : 'build validation with orders-ci'].filter(Boolean).join(' and ')} on ${branch}.`);
    }
  },

  async G03(r) {
    const prs = prFrom(await completedPrs('develop'), 'feature/');
    r.check('feature-merged', prs.length > 0, prs.slice(0, 3).map((p) => `PR ${p.pullRequestId}: ${p.sourceRefName} → develop (${p.closedDate})`).join('\n') || 'No completed PR from feature/* into develop', 'Open a PR from feature/min-order to develop and complete it.');
  },

  async G04(r) {
    const t = await repo(S.templatesRepo);
    r.check('templates-repo', Boolean(t), t ? `${S.templatesRepo}: ${t.remoteUrl}` : `${S.templatesRepo} not found`, `az repos create --name ${S.templatesRepo}`);
    const tags = t ? await refs(S.templatesRepo, 'tags/') : [];
    const doc = tags.includes('refs/tags/v1.0.0') ? parse(await file(S.templatesRepo, '/templates/deploy-stage.yml', 'v1.0.0', 'tag')) : null;
    const stage = list(doc?.stages)[0];
    const deployment = list(stage?.jobs).find((j) => j?.deployment && j?.environment);
    r.check('template-tagged', Boolean(doc && list(doc.parameters).length && deployment), `Tags: ${tags.join(', ') || '(none)'}; parameters: ${list(doc?.parameters).map((p) => p.name).join(', ') || '-'}; deployment job: ${deployment ? 'yes' : 'no'}`,
      'Tag v1.0.0 with templates/deploy-stage.yml: parameters + a stage with a deployment job.');
  },

  async G05(r) {
    const p = await pipeline('orders-cd');
    r.check('cd-pipeline', Boolean(p), p ? `orders-cd → ${p.repository?.name}/${p.process?.yamlFilename}` : 'Pipeline orders-cd not found', 'Register azure-pipelines/cd.yml as orders-cd.');
    const doc = parse(await file(S.appRepo, '/azure-pipelines/cd.yml', 'develop'));
    const ciRes = list(doc?.resources?.pipelines).find((x) => x?.source === 'orders-ci');
    const tplRes = list(doc?.resources?.repositories).find((x) => String(x?.ref ?? '').startsWith('refs/tags/'));
    r.check('cd-resources', Boolean(ciRes && tplRes), `pipeline resource on orders-ci: ${ciRes ? 'yes' : 'no'}; template repository ref: ${tplRes?.ref ?? '(not pinned to a tag)'}`, 'resources: pipelines (source orders-ci) and repositories (ref refs/tags/v1.0.0).');
    const dev = await environment('DEV');
    const recs = dev ? await deployments(dev) : [];
    r.check('dev-deployed', recs.length > 0, dev ? `DEV: ${recs.length} deployment(s)` : 'Environment DEV not found', 'Merge to develop so orders-ci → orders-cd deploys DEV.');
  },

  async G06(r) {
    const p = await pool(S.agentPool);
    r.check('pool-exists', Boolean(p && !p.isHosted), p ? `${p.name} (id ${p.id}, self-hosted: ${!p.isHosted})` : `Pool ${S.agentPool} not found`, 'Organization settings → Agent pools → Add pool → Self-hosted.');
    const agents = p ? await call(['pipelines', 'agent', 'list', '--pool-id', String(p.id), ...ORG], 'agents') : null;
    const online = agents?.ok ? agents.json.filter((a) => a.status === 'online' && a.enabled) : [];
    r.check('agent-online', online.length > 0, agents?.ok ? agents.json.map((a) => `${a.name}: ${a.status}${a.enabled ? '' : ' (disabled)'} v${a.version}`).join('\n') || '(no agents)' : 'Pool not found',
      'Start WSL and the agent service.');
    const jobs = p ? await call(['devops', 'invoke', ...ORG, '--area', 'distributedtask', '--resource', 'jobrequests', '--route-parameters', `poolId=${p.id}`, '--query-parameters', 'top=20', '--api-version', '7.1'], 'job requests') : null;
    const ok = jobs?.ok ? (jobs.json.value ?? []).filter((j) => j.result === 'succeeded') : [];
    r.check('job-ran-on-agent', ok.length > 0, ok.slice(0, 3).map((j) => `${j.definition?.name ?? 'job'} on ${j.reservedAgent?.name ?? '?'} (${j.finishTime})`).join('\n') || 'No succeeded job on this pool yet', 'Run the DEV stage on the pool lab-wsl.');
  },

  async G07(r) {
    const prd = await environment('PRD');
    const checks = prd ? await invoke('PipelinesChecks', 'configurations', [], ['resourceType=environment', `resourceId=${prd.id}`], '7.1-preview') : null;
    const types = checks?.ok ? (checks.json.value ?? []).map((c) => c.type?.name) : [];
    r.check('prd-approval', types.includes('Approval'), prd ? `PRD checks: ${types.join(', ') || '(none)'}` : 'Environment PRD not found', 'PRD → Approvals and checks → Approvals.');
  },

  async G08(r) {
    const toMain = prFrom(await completedPrs('main'), 'release/');
    r.check('release-merged-main', toMain.length > 0, toMain.map((p) => `PR ${p.pullRequestId}: ${p.sourceRefName} → main`).join('\n') || 'No completed PR from release/* into main', 'PR release/1.0.0 → main.');
    const tags = await refs(S.appRepo, 'tags/');
    r.check('release-tagged', tags.includes('refs/tags/v1.0.0'), `Tags: ${tags.join(', ') || '(none)'}`, 'git tag -a v1.0.0 on main and push it.');
    const prd = await environment('PRD');
    const recs = prd ? await deployments(prd) : [];
    r.check('prd-deployed', recs.length > 0, prd ? `PRD: ${recs.length} deployment(s)` : 'Environment PRD not found', 'Approve the PRD stage of the main build.');
    const back = (await completedPrs('develop')).filter((p) => /^refs\/heads\/(release\/|main$)/.test(p.sourceRefName ?? ''));
    r.check('back-merged', back.length > 0, back.map((p) => `PR ${p.pullRequestId}: ${p.sourceRefName} → develop`).join('\n') || 'No completed PR from release/* or main into develop', 'Merge the release back into develop.');
  },

  async G09(r) {
    const toMain = prFrom(await completedPrs('main'), 'hotfix/');
    r.check('hotfix-merged-main', toMain.length > 0, toMain.map((p) => `PR ${p.pullRequestId}: ${p.sourceRefName} → main`).join('\n') || 'No completed PR from hotfix/* into main', 'PR hotfix/1.0.1 → main.');
    const tags = await refs(S.appRepo, 'tags/');
    r.check('hotfix-tagged', tags.includes('refs/tags/v1.0.1'), `Tags: ${tags.join(', ') || '(none)'}`, 'Tag v1.0.1 on main.');
    const back = (await completedPrs('develop')).filter((p) => /^refs\/heads\/(hotfix\/|main$)/.test(p.sourceRefName ?? ''));
    const after = back.filter((p) => toMain.some((m) => (p.closedDate ?? '') >= (m.closedDate ?? '')));
    r.check('hotfix-back-merged', after.length > 0, after.map((p) => `PR ${p.pullRequestId}: ${p.sourceRefName} → develop`).join('\n') || 'No PR into develop after the hotfix reached main', 'Merge the hotfix back into develop.');
  },

  async G10(r) {
    const tags = await refs(S.templatesRepo, 'tags/');
    r.check('template-v110', tags.includes('refs/tags/v1.1.0'), `Template tags: ${tags.join(', ') || '(none)'}`, 'Tag v1.1.0 in pipeline-templates.');
    const doc = parse(await file(S.appRepo, '/azure-pipelines/cd.yml', 'develop'));
    const ref = list(doc?.resources?.repositories).map((x) => x?.ref).find(Boolean);
    r.check('cd-bumped', ref === 'refs/tags/v1.1.0', `cd.yml on develop uses ${ref ?? '(no repository resource)'}`, 'Bump the ref through a PR to develop.');
  },

  async G11(r) {
    const R = S.githubRepo;
    const g = async (path) => {
      const res = await gh(['api', path]);
      if (res.notInstalled) throw new Blocked('missing_prerequisite', 'GitHub CLI (gh) is not installed.');
      if (res.authError || res.timedOut) throw new Blocked('auth_error', res.stderr || 'gh timed out');
      return res.ok ? JSON.parse(res.stdout) : null;
    };
    const files = (await g(`repos/${R}/contents/.github/workflows`)) ?? [];
    const docs = [];
    for (const f of files.filter((x) => /\.ya?ml$/.test(x.name))) {
      const c = await g(`repos/${R}/contents/${f.path}`);
      docs.push({ name: f.name, doc: parse(c?.content ? Buffer.from(c.content, 'base64').toString('utf8') : '') });
    }
    const branchesOf = (d) => list(d?.on?.push?.branches).map(String);
    const ci = docs.find((d) => ['develop', 'main'].every((b) => branchesOf(d.doc).includes(b)) && branchesOf(d.doc).some((b) => b.startsWith('release/')) && branchesOf(d.doc).some((b) => b.startsWith('hotfix/')));
    r.check('gh-ci-branches', Boolean(ci), docs.map((d) => `${d.name}: push ${branchesOf(d.doc).join(', ') || '-'}`).join('\n') || 'No workflows in the repository', 'on: push: branches: [develop, release/**, hotfix/**, main]');
    const reusable = docs.find((d) => d.doc?.on && typeof d.doc.on === 'object' && 'workflow_call' in d.doc.on);
    const used = reusable && docs.some((d) => Object.values(d.doc?.jobs ?? {}).some((j) => String(j?.uses ?? '').endsWith(reusable.name)));
    r.check('gh-reusable', Boolean(used), reusable ? `${reusable.name} is reusable; called: ${used ? 'yes' : 'no'}` : 'No workflow with on: workflow_call', 'Call the reusable workflow from the CI jobs: uses: ./.github/workflows/deploy.yml');
    const envs = (await g(`repos/${R}/environments`))?.environments ?? [];
    const prd = envs.find((e) => e.name === 'prd');
    r.check('gh-prd-protected', Boolean(prd?.protection_rules?.some((p) => p.type === 'required_reviewers')), envs.map((e) => `${e.name}: ${(e.protection_rules ?? []).map((p) => p.type).join(', ') || 'no rules'}`).join('\n') || 'No environments', 'Environment prd with required reviewers.');
    const prot = [];
    for (const b of ['main', 'develop']) prot.push([b, Boolean(await g(`repos/${R}/branches/${b}/protection`))]);
    r.check('gh-branches-protected', prot.every(([, ok]) => ok), prot.map(([b, ok]) => `${b}: ${ok ? 'protected' : 'not protected'}`).join('\n'), 'Protect main and develop (PR + required check).');
  },
};

runChecker(async (result) => {
  const id = process.env.PORTAL_SESSION_ID;
  const mission = MISSIONS[id];
  if (!mission) throw new Error(`Unknown Git Flow mission ${id}`);
  try {
    await mission(result);
  } catch (err) {
    if (!(err instanceof Blocked)) throw err;
    // Report every criterion this run could not evaluate as blocked by the environment.
    const done = new Set(result.criteria.map((c) => c.id));
    const ids = JSON.parse(fs.readFileSync(new URL('../catalog/gitflow.json', import.meta.url), 'utf8')).blocks.find((b) => b.id === id).criteria.filter((c) => c.verify === 'checker').map((c) => c.id);
    for (const c of ids) if (!done.has(c)) result.skip(c, err.reason, err.message);
    return 'Blocked by the environment.';
  }
  return `Mission ${id} evaluated (read-only).`;
});
