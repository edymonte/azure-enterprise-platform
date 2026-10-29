// Recovery sprint R3 — remote state you can trust (read-only). The first four
// criteria match session C002; no-stale-lock checks that no blob is left leased.
import { runChecker, az, azureGate } from './lib/checker.js';
import { STATE_RG, STATE_LAYERS, reportAzError, stateAccount, stateBlobs } from './lib/platform.js';

const IDS = ['shared-key-disabled', 'versioning-enabled', 'layer-blobs', 'multiple-versions', 'no-stale-lock'];

runChecker(async (result) => {
  const gate = await azureGate();
  if (gate.blocked) {
    for (const id of IDS) result.skip(id, gate.blocked, gate.reason);
    return 'Azure sign-in needed.';
  }
  const sa = await stateAccount();
  if (sa.error) {
    for (const id of IDS) reportAzError(result, id, sa.error, 'State storage account');
    return 'State account not found.';
  }
  const name = sa.account.name;

  // ---- Control plane --------------------------------------------------------------
  const account = await az(['storage', 'account', 'show', '-n', name, '-g', STATE_RG]);
  if (!account.ok) reportAzError(result, 'shared-key-disabled', account, 'az storage account show');
  else {
    const a = account.json;
    result.check(
      'shared-key-disabled',
      a.allowSharedKeyAccess === false,
      `${name}: allowSharedKeyAccess=${a.allowSharedKeyAccess}, allowBlobPublicAccess=${a.allowBlobPublicAccess}, minimumTlsVersion=${a.minimumTlsVersion}`,
      'Shared keys are still accepted: anyone with a key bypasses Entra ID and RBAC.',
    );
  }
  const service = await az(['storage', 'account', 'blob-service-properties', 'show', '-n', name, '-g', STATE_RG]);
  if (!service.ok) reportAzError(result, 'versioning-enabled', service, 'Blob service properties');
  else {
    const s = service.json;
    result.check(
      'versioning-enabled',
      s.isVersioningEnabled === true,
      `isVersioningEnabled=${s.isVersioningEnabled}, soft delete=${s.deleteRetentionPolicy?.enabled ? `${s.deleteRetentionPolicy.days} days` : 'off'}`,
      'Without versioning a corrupted state cannot be rolled back.',
    );
  }

  // ---- Data plane -------------------------------------------------------------------
  const all = await stateBlobs(name, { versions: true });
  const current = await stateBlobs(name);
  for (const [r, ids] of [[all, ['layer-blobs', 'multiple-versions']], [current, ['no-stale-lock']]]) {
    if (r.ok) continue;
    for (const id of ids) {
      if (r.forbidden) result.fail(id, r.stderr, 'Your user has no Storage Blob Data role on the state account.');
      else reportAzError(result, id, r, 'State blob list');
    }
  }
  if (all.ok) {
    const counts = new Map();
    for (const b of all.json) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
    const summary = [...counts].sort().map(([n, c]) => `${n}: ${c} version(s)`).join('\n') || '(no blobs)';
    const missing = STATE_LAYERS.filter((l) => !counts.has(`${l}.tfstate`));
    result.check('layer-blobs', missing.length === 0, summary, `No state blob for ${missing.join(', ')}.`);
    result.check('multiple-versions', [...counts.values()].some((c) => c >= 2), summary, 'Every blob has a single version: apply a layer twice or check that versioning is on.');
  }
  if (current.ok) {
    const leased = current.json.filter((b) => b.lease === 'leased');
    result.check(
      'no-stale-lock',
      leased.length === 0,
      current.json.map((b) => `${b.name}: lease ${b.lease ?? 'unknown'}`).join('\n'),
      `Leased: ${leased.map((b) => b.name).join(', ')}. If no plan/apply is running, release it with terraform force-unlock <LockID>.`,
    );
  }
  return 'State account protection, versions and locks evaluated.';
});
