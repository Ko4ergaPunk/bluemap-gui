const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

function tokenize(source) {
  const tokens = [];
  let i = 0;
  const text = String(source || '');

  while (i < text.length) {
    const char = text[i];

    if (char === '\n') {
      tokens.push({ type: 'newline' });
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\uFEFF') {
      i += 1;
      continue;
    }
    if (char === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (char === '"') {
      if (text.startsWith('"""', i)) {
        const end = text.indexOf('"""', i + 3);
        const value = end === -1 ? text.slice(i + 3) : text.slice(i + 3, end);
        tokens.push({ type: 'string', value });
        i = end === -1 ? text.length : end + 3;
        continue;
      }
      let j = i + 1;
      let value = '';
      while (j < text.length) {
        const c = text[j];
        if (c === '"') break;
        if (c === '\\') {
          const next = text[j + 1];
          if (next === 'u') {
            const hex = text.slice(j + 2, j + 6);
            value += String.fromCharCode(parseInt(hex, 16) || 0);
            j += 6;
            continue;
          }
          value += ESCAPES[next] ?? next;
          j += 2;
          continue;
        }
        value += c;
        j += 1;
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    if ('{}[]:,='.includes(char)) {
      tokens.push({ type: char });
      i += 1;
      continue;
    }

    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (/\s/.test(c) || '{}[]:,='.includes(c) || c === '#') break;
      if (c === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) break;
      j += 1;
    }
    if (j === i) {
      i += 1;
      continue;
    }
    tokens.push({ type: 'word', value: text.slice(i, j) });
    i = j;
  }

  return tokens;
}

function parsePrimitive(token) {
  if (!token) return null;
  if (token.type === 'string') return token.value;
  if (token.type === 'word') {
    const raw = token.value;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }
  return null;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  next() {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  skip() {
    while (this.peek()?.type === 'newline') this.pos += 1;
  }

  skipSeparators() {
    while (this.peek()?.type === 'newline' || this.peek()?.type === ',') this.pos += 1;
  }

  parseRoot() {
    return this.parseObject(false);
  }

  parseValue() {
    this.skip();
    const token = this.peek();
    if (!token) return null;
    if (token.type === '{') {
      this.next();
      return this.parseObject(true);
    }
    if (token.type === '[') {
      this.next();
      return this.parseArray();
    }
    if (token.type === 'string' || token.type === 'word') {
      this.next();
      return parsePrimitive(token);
    }
    this.next();
    return null;
  }

  parseObject(braced) {
    const result = {};
    while (this.pos < this.tokens.length) {
      this.skipSeparators();
      const token = this.peek();
      if (!token) break;
      if (token.type === '}') {
        this.next();
        if (braced) return result;
        continue;
      }
      if (token.type !== 'word' && token.type !== 'string') {
        this.next();
        continue;
      }

      const key = this.next().value;
      this.skip();
      let separator = this.peek();
      if (separator?.type === ':' || separator?.type === '=') {
        this.next();
        this.skip();
      } else if (key === 'include' || key === 'includes') {
        this.skipSeparators();
        continue;
      } else if (separator?.type === '{' || separator?.type === '[') {
        result[key] = this.parseValue();
        continue;
      } else {
        continue;
      }

      if (key === 'include' || key === 'includes') {
        this.skipSeparators();
        continue;
      }

      const value = this.parseValue();
      result[key] = value;
    }
    return result;
  }

  parseArray() {
    const result = [];
    while (this.pos < this.tokens.length) {
      this.skipSeparators();
      const token = this.peek();
      if (!token) break;
      if (token.type === ']') {
        this.next();
        break;
      }
      result.push(this.parseValue());
    }
    return result;
  }
}

export function parseHocon(source) {
  const parser = new Parser(tokenize(source));
  return parser.parseRoot();
}

export function isHoconLike(source) {
  const text = String(source || '').trimStart();
  if (!text) return false;
  if (text.startsWith('{')) return false;
  return /\b(marker-sets|markerSets|start-pos|enable-flat-view|world|dimension)\b/.test(text);
}
