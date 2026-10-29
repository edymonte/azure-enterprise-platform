// Recovery sprint R6 — evidence of the "plan cannot log in" incident (read-only):
// a failed infra run with an Entra error, and the presented OIDC subject format
// next to the subjects the app registration trusts. The portal keeps this
// evidence sealed until the learner has recorded their own attempts.
import { runChecker, gh, az, repoSlug } from './lib/checker.js';

runChecker(async (result) => {
  const slug = await repoSlug();
  if (!slug) {
    result.skip('failure-evidence', 'missing_prerequisite', 'The origin remote is not a GitHub repository.');
    result.skip('subject-comparison', 'missing_prerequisite', 'The origin remote is not a GitHub repository.');
    return 'No GitHub repository.';
  }
  const ghBlock = (r) => (r.notInstalled ? 'missing_prerequisite' : r.authError || r.timedOut ? 'auth_error' : null);

  // ---- Failed runs and their Entra error --------------------------------------------------
  const runs = await gh(['run', 'list', '-R', slug, '--workflow', 'infra.yml', '--status', 'failure', '-L', '10', '--json', 'databaseId,headBranch,createdAt']);
  if (ghBlock(runs)) result.skip('failure-evidence', ghBlock(runs), runs.stderr || 'gh not available.');
  else if (!runs.ok) result.fail('failure-evidence', runs.stderr, 'Could not list the infra workflow runs.');
  else {
    const found = [];
    for (const run of JSON.parse(runs.stdout || '[]').slice(0, 3)) {
      const log = await gh(['run', 'view', String(run.databaseId), '-R', slug, '--log-failed'], { timeoutMs: 90000 });
      const codes = [...new Set((log.stdout.match(/AADSTS\d+/g) ?? []))];
      if (codes.length) found.push(`run ${run.databaseId} (${run.headBranch}, ${run.createdAt.slice(0, 10)}): ${codes.join(', ')}`);
    }
    result.check('failure-evidence', found.length > 0, found.join('\n') || 'No failed infra run with an AADSTS error among the latest failures.', 'No failed infra run with an Entra (AADSTS) error was found.');
  }

  // ---- Presented subject vs trusted subjects ------------------------------------------------
  const custom = await gh(['api', `repos/${slug}/actions/oidc/customization/sub`]);
  const clientId = await gh(['variable', 'get', 'AZURE_CLIENT_ID', '-R', slug]);
  const blocked = ghBlock(custom) ?? ghBlock(clientId);
  if (blocked) result.skip('subject-comparison', blocked, custom.stderr || clientId.stderr || 'gh not available.');
  else if (!custom.ok || !clientId.ok) result.fail('subject-comparison', custom.stderr || clientId.stderr, 'Could not read the OIDC customization or the AZURE_CLIENT_ID variable.');
  else {
    const fics = await az(['ad', 'app', 'federated-credential', 'list', '--id', clientId.stdout.trim(), '--query', '[].subject']);
    if (!fics.ok) {
      if (fics.authError || fics.notInstalled) result.skip('subject-comparison', fics.notInstalled ? 'missing_prerequisite' : 'auth_error', fics.stderr);
      else result.fail('subject-comparison', fics.stderr, 'Could not list the federated credentials of the GitHub app registration.');
    } else {
      const c = JSON.parse(custom.stdout);
      const prefix = c.use_immutable_subject ? c.sub_claim_prefix ?? `(immutable ids for ${slug})` : `repo:${slug}`;
      const trusted = fics.json ?? [];
      const matches = trusted.filter((s) => s.startsWith(`${prefix}:`));
      result.pass('subject-comparison', [
        `Presented subject prefix: ${prefix} (use_immutable_subject=${Boolean(c.use_immutable_subject)}, use_default=${Boolean(c.use_default)})`,
        `Trusted subjects:\n  ${trusted.join('\n  ') || '(none)'}`,
        `Trusted subjects with the presented prefix: ${matches.length}`,
      ].join('\n'));
    }
  }
  return 'Incident evidence collected.';
});
