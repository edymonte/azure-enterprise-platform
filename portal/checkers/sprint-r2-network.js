// Recovery sprint R2 — hub & spoke review and data-plane access to the state (read-only).
// The network criteria match session C005.
import { runChecker, az, azureGate } from './lib/checker.js';
import { HUB, SPOKE, PRIVATE_ZONES, reportAzError, stateAccount } from './lib/platform.js';

const IDS = ['peering-connected', 'nsg-rules', 'dns-links', 'state-data-role'];
const EXPECTED_RULES = [
  { priority: 100, access: 'Allow', what: 'Front Door', match: (r) => r.sourceAddressPrefix === 'AzureFrontDoor.Backend' },
  { priority: 110, access: 'Allow', what: 'operator IP', match: (r) => (r.sourceAddressPrefixes ?? []).length > 0 || /\/32$/.test(r.sourceAddressPrefix ?? '') },
  { priority: 4000, access: 'Deny', what: 'Internet', match: (r) => r.sourceAddressPrefix === 'Internet' },
];

runChecker(async (result) => {
  const gate = await azureGate();
  if (gate.blocked) {
    for (const id of IDS) result.skip(id, gate.blocked, gate.reason);
    return 'Azure sign-in needed.';
  }

  // ---- Peering (both sides) ----------------------------------------------------
  const hubSide = await az(['network', 'vnet', 'peering', 'list', '-g', HUB.rg, '--vnet-name', HUB.vnet]);
  const spokeSide = await az(['network', 'vnet', 'peering', 'list', '-g', SPOKE.rg, '--vnet-name', SPOKE.vnet]);
  if (!hubSide.ok) reportAzError(result, 'peering-connected', hubSide, `Peerings of ${HUB.vnet}`);
  else if (!spokeSide.ok) reportAzError(result, 'peering-connected', spokeSide, `Peerings of ${SPOKE.vnet}`);
  else {
    const toSpoke = hubSide.json.find((p) => p.remoteVirtualNetwork?.id?.toLowerCase().endsWith(`/${SPOKE.vnet}`));
    const toHub = spokeSide.json.find((p) => p.remoteVirtualNetwork?.id?.toLowerCase().endsWith(`/${HUB.vnet}`));
    const line = (p, dir) => (p ? `${dir}: ${p.name} ${p.peeringState}` : `${dir}: missing`);
    result.check(
      'peering-connected',
      toSpoke?.peeringState === 'Connected' && toHub?.peeringState === 'Connected',
      [line(toSpoke, 'hub → spoke'), line(toHub, 'spoke → hub')].join('\n'),
      'Both peerings must exist and be Connected.',
    );
  }

  // ---- NSG ------------------------------------------------------------------------
  const rules = await az(['network', 'nsg', 'rule', 'list', '-g', SPOKE.rg, '--nsg-name', SPOKE.nsg]);
  if (!rules.ok) reportAzError(result, 'nsg-rules', rules, `Rules of ${SPOKE.nsg}`);
  else {
    const found = EXPECTED_RULES.map((e) => ({ e, r: rules.json.find((r) => r.priority === e.priority && r.access === e.access && r.direction === 'Inbound' && e.match(r)) }));
    result.check(
      'nsg-rules',
      found.every((f) => f.r),
      [...rules.json].sort((a, b) => a.priority - b.priority).map((r) => `${r.priority} ${r.access} ${r.name}`).join('\n'),
      `Missing: ${found.filter((f) => !f.r).map((f) => `${f.e.priority} ${f.e.what}`).join(', ')}.`,
    );
  }

  // ---- Private DNS links ---------------------------------------------------------
  const linkLines = [];
  let linksOk = true;
  let linkError = null;
  for (const zone of PRIVATE_ZONES) {
    const links = await az(['network', 'private-dns', 'link', 'vnet', 'list', '-g', HUB.rg, '-z', zone]);
    if (!links.ok) {
      linkError = { r: links, zone };
      break;
    }
    const vnets = links.json.map((l) => (l.virtualNetwork?.id ?? '').split('/').pop().toLowerCase());
    const ok = vnets.includes(HUB.vnet) && vnets.includes(SPOKE.vnet);
    linksOk &&= ok;
    linkLines.push(`${zone}: ${vnets.join(', ') || '(no links)'}`);
  }
  if (linkError) reportAzError(result, 'dns-links', linkError.r, `Links of ${linkError.zone}`);
  else result.check('dns-links', linksOk, linkLines.join('\n'), 'Each private zone must be linked to the hub and the spoke VNet.');

  // ---- Data-plane role on the state account -----------------------------------------
  const sa = await stateAccount();
  const me = await az(['ad', 'signed-in-user', 'show', '--query', '{id:id, upn:userPrincipalName}']);
  if (sa.error) reportAzError(result, 'state-data-role', sa.error, 'State storage account');
  else if (!me.ok) reportAzError(result, 'state-data-role', me, 'Signed-in user');
  else {
    const roles = await az(['role', 'assignment', 'list', '--assignee', me.json.id, '--scope', sa.account.id, '--include-inherited', '--query', '[].roleDefinitionName']);
    if (!roles.ok) reportAzError(result, 'state-data-role', roles, 'Role assignments');
    else {
      const data = roles.json.filter((r) => /^Storage Blob Data (Owner|Contributor|Reader)$/.test(r));
      result.check(
        'state-data-role',
        data.length > 0,
        `Roles of the signed-in user on ${sa.account.name}: ${roles.json.join(', ') || '(none)'}`,
        'No Storage Blob Data role: control-plane roles (Owner) cannot read blobs when shared keys are disabled.',
      );
    }
  }
  return 'Peering, NSG, private DNS and state access evaluated.';
});
