/* RAR runtime — LisPy interpreter + Python-to-LisPy transpiler.
 *
 * Vendored verbatim from the RAR vbrainstem (kody-w.github.io/RAR/virtual-brainstem-summon.html
 * lines 400-2298, sections 1+2). Used as a fast-path for executing single-file
 * *_agent.py cartridges in the browser without booting Pyodide.
 *
 * Exports on window.RAR_RUNTIME:
 *   - unrappTranspile(pySource) → { lispy, jsFunctions, dataObjects, manifest, operations, errors, elapsed }
 *   - lispParse(source) → AST
 *   - lispEval(expr, env) → value
 *   - createGlobalEnv() → fresh LisPy env
 *   - setOutputHook(fn) → set brainstem output sink
 */
(function (root) {
// SECTION 1: lispy.js — Complete Lisp Interpreter in JavaScript
// ═══════════════════════════════════════════════════════════════════════

// Output callback — UI hooks into this
let brainstemOutput = (text) => {};

// --- Types ---
class LispSymbol extends String {
  constructor(s) { super(s); }
  get isSymbol() { return true; }
}

const _symbolCache = {};
function Sym(name) {
  if (!_symbolCache[name]) _symbolCache[name] = new LispSymbol(name);
  return _symbolCache[name];
}

const NIL = Object.freeze({
  toString() { return '()'; },
  isNil: true,
  length: 0,
  [Symbol.iterator]() { return { next() { return { done: true }; } }; }
});

class LispPair {
  constructor(car, cdr) { this.car = car; this.cdr = cdr; }
  toString() { return '(' + pairRepr(this) + ')'; }
  get length() {
    let n = 0, cur = this;
    while (cur instanceof LispPair) { n++; cur = cur.cdr; }
    return n;
  }
  [Symbol.iterator]() {
    let cur = this;
    return {
      next() {
        if (cur instanceof LispPair) {
          const val = cur.car; cur = cur.cdr; return { value: val, done: false };
        }
        if (cur !== NIL && cur !== undefined && cur !== null) {
          const val = cur; cur = NIL; return { value: val, done: false };
        }
        return { done: true };
      }
    };
  }
}

class LispLambda {
  constructor(params, body, env, name = 'lambda') {
    this.params = params; this.body = body; this.env = env; this.name = name;
  }
  toString() { return `#<procedure ${this.name}>`; }
}

class LispMacro {
  constructor(params, body, env, name = 'macro') {
    this.params = params; this.body = body; this.env = env; this.name = name;
  }
  toString() { return `#<macro ${this.name}>`; }
}

class LispEnv {
  constructor(params, args, parent) {
    this.bindings = new Map();
    this.parent = parent || null;
    if (params && args) {
      if (typeof params === 'string' || params instanceof LispSymbol) {
        // variadic
        this.bindings.set(String(params), Array.from(args));
      } else if (Array.isArray(params)) {
        for (let i = 0; i < params.length; i++) {
          this.bindings.set(String(params[i]), args[i]);
        }
      }
    }
  }
  get(name) {
    const s = String(name);
    if (this.bindings.has(s)) return this.bindings.get(s);
    if (this.parent) return this.parent.get(s);
    throw new LispError(`unbound variable: ${s}`);
  }
  set(name, val) {
    const s = String(name);
    if (this.bindings.has(s)) { this.bindings.set(s, val); return val; }
    if (this.parent) return this.parent.set(s, val);
    throw new LispError(`unbound variable: ${s}`);
  }
  define(name, val) { this.bindings.set(String(name), val); return val; }
}

class LispError extends Error {
  constructor(msg) { super(msg); this.name = 'LispError'; }
}

// --- Helpers ---
function isNil(x) { return x === NIL || x === null || x === undefined; }
function isTruthy(x) { return x !== false && !isNil(x); }

function pairRepr(p) {
  const parts = [];
  let cur = p;
  while (cur instanceof LispPair) { parts.push(valueRepr(cur.car)); cur = cur.cdr; }
  if (!isNil(cur)) { parts.push('.'); parts.push(valueRepr(cur)); }
  return parts.join(' ');
}

function valueRepr(val) {
  if (val === true) return '#t';
  if (val === false) return '#f';
  if (isNil(val)) return '()';
  if (val instanceof LispSymbol) return String(val);
  if (typeof val === 'string') return '"' + val.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n') + '"';
  if (Array.isArray(val)) return '(' + val.map(valueRepr).join(' ') + ')';
  if (val instanceof LispPair) return val.toString();
  if (val instanceof LispLambda || val instanceof LispMacro) return val.toString();
  if (typeof val === 'object' && val !== null && !(val instanceof LispEnv)) {
    const items = Object.entries(val).map(([k,v]) => `(${valueRepr(k)} . ${valueRepr(v)})`).join(' ');
    return `(dict ${items})`;
  }
  return String(val);
}

function displayValue(val) {
  if (typeof val === 'string' && !(val instanceof LispSymbol)) return val;
  return valueRepr(val);
}

// --- Tokenizer ---
function lispTokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === ';') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if ('()[]\'`,'.includes(c)) { tokens.push(c); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\' && j + 1 < source.length) { j += 2; continue; }
        if (source[j] === '"') break;
        j++;
      }
      tokens.push(source.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < source.length && !' \t\n\r()[]";,'.includes(source[j])) j++;
    tokens.push(source.slice(i, j));
    i = j;
  }
  return tokens;
}

// --- Parser ---
function lispParse(source) {
  const tokens = lispTokenize(source);
  const exprs = [];
  let pos = 0;

  function readExpr() {
    if (pos >= tokens.length) throw new LispError('unexpected end of input');
    const tok = tokens[pos];
    if (tok === "'") { pos++; return [Sym('quote'), readExpr()]; }
    if (tok === '`') { pos++; return [Sym('quasiquote'), readExpr()]; }
    if (tok === ',') { pos++; return [Sym('unquote'), readExpr()]; }
    if (tok === '(' || tok === '[') {
      pos++;
      const close = tok === '(' ? ')' : ']';
      const lst = [];
      while (pos < tokens.length && tokens[pos] !== close) lst.push(readExpr());
      if (pos >= tokens.length) throw new LispError(`missing closing '${close}'`);
      pos++;
      return lst;
    }
    if (tok === ')' || tok === ']') throw new LispError(`unexpected '${tok}'`);
    pos++;
    return parseAtom(tok);
  }

  while (pos < tokens.length) exprs.push(readExpr());
  return exprs;
}

function parseAtom(tok) {
  if (tok === '#t') return true;
  if (tok === '#f') return false;
  if (tok === 'nil') return NIL;
  const n = Number(tok);
  if (!isNaN(n) && tok !== '') return n;
  if (tok.startsWith('"') && tok.endsWith('"')) {
    let s = tok.slice(1, -1);
    s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return s;
  }
  return Sym(tok);
}

// --- Evaluator ---
function lispEval(expr, env) {
  // Self-evaluating
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (isNil(expr)) return NIL;
  if (typeof expr === 'string' && !(expr instanceof LispSymbol)) return expr;
  if (expr instanceof LispPair) return expr;
  if (typeof expr === 'object' && !Array.isArray(expr) && expr !== null && !(expr instanceof LispSymbol)) return expr;

  // Symbol
  if (expr instanceof LispSymbol) return env.get(expr);

  // Not a list
  if (!Array.isArray(expr)) return expr;

  // Empty list
  if (expr.length === 0) return NIL;

  const head = expr[0];

  // Special forms
  if (head instanceof LispSymbol) {
    const h = String(head);

    if (h === 'quote') return expr[1];

    if (h === 'if') {
      const test = lispEval(expr[1], env);
      if (isTruthy(test)) return lispEval(expr[2], env);
      return expr.length > 3 ? lispEval(expr[3], env) : NIL;
    }

    if (h === 'cond') {
      for (let i = 1; i < expr.length; i++) {
        const clause = expr[i];
        if (clause[0] instanceof LispSymbol && String(clause[0]) === 'else') return evalBody(clause.slice(1), env);
        if (isTruthy(lispEval(clause[0], env))) return evalBody(clause.slice(1), env);
      }
      return NIL;
    }

    if (h === 'define') {
      const target = expr[1];
      if (Array.isArray(target)) {
        const name = String(target[0]);
        const params = target.slice(1).map(String);
        const fn = new LispLambda(params, expr.slice(2), env, name);
        env.define(name, fn);
        return fn;
      }
      const val = lispEval(expr[2], env);
      env.define(String(target), val);
      return val;
    }

    if (h === 'set!') {
      const val = lispEval(expr[2], env);
      env.set(String(expr[1]), val);
      return val;
    }

    if (h === 'lambda') {
      const params = expr[1];
      if (params instanceof LispSymbol || typeof params === 'string') {
        return new LispLambda(String(params), expr.slice(2), env);
      }
      return new LispLambda(params.map(String), expr.slice(2), env);
    }

    if (h === 'let') {
      const bindings = expr[1];
      const newEnv = new LispEnv(null, null, env);
      for (const b of bindings) newEnv.define(String(b[0]), lispEval(b[1], env));
      return evalBody(expr.slice(2), newEnv);
    }

    if (h === 'let*') {
      const bindings = expr[1];
      const newEnv = new LispEnv(null, null, env);
      for (const b of bindings) newEnv.define(String(b[0]), lispEval(b[1], newEnv));
      return evalBody(expr.slice(2), newEnv);
    }

    if (h === 'begin') return evalBody(expr.slice(1), env);

    if (h === 'and') {
      let result = true;
      for (let i = 1; i < expr.length; i++) {
        result = lispEval(expr[i], env);
        if (!isTruthy(result)) return result;
      }
      return result;
    }

    if (h === 'or') {
      for (let i = 1; i < expr.length; i++) {
        const result = lispEval(expr[i], env);
        if (isTruthy(result)) return result;
      }
      return false;
    }

    if (h === 'define-macro') {
      const target = expr[1];
      if (Array.isArray(target)) {
        const name = String(target[0]);
        const params = target.slice(1).map(String);
        const mac = new LispMacro(params, expr.slice(2), env, name);
        env.define(name, mac);
        return mac;
      }
      throw new LispError('invalid define-macro syntax');
    }

    if (h === 'do') return NIL;
  }

  // Function application
  const fn = lispEval(head, env);

  // Macro expansion
  if (fn instanceof LispMacro) {
    const macArgs = expr.slice(1);
    const macEnv = new LispEnv(fn.params, macArgs, fn.env);
    const expanded = evalBody(fn.body, macEnv);
    return lispEval(expanded, env);
  }

  // Eval arguments
  const args = expr.slice(1).map(a => lispEval(a, env));

  if (typeof fn === 'function') {
    try { return fn(...args); }
    catch(e) { throw new LispError(`call error: ${e.message}`); }
  }

  if (fn instanceof LispLambda) {
    const callEnv = new LispEnv(fn.params, args, fn.env);
    return evalBody(fn.body, callEnv);
  }

  throw new LispError(`not callable: ${valueRepr(fn)}`);
}

