// Recovery sprint R5 — the learner's Azure Pipelines drill (structure only, offline).
import { runChecker } from './lib/checker.js';
import { readDrill, walk, asList, secretFindings } from './lib/drill.js';

const IDS = ['drill-stages', 'drill-template', 'drill-variables', 'drill-service-connection', 'drill-approval-gate'];
const CONNECTION_INPUTS = ['azureSubscription', 'backendServiceArm', 'environmentServiceNameAzureRM', 'connectedServiceNameARM', 'azureResourceManagerConnection'];

runChecker(async (result) => {
  const d = readDrill('r5-infra-pipeline.yml');
  if (d.error) {
    for (const id of IDS) result.fail(id, d.file, d.error);
    return 'Drill not readable.';
  }
  const stages = asList(d.doc.stages).filter((s) => s && typeof s === 'object');
  const plan = stages.find((s) => /plan/i.test(String(s.stage ?? '')));
  const apply = stages.find((s) => /apply/i.test(String(s.stage ?? '')));
  const dependsOn = asList(apply?.dependsOn).map(String);
  result.check(
    'drill-stages',
    Boolean(plan && apply && dependsOn.includes(String(plan.stage))),
    `stages: ${stages.map((s) => s.stage).join(' → ') || '(none)'}; Apply dependsOn: ${dependsOn.join(', ') || '(not set)'}`,
    'Declare a Plan stage and an Apply stage with dependsOn: Plan (dependsOn: [] would run them in parallel).',
  );

  const nodes = walk(d.doc);
  const templates = nodes.filter((n) => typeof n.template === 'string' && n.parameters && typeof n.parameters === 'object');
  result.check(
    'drill-template',
    templates.length > 0,
    templates.map((t) => `${t.template} (${Object.keys(t.parameters).join(', ')})`).join('\n') || '(no template with parameters)',
    'Reuse the steps with - template: templates/terraform-layer.yml and parameters: (layer, action, serviceConnection).',
  );

  const vars = asList(d.doc.variables);
  const group = vars.find((v) => v && typeof v === 'object' && typeof v.group === 'string');
  const used = /\$\{\{\s*variables\.|\$\(\w+\)|\$\[\s*variables/.test(d.text);
  result.check(
    'drill-variables',
    Boolean(group) && used,
    `variable group: ${group?.group ?? '(none)'}; variables referenced: ${used ? 'yes' : 'no'}`,
    'Use the list form: variables: - group: mfs-lab-common - name: serviceConnection value: …, and reference them with ${{ variables.x }} or $(x).',
  );

  const connections = nodes.flatMap((n) => [
    ...CONNECTION_INPUTS.filter((k) => typeof n[k] === 'string').map((k) => `${k}: ${n[k]}`),
    ...(n.parameters && typeof n.parameters === 'object' ? Object.entries(n.parameters).filter(([k]) => /serviceconnection|azuresubscription/i.test(k)).map(([k, v]) => `parameter ${k}: ${v}`) : []),
  ]);
  const secrets = secretFindings(d.text);
  result.check(
    'drill-service-connection',
    connections.length > 0 && secrets.length === 0,
    `${connections.join('\n') || '(no service connection reference)'}${secrets.length ? `\nSecret-like values:\n${secrets.join('\n')}` : ''}`,
    connections.length ? 'Remove the secret: the service connection (workload identity federation) is the only credential.' : 'Reference the service connection (azureSubscription input or a serviceConnection template parameter).',
  );

  const deployment = asList(apply?.jobs).find((j) => j && typeof j === 'object' && j.deployment && j.environment);
  result.check(
    'drill-approval-gate',
    Boolean(deployment),
    deployment ? `Apply → deployment ${deployment.deployment} on environment ${typeof deployment.environment === 'string' ? deployment.environment : deployment.environment?.name}` : `Apply jobs: ${asList(apply?.jobs).map((j) => j?.job ?? j?.deployment ?? '?').join(', ') || '(none)'}`,
    'Make Apply a deployment job (- deployment: apply) with environment: mfs-lab — the approval lives on the environment.',
  );
  return 'Drill structure evaluated.';
});
