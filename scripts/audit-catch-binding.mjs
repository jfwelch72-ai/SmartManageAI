#!/usr/bin/env node
// Audit: catch blocks that reference an error identifier other than their binding.
//
// Detects patterns like:
//   } catch (err) { next(error); }
//   } catch (err) { logError(error); throw error; }
// which crash with `ReferenceError: error is not defined` instead of returning
// a clean 500.
//
// Strategy: parse each .ts file in server/ for `catch (BINDING) { ... }` blocks.
// Strip nested function/arrow bodies from the catch body (they have their own
// scope and may legitimately introduce parameters named `e`, `err`, etc.).
// Then look for direct references to common error identifiers (`error`, `err`,
// `e`, `ex`) that aren't the catch binding and aren't shadowed by a local
// declaration in the catch body.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const ERROR_NAMES = new Set(['error', 'err', 'e', 'ex', 'exception']);

const files = execSync("rg -l --type ts 'catch\\s*[(\\{]' server/", {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

// Walk source character-by-character with awareness of strings, template
// literals (including ${...} interpolations), and comments. Returns an array
// the same length as src where each entry is a "code class":
//   'c' = code, 's' = string/comment/regex/non-code (to be ignored).
function classify(src) {
  const cls = new Array(src.length).fill('c');
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let strQuote = null; // '"' | "'" | null
  // Template-literal stack: each entry tracks whether we're inside the
  // template's text (`text`) or inside an interpolation (`expr`) and the brace
  // depth at which the interpolation closes.
  const tplStack = [];
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const top = tplStack[tplStack.length - 1];

    if (inLine) {
      cls[i] = 's';
      if (c === '\n') inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      cls[i] = 's';
      if (c === '*' && n === '/') { cls[i + 1] = 's'; i += 2; inBlock = false; continue; }
      i++;
      continue;
    }
    if (strQuote) {
      cls[i] = 's';
      if (c === '\\') { if (i + 1 < src.length) cls[i + 1] = 's'; i += 2; continue; }
      if (c === strQuote) strQuote = null;
      i++;
      continue;
    }
    if (top && top.mode === 'text') {
      cls[i] = 's';
      if (c === '\\') { if (i + 1 < src.length) cls[i + 1] = 's'; i += 2; continue; }
      if (c === '`') { tplStack.pop(); i++; continue; }
      if (c === '$' && n === '{') {
        cls[i + 1] = 's';
        tplStack[tplStack.length - 1] = { mode: 'expr', braceDepth: 1 };
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Code mode (or template expr mode — same syntax, but track braces)
    if (c === '/' && n === '/') { cls[i] = 's'; cls[i + 1] = 's'; inLine = true; i += 2; continue; }
    if (c === '/' && n === '*') { cls[i] = 's'; cls[i + 1] = 's'; inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'") { cls[i] = 's'; strQuote = c; i++; continue; }
    if (c === '`') { cls[i] = 's'; tplStack.push({ mode: 'text' }); i++; continue; }
    if (top && top.mode === 'expr') {
      if (c === '{') top.braceDepth++;
      else if (c === '}') {
        top.braceDepth--;
        if (top.braceDepth === 0) {
          cls[i] = 's';
          tplStack[tplStack.length - 1] = { mode: 'text' };
          i++;
          continue;
        }
      }
    }
    i++;
  }
  return cls;
}

// Find all catch headers in `src`. Returns objects with binding name and
// body offsets [bodyStart, bodyEnd) (exclusive of the closing brace).
function findCatches(src, cls) {
  const results = [];
  const re = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]+)?\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (cls[m.index] !== 'c') continue;
    const binding = m[1];
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < src.length && depth > 0) {
      if (cls[i] === 'c') {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
      }
      if (depth === 0) break;
      i++;
    }
    results.push({ binding, bodyStart, bodyEnd: i });
  }
  return results;
}