function evalBody(body, env) {
  let result = NIL;
  for (const expr of body) result = lispEval(expr, env);
  return result;
}

// --- Call helper ---
function callFn(fn, args) {
  if (typeof fn === 'function') return fn(...args);
  if (fn instanceof LispLambda) {
    const callEnv = new LispEnv(fn.params, args, fn.env);
    return evalBody(fn.body, callEnv);
  }
  throw new LispError(`not callable: ${valueRepr(fn)}`);
}

// --- Global Environment ---
function createGlobalEnv() {
  const env = new LispEnv();

  // Arithmetic
  env.define('+', (...args) => args.reduce((a,b) => a+b, 0));
  env.define('-', (a, ...rest) => rest.length ? a - rest.reduce((x,y)=>x+y,0) : -a);
  env.define('*', (...args) => args.reduce((a,b) => a*b, 1));
  env.define('/', (a,b) => { if(b===0) throw new LispError('division by zero'); return a/b; });
  env.define('%', (a,b) => a % b);
  env.define('abs', Math.abs);
  env.define('round', (n, d) => {
    if (d === undefined || d === 0) return Math.round(n);
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  });
  env.define('floor', Math.floor);
  env.define('ceil', Math.ceil);
  env.define('min', (...a) => Math.min(...a));
  env.define('max', (...a) => Math.max(...a));
  env.define('expt', Math.pow);
  env.define('sqrt', Math.sqrt);
  env.define('modulo', (a,b) => a%b);

  // Comparison
  env.define('=', (a,b) => a === b || (typeof a === 'number' && typeof b === 'number' && a == b));
  env.define('equal?', (a,b) => JSON.stringify(a) === JSON.stringify(b));
  env.define('<', (a,b) => a < b);
  env.define('>', (a,b) => a > b);
  env.define('<=', (a,b) => a <= b);
  env.define('>=', (a,b) => a >= b);
  env.define('!=', (a,b) => a !== b);

  // Logic
  env.define('not', x => !isTruthy(x));

  // Predicates
  env.define('null?', x => isNil(x) || (Array.isArray(x) && x.length === 0));
  env.define('pair?', x => (x instanceof LispPair) || (Array.isArray(x) && !(x instanceof LispSymbol)));
  env.define('list?', x => Array.isArray(x));
  env.define('number?', x => typeof x === 'number');
  env.define('string?', x => typeof x === 'string' && !(x instanceof LispSymbol));
  env.define('symbol?', x => x instanceof LispSymbol);
  env.define('boolean?', x => typeof x === 'boolean');
  env.define('procedure?', x => typeof x === 'function' || x instanceof LispLambda);
  env.define('dict?', x => typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof LispPair) && !isNil(x) && !(x instanceof LispEnv));
  env.define('zero?', x => x === 0);
  env.define('integer?', x => typeof x === 'number' && Number.isInteger(x));

  // Lists
  env.define('cons', (a,b) => new LispPair(a,b));
  env.define('car', x => {
    if (x instanceof LispPair) return x.car;
    if (Array.isArray(x) && x.length > 0) return x[0];
    throw new LispError('car: not a pair');
  });
  env.define('cdr', x => {
    if (x instanceof LispPair) return x.cdr;
    if (Array.isArray(x)) return x.length > 1 ? x.slice(1) : NIL;
    throw new LispError('cdr: not a pair');
  });
  env.define('list', (...args) => [...args]);
  env.define('length', x => {
    if (isNil(x)) return 0;
    if (typeof x === 'string') return x.length;
    if (Array.isArray(x)) return x.length;
    if (typeof x === 'object') return Object.keys(x).length;
    return 0;
  });
  env.define('append', (...lists) => {
    const result = [];
    for (const lst of lists) {
      if (Array.isArray(lst)) result.push(...lst);
      else if (!isNil(lst)) result.push(lst);
    }
    return result;
  });
  env.define('reverse', x => Array.isArray(x) ? [...x].reverse() : x);
  env.define('nth', (lst, n) => Array.isArray(lst) ? lst[n] : NIL);
  env.define('range', (...args) => {
    let start=0, end=0, step=1;
    if (args.length===1) end=args[0];
    else if (args.length===2) { start=args[0]; end=args[1]; }
    else { start=args[0]; end=args[1]; step=args[2]; }
    const r = [];
    if (step > 0) for (let i=start; i<end; i+=step) r.push(i);
    else for (let i=start; i>end; i+=step) r.push(i);
    return r;
  });
  env.define('flatten', function flatten(lst) {
    if (!Array.isArray(lst)) return [lst];
    const r = [];
    for (const item of lst) {
      if (Array.isArray(item)) r.push(...flatten(item));
      else r.push(item);
    }
    return r;
  });
  env.define('sort', (lst, keyFn, reverse) => {
    if (!Array.isArray(lst)) return lst;
    const sorted = [...lst];
    if (keyFn) {
      sorted.sort((a,b) => {
        const ka = callFn(keyFn, [a]);
        const kb = callFn(keyFn, [b]);
        if (ka < kb) return -1;
        if (ka > kb) return 1;
        return 0;
      });
    } else {
      sorted.sort((a,b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      });
    }
    if (reverse === true) sorted.reverse();
    return sorted;
  });
  env.define('first', x => Array.isArray(x) && x.length > 0 ? x[0] : NIL);
  env.define('last', x => Array.isArray(x) && x.length > 0 ? x[x.length-1] : NIL);
  env.define('empty?', x => isNil(x) || (Array.isArray(x) && x.length===0) || (typeof x==='string' && x.length===0));
  env.define('take', (lst,n) => Array.isArray(lst) ? lst.slice(0,n) : NIL);
  env.define('drop', (lst,n) => Array.isArray(lst) ? lst.slice(n) : NIL);

  // Higher-order
  env.define('map', (fn, ...lists) => {
    if (lists.length === 1) {
      const lst = lists[0];
      if (!Array.isArray(lst)) return NIL;
      return lst.map(x => callFn(fn, [x]));
    }
    const minLen = Math.min(...lists.map(l => Array.isArray(l) ? l.length : 0));
    const result = [];
    for (let i = 0; i < minLen; i++) result.push(callFn(fn, lists.map(l => l[i])));
    return result;
  });
  env.define('filter', (fn, lst) => {
    if (!Array.isArray(lst)) return NIL;
    return lst.filter(x => isTruthy(callFn(fn, [x])));
  });
  env.define('reduce', (fn, init, lst) => {
    // Support both (reduce fn init lst) and (reduce fn lst)
    if (lst === undefined) { lst = init; init = undefined; }
    if (!Array.isArray(lst)) throw new LispError('reduce requires a list');
    if (init !== undefined) return lst.reduce((acc, x) => callFn(fn, [acc, x]), init);
    return lst.reduce((acc, x) => callFn(fn, [acc, x]));
  });
  env.define('for-each', (fn, lst) => {
    if (Array.isArray(lst)) lst.forEach(x => callFn(fn, [x]));
    return NIL;
  });
  env.define('apply', (fn, args) => callFn(fn, Array.isArray(args) ? args : [args]));

  // Strings
  env.define('string-append', (...args) => args.map(a => {
    if (typeof a === 'number') return String(a);
    if (isNil(a)) return '';
    return String(a);
  }).join(''));
  env.define('string-length', s => String(s).length);
  env.define('substring', (s, start, end) => end !== undefined ? String(s).slice(start, end) : String(s).slice(start));
  env.define('string-split', (s, delim) => String(s).split(delim !== undefined ? delim : ' '));
  env.define('string-join', (lst, sep) => {
    if (!Array.isArray(lst)) return '';
    return lst.map(x => {
      if (typeof x === 'number') return String(x);
      if (isNil(x)) return '';
      return String(x);
    }).join(sep !== undefined ? sep : ' ');
  });
  env.define('string-upcase', s => String(s).toUpperCase());
  env.define('string-downcase', s => String(s).toLowerCase());
  env.define('string-titlecase', s => String(s).replace(/\b\w/g, c => c.toUpperCase()));
  env.define('string-replace', (s, old, nw) => String(s).split(old).join(nw));
  env.define('string-contains?', (s, sub) => String(s).includes(sub));
  env.define('string-ref', (s, i) => String(s)[i]);
  env.define('string-trim', s => String(s).trim());
  env.define('string-starts-with?', (s, pre) => String(s).startsWith(pre));
  env.define('string-ends-with?', (s, suf) => String(s).endsWith(suf));

  // Conversion
  env.define('number->string', n => String(n));
  env.define('string->number', s => { const n = Number(s); return isNaN(n) ? 0 : n; });
  env.define('->string', x => typeof x === 'string' ? x : String(x));
  env.define('->number', x => typeof x === 'number' ? x : Number(x));

  // Number formatting
  env.define('number-format', (n, fmt) => {
    if (fmt === ',' || fmt === ':,') return Number(n).toLocaleString('en-US');
    if (fmt === ',.0f' || fmt === ':,.0f') return Math.round(Number(n)).toLocaleString('en-US');
    const m = String(fmt).match(/[,:]?\.(\d+)f/);
    if (m) {
      const digits = parseInt(m[1]);
      const hasSep = fmt.includes(',');
      if (hasSep) return Number(n).toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits});
      return Number(n).toFixed(digits);
    }
    return String(n);
  });

  // Dicts
  env.define('make-dict', (...pairs) => {
    const d = {};
    for (let i = 0; i < pairs.length; i += 2) d[String(pairs[i])] = pairs[i+1];
    return d;
  });
  env.define('dict-get', (d, k, dflt) => {
    if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
      const v = d[String(k)];
      if (v !== undefined) return v;
      return dflt !== undefined ? dflt : NIL;
    }
    if (Array.isArray(d) && typeof k === 'number') {
      return k >= 0 && k < d.length ? d[k] : (dflt !== undefined ? dflt : NIL);
    }
    return dflt !== undefined ? dflt : NIL;
  });
  env.define('dict-set', (d, k, v) => {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return d;
    return {...d, [String(k)]: v};
  });
  env.define('dict-keys', d => {
    if (typeof d === 'object' && d !== null && !Array.isArray(d)) return Object.keys(d);
    return [];
  });
  env.define('dict-values', d => {
    if (typeof d === 'object' && d !== null && !Array.isArray(d)) return Object.values(d);
    return [];
  });
  env.define('dict-items', d => {
    if (typeof d === 'object' && d !== null && !Array.isArray(d))
      return Object.entries(d).map(([k,v]) => [k, v]);
    return [];
  });
  env.define('dict-has?', (d, k) => typeof d === 'object' && d !== null && String(k) in d);
  env.define('dict-merge', (...dicts) => Object.assign({}, ...dicts.filter(d => typeof d === 'object' && d !== null)));
  env.define('dict-remove', (d, k) => {
    if (typeof d !== 'object' || d === null) return d;
    const r = {...d}; delete r[String(k)]; return r;
  });

  // I/O — all route through brainstemOutput
  env.define('display', (...args) => { brainstemOutput(args.map(displayValue).join('')); return NIL; });
  env.define('log', (...args) => { brainstemOutput(args.map(displayValue).join(' ')); return NIL; });
  env.define('newline', () => { brainstemOutput('\n'); return NIL; });
  env.define('format', (...args) => {
    if (args.length === 0) return '';
    let s = String(args[0]);
    for (let i = 1; i < args.length; i++) s = s.replace('~a', displayValue(args[i]));
    return s;
  });
  env.define('error', msg => { throw new LispError(String(msg)); });
  env.define('print', x => { brainstemOutput(valueRepr(x)); return NIL; });
  env.define('println', x => { brainstemOutput(displayValue(x) + '\n'); return NIL; });

  // JSON
  env.define('json->sexp', s => JSON.parse(s));
  env.define('sexp->json', v => JSON.stringify(v, null, 2));

  // Integer division
  env.define('//', (a,b) => { if(b===0) throw new LispError('division by zero'); return Math.trunc(a/b); });

  // Constants
  env.define('#t', true);
  env.define('#f', false);
  env.define('nil', NIL);
  env.define('pi', Math.PI);
  env.define('e', Math.E);

  // Misc
  env.define('int', x => typeof x === 'number' ? Math.trunc(x) : parseInt(x) || 0);
  env.define('float', x => typeof x === 'number' ? x : parseFloat(x) || 0);

  return env;
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: unrapp.js — Python-to-JS Transpiler (Hybrid Approach)
//
// Strategy: Python agent code is converted to JavaScript functions.
// Data dicts become JS objects. Helper functions and class methods become
// JS functions. Everything is injected into the LisPy environment as
// callable builtins. The REPL can interact with all data and functions.
// ═══════════════════════════════════════════════════════════════════════

