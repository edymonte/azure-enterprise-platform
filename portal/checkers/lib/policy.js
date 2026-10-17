// Azure Policy rule analysis shared by checkers (pure, unit-tested).

const OPERATORS = ['equals', 'notEquals', 'in', 'notIn', 'like', 'notLike', 'contains', 'notContains', 'less', 'lessOrEquals', 'greater', 'greaterOrEquals', 'match', 'notMatch'];

// Every `field` condition whose accessor is an expression using current().
export function fieldsUsingCurrent(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => fieldsUsingCurrent(n, found));
  else if (node && typeof node === 'object') {
    if (typeof node.field === 'string' && /current\s*\(/i.test(node.field)) found.push(node.field);
    Object.values(node).forEach((v) => fieldsUsingCurrent(v, found));
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

// The where-clause reads the tag through the field() function inside a value expression.
export function whereReadsTag(where) {
  if (!where || typeof where.value !== 'string') return { ok: false, why: 'count.where has no "value" condition.' };
  const expr = where.value;
  if (!/field\s*\(/i.test(expr) || !/current\s*\(\s*'tagName'\s*\)/i.test(expr)) {
    return { ok: false, why: `value "${expr}" must read the tag with field(...) and current('tagName').` };
  }
  const op = OPERATORS.find((o) => Object.hasOwn(where, o));
  if (!op) return { ok: false, why: 'the value condition has no comparison operator (exists only works with field).' };
  return { ok: true, why: `value "${expr}" ${op} ${JSON.stringify(where[op])}` };
}

export function analyse(rule) {
  const bad = fieldsUsingCurrent(rule);
  const countNode = findCount(rule);
  const where = countNode?.count?.where;
  const reads = whereReadsTag(where);
  const compares = countNode && Object.hasOwn(countNode, 'greater') ? `count greater ${countNode.greater}` : null;
  return { bad, reads, compares, countValue: countNode?.count?.value };
}
