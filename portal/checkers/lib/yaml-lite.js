// Minimal YAML reader for machine-generated manifests (helm template output).
// Supports block maps and sequences, plain/quoted scalars, simple flow
// collections and block scalars (| and >). Anchors, tags and multi-line plain
// scalars are intentionally unsupported — checkers fail loudly instead.

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && !(quote === '"' && text[i - 1] === '\\')) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Returns { key, rest } for "key: value" / "key:", or null when not a mapping entry.
export function splitKey(text) {
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0];
    const end = text.indexOf(q, 1);
    if (end < 0 || text[end + 1] !== ':' || (text[end + 2] !== undefined && text[end + 2] !== ' ')) return null;
    return { key: text.slice(1, end), rest: text.slice(end + 2).trim() };
  }
  if (text.startsWith('[') || text.startsWith('{')) return null;
  const m = text.match(/^([^\s:][^:]*?):(\s+(.*))?$/);
  if (!m) return null;
  return { key: m[1].trim(), rest: (m[3] ?? '').trim() };
}

export function parseScalar(raw) {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`unterminated string: ${text}`);
    return JSON.parse(text);
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new Error(`unterminated string: ${text}`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error(`unsupported multi-line flow sequence: ${text}`);
    return splitTopLevel(text.slice(1, -1), ',').map(parseScalar);
  }
  if (text.startsWith('{')) {
    if (!text.endsWith('}')) throw new Error(`unsupported multi-line flow mapping: ${text}`);
    const obj = {};
    for (const part of splitTopLevel(text.slice(1, -1), ',')) {
      const kv = splitKey(part);
      if (!kv) throw new Error(`invalid flow mapping entry: ${part}`);
      obj[kv.key] = parseScalar(kv.rest);
    }
    return obj;
  }
  if (text === 'true' || text === 'True') return true;
  if (text === 'false' || text === 'False') return false;
  if (/^[-+]?\d+$/.test(text)) return Number(text);
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  if (/^[&*!]/.test(text)) throw new Error(`anchors/aliases/tags are not supported: ${text}`);
  return text;
}

class Parser {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }

  peek() {
    while (this.i < this.lines.length) {
      const t = this.lines[this.i].trim();
      if (t === '' || t.startsWith('#')) this.i++;
      else break;
    }
    if (this.i >= this.lines.length) return null;
    const line = this.lines[this.i];
    if (line.includes('\t') && /^\s*\t/.test(line)) throw new Error(`tabs are not allowed for indentation (line ${this.i + 1})`);
    return { indent: indentOf(line), text: stripComment(line.trim()) };
  }

  static isSeqItem(text) {
    return text === '-' || text.startsWith('- ');
  }

  node(minIndent) {
    const p = this.peek();
    if (!p || p.indent < minIndent) return null;
    return Parser.isSeqItem(p.text) ? this.seq(p.indent) : this.map(p.indent);
  }

  seq(indent) {
    const arr = [];
    for (;;) {
      const p = this.peek();
      if (!p || p.indent !== indent || !Parser.isSeqItem(p.text)) break;
      const rest = p.text === '-' ? '' : p.text.slice(2).trimStart();
      if (rest === '') {
        this.i++;
        arr.push(this.node(indent + 1));
      } else if (splitKey(rest) && !/^[|>]/.test(rest)) {
        // "- key: value": the item is a mapping that starts on this line.
        const col = indent + (p.text.length - rest.length);
        this.lines[this.i] = ' '.repeat(col) + rest;
        arr.push(this.map(col));
      } else if (Parser.isSeqItem(rest)) {
        const col = indent + (p.text.length - rest.length);
        this.lines[this.i] = ' '.repeat(col) + rest;
        arr.push(this.seq(col));
      } else {
        this.i++;
        arr.push(this.value(rest, indent));
      }
    }
    return arr;
  }

  map(indent) {
    const obj = {};
    for (;;) {
      const p = this.peek();
      if (!p || p.indent !== indent || Parser.isSeqItem(p.text)) break;
      const kv = splitKey(p.text);
      if (!kv) throw new Error(`expected "key: value" at line ${this.i + 1}: ${p.text}`);
      this.i++;
      if (kv.rest === '') {
        const n = this.peek();
        if (n && n.indent > indent) obj[kv.key] = this.node(n.indent);
        else if (n && n.indent === indent && Parser.isSeqItem(n.text)) obj[kv.key] = this.seq(indent);
        else obj[kv.key] = null;
      } else {
        obj[kv.key] = this.value(kv.rest, indent);
      }
    }
    return obj;
  }

  value(rest, indent) {
    if (/^[|>][+-]?\d*$/.test(rest)) return this.blockScalar(rest, indent);
    return parseScalar(rest);
  }

  blockScalar(header, indent) {
    const out = [];
    let blockIndent = null;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.trim() === '') {
        out.push('');
        this.i++;
        continue;
      }
      const ind = indentOf(line);
      if (ind <= indent || (blockIndent !== null && ind < blockIndent)) break;
      blockIndent ??= ind;
      out.push(line.slice(blockIndent));
      this.i++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    const body = header.startsWith('>') ? out.join(' ') : out.join('\n');
    return header.includes('-') ? body : `${body}\n`;
  }
}

export function parseDocument(text) {
  const lines = text.split(/\r?\n/);
  const parser = new Parser(lines);
  const first = parser.peek();
  if (!first) return null;
  const value = Parser.isSeqItem(first.text) ? parser.seq(first.indent) : parser.map(first.indent);
  const leftover = parser.peek();
  if (leftover) throw new Error(`unexpected content at line ${parser.i + 1}: ${leftover.text}`);
  return value;
}

export function parseAllDocuments(text) {
  const docs = [];
  let current = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^---(\s.*)?$/.test(line)) {
      docs.push(current.join('\n'));
      current = [];
    } else current.push(line);
  }
  docs.push(current.join('\n'));
  return docs.map(parseDocument).filter((d) => d !== null);
}
