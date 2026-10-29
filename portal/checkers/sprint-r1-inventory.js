// Recovery sprint R1 — tools, Azure context and deployed layers (read-only).
import { runChecker, az, gh, azureGate } from './lib/checker.js';
import { runCommand } from '../lib/exec.js';
import { STATE_RG, STATE_LAYERS, HUB, SPOKE, reportAzError, stateAccount, stateBlobs } from './lib/platform.js';

runChecker(async (result) => {
  // ---- Tools ------------------------------------------------------------------
  const lines = [];
  const missing = [];
  const azv = await az(['version']);
  if (azv.ok) lines.push(`az ${azv.json?.['azure-cli'] ?? '?'}`);
  else missing.push('az');
  for (const [cmd, args, pick] of [['terraform', ['version'], /Terraform v[\d.]+/], ['git', ['--version'], /git version [\d.]+/]]) {
    const r = await runCommand(cmd, args, { timeoutMs: 20000 });
    if (r.code === 0) lines.push((r.stdout.match(pick) ?? [cmd])[0]);
    else missing.push(cmd);
  }
  const ghAuth = await gh(['auth', 'status']);
  if (ghAuth.notInstalled) missing.push('gh');
  else if (!ghAuth.ok) missing.push('gh (not signed in: gh auth login)');
  else lines.push('gh signed in');
  result.check('tools-ready', missing.length === 0, lines.join('\n'), `Missing or not ready: ${missing.join(', ')}.`);

  // ---- Azure context ----------------------------------------------------------
  const gate = await azureGate();
  if (gate.blocked) {
    result.skip('azure-lab-context', gate.blocked, gate.reason);
    result.skip('deployed-layers', gate.blocked, gate.reason);
    return 'Tools evaluated; Azure criteria need a valid sign-in.';
  }
  const stateRg = await az(['group', 'show', '-n', STATE_RG, '--query', '{name:name, location:location}']);
  if (!stateRg.ok && !stateRg.notFound) reportAzError(result, 'azure-lab-context', stateRg, `az group show ${STATE_RG}`);
  else {
    result.check(
      'azure-lab-context',
      stateRg.ok,
      `Subscription "${gate.account.name}" (${gate.account.id}), user ${gate.account.user?.name ?? '?'}${stateRg.ok ? `; ${STATE_RG} in ${stateRg.json.location}` : ''}`,
      `${STATE_RG} does not exist in this subscription: select the lab subscription (az account set).`,
    );
  }

  // ---- Deployed layers ----------------------------------------------------------
  const sa = await stateAccount();
  if (sa.error) {
    reportAzError(result, 'deployed-layers', sa.error, 'State storage account');
    return 'Azure evaluated.';
  }
  const blobs = await stateBlobs(sa.account.name);
  if (!blobs.ok) {
    if (blobs.forbidden) result.fail('deployed-layers', blobs.stderr, 'Your user has no Storage Blob Data role on the state account (00-bootstrap assigns it).');
    else reportAzError(result, 'deployed-layers', blobs, 'State blob list');
    return 'Azure evaluated.';
  }
  const names = new Set((blobs.json ?? []).map((b) => b.name.replace(/\.tfstate$/, '')));
  const groups = await az(['group', 'list', '--query', "[?starts_with(name, 'rg-mfs')].name"]);
  const rgs = new Set(groups.ok ? groups.json : []);
  const missingLayers = STATE_LAYERS.filter((l) => !names.has(l));
  const missingRgs = [HUB.rg, SPOKE.rg].filter((g) => !rgs.has(g));
  result.check(
    'deployed-layers',
    missingLayers.length === 0 && missingRgs.length === 0,
    [`State blobs: ${[...names].sort().join(', ') || '(none)'}`, `Resource groups: ${[...rgs].sort().join(', ') || '(none)'}`].join('\n'),
    [missingLayers.length ? `No state for ${missingLayers.join(', ')}` : null, missingRgs.length ? `Missing ${missingRgs.join(', ')}` : null].filter(Boolean).join('; '),
  );
  return 'Tools, Azure context and deployed layers evaluated.';
});
