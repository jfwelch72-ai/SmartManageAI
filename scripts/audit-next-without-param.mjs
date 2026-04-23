#!/usr/bin/env node
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const candidates = execSync("rg -l 'next\\(error\\)|next\\(err\\)' server/ --glob '!**/__tests__/**'", {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

function findHandlerSig(lines, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const line = lines[j];
    if (!/=>\s*\{?\s*$|function\b[^{]*\{\s*$/.test(line)) continue;
    let sig = line;
    let k = j;
    while (k > 0 && !sig.includes('(')) {
      k--;
      sig = lines[k] + '\n' + sig;
    }
    const m = sig.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::[^=]*?)?\s*(?:=>\s*\{?|\{)\s*$/);
    if (!m) continue;
    const params = m[1];
    if (!/(?:^|[\s,(])_?(?:req|request)\b/i.test(params)) continue;
    return { params, line: j + 1 };
  }
  return null;
}

const offenders = [];
for (const file of candidates) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\/\/.*$/, '');
    if (!/\bnext\((error|err)\)/.test(stripped)) continue;
    const sig = findHandlerSig(lines, i);
    if (!sig) continue;
    if (!/\bnext\b/.test(sig.params)) {
      offenders.push({ file, line: i + 1, sigLine: sig.line, params: sig.params.trim().slice(0, 100) });
    }
  }
}

if (offenders.length > 0) {
  console.error(`Found ${offenders.length} handler(s) calling next(error) without declaring \`next\`:`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  (handler at :${o.sigLine}  params: ${o.params})`);
  }
  console.error('\nFix: add `next: NextFunction` to the handler signature, or handle the error inline with logError + res.status(...).json(...).');
  process.exit(1);
}

console.log('OK: every server handler that calls next(error) declares `next` in its signature.');
