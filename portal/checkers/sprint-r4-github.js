// Recovery sprint R4 — the learner's GitHub Actions drill (structure only) and
// the protection of the repository's lab environment (read-only).
import { runChecker, gh, repoSlug } from './lib/checker.js';
import { readDrill, asList, secretFindings } from './lib/drill.js';

const DRILL_IDS = ['drill-triggers', 'drill-oidc', 'drill-gated-apply'];

runChecker(async (result) => {
  // ---- Drill ------------------------------------------------------------------------
  const d = readDrill('r4-infra-plan.yml');
  if (d.error) for (const id of DRILL_IDS) result.fail(id, d.file, d.error);
  else {
    const on = d.doc.on ?? {};
    const pr = typeof on === 'object' && !Array.isArray(on) ? on.pull_request : null;
    const paths = asList(pr?.paths).map(String);
    const dispatch = typeof on === 'object' && !Array.isArray(on) ? 'workflow_dispatch' in on : asList(on).includes('workflow_dispatch');
    result.check(
      'drill-triggers',
      paths.some((p) => p.startsWith('infra/')) && dispatch,
      `pull_request paths: ${paths.join(', ') || '(none)'}; workflow_dispatch: ${dispatch ? 'yes' : 'no'}`,
      'Trigger plan on pull_request with paths [\'infra/**\'] and add workflow_dispatch for the manual run.',
    );

    const jobs = d.doc.jobs && typeof d.doc.jobs === 'object' ? d.doc.jobs : {};
    const tokenAt = [['workflow', d.doc.permissions], ...Object.entries(jobs).map(([n, j]) => [`job ${n}`, j?.permissions])]
      .filter(([, p]) => p && typeof p === 'object' && p['id-token'] === 'write')
      .map(([where]) => where);
    const secrets = secretFindings(d.text);
    result.check(
      'drill-oidc',
      tokenAt.length > 0 && secrets.length === 0,
      `id-token: write at ${tokenAt.join(', ') || '(nowhere)'}${secrets.length ? `\nSecret-like values:\n${secrets.join('\n')}` : '\nNo secret-like values.'}`,
      tokenAt.length ? 'Remove the secret: OIDC needs only client, tenant and subscription ids.' : 'Add permissions: id-token: write (and contents: read).',
    );

    const gated = Object.entries(jobs).map(([name, j]) => {
      const needs = asList(j?.needs).filter((n) => n in jobs);
      const env = typeof j?.environment === 'string' ? j.environment : j?.environment?.name;
      const manual = /workflow_dispatch/.test(String(j?.if ?? ''));
      const applies = /terraform[^\n]*\bapply\b/.test(JSON.stringify(j?.steps ?? []));
      return { name, needs, env, manual, applies };
    });
    const ok = gated.find((g) => g.applies && g.needs.length && g.env && g.manual);
    result.check(
      'drill-gated-apply',
      Boolean(ok),
      gated.map((g) => `${g.name}: needs=${g.needs.join(',') || '-'} environment=${g.env ?? '-'} manual-only=${g.manual} terraform apply=${g.applies}`).join('\n') || '(no jobs)',
      'The job that runs terraform apply needs the plan job, has if: github.event_name == \'workflow_dispatch\' and environment: lab.',
    );
  }

  // ---- Repository environment -----------------------------------------------------------
  const slug = await repoSlug();
  if (!slug) {
    result.skip('lab-environment-protected', 'missing_prerequisite', 'The origin remote is not a GitHub repository.');
    return 'Drill evaluated.';
  }
  const env = await gh(['api', `repos/${slug}/environments/lab`]);
  if (env.notInstalled) result.skip('lab-environment-protected', 'missing_prerequisite', 'GitHub CLI (gh) is not installed.');
  else if (env.authError || env.timedOut) result.skip('lab-environment-protected', 'auth_error', env.stderr || 'gh api timed out.');
  else if (!env.ok) result.fail('lab-environment-protected', env.stderr, env.notFound ? 'The lab environment does not exist in the repository.' : 'Could not read the environment.');
  else {
    const rules = (JSON.parse(env.stdout).protection_rules ?? []).map((r) => r.type);
    result.check('lab-environment-protected', rules.includes('required_reviewers'), `${slug} environment lab: ${rules.join(', ') || 'no protection rules'}`, 'Add required reviewers to the lab environment.');
  }
  return 'Drill and lab environment evaluated.';
});
