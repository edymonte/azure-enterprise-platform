// Read-only probes of the deployed platform (state storage and hub & spoke),
// shared by the recovery-sprint checkers. Names follow the repository defaults
// (org "mfs", environment "lab").
import { az } from './checker.js';

export const STATE_RG = 'rg-mfs-tfstate';
export const STATE_CONTAINER = 'tfstate';
export const STATE_LAYERS = ['05-identity', '10-foundation', '20-governance'];
export const HUB = { rg: 'rg-mfs-hub-lab', vnet: 'vnet-mfs-hub-lab' };
export const SPOKE = { rg: 'rg-mfs-portal-lab', vnet: 'vnet-mfs-portal-lab', nsg: 'nsg-mfs-aks-lab' };
export const PRIVATE_ZONES = ['privatelink.database.windows.net', 'privatelink.vaultcore.azure.net'];

// Turns a failed az call into a skip (environment) or a fail with a reason.
export function reportAzError(result, id, r, what) {
  if (r.authError) result.skip(id, 'auth_error', `${what}: ${r.stderr}`);
  else if (r.notInstalled) result.skip(id, 'missing_prerequisite', 'Azure CLI (az) is not installed.');
  else if (r.timedOut) result.skip(id, 'auth_error', `${what} timed out.`);
  else result.fail(id, r.stderr || `${what} failed.`, r.notFound ? `${what}: not found — is the layer deployed?` : `${what} failed.`);
}

export async function stateAccount() {
  const r = await az(['storage', 'account', 'list', '-g', STATE_RG, '--query', '[].{name:name, id:id}']);
  if (!r.ok) return { error: r };
  if (!r.json?.length) return { error: { ...r, notFound: true, stderr: `No storage account in ${STATE_RG}.` } };
  return { account: r.json[0] };
}

// Blob listing through Entra ID (data plane). A 403 means the signed-in user has no data role.
export async function stateBlobs(accountName, { versions = false } = {}) {
  const args = ['storage', 'blob', 'list', '--account-name', accountName, '-c', STATE_CONTAINER, '--auth-mode', 'login',
    '--query', '[].{name:name, version:versionId, lease:properties.lease.state}'];
  if (versions) args.push('--include', 'v');
  const r = await az(args);
  const forbidden = /AuthorizationPermissionMismatch|AuthorizationFailure|403/i.test(r.stderr ?? '');
  return { ...r, forbidden };
}