function unrappTranspile(pythonSource) {
  const errors = [];
  const t0 = performance.now();
  let manifest = null;
  let operations = [];
  let dataObjects = {};
  let jsFunctions = {}; // name -> JS function body string

  try {
    // Stage 1: Extract manifest
    manifest = extractManifest(pythonSource);

    // Stage 2: Extract module-level data dicts as JS objects
    dataObjects = extractDataDicts(pythonSource);

    // Stage 3: Find operations from dispatch/perform method
    operations = extractOperations(pythonSource);

    // Stage 4: Convert all Python functions to JavaScript
    jsFunctions = convertFunctionsToJS(pythonSource, dataObjects);

  } catch(e) {
    errors.push(e.message);
  }

  // Build LisPy perform dispatcher
  let lispy = '';
  if (operations.length > 0) {
    const lines = ['(define (perform kwargs)',
      '  (let* ((op (dict-get kwargs "operation" "' + operations[0] + '")))'];
    lines.push('    (cond');
    for (const op of operations) {
      lines.push(`      ((equal? op "${op}") (op-${op} kwargs))`);
    }
    lines.push('      (else (string-append "Unknown operation: " op))');
    lines.push('    )))');
    lispy = lines.join('\n');
  }

  const elapsed = performance.now() - t0;
  return { lispy, manifest, operations, dataObjects, jsFunctions, errors, elapsed };
}

function extractManifest(src) {
  const match = src.match(/__manifest__\s*=\s*\{/);
  if (!match) return null;
  let block = extractBracketBlock(src, match.index + match[0].length - 1, '{', '}');
  block = pythonDictToJson(block);
  // Handle parenthesized string concatenation: ("str1" "str2") -> "str1str2"
  block = block.replace(/\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g, '"$1"');
  block = block.replace(/"((?:[^"\\]|\\.)*)"\s*\n\s*"((?:[^"\\]|\\.)*)"/g, '"$1$2"');
  try { return JSON.parse(block); } catch(e) {
    const m = {};
    const nameMatch = src.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) m.name = nameMatch[1];
    const descMatch = src.match(/"description"\s*:\s*"([^"]+)"/);
    if (descMatch) m.description = descMatch[1];
    const dispMatch = src.match(/"display_name"\s*:\s*"([^"]+)"/);
    if (dispMatch) m.display_name = dispMatch[1];
    return Object.keys(m).length > 0 ? m : null;
  }
}

function extractOperations(src) {
  const ops = [];
  // Pattern 1: dispatch dict
  const dispatchMatch = src.match(/dispatch\s*=\s*\{([^}]+)\}/);
  if (dispatchMatch) {
    for (const m of dispatchMatch[1].matchAll(/"(\w+)"\s*:/g)) ops.push(m[1]);
  }
  // Pattern 2: if/elif chain
  if (ops.length === 0) {
    for (const m of src.matchAll(/(?:if|elif)\s+op\s*==\s*"(\w+)"/g)) ops.push(m[1]);
  }
  // Pattern 3: enum
  if (ops.length === 0) {
    const enumMatch = src.match(/"enum"\s*:\s*\[([\s\S]*?)\]/);
    if (enumMatch) for (const m of enumMatch[1].matchAll(/"(\w+)"/g)) ops.push(m[1]);
  }
  return ops;
}

// --- Bracket block extractor ---
function extractBracketBlock(src, start, open, close) {
  let depth = 0, i = start;
  while (i < src.length) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) break; }
    else if (src[i] === '"' || src[i] === "'") {
      const q = src[i]; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    }
    else if (open === '{' && src[i] === '[') depth++;
    else if (open === '{' && src[i] === ']') depth--;
    else if (open === '[' && src[i] === '{') depth++;
    else if (open === '[' && src[i] === '}') depth--;
    i++;
  }
  return src.slice(start, i + 1);
}

// --- Python dict/list to JSON ---
function pythonDictToJson(block) {
  let result = '';
  let inStr = false, strChar = '';
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (inStr) {
      if (c === '\\') { result += c + (block[i+1]||''); i++; continue; }
      if (c === strChar) { result += '"'; inStr = false; continue; }
      if (c === '"') { result += '\\"'; continue; }
      result += c;
    } else {
      if (c === "'" || c === '"') { inStr = true; strChar = c; result += '"'; continue; }
      result += c;
    }
  }
  result = result.replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null');
  result = result.replace(/,(\s*[}\]])/g, '$1');
  result = result.replace(/\(([^()]*)\)/g, '[$1]');
  // Strip Python numeric underscores: 2_800_000 -> 2800000
  result = result.replace(/\b(\d[\d_]*\d)\b/g, m => m.replace(/_/g, ''));
  return result;
}