// Within a catch body, find ranges occupied by nested function bodies / arrow
// bodies. References inside those have their own scope and parameters, so we
// exclude them from the catch's direct-scope scan.
function findInnerFunctionRanges(src, cls, start, end) {
  const ranges = [];
  // Match function declarations/expressions (named or anonymous, async, generator, methods).
  // Heuristic: `function` keyword followed by optional name and parameter list.
  const fnRe = /\bfunction\b\s*\*?\s*[A-Za-z_$][\w$]*?\s*\(|\bfunction\b\s*\*?\s*\(/g;
  fnRe.lastIndex = start;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    if (m.index >= end) break;
    if (cls[m.index] !== 'c') continue;
    const body = skipParamsAndFindBody(src, cls, m.index + m[0].length - 1, end);
    if (body) ranges.push(body);
  }
  // Arrow functions: ...(params)... =>
  // Or single-identifier arrow: name => ...
  // Find `=>` and walk back to grab the parameter list and forward to grab the body.
  for (let i = start; i < end - 1; i++) {
    if (cls[i] !== 'c') continue;
    if (src[i] === '=' && src[i + 1] === '>') {
      const body = findArrowBody(src, cls, i + 2, end);
      if (body) ranges.push(body);
    }
  }
  // Class method bodies — treat any `methodName(params) {` inside a class.
  // Skipped: rare in catch blocks. If needed, extend later.
  return mergeRanges(ranges);
}

function skipParamsAndFindBody(src, cls, parenIdx, end) {
  // parenIdx points at '('
  let i = parenIdx;
  if (src[i] !== '(') return null;
  let depth = 1;
  i++;
  while (i < end && depth > 0) {
    if (cls[i] === 'c') {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  // After ')' may be return type annotation `: T` then '{'
  i++;
  while (i < end && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
  // skip return type annotation
  if (src[i] === ':') {
    while (i < end && src[i] !== '{' && src[i] !== ';' && src[i] !== '\n') i++;
  }
  while (i < end && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
  if (src[i] !== '{') return null;
  const bodyStart = i + 1;
  let bd = 1;
  i++;
  while (i < end && bd > 0) {
    if (cls[i] === 'c') {
      if (src[i] === '{') bd++;
      else if (src[i] === '}') bd--;
    }
    if (bd === 0) break;
    i++;
  }
  return [parenIdx, i];
}

function findArrowBody(src, cls, afterArrow, end) {
  let i = afterArrow;
  while (i < end && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
  if (i >= end) return null;
  if (src[i] === '{' && cls[i] === 'c') {
    const bodyStart = i + 1;
    let bd = 1;
    i++;
    while (i < end && bd > 0) {
      if (cls[i] === 'c') {
        if (src[i] === '{') bd++;
        else if (src[i] === '}') bd--;
      }
      if (bd === 0) break;
      i++;
    }
    return [afterArrow, i];
  }
  // Expression body: walk until top-level ',' ';' ')' '}' ']' or newline that
  // ends the expression. Use bracket depth tracking.
  let depth = 0;
  while (i < end) {
    if (cls[i] === 'c') {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (c === ',' || c === ';')) break;
    }
    i++;
  }
  return [afterArrow, i];
}

function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [ranges[0].slice()];
  for (let i = 1; i < ranges.length; i++) {
    const last = out[out.length - 1];
    if (ranges[i][0] <= last[1]) {
      if (ranges[i][1] > last[1]) last[1] = ranges[i][1];
    } else {
      out.push(ranges[i].slice());
    }
  }
  return out;
}

function inRanges(idx, ranges) {
  // binary search would be nicer but linear is fine for our sizes
  for (const [a, b] of ranges) {
    if (idx >= a && idx < b) return true;
    if (a > idx) break;
  }
  return false;
}

function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

const offenders = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const cls = classify(src);
  const catches = findCatches(src, cls);

  for (const cat of catches) {
    const innerFns = findInnerFunctionRanges(src, cls, cat.bodyStart, cat.bodyEnd);

    // Collect local declarations in the catch's direct scope.
    const declared = new Set();
    const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    let dm;
    while ((dm = declRe.exec(src)) !== null) {
      if (dm.index < cat.bodyStart || dm.index >= cat.bodyEnd) continue;
      if (inRanges(dm.index, innerFns)) continue;
      if (cls[dm.index] !== 'c') continue;
      declared.add(dm[1]);
    }
    // Destructured locals: `const { a, b: c } = ...` and `const [a, b] = ...`
    const destrObjRe = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
    while ((dm = destrObjRe.exec(src)) !== null) {
      if (dm.index < cat.bodyStart || dm.index >= cat.bodyEnd) continue;
      if (inRanges(dm.index, innerFns)) continue;
      if (cls[dm.index] !== 'c') continue;
      for (const part of dm[1].split(',')) {
        const name = part.split(':').pop().trim().split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }
    const destrArrRe = /\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g;
    while ((dm = destrArrRe.exec(src)) !== null) {
      if (dm.index < cat.bodyStart || dm.index >= cat.bodyEnd) continue;
      if (inRanges(dm.index, innerFns)) continue;
      if (cls[dm.index] !== 'c') continue;
      for (const part of dm[1].split(',')) {
        const name = part.trim().split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }

    // Scan the catch body for stray references in the catch's direct scope.
    const idRe = /\b([A-Za-z_$][\w$]*)\b/g;
    idRe.lastIndex = cat.bodyStart;
    let im;
    while ((im = idRe.exec(src)) !== null) {
      if (im.index >= cat.bodyEnd) break;
      const name = im[1];
      if (!ERROR_NAMES.has(name)) continue;
      if (name === cat.binding) continue;
      if (declared.has(name)) continue;
      if (cls[im.index] !== 'c') continue;
      if (inRanges(im.index, innerFns)) continue;
      // Skip property access: `.error`
      const before = src[im.index - 1];
      if (before === '.' || before === '?') continue;
      // Skip object property keys / type annotations: `error:`
      const restIdx = im.index + name.length;
      let after = restIdx;
      while (after < src.length && (src[after] === ' ' || src[after] === '\t')) after++;
      if (src[after] === ':') continue;
      offenders.push({
        file,
        line: lineOf(src, im.index),
        binding: cat.binding,
        ref: name,
      });
    }
  }
}

if (offenders.length > 0) {
  console.error(`Found ${offenders.length} catch reference(s) not matching the catch binding:`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  catch(${o.binding}) references \`${o.ref}\``);
  }
  console.error('\nFix: use the catch binding name (e.g. rename `error` -> the binding).');
  process.exit(1);
}

console.log(`OK: scanned ${files.length} server file(s); no catch block references a stray error identifier.`);
