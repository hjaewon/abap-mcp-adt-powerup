#!/usr/bin/env node
/**
 * Customer-data tripwire for a PUBLIC repository.
 *
 * Scans either the staged diff (pre-commit) or a commit-message file
 * (commit-msg) for terms listed in ~/.sc4sap/denylist.txt — customer
 * identifiers such as org codes and company names that must never appear
 * in a public repo. The list lives in the home directory only, so the
 * terms themselves are never committed anywhere.
 *
 * Matching is token-bounded: a term surrounded by [A-Za-z0-9] on either
 * side is treated as part of a larger identifier (e.g. a standard SAP
 * name or a \uXXXX escape) and ignored.
 *
 * Exit 0 = clean or no denylist present (warns). Exit 1 = term found.
 * Conscious override: git commit --no-verify.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const denyFile = join(homedir(), '.sc4sap', 'denylist.txt');
if (!existsSync(denyFile)) {
  console.warn(`[denylist] WARNING: ${denyFile} not found — customer-data tripwire inactive`);
  process.exit(0);
}
const terms = readFileSync(denyFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const mode = process.argv[2]; // 'staged' | 'message'
let subject;
let label;
if (mode === 'message') {
  subject = readFileSync(process.argv[3], 'utf8');
  label = 'commit message';
} else {
  // Added lines only — committing a REMOVAL of a term must stay possible.
  subject = execFileSync('git', ['diff', '--cached', '--unified=0'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n');
  label = 'staged changes';
}

const isAlnum = (ch) => !!ch && /[A-Za-z0-9]/.test(ch);
const hits = [];
for (const term of terms) {
  let i = -1;
  while ((i = subject.indexOf(term, i + 1)) !== -1) {
    if (isAlnum(subject[i - 1]) || isAlnum(subject[i + term.length])) continue;
    hits.push(term);
    break;
  }
}

if (hits.length) {
  console.error(`\n[denylist] BLOCKED — customer identifiers found in ${label}:`);
  for (const t of hits) console.error(`   "${t}"`);
  console.error('\nThis repository is PUBLIC. Replace the values with synthetic ones');
  console.error('(see ~/.sc4sap/denylist.txt). Conscious override: --no-verify.\n');
  process.exit(1);
}
process.exit(0);
