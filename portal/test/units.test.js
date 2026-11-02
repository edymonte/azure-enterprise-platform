import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAllDocuments, parseScalar } from '../checkers/lib/yaml-lite.js';
import { allowedDisruptions, selects } from '../checkers/lib/k8s.js';
import { analyse, fieldsUsingCurrent } from '../checkers/lib/policy.js';
import { redact } from '../lib/redact.js';

test('yaml-lite parses helm-style manifests', () => {
  const docs = parseAllDocuments([
    '---',
    '# Source: chart/templates/x.yaml',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: "svc"',
    '  labels:',
    '    app.kubernetes.io/name: api',
    'spec:',
    '  ports:',
    '    - port: 80',
    '      targetPort: 8080',
    '  policyTypes: ["Ingress"]',
    '  resources:',
    '    requests: { cpu: 50m, memory: 96Mi }',
    '  args:',
    '    - |',
    '      line one',
    '      line two',
    '  empty:',
    '---',
    'kind: List',
    'items:',
    '- a',
    '- b',
  ].join('\n'));
  assert.equal(docs.length, 2);
  assert.equal(docs[0].metadata.name, 'svc');
  assert.equal(docs[0].metadata.labels['app.kubernetes.io/name'], 'api');
  assert.deepEqual(docs[0].spec.ports, [{ port: 80, targetPort: 8080 }]);
  assert.deepEqual(docs[0].spec.policyTypes, ['Ingress']);
  assert.deepEqual(docs[0].spec.resources.requests, { cpu: '50m', memory: '96Mi' });
  assert.equal(docs[0].spec.args[0], 'line one\nline two\n');
  assert.equal(docs[0].spec.empty, null);
  assert.deepEqual(docs[1].items, ['a', 'b']);
});

test('yaml-lite scalars and unsupported features', () => {
  assert.equal(parseScalar('"a: b"'), 'a: b');
  assert.equal(parseScalar("'it''s'"), "it's");
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('12'), 12);
  assert.equal(parseScalar('curlimages/curl:8.11.1'), 'curlimages/curl:8.11.1');
  assert.throws(() => parseAllDocuments('a: &anchor 1'));
});

test('allowedDisruptions matches the disruption controller arithmetic', () => {
  assert.equal(allowedDisruptions({ minAvailable: 1 }, 1), 0);
  assert.equal(allowedDisruptions({ minAvailable: 1 }, 2), 1);
  assert.equal(allowedDisruptions({ maxUnavailable: 1 }, 1), 1);
  assert.equal(allowedDisruptions({ maxUnavailable: '50%' }, 3), 2);
  assert.equal(allowedDisruptions({ minAvailable: '50%' }, 3), 1);
  assert.equal(allowedDisruptions({ maxUnavailable: 0 }, 5), 0);
  assert.ok(Number.isNaN(allowedDisruptions({}, 2)));
  assert.equal(selects({ matchLabels: { a: '1' } }, { a: '1', b: '2' }), true);
  assert.equal(selects({ matchLabels: {} }, { a: '1' }), false);
});

const brokenRule = {
  if: { allOf: [
    { field: 'type', equals: 'Microsoft.Resources/subscriptions/resourceGroups' },
    { count: { value: "[parameters('tagNames')]", name: 'tagName', where: { field: "[concat('tags[', current('tagName'), ']')]", exists: 'false' } }, greater: 0 },
  ] },
  then: { effect: "[parameters('effect')]" },
};

test('policy analysis mirrors the engine: no runtime functions in field accessors or field()', () => {
  // 1) Original rule: current() inside a field accessor (UnsupportedPolicyRuleField).
  assert.equal(fieldsUsingCurrent(brokenRule).length, 1);
  assert.equal(analyse(brokenRule).reads.ok, false);

  // 2) current() nested in the field() function — rejected by Azure with
  //    InvalidPolicyDefinition ("FIELD functions cannot contain ... CURRENT").
  const nested = structuredClone(brokenRule);
  nested.if.allOf[1].count.where = { value: "[coalesce(field(concat('tags[', current('tagName'), ']')), '')]", equals: '' };
  assert.ok(analyse(nested).bad.length > 0, 'field(…current()…) must be flagged');

  // 3) Accepted: fixed path + key operator with current() on the value side.
  const fixed = structuredClone(brokenRule);
  fixed.if.allOf[1].count.where = { field: 'tags', notContainsKey: "[current('tagName')]" };
  const a = analyse(fixed);
  assert.deepEqual(a.bad, []);
  assert.equal(a.reads.ok, true);
  assert.equal(a.compares, 'count greater 0');

  // 4) Accepted: value expression with field('tags') (literal argument) and current() outside it.
  const viaValue = structuredClone(brokenRule);
  viaValue.if.allOf[1].count.where = { value: "[contains(field('tags'), current('tagName'))]", equals: false };
  assert.deepEqual(analyse(viaValue).bad, []);
  assert.equal(analyse(viaValue).reads.ok, true);

  // 5) A where clause without an operator is not a test.
  const noOperator = structuredClone(fixed);
  delete noOperator.if.allOf[1].count.where.notContainsKey;
  assert.equal(analyse(noOperator).reads.ok, false);
});

test('redact removes secret-looking values', () => {
  const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(10)}`;
  const out = redact(`token ${jwt} AccountKey=abc123; https://x/y?sv=1&sig=SECRET ghp_${'x'.repeat(30)}`);
  assert.ok(!out.includes(jwt));
  assert.ok(!out.includes('abc123'));
  assert.ok(!out.includes('SECRET'));
  assert.ok(!out.includes('ghp_x'));
});

test('commands tab: every command has an explanation and an example', async () => {
  const { loadCatalog } = await import('../server/catalog.js');
  const { PORTAL_ROOT } = await import('../server/config.js');
  const ref = loadCatalog(PORTAL_ROOT).commands;
  assert.deepEqual(ref.sections.map((s) => s.id), ['az', 'git', 'gh', 'docker', 'kubectl']);
  for (const s of ref.sections) for (const c of s.commands) assert.ok(c.what.length > 20 && c.example.length > 5, `${s.id}: ${c.cmd}`);
});
