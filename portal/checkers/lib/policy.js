// Azure Policy rule analysis shared by checkers (pure, unit-tested).
//
// The policy engine rejects runtime functions (current(), field(),
// resourceGroup(), subscription(), requestContext(), policy(), claims(),
// capability(), policyAssignment()) in two places:
//   - inside a "field" accessor:          { "field": "[concat('tags[', current('x'), ']')]" }
//   - inside the field() function's args: "[field(concat('tags[', current('x'), ']'))]"
// current() IS allowed on the value side of an operator and inside "value"
// expressions, as long as it is not nested in field().

const OPERATORS = ['equals', 'notEquals', 'in', 'notIn', 'like', 'notLike', 'contains', 'notContains', 'containsKey', 'notContainsKey', 'less', 'lessOrEquals', 'greater', 'greaterOrEquals', 'match', 'notMatch', 'matchInsensitively', 'notMatchInsensitively'];
const RUNTIME = /\b(current|field|resourceGroup|subscription|requestContext|policy|claims|capability|policyAssignment)\s*\(/i;

// Arguments of every field( … ) call in an expression string.
export function fieldCallArgs(expr) {
  const out = [];
  const re = /\bfield\s*\(/gi;
  let m;
  while ((m = re.exec(expr))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < expr.length && depth > 0; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') depth--;
    }
    out.push(expr.slice(start, i - 1));
  }
  return out;
}

// Every place the engine would reject: field accessors or field() calls
// containing runtime functions.
export function invalidRuntimeUse(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => invalidRuntimeUse(n, found));
  else if (node && typeof node === 'object') {
    if (typeof node.field === 'string' && node.field.startsWith('[') && RUNTIME.test(node.field)) {
      found.push(`field accessor ${node.field}`);
    }
    for (const v of Object.values(node)) {
      if (typeof v === 'string') {
        for (const args of fieldCallArgs(v)) if (RUNTIME.test(args)) found.push(`field() call with a runtime function: ${v}`);
      } else invalidRuntimeUse(v, found);
    }
  }
  return found;
}

function findCount(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const c = findCount(n);
      if (c) return c;
    }
  } else if (node && typeof node === 'object') {
    if (node.count && typeof node.count === 'object' && node.count.value !== undefined) return node;
    for (const v of Object.values(node)) {
      const c = findCount(v);
      if (c) return c;
    }
  }
  return null;
}

const USES_TAGNAME = /current\s*\(\s*'tagName'\s*\)/i;

// The where clause must test the current tag name against the resource's tags.
// Accepted shapes:
//   { "field": "tags", "notContainsKey": "[current('tagName')]" }   (or containsKey)
//   { "value": "[contains(field('tags'), current('tagName'))]", "equals": false }
export function whereReadsTag(where) {
  if (!where || typeof where !== 'object') return { ok: false, why: 'count.where is missing.' };
  const op = OPERATORS.find((o) => Object.hasOwn(where, o));
  if (!op) return { ok: false, why: 'the where clause has no comparison operator.' };
  if (typeof where.field === 'string' && /^tags$/i.test(where.field)) {
    if ((op === 'containsKey' || op === 'notContainsKey') && USES_TAGNAME.test(String(where[op]))) {
      return { ok: true, why: `field "tags" ${op} ${where[op]}` };
    }
    return { ok: false, why: `field "tags" must be tested with containsKey/notContainsKey against [current('tagName')] (found ${op}).` };
  }
  if (typeof where.value === 'string' && USES_TAGNAME.test(where.value)) {
    return { ok: true, why: `value "${where.value}" ${op} ${JSON.stringify(where[op])}` };
  }
  return { ok: false, why: 'the where clause must compare the resource tags with current(\'tagName\').' };
}

export function analyse(rule) {
  const bad = invalidRuntimeUse(rule);
  const countNode = findCount(rule);
  const where = countNode?.count?.where;
  const reads = whereReadsTag(where);
  const compares = countNode && Object.hasOwn(countNode, 'greater') ? `count greater ${countNode.greater}` : null;
  return { bad, reads, compares, countValue: countNode?.count?.value };
}

// Field accessors that use current() (subset of invalidRuntimeUse).
export function fieldsUsingCurrent(rule) {
  return invalidRuntimeUse(rule).filter((x) => x.startsWith('field accessor'));
}
