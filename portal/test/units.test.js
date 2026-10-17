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

test('policy analysis flags current() inside field and accepts a value condition', () => {
  assert.equal(fieldsUsingCurrent(brokenRule).length, 1);
  const broken = analyse(brokenRule);
  assert.equal(broken.reads.ok, false);
  const fixed = structuredClone(brokenRule);
  fixed.if.allOf[1].count.where = { value: "[coalesce(field(concat('tags[', current('tagName'), ']')), '')]", equals: '' };
  const a = analyse(fixed);
  assert.equal(a.bad.length, 0);
  assert.equal(a.reads.ok, true);
  assert.equal(a.compares, 'count greater 0');
  const noOperator = structuredClone(fixed);
  delete noOperator.if.allOf[1].count.where.equals;
  noOperator.if.allOf[1].count.where.exists = false;
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
