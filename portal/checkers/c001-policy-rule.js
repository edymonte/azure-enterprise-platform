// C001 — "Policy rejected by the API": the require-rg-tags rule must use a
// `value` condition (current() is not allowed in a `field` accessor), be
// committed, and be deployed together with the platform-guardrails initiative.
import { runChecker, readText, git, az, azureGate } from './lib/checker.js';
import { analyse } from './lib/policy.js';

const RULE = 'infra/policies/require-rg-tags.rule.json';
const DEFINITION = 'mfs-require-rg-tags';
const INITIATIVE = 'mfs-platform-guardrails';
const REFERENCE_ID = 'requireRgTags';

runChecker(async (result) => {
  // ---- Local rule (offline) ------------------------------------------------
  let localRule = null;
  try {
    localRule = JSON.parse(readText(RULE));
  } catch (err) {
    result.fail('rule-accepted-syntax', `${RULE}: ${err.message}`, 'The rule file must be valid JSON.');
  }
  if (localRule) {
    const a = analyse(localRule);
    result.check(
      'rule-accepted-syntax',
      a.bad.length === 0,
      a.bad.length ? `field accessors using current():\n${a.bad.join('\n')}` : 'No field accessor uses current().',
      'The API rejects current() inside a "field" accessor (UnsupportedPolicyRuleField).',
    );
    result.check(
      'rule-detects-missing-tag',
      a.reads.ok && a.compares !== null && a.countValue === "[parameters('tagNames')]",
      [`count over ${a.countValue ?? '(none)'}`, a.reads.why, a.compares ?? 'no "greater" comparison on the count'].join('\n'),
      'Keep the value count over tagNames and detect a missing tag with a value condition.',
    );
  } else {
    result.fail('rule-detects-missing-tag', 'Rule could not be parsed.', 'Fix the JSON first.');
  }

  // ---- Committed fix (git) -------------------------------------------------
  const status = await git(['status', '--porcelain', '--', RULE]);
  const committed = await git(['show', `HEAD:${RULE}`]);
  let committedOk = false;
  let committedEvidence = '';
  if (status.code !== 0 || committed.code !== 0) {
    committedEvidence = 'Could not read the rule from git.';
  } else if (status.stdout.trim()) {
    committedEvidence = `Uncommitted change: ${status.stdout.trim()}`;
  } else {
    try {
      const a = analyse(JSON.parse(committed.stdout));
      committedOk = a.bad.length === 0 && a.reads.ok;
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const last = await git(['log', '-1', '--format=%h %s', '--', RULE]);
      committedEvidence = `${branch.stdout.trim()} @ ${last.stdout.trim()}${committedOk ? '' : ' (committed rule is still the broken version)'}`;
    } catch (err) {
      committedEvidence = `Committed rule is not valid JSON: ${err.message}`;
    }
  }
  result.check('fix-committed', committedOk, committedEvidence, 'Commit the fixed rule on a branch (never on main).');

  // ---- Azure (read-only) ----------------------------------------------------
  const gate = await azureGate();
  if (gate.blocked) {
    result.skip('definition-deployed', gate.blocked, gate.reason);
    result.skip('initiative-assigned', gate.blocked, gate.reason);
    return 'Local criteria evaluated; Azure criteria need a valid sign-in.';
  }

  const def = await az(['policy', 'definition', 'show', '-n', DEFINITION]);
  if (def.authError) result.skip('definition-deployed', 'auth_error', def.stderr);
  else if (!def.ok) {
    result.fail('definition-deployed', def.notFound ? `Policy definition ${DEFINITION} does not exist in the subscription.` : def.stderr, 'Apply 20-governance after fixing the rule.');
  } else {
    const deployed = analyse(def.json.policyRule);
    result.check(
      'definition-deployed',
      deployed.bad.length === 0 && deployed.reads.ok,
      `${def.json.id}\n${deployed.reads.why}`,
      'The deployed definition must be the fixed rule.',
    );
  }

  const assignment = await az(['policy', 'assignment', 'show', '-n', INITIATIVE]);
  const setDef = await az(['policy', 'set-definition', 'show', '-n', INITIATIVE]);
  if (assignment.authError || setDef.authError) {
    result.skip('initiative-assigned', 'auth_error', assignment.stderr || setDef.stderr);
  } else {
    const refs = setDef.ok ? (setDef.json.policyDefinitions ?? []).map((p) => p.policyDefinitionReferenceId) : [];
    const ok = assignment.ok && setDef.ok && refs.includes(REFERENCE_ID);
    const lines = [
      assignment.ok ? `Assignment ${INITIATIVE} at ${assignment.json.scope}` : `Assignment ${INITIATIVE} not found`,
      setDef.ok ? `Initiative references: ${refs.join(', ')}` : `Initiative ${INITIATIVE} not found`,
    ];
    result.check('initiative-assigned', ok, lines.join('\n'), 'The initiative (with requireRgTags) must be created and assigned to the subscription.');
  }
  return 'Rule, commit and Azure deployment evaluated.';
});