// --- Extract data dicts as JS objects ---
function extractDataDicts(src) {
  const dataObjects = {};
  // Dicts: UPPER_CASE or _UPPER_CASE = { ... }
  for (const match of src.matchAll(/^(_?[A-Z][A-Z_0-9]+)\s*=\s*\{/gm)) {
    if (match[1] === '__manifest__') continue;
    const block = extractBracketBlock(src, match.index + match[0].length - 1, '{', '}');
    try {
      dataObjects[match[1]] = JSON.parse(pythonDictToJson(block));
    } catch(e) {}
  }
  // Arrays: UPPER_CASE or _UPPER_CASE = [ ... ]
  for (const match of src.matchAll(/^(_?[A-Z][A-Z_0-9]+)\s*=\s*\[/gm)) {
    const block = extractBracketBlock(src, match.index + match[0].length - 1, '[', ']');
    try {
      dataObjects[match[1]] = JSON.parse(pythonDictToJson(block));
    } catch(e) {}
  }
  return dataObjects;
}

// --- Convert Python functions to JavaScript ---
function convertFunctionsToJS(src, dataObjects) {
  const fns = {};
  const lines = src.split('\n');

  // Pass 1: Extract module-level helper functions (no indent or leading spaces < 4)
  let i = 0;
  let inClass = false;
  let classIndent = -1;

  // First, find class boundary
  let classStart = -1, classEnd = lines.length;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].match(/^class\s+\w+/)) {
      classStart = k;
      classIndent = getIndent(lines[k]);
      break;
    }
  }

  // Extract module-level functions (before or outside class)
  i = 0;
  while (i < lines.length) {
    const defMatch = lines[i].match(/^def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*)?:\s*$/);
    if (defMatch) {
      const name = defMatch[1];
      const rawParams = defMatch[2];
      const params = rawParams.split(',').map(p => p.trim()).filter(p => p && p !== 'self' && !p.startsWith('*'));
      i++;
      const bodyIndent = 4;
      const bodyStart = i;
      while (i < lines.length) {
        if (lines[i].trim() === '' || lines[i].trim().startsWith('#')) { i++; continue; }
        if (lines[i].match(/\S/) && getIndent(lines[i]) < bodyIndent) break;
        i++;
      }
      const bodyLines = lines.slice(bodyStart, i);
      const jsBody = convertPythonBodyToJS(bodyLines, bodyIndent, dataObjects);
      fns[name] = { params, body: jsBody, isHelper: true };
      continue;
    }
    if (lines[i].match(/^class\s+\w+/)) break; // stop at class
    i++;
  }

  // Pass 2: Extract class methods (inside class)
  if (classStart >= 0) {
    const methodIndent = classIndent + 4;
    i = classStart + 1;
    while (i < lines.length) {
      const mRe = new RegExp(`^\\s{${methodIndent}}def\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*(?:->.*)?:\\s*$`);
      const defMatch = lines[i].match(mRe);
      if (defMatch) {
        const name = defMatch[1];
        const rawParams = defMatch[2];

        if (['__init__', 'perform'].includes(name)) { i++; continue; }

        // Filter self, convert **kwargs to kwargs
        const params = rawParams.split(',').map(p => p.trim().replace(/^\*\*/, '')).filter(p => p && p !== 'self');
        i++;
        const bodyIndent = methodIndent + 4;
        const bodyStart = i;
        while (i < lines.length) {
          if (lines[i].trim() === '' || lines[i].trim().startsWith('#')) { i++; continue; }
          if (lines[i].match(/\S/) && getIndent(lines[i]) < bodyIndent) break;
          i++;
        }
        const bodyLines = lines.slice(bodyStart, i);
        const jsBody = convertPythonBodyToJS(bodyLines, bodyIndent, dataObjects);
        const opName = name.startsWith('_') ? name.slice(1) : name;
        fns['method_' + opName] = { params: params.length > 0 ? params : ['kwargs'], body: jsBody, isMethod: true };
        continue;
      }
      i++;
    }
  }

  return fns;
}

function getIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function joinLogicalLines(bodyLines) {
  // Join lines that are inside brackets (Python's implicit line continuation)
  const logical = [];
  let current = '';
  let depth = 0;

  for (const raw of bodyLines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      if (depth === 0) { logical.push(raw); continue; }
      continue;
    }
    if (depth === 0) {
      if (current) logical.push(mergeImplicitStringConcat(current));
      current = raw;
    } else {
      current += ' ' + raw.trim();
    }
    // Count brackets (skip inside strings)
    let inStr = false, sc = '';
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if (inStr) { if (c === '\\') { k++; continue; } if (c === sc) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
  }
  if (current) logical.push(mergeImplicitStringConcat(current));
  return logical;
}

function mergeImplicitStringConcat(line) {
  // Python implicit string concatenation: "abc" "def" -> "abcdef", f"abc" f"def" -> f"abcdef"
  // Handle: f"..." f"..." and "..." "..." patterns
  line = line.replace(/"\s+f"/g, '');  // f"part1" f"part2" -> f"part1part2"
  line = line.replace(/"\s+"/g, '');   // "part1" "part2" -> "part1part2"
  return line;
}

function convertPythonBodyToJS(bodyLines, baseIndent, dataObjects) {
  // First, join multi-line expressions
  bodyLines = joinLogicalLines(bodyLines);

  const jsLines = [];
  const dataNames = Object.keys(dataObjects || {});

  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    // Skip docstrings (triple-quoted strings as statements)
    if (raw.trim().startsWith('"""') || raw.trim().startsWith("'''")) {
      const q = raw.trim().slice(0, 3);
      if (raw.trim().endsWith(q) && raw.trim().length > 6) continue; // single-line docstring
      // Multi-line: skip until closing triple-quote
      i++;
      while (i < bodyLines.length && !bodyLines[i].includes(q)) i++;
      continue;
    }
    const indent = getIndent(raw);
    const line = raw.trim();
    const relIndent = Math.max(0, indent - baseIndent);
    const pad = '  '.repeat(relIndent / 4 + 1);

    // for k, v in DICT.items():
    const forItemsMatch = line.match(/^for\s+(\w+),\s*(\w+)\s+in\s+(\w+)\.items\(\)\s*:$/);
    if (forItemsMatch) {
      const [, k, v, dict] = forItemsMatch;
      const dictRef = dataNames.includes(dict) ? `DATA.${dict}` : dict;
      jsLines.push(`${pad}for (const [${k}, ${v}] of Object.entries(${dictRef})) {`);
      // Collect body
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      const innerJS = convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects);
      jsLines.push(innerJS);
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // for x in DICT.values():
    const forValuesMatch = line.match(/^for\s+(\w+)\s+in\s+(\w+)\.values\(\)\s*:$/);
    if (forValuesMatch) {
      const [, v, dict] = forValuesMatch;
      const dictRef = dataNames.includes(dict) ? `DATA.${dict}` : dict;
      jsLines.push(`${pad}for (const ${v} of Object.values(${dictRef})) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // for x in sorted(DICT.keys()):
    const forSortedKeys = line.match(/^for\s+(\w+)\s+in\s+sorted\((\w+)\.keys\(\)\)\s*:$/);
    if (forSortedKeys) {
      const [, v, dict] = forSortedKeys;
      const dictRef = dataNames.includes(dict) ? `DATA.${dict}` : dict;
      jsLines.push(`${pad}for (const ${v} of Object.keys(${dictRef}).sort()) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // for k, v in list (tuple unpacking from non-.items() source)
    const forTupleMatch = line.match(/^for\s+(\w+),\s*(\w+)\s+in\s+(.+)\s*:$/);
    if (forTupleMatch) {
      const [, k, v, iter] = forTupleMatch;
      jsLines.push(`${pad}for (const [${k}, ${v}] of ${pyExprToJS(iter, dataNames)}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // for x in list/sorted(list):
    const forMatch = line.match(/^for\s+(\w+)\s+in\s+(.+)\s*:$/);
    if (forMatch) {
      const [, v, iter] = forMatch;
      jsLines.push(`${pad}for (const ${v} of ${pyExprToJS(iter, dataNames)}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // if/elif/else
    const ifMatch = line.match(/^if\s+(.+)\s*:$/);
    if (ifMatch) {
      jsLines.push(`${pad}if (${pyCondToJS(ifMatch[1], dataNames)}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }
    const elifMatch = line.match(/^elif\s+(.+)\s*:$/);
    if (elifMatch) {
      // Remove last closing brace and add else if
      if (jsLines.length > 0 && jsLines[jsLines.length-1].trim() === '}') jsLines.pop();
      jsLines.push(`${pad}} else if (${pyCondToJS(elifMatch[1], dataNames)}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }
    if (line === 'else:') {
      if (jsLines.length > 0 && jsLines[jsLines.length-1].trim() === '}') jsLines.pop();
      jsLines.push(`${pad}} else {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // try/except → try/catch
    if (line === 'try:') {
      jsLines.push(`${pad}try {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }
    const exceptMatch = line.match(/^except(?:\s+[\w.,() ]+?)?(?:\s+as\s+(\w+))?\s*:$/);
    if (exceptMatch) {
      if (jsLines.length > 0 && jsLines[jsLines.length-1].trim() === '}') jsLines.pop();
      const errVar = exceptMatch[1] || 'e';
      jsLines.push(`${pad}} catch(${errVar}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }
    if (line === 'finally:') {
      if (jsLines.length > 0 && jsLines[jsLines.length-1].trim() === '}') jsLines.pop();
      jsLines.push(`${pad}} finally {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // while loop
    const whileMatch = line.match(/^while\s+(.+)\s*:$/);
    if (whileMatch) {
      jsLines.push(`${pad}while (${pyCondToJS(whileMatch[1], dataNames)}) {`);
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // with statement → just execute the body (skip resource management)
    if (line.startsWith('with ')) {
      const bodyEnd = collectBlock(bodyLines, i + 1, indent + 4);
      jsLines.push(`${pad}/* with */ {`);
      jsLines.push(convertPythonBodyToJS(bodyLines.slice(i + 1, bodyEnd), indent + 4, dataObjects));
      jsLines.push(`${pad}}`);
      i = bodyEnd - 1;
      continue;
    }

    // pass, continue, break, import
    if (line === 'pass') continue;
    if (line === 'continue') { jsLines.push(`${pad}continue;`); continue; }
    if (line === 'break') { jsLines.push(`${pad}break;`); continue; }
    if (line.startsWith('import ') || line.startsWith('from ')) continue;

    // raise → throw
    if (line.startsWith('raise ')) {
      jsLines.push(`${pad}throw new Error(${pyExprToJS(line.slice(6), dataNames)});`);
      continue;
    }

    // return
    if (line.startsWith('return ')) {
      jsLines.push(`${pad}return ${pyExprToJS(line.slice(7), dataNames)};`);
      continue;
    }
    if (line === 'return') { jsLines.push(`${pad}return;`); continue; }

    // list.append(x)
    const appendMatch = line.match(/^(\w+)\.append\((.+)\)$/);
    if (appendMatch) {
      jsLines.push(`${pad}${appendMatch[1]}.push(${pyExprToJS(appendMatch[2], dataNames)});`);
      continue;
    }

    // list.sort(key=...)
    const sortMatch = line.match(/^(\w+)\.sort\(key=lambda\s+(\w+):\s*(.+?)(?:,\s*reverse=(\w+))?\)$/);
    if (sortMatch) {
      const rev = sortMatch[4] === 'True' ? '.reverse()' : '';
      jsLines.push(`${pad}${sortMatch[1]}.sort((a,b) => { const ka = ${pyExprToJS(sortMatch[3].replace(new RegExp(sortMatch[2],'g'), 'a'), dataNames)}; const kb = ${pyExprToJS(sortMatch[3].replace(new RegExp(sortMatch[2],'g'), 'b'), dataNames)}; return ka < kb ? -1 : ka > kb ? 1 : 0; })${rev};`);
      continue;
    }

    // Dict key augmented assignment: d["key"] += x or d[var] += x
    const dictAugAssign = line.match(/^(\w+)\[(.+?)\]\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
    if (dictAugAssign) {
      const obj = dataNames.includes(dictAugAssign[1]) ? `DATA.${dictAugAssign[1]}` : dictAugAssign[1];
      const key = pyExprToJS(dictAugAssign[2], dataNames);
      jsLines.push(`${pad}${obj}[${key}] ${dictAugAssign[3]} ${pyExprToJS(dictAugAssign[4], dataNames)};`);
      continue;
    }

    // Dict key assignment: d["key"] = expr or d[var] = expr
    const dictAssign = line.match(/^(\w+)\[(.+?)\]\s*=\s*(.+)$/);
    if (dictAssign) {
      const obj = dataNames.includes(dictAssign[1]) ? `DATA.${dictAssign[1]}` : dictAssign[1];
      const key = pyExprToJS(dictAssign[2], dataNames);
      jsLines.push(`${pad}${obj}[${key}] = ${pyExprToJS(dictAssign[3], dataNames)};`);
      continue;
    }

    // total_cost += x
    const augAssign = line.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
    if (augAssign) {
      jsLines.push(`${pad}${augAssign[1]} ${augAssign[2]} ${pyExprToJS(augAssign[3], dataNames)};`);
      continue;
    }

    // Assignment: x = expr
    const assignMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const val = pyExprToJS(assignMatch[2], dataNames);
      jsLines.push(`${pad}let ${varName} = ${val};`);
      continue;
    }

    // Pass-through (function calls etc)
    jsLines.push(`${pad}${pyExprToJS(line, dataNames)};`);
  }

  return jsLines.join('\n');
}

function collectBlock(lines, start, minIndent) {
  let i = start;
  while (i < lines.length) {
    if (lines[i].trim() === '' || lines[i].trim().startsWith('#')) { i++; continue; }
    if (getIndent(lines[i]) < minIndent) break;
    i++;
  }
  return i;
}

// Convert a Python expression to JavaScript
let _pyExprDepth = 0;
function pyExprToJS(expr, dataNames) {
  if (!expr) return 'null';
  expr = expr.trim();
  if (++_pyExprDepth > 80) { _pyExprDepth--; return expr; }
  try {
  return _pyExprToJSInner(expr, dataNames);
  } finally { _pyExprDepth--; }
}
function _pyExprToJSInner(expr, dataNames) {

  // Remove trailing comment
  const ci = expr.indexOf(' #');
  if (ci > 0) {
    let inStr = false, sc = '';
    for (let k = 0; k < ci; k++) {
      if (!inStr && (expr[k]==='"'||expr[k]==="'")) { inStr=true; sc=expr[k]; }
      else if (inStr && expr[k]===sc) inStr=false;
    }
    if (!inStr) expr = expr.slice(0, ci).trim();
  }

  if (expr === 'None') return 'null';
  if (expr === 'True') return 'true';
  if (expr === 'False') return 'false';

  // Python `or` / `and` at depth 0 → JS `||` / `&&`
  {
    const boolParts = splitBoolOp(expr);
    if (boolParts) {
      const jsOp = boolParts.op === 'or' ? '||' : '&&';
      return boolParts.parts.map(p => pyExprToJS(p.trim(), dataNames)).join(` ${jsOp} `);
    }
  }

  // f-string -> template literal
  if (expr.startsWith('f"') || expr.startsWith("f'")) {
    return pyFStringToJS(expr, dataNames);
  }

  // String
  if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
    return '"' + expr.slice(1, -1).replace(/"/g, '\\"') + '"';
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(expr)) return expr;

  // Tuple literal (a, b) -> [a, b], or parenthesized expression (expr) -> expr
  // Only if the opening ( matches the closing ) (they form a pair)
  if (expr.startsWith('(') && expr.endsWith(')') && !expr.match(/^\w+\(/) && isMatchingParens(expr)) {
    const inner = expr.slice(1, -1).trim();
    const parts = splitComma(inner);
    if (parts.length >= 2) {
      return `[${parts.map(p => pyExprToJS(p.trim(), dataNames)).join(', ')}]`;
    }
    // Single-element parens: strip and recurse, preserving grouping
    if (parts.length === 1) {
      return `(${pyExprToJS(inner, dataNames)})`;
    }
  }

  // List literal: [x for y in z] or [a, b, c]
  if (expr.startsWith('[') && expr.endsWith(']')) {
    const inner = expr.slice(1, -1).trim();
    if (!inner) return '[]';
    // List comprehension
    const compMatch = inner.match(/^(.+)\s+for\s+(\w+)\s+in\s+(.+?)(?:\s+if\s+(.+))?$/);
    if (compMatch) {
      let src = pyExprToJS(compMatch[3], dataNames);
      if (compMatch[4]) src = `${src}.filter(${compMatch[2]} => ${pyCondToJS(compMatch[4], dataNames)})`;
      return `${src}.map(${compMatch[2]} => ${pyExprToJS(compMatch[1], dataNames)})`;
    }
    const items = splitComma(inner).map(x => pyExprToJS(x.trim(), dataNames));
    return `[${items.join(', ')}]`;
  }

  // Dict literal: {k: v, ...} or dict comprehension {k: v for x in y}
  if (expr.startsWith('{') && expr.endsWith('}')) {
    const inner = expr.slice(1, -1).trim();
    if (!inner) return '{}';
    // Dict comprehension: {keyExpr: valExpr for var in iter}
    // Guard: only match if no commas at depth 0 before the `for` (otherwise it's a plain dict with a gen-expr value)
    const dictCompMatch = inner.match(/^(.+?)\s*:\s*(.+?)\s+for\s+(\w+),?\s*(\w+)?\s+in\s+(.+?)(?:\s+if\s+(.+))?$/);
    if (dictCompMatch && splitComma(dictCompMatch[1] + ':' + dictCompMatch[2]).length === 1) {
      const [, kExpr, vExpr, v1, v2, iterExpr, filterExpr] = dictCompMatch;
      let src = pyExprToJS(iterExpr, dataNames);
      // Check if iterating over .items()
      if (v2) {
        // for k, v in dict.items() pattern
        let base = `Object.fromEntries(Object.entries(${src}).map(([${v1}, ${v2}]) => [${pyExprToJS(kExpr, dataNames)}, ${pyExprToJS(vExpr, dataNames)}])`;
        if (filterExpr) base = `Object.fromEntries(Object.entries(${src}).filter(([${v1}, ${v2}]) => ${pyCondToJS(filterExpr, dataNames)}).map(([${v1}, ${v2}]) => [${pyExprToJS(kExpr, dataNames)}, ${pyExprToJS(vExpr, dataNames)}])`;
        return base + ')';
      } else {
        let base = `Object.fromEntries(${src}.map(${v1} => [${pyExprToJS(kExpr, dataNames)}, ${pyExprToJS(vExpr, dataNames)}])`;
        if (filterExpr) base = `Object.fromEntries(${src}.filter(${v1} => ${pyCondToJS(filterExpr, dataNames)}).map(${v1} => [${pyExprToJS(kExpr, dataNames)}, ${pyExprToJS(vExpr, dataNames)}])`;
        return base + ')';
      }
    }
    const pairs = splitComma(inner).map(p => {
      p = p.trim();
      // Dict unpacking: **expr → ...expr (JS spread)
      if (p.startsWith('**')) return `...${pyExprToJS(p.slice(2).trim(), dataNames)}`;
      const [k, v] = splitFirst(p, ':');
      return `${pyExprToJS(k.trim(), dataNames)}: ${pyExprToJS(v.trim(), dataNames)}`;
    });
    return `{${pairs.join(', ')}}`;
  }

  // Ternary: a if cond else b — only match if/else at bracket depth 0
  {
    const ternParts = splitTernary(expr);
    if (ternParts) {
      return `(${pyCondToJS(ternParts.cond, dataNames)} ? ${pyExprToJS(ternParts.value, dataNames)} : ${pyExprToJS(ternParts.alt, dataNames)})`;
    }
  }

  // sum(gen_expr)
  const sumMatch = expr.match(/^sum\((.+)\)$/);
  if (sumMatch) {
    const inner = sumMatch[1].trim();
    const genMatch = inner.match(/^(.+)\s+for\s+(\w+)(?:,\s*(\w+))?\s+in\s+(.+?)(?:\s+if\s+(.+))?$/);
    if (genMatch) {
      const [, mapExpr, v1, v2, iterExpr, filterExpr] = genMatch;
      let src = pyExprToJS(iterExpr, dataNames);
      if (v2) src = `Object.entries(${src})`;
      const param = v2 ? `([${v1},${v2}])` : v1;
      if (filterExpr) src = `${src}.filter(${param} => ${pyCondToJS(filterExpr, dataNames)})`;
      return `${src}.map(${param} => ${pyExprToJS(mapExpr, dataNames)}).reduce((a,b) => a+b, 0)`;
    }
    return `${pyExprToJS(inner, dataNames)}.reduce((a,b) => a+b, 0)`;
  }

  // sorted(x, key=lambda y: expr, reverse=True/False)
  const sortedMatch = expr.match(/^sorted\((.+?),\s*key=lambda\s+(\w+):\s*(.+?)(?:,\s*reverse=(\w+))?\)$/);
  if (sortedMatch) {
    const arr = pyExprToJS(sortedMatch[1], dataNames);
    const v = sortedMatch[2];
    const keyExpr = pyExprToJS(sortedMatch[3], dataNames);
    const rev = sortedMatch[4] === 'True';
    const cmp = rev
      ? `(a,b) => { const ka=${keyExpr.replace(new RegExp('\\b'+v+'\\b','g'),'a')}; const kb=${keyExpr.replace(new RegExp('\\b'+v+'\\b','g'),'b')}; return kb<ka?-1:kb>ka?1:0; }`
      : `(a,b) => { const ka=${keyExpr.replace(new RegExp('\\b'+v+'\\b','g'),'a')}; const kb=${keyExpr.replace(new RegExp('\\b'+v+'\\b','g'),'b')}; return ka<kb?-1:ka>kb?1:0; }`;
    return `[...${arr}].sort(${cmp})`;
  }

  // sorted(x)
  const sortedSimple = expr.match(/^sorted\((.+)\)$/);
  if (sortedSimple) return `[...${pyExprToJS(sortedSimple[1], dataNames)}].sort()`;

  // len(x)
  const lenMatch = expr.match(/^len\((.+)\)$/);
  if (lenMatch) return `${pyExprToJS(lenMatch[1], dataNames)}.length`;

  // round(x, n)
  const roundMatch = expr.match(/^round\((.+?),\s*(.+)\)$/);
  if (roundMatch) return `Math.round(${pyExprToJS(roundMatch[1], dataNames)} * Math.pow(10, ${roundMatch[2]})) / Math.pow(10, ${roundMatch[2]})`;
  const roundMatch2 = expr.match(/^round\((.+)\)$/);
  if (roundMatch2) return `Math.round(${pyExprToJS(roundMatch2[1], dataNames)})`;

  // max(a, b) / min(a, b) / max(expr for x in y)
  const maxMinMatch = expr.match(/^(max|min)\((.+)\)$/);
  if (maxMinMatch) {
    const inner = maxMinMatch[2].trim();
    // Generator expression: max(expr for x in y [if cond])
    const genMatch = inner.match(/^(.+)\s+for\s+(\w+)(?:,\s*(\w+))?\s+in\s+(.+?)(?:\s+if\s+(.+))?$/);
    if (genMatch) {
      const [, mapExpr, v1, v2, iterExpr, filterExpr] = genMatch;
      let src = pyExprToJS(iterExpr, dataNames);
      if (v2) src = `Object.entries(${src})`;
      if (filterExpr) src = `${src}.filter(${v2 ? `([${v1},${v2}])` : v1} => ${pyCondToJS(filterExpr, dataNames)})`;
      const param = v2 ? `([${v1},${v2}])` : v1;
      return `Math.${maxMinMatch[1]}(...${src}.map(${param} => ${pyExprToJS(mapExpr, dataNames)}))`;
    }
    const args = splitComma(inner).map(a => pyExprToJS(a.trim(), dataNames));
    return `Math.${maxMinMatch[1]}(${args.join(', ')})`;
  }

  // int(x)
  const intMatch = expr.match(/^int\((.+)\)$/);
  if (intMatch) return `Math.trunc(${pyExprToJS(intMatch[1], dataNames)})`;

  // str(x)
  const strMatch = expr.match(/^str\((.+)\)$/);
  if (strMatch) return `String(${pyExprToJS(strMatch[1], dataNames)})`;

  // all(cond for x in list)
  const allMatch = expr.match(/^all\((.+)\s+for\s+(\w+)\s+in\s+(.+)\)$/);
  if (allMatch) return `${pyExprToJS(allMatch[3], dataNames)}.every(${allMatch[2]} => ${pyCondToJS(allMatch[1], dataNames)})`;

  // any(cond for x in list)
  const anyMatch = expr.match(/^any\((.+)\s+for\s+(\w+)\s+in\s+(.+)\)$/);
  if (anyMatch) return `${pyExprToJS(anyMatch[3], dataNames)}.some(${anyMatch[2]} => ${pyCondToJS(anyMatch[1], dataNames)})`;

  // Method chains — handle from left to right
  // x.items()
  if (expr.endsWith('.items()')) {
    const obj = expr.slice(0, -8);
    return `Object.entries(${pyExprToJS(obj, dataNames)})`;
  }
  if (expr.endsWith('.values()')) {
    const obj = expr.slice(0, -9);
    return `Object.values(${pyExprToJS(obj, dataNames)})`;
  }
  if (expr.endsWith('.keys()')) {
    const obj = expr.slice(0, -7);
    return `Object.keys(${pyExprToJS(obj, dataNames)})`;
  }
  if (expr.endsWith('.title()')) {
    const s = expr.slice(0, -8);
    return `${pyExprToJS(s, dataNames)}.replace(/\\b\\w/g, c => c.toUpperCase())`;
  }
  if (expr.endsWith('.upper()')) {
    return `${pyExprToJS(expr.slice(0, -8), dataNames)}.toUpperCase()`;
  }
  if (expr.endsWith('.lower()')) {
    return `${pyExprToJS(expr.slice(0, -8), dataNames)}.toLowerCase()`;
  }
  if (expr.endsWith('.strip()')) {
    return `${pyExprToJS(expr.slice(0, -8), dataNames)}.trim()`;
  }

  if (expr.endsWith('.lstrip()')) return `${pyExprToJS(expr.slice(0, -9), dataNames)}.trimStart()`;
  if (expr.endsWith('.rstrip()')) return `${pyExprToJS(expr.slice(0, -9), dataNames)}.trimEnd()`;

  // x.lstrip("#") → trimStart equivalent with char
  const lstripMatch = expr.match(/^(.+)\.lstrip\((.+)\)$/);
  if (lstripMatch) return `${pyExprToJS(lstripMatch[1], dataNames)}.replace(new RegExp('^[' + ${pyExprToJS(lstripMatch[2], dataNames)} + ']+'), '')`;

  // x.startswith("a") / x.endswith("a")
  const swMatch = expr.match(/^(.+)\.(startswith|endswith)\((.+)\)$/);
  if (swMatch) {
    const method = swMatch[2] === 'startswith' ? 'startsWith' : 'endsWith';
    return `${pyExprToJS(swMatch[1], dataNames)}.${method}(${pyExprToJS(swMatch[3], dataNames)})`;
  }

  // x.index(val) → indexOf
  const indexMatch = expr.match(/^(.+)\.index\((.+)\)$/);
  if (indexMatch) return `${pyExprToJS(indexMatch[1], dataNames)}.indexOf(${pyExprToJS(indexMatch[2], dataNames)})`;

  // x.split("a") / x.split()
  const splitMatch = expr.match(/^(.+)\.split\(([^)]*)\)$/);
  if (splitMatch) {
    const obj = pyExprToJS(splitMatch[1], dataNames);
    const arg = splitMatch[2].trim();
    return arg ? `${obj}.split(${pyExprToJS(arg, dataNames)})` : `${obj}.split(/\\s+/)`;
  }

  // x.replace("a", "b")
  const replaceMatch = expr.match(/^(.+)\.replace\(([^,]+),\s*([^)]+)\)$/);
  if (replaceMatch) return `${pyExprToJS(replaceMatch[1], dataNames)}.split(${pyExprToJS(replaceMatch[2], dataNames)}).join(${pyExprToJS(replaceMatch[3], dataNames)})`;

  // "sep".join(list)
  const joinMatch = expr.match(/^(["'][^"']*["'])\.join\((.+)\)$/);
  if (joinMatch) return `${pyExprToJS(joinMatch[2], dataNames)}.join(${pyExprToJS(joinMatch[1], dataNames)})`;

  // var.join(list)
  const varJoinMatch = expr.match(/^(\w+)\.join\((.+)\)$/);
  if (varJoinMatch && !dataNames.includes(varJoinMatch[1])) {
    return `${pyExprToJS(varJoinMatch[2], dataNames)}.join(${varJoinMatch[1]})`;
  }

  // x.get("key", default) — dict access with default
  // Use bracket-aware parsing to handle nested .get() calls properly
  {
    const getPos = findMethodCall(expr, 'get');
    if (getPos) {
      const obj = pyExprToJS(getPos.receiver, dataNames);
      const args = splitComma(getPos.args);
      const key = pyExprToJS(args[0].trim(), dataNames);
      const dflt = args.length > 1 ? pyExprToJS(args.slice(1).join(',').trim(), dataNames) : 'undefined';
      // If there's a suffix (chained .get()), handle it
      let result = `(${obj}[${key}] !== undefined ? ${obj}[${key}] : ${dflt})`;
      if (getPos.suffix) {
        result = pyExprToJS(result + getPos.suffix, dataNames);
      }
      return result;
    }
  }

  // Binary operators — must check BEFORE dict chain to avoid
  // 'c in t["x"]' being parsed as dict access on 'c in t'

  // Handle 'not' prefix
  if (expr.startsWith('not ')) return `!(${pyCondToJS(expr.slice(4), dataNames)})`;

  // 'x not in y' membership
  const notInMatch = expr.match(/^(.+?)\s+not\s+in\s+(.+)$/);
  if (notInMatch) {
    const item = pyExprToJS(notInMatch[1], dataNames);
    const collection = pyExprToJS(notInMatch[2], dataNames);
    return `!(Array.isArray(${collection}) ? ${collection}.includes(${item}) : String(${collection}).includes(String(${item})))`;
  }

  // 'x in y' membership
  const inMatch = expr.match(/^(.+?)\s+in\s+(.+)$/);
  if (inMatch && !inMatch[1].includes(' for ') && !inMatch[1].includes(' if ')) {
    const item = pyExprToJS(inMatch[1], dataNames);
    const collection = pyExprToJS(inMatch[2], dataNames);
    return `(Array.isArray(${collection}) ? ${collection}.includes(${item}) : String(${collection}).includes(String(${item})))`;
  }

  // Comparison operators (==, !=, <, >, <=, >=, is, is not) — route through pyCondToJS
  // Only match at bracket depth 0 to avoid matching inside generated subexpressions
  {
    // Note: ' is not ' and ' is ' require word-char boundary check to avoid matching inside words
    const cmpOps = [' is not ', ' is ', ' !== ', ' != ', ' === ', ' == ', ' <= ', ' >= ', ' < ', ' > '];
    let cmpInStr = false, cmpSc = '', cmpDepth = 0;
    let foundCmp = false;
    for (let ci = 0; ci < expr.length && !foundCmp; ci++) {
      const c = expr[ci];
      if (cmpInStr) { if (c === '\\') { ci++; continue; } if (c === cmpSc) cmpInStr = false; continue; }
      if (c === '"' || c === "'") { cmpInStr = true; cmpSc = c; continue; }
      if ('([{'.includes(c)) { cmpDepth++; continue; }
      if (')]}'.includes(c)) { cmpDepth--; continue; }
      if (cmpDepth === 0) {
        for (const op of cmpOps) {
          if (expr.slice(ci, ci + op.length) === op) {
            foundCmp = true; break;
          }
        }
      }
    }
    if (foundCmp) return pyCondToJS(expr, dataNames);
  }

  // Binary arithmetic: split on +, -, *, / at depth 0
  {
    const binOp = splitBinaryOp(expr);
    if (binOp) {
      const l = pyExprToJS(binOp.left, dataNames);
      const r = pyExprToJS(binOp.right, dataNames);
      if (binOp.op === '//') return 'Math.floor(' + l + ' / ' + r + ')';
      if (binOp.op === '**') return `Math.pow(${l}, ${r})`;
      return `${l} ${binOp.op} ${r}`;
    }
  }

  // Python slice: expr[start:end] -> expr.slice(start, end) — supports expressions, not just numbers
  {
    // Find the last [...] and check if it contains a colon at depth 0 (it's a slice)
    const lastBracket = expr.lastIndexOf(']');
    if (lastBracket === expr.length - 1) {
      // Find matching [
      let depth = 0, bi = lastBracket;
      while (bi >= 0) {
        if (expr[bi] === ']') depth++;
        else if (expr[bi] === '[') { depth--; if (depth === 0) break; }
        bi--;
      }
      if (bi > 0) {
        const inside = expr.slice(bi + 1, lastBracket);
        // Check for colon at depth 0 inside the brackets (slice indicator)
        let hasSlice = false, d = 0, colonPos = -1, inS = false, sC = '';
        for (let k = 0; k < inside.length; k++) {
          const c = inside[k];
          if (inS) { if (c === '\\') k++; else if (c === sC) inS = false; continue; }
          if (c === '"' || c === "'") { inS = true; sC = c; continue; }
          if ('([{'.includes(c)) d++;
          else if (')]}'.includes(c)) d--;
          else if (c === ':' && d === 0) { hasSlice = true; colonPos = k; break; }
        }
        if (hasSlice) {
          const obj = pyExprToJS(expr.slice(0, bi), dataNames);
          const startExpr = inside.slice(0, colonPos).trim();
          const endExpr = inside.slice(colonPos + 1).trim();
          const jsStart = startExpr ? pyExprToJS(startExpr, dataNames) : '0';
          const jsEnd = endExpr ? pyExprToJS(endExpr, dataNames) : '';
          return jsEnd ? `${obj}.slice(${jsStart}, ${jsEnd})` : `${obj}.slice(${jsStart})`;
        }
      }
    }
  }

  // dict[key] access — bracket-aware chained parsing
  {
    const bracketAccess = splitBracketAccess(expr);
    if (bracketAccess) {
      const obj = pyExprToJS(bracketAccess.obj, dataNames);
      const key = pyExprToJS(bracketAccess.key, dataNames);
      const suffix = bracketAccess.suffix;
      let result = `${obj}[${key}]`;
      if (suffix) result = pyExprToJS(result + suffix, dataNames);
      return result;
    }
  }

  // Simple variable — check if it's a data reference
  if (/^\w+$/.test(expr)) {
    if (dataNames.includes(expr)) return `DATA.${expr}`;
    return expr;
  }

  // Attribute access: x.y (not a method call)
  if (/^\w+\.\w+$/.test(expr) && !expr.endsWith(')')) {
    const [obj, attr] = expr.split('.');
    if (dataNames.includes(obj)) return `DATA.${obj}.${attr}`;
    return expr;
  }

  // Function call: name(args)
  const callMatch = expr.match(/^(\w+)\((.*)?\)$/);
  if (callMatch) {
    const fn = callMatch[1];
    const argsStr = callMatch[2] || '';
    if (fn === 'print') return `/* print */ void 0`;
    const args = argsStr ? splitComma(argsStr).map(a => pyExprToJS(a.trim(), dataNames)).join(', ') : '';
    // Python builtins -> PY.name()
    const pyBuiltins = ['len','int','float','str','list','sorted','sum','max','min','abs','round','range','all','any','dict','enumerate','zip','isinstance','type','bool','tuple','set'];
    if (pyBuiltins.includes(fn)) return `PY.${fn}(${args})`;
    // Known helper -> HELPERS.name()
    return `HELPERS.${fn}(${args})`;
  }

  // Fallback — return as-is
  return expr;
}

function pyCondToJS(cond, dataNames) {
  cond = cond.trim();
  // and/or
  const andParts = cond.split(/\s+and\s+/);
  if (andParts.length > 1) return andParts.map(p => pyCondToJS(p, dataNames)).join(' && ');
  const orParts = cond.split(/\s+or\s+/);
  if (orParts.length > 1) return orParts.map(p => pyCondToJS(p, dataNames)).join(' || ');
  // not
  if (cond.startsWith('not ')) return `!(${pyCondToJS(cond.slice(4), dataNames)})`;
  // Comparisons — check longer operators first to avoid partial matches (e.g. !== vs !=)
  // Use \b word boundaries for `is`/`is not` to avoid matching inside words like "history"
  const cmpMatch = cond.match(/^(.+?)\s*(!==|===|\bis not\b|\bis\b|==|!=|<=|>=|<|>)\s*(.+)$/);
  if (cmpMatch) {
    const l = pyExprToJS(cmpMatch[1], dataNames);
    const r = pyExprToJS(cmpMatch[3], dataNames);
    const op = cmpMatch[2] === '==' ? '===' : cmpMatch[2] === '!=' ? '!==' : cmpMatch[2] === 'is not' ? '!==' : cmpMatch[2] === 'is' ? '===' : cmpMatch[2];
    return `${l} ${op} ${r}`;
  }
  // in
  const inMatch = cond.match(/^(.+?)\s+in\s+(.+)$/);
  if (inMatch && !inMatch[1].includes(' for ')) {
    return pyExprToJS(`${inMatch[1]} in ${inMatch[2]}`, dataNames);
  }
  return pyExprToJS(cond, dataNames);
}

function pyFStringToJS(fstr, dataNames) {
  const inner = fstr.slice(2, -1);
  let result = '`';
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '{') {
      i++;
      let depth = 1, expr = '';
      while (i < inner.length && depth > 0) {
        if (inner[i] === '{') depth++;
        else if (inner[i] === '}') { depth--; if (depth === 0) break; }
        expr += inner[i]; i++;
      }
      i++; // skip }
      // Format spec — find last colon at bracket depth 0 (skip colons in dicts/slices)
      let colonIdx = -1;
      { let d=0, inS=false, sC='';
        for (let k=0; k<expr.length; k++) {
          const c = expr[k];
          if (inS) { if (c==='\\') k++; else if (c===sC) inS=false; continue; }
          if (c==='"'||c==="'") { inS=true; sC=c; continue; }
          if ('([{'.includes(c)) d++;
          else if (')]}'.includes(c)) d--;
          else if (c===':' && d===0) colonIdx = k;
        }
      }
      if (colonIdx > 0) {
        const varPart = expr.slice(0, colonIdx);
        const fmt = expr.slice(colonIdx + 1);
        if (fmt === ',') {
          result += '${' + `Number(${pyExprToJS(varPart, dataNames)}).toLocaleString('en-US')` + '}';
        } else if (fmt.match(/^,\.\d+f$/)) {
          const d = fmt.match(/\.(\d+)f/)[1];
          result += '${' + `Number(${pyExprToJS(varPart, dataNames)}).toLocaleString('en-US',{minimumFractionDigits:${d},maximumFractionDigits:${d}})` + '}';
        } else if (fmt.match(/^\.\d+f$/)) {
          const d = fmt.match(/\.(\d+)f/)[1];
          result += '${' + `Number(${pyExprToJS(varPart, dataNames)}).toFixed(${d})` + '}';
        } else if (fmt === ',.0f') {
          result += '${' + `Math.round(Number(${pyExprToJS(varPart, dataNames)})).toLocaleString('en-US')` + '}';
        } else if (fmt.match(/^\.0f$/)) {
          result += '${' + `Math.round(${pyExprToJS(varPart, dataNames)})` + '}';
        } else if (fmt.match(/^\.\d*%$/)) {
          // Percentage format: :.0% or :.1% etc
          const d = (fmt.match(/\.(\d+)%/) || [,'0'])[1];
          result += '${' + `(${pyExprToJS(varPart, dataNames)} * 100).toFixed(${d})` + '}%';
        } else if (fmt.match(/^>\d+|^<\d+|^\d+/)) {
          // Width/alignment specs — just output the value
          result += '${' + pyExprToJS(varPart, dataNames) + '}';
        } else {
          // Unknown format spec — try to transpile just the var part
          result += '${' + pyExprToJS(varPart, dataNames) + '}';
        }
      } else {
        result += '${' + pyExprToJS(expr, dataNames) + '}';
      }
    } else {
      if (inner[i] === '`') result += '\\`';
      else if (inner[i] === '$' && inner[i+1] === '{') result += '\\$';
      else result += inner[i];
      i++;
    }
  }
  result += '`';
  return result;
}

// Split on `or` / `and` at bracket depth 0 (outside strings)
function splitBoolOp(expr) {
  // Try `or` first, then `and` (or has lower precedence)
  for (const op of ['or', 'and']) {
    const re = new RegExp(`\\s+${op}\\s+`, 'g');
    let depth = 0, inStr = false, strChar = '', m;
    const positions = [];
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (inStr) { if (c === '\\') i++; else if (c === strChar) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
      if ('([{'.includes(c)) { depth++; continue; }
      if (')]}'.includes(c)) { depth--; continue; }
      if (depth === 0) {
        re.lastIndex = i;
        m = re.exec(expr);
        if (m && m.index === i) positions.push({ start: i, end: i + m[0].length });
      }
    }
    if (positions.length > 0) {
      const parts = [];
      let prev = 0;
      for (const p of positions) { parts.push(expr.slice(prev, p.start)); prev = p.end; }
      parts.push(expr.slice(prev));
      return { op, parts };
    }
  }
  return null;
}

function splitComma(s) {
  const result = [];
  let depth = 0, current = '', inStr = false, strChar = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { current += c + (s[i+1]||''); i++; continue; }
      if (c === strChar) inStr = false;
      current += c;
    } else {
      if (c === '"' || c === "'") { inStr = true; strChar = c; current += c; }
      else if ('([{'.includes(c)) { depth++; current += c; }
      else if (')]}'.includes(c)) { depth--; current += c; }
      else if (c === ',' && depth === 0) { result.push(current); current = ''; }
      else current += c;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

function splitFirst(s, delim) {
  const idx = s.indexOf(delim);
  if (idx < 0) return [s, ''];
  return [s.slice(0, idx), s.slice(idx + 1)];
}

// Find a .method(args) call in an expression, handling nested brackets
// Returns { receiver, args, suffix } or null
function findMethodCall(expr, method) {
  const needle = '.' + method + '(';
  // Search right-to-left to find the outermost .get() first for chaining
  // But we want to find ALL .get() positions and pick the right one
  // Strategy: find the FIRST .get( at depth 0
  let inStr = false, sc = '', depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === sc) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (depth === 0 && expr.slice(i, i + needle.length) === needle) {
      const receiver = expr.slice(0, i);
      const argsStart = i + needle.length;
      // Find matching closing paren
      let d = 1, j = argsStart, inS2 = false, sc2 = '';
      while (j < expr.length && d > 0) {
        const ch = expr[j];
        if (inS2) { if (ch === '\\') { j++; } else if (ch === sc2) inS2 = false; }
        else {
          if (ch === '"' || ch === "'") { inS2 = true; sc2 = ch; }
          else if (ch === '(' || ch === '[' || ch === '{') d++;
          else if (ch === ')' || ch === ']' || ch === '}') d--;
        }
        j++;
      }
      const args = expr.slice(argsStart, j - 1);
      const suffix = expr.slice(j);
      return { receiver, args, suffix: suffix || null };
    }
  }
  return null;
}

// Split expr into obj[key] access — finds the LAST [...] access at bracket depth 0
// Returns { obj, key, suffix } or null
function splitBracketAccess(expr) {
  let inStr = false, sc = '', depth = 0;
  let lastBracketStart = -1, lastBracketEnd = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === sc) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { depth--; continue; }
    if (c === '[' && depth === 0) {
      // Find matching ] using full bracket tracking
      let d = 1, j = i + 1, iS = false, sC = '';
      while (j < expr.length && d > 0) {
        const ch = expr[j];
        if (iS) { if (ch === '\\') j++; else if (ch === sC) iS = false; }
        else {
          if (ch === '"' || ch === "'") { iS = true; sC = ch; }
          else if (ch === '[' || ch === '(' || ch === '{') d++;
          else if (ch === ']' || ch === ')' || ch === '}') d--;
        }
        j++;
      }
      if (d === 0) {
        lastBracketStart = i;
        lastBracketEnd = j;
        // Skip past this bracket in the outer loop
        i = j - 1;
      }
    }
  }
  if (lastBracketStart > 0 && lastBracketEnd > 0) {
    const obj = expr.slice(0, lastBracketStart);
    const key = expr.slice(lastBracketStart + 1, lastBracketEnd - 1);
    const suffix = expr.slice(lastBracketEnd) || null;
    // Don't match slice patterns (key contains bare ':')
    if (/^\d*:\d*$/.test(key.trim())) return null;
    // Don't match if obj contains operators/spaces (part of a larger expression)
    // Only match if obj looks like an identifier chain: word, word.word, word[...], etc.
    if (/\s/.test(obj.trim())) return null;
    return { obj, key, suffix };
  }
  return null;
}

// Check if the first ( and last ) in an expression are a matching pair
function isMatchingParens(expr) {
  if (expr[0] !== '(') return false;
  let depth = 1, inStr = false, sc = '';
  for (let i = 1; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === sc) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i === expr.length - 1; }
  }
  return false;
}

// Split a Python ternary expression: value if cond else alt
// Only matches if 'if' and 'else' keywords are at bracket depth 0
function splitTernary(expr) {
  let inStr = false, sc = '', depth = 0;
  let ifPos = -1, elsePos = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === sc) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth--; continue; }
    if (depth === 0) {
      // Check for ' if ' at this position
      if (ifPos < 0 && expr.slice(i, i + 4) === ' if ' && i > 0) {
        ifPos = i;
      }
      // Check for ' else ' — use the LAST one at depth 0 after ifPos
      if (ifPos >= 0 && expr.slice(i, i + 6) === ' else ') {
        elsePos = i;
      }
    }
  }
  if (ifPos >= 0 && elsePos > ifPos) {
    return {
      value: expr.slice(0, ifPos).trim(),
      cond: expr.slice(ifPos + 4, elsePos).trim(),
      alt: expr.slice(elsePos + 6).trim(),
    };
  }
  return null;
}

// Split an expression on a binary arithmetic operator at depth 0
// Splits on lowest-precedence op found, scanning left-to-right
// Returns { left, op, right } or null
function splitBinaryOp(expr) {
  // Try operator groups from lowest to highest precedence
  for (const ops of [[' + ', ' - '], [' * ', ' / ', ' // ', ' ** ', ' % ']]) {
    let inStr = false, sc = '', depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (inStr) { if (c === '\\') { i++; continue; } if (c === sc) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; sc = c; continue; }
      if ('([{'.includes(c)) { depth++; continue; }
      if (')]}'.includes(c)) { depth--; continue; }
      if (depth === 0) {
        for (const op of ops) {
          if (expr.slice(i, i + op.length) === op) {
            const left = expr.slice(0, i).trim();
            const right = expr.slice(i + op.length).trim();
            if (left && right) return { left, op: op.trim(), right };
          }
        }
      }
    }
  }
  return null;
}


  // Re-bind brainstemOutput via setter so callers can hook into it
  function setOutputHook(fn) { brainstemOutput = fn; }

  root.RAR_RUNTIME = {
    unrappTranspile,
    lispParse,
    lispEval,
    createGlobalEnv,
    setOutputHook,
    NIL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
