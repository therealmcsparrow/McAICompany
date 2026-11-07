#!/usr/bin/env node
// Usage: node scripts/gate-report.mjs <x.y.z> (contract: docs/contracts/release.md v1.3)
// Prints the Gate Report of one plugin version (contract: docs/contracts/release.md v1.3). Node built-ins only.
// It holds only what the records of the runs of that version show: Gates with result and wait, CEO forms, Fix rounds,
// run time and Step time per Role id. A value that was not recorded reads `not recorded`. Nothing is estimated.
// Runs come from .company/ledger/<run>.jsonl whose last `meta` record names the version; Gates and forms from run-state.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { show } from './run-state.mjs';
import { isWorkFolder } from '../mods/lib/work-folder.mjs';

const MAX_FILES = 500;
const MAX_LEDGER_BYTES = 1024 * 1024;
const EXCLUDED = /^(brainstorm|replay|baseline)-/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROLE = /^(lead|other|[a-z][a-z0-9-]{0,40})$/;
const GATES = new Set(['brief', 'plan', 'ship']);
const RESULTS = new Set(['passed', 'changed', 'stopped']);
export const NONE = 'not recorded';
const MAX_EVAL_BYTES = 256 * 1024;
const MAX_EVAL_LINE = 1024;
const EVAL_FILES = [
  ['plan review eval', ['tests', 'plan-review', 'eval.jsonl']],
  ['code review eval', ['tests', 'code-review', 'eval.jsonl']]
];

function duration(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// The parsed records of a ledger file, or undefined when it is not a bounded plain file.
function readLedger(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return undefined;
  }
  if (!st.isFile() || st.size > MAX_LEDGER_BYTES) return undefined;
  const records = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line);
      if (typeof rec === 'object' && rec !== null && !Array.isArray(rec)) records.push(rec);
    } catch {
      // a damaged line is skipped, never guessed
    }
  }
  return records;
}

const last = (records, kind) => records.findLast((r) => r.kind === kind);

// The runs of `version`, sorted by name: [{ run, ship }].
export function runsOf(root, version) {
  const dir = path.join(root, '.company', 'ledger');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const file of names.filter((n) => n.endsWith('.jsonl')).sort().slice(0, MAX_FILES)) {
    const run = file.slice(0, -6);
    if (!isWorkFolder(run) || EXCLUDED.test(run)) continue;
    const records = readLedger(path.join(dir, file));
    if (!records) continue;
    const meta = last(records, 'meta');
    if (!meta || meta.aico !== version) continue;
    out.push({ run, ship: last(records, 'ship') });
  }
  return out;
}

function runLines({ run, ship }, root) {
  let view = null;
  try {
    view = show(root, run);
  } catch {
    view = null;
  }
  const recorded = view && view.state !== 'none';
  const lines = [`### ${run}`, ''];
  const gates = recorded ? view.gates.filter((g) => GATES.has(g.gate) && RESULTS.has(g.result)) : [];
  if (gates.length === 0) lines.push(`- Gates: ${NONE}`);
  else {
    lines.push('- Gates:');
    for (const g of gates) lines.push(`  - ${g.gate}: ${g.result}, wait ${Number.isSafeInteger(g.wait) ? duration(g.wait) : NONE}`);
  }
  const forms = recorded ? view.ceo.filter((c) => GATES.has(c.gate) && Number.isInteger(c.n)) : [];
  if (forms.length === 0) lines.push(`- CEO forms: ${NONE}`);
  else lines.push(`- CEO forms: ${forms.map((c) => `${c.gate} ${c.n}`).join(', ')}`);
  const fix = ship && Number.isSafeInteger(ship.fix_rounds) && ship.fix_rounds >= 0 ? String(ship.fix_rounds) : NONE;
  lines.push(`- Fix rounds: ${fix}`);
  const timed = ship && TIME.test(ship.t_start ?? '') && TIME.test(ship.t_ship ?? '') && Date.parse(ship.t_ship) >= Date.parse(ship.t_start);
  lines.push(`- Run time: ${timed ? duration((Date.parse(ship.t_ship) - Date.parse(ship.t_start)) / 1000) : NONE}`);
  const byRole = new Map();
  for (const s of recorded ? view.subs : []) {
    if (!Number.isSafeInteger(s.ms) || typeof s.role !== 'string' || !ROLE.test(s.role)) continue;
    byRole.set(s.role, (byRole.get(s.role) ?? 0) + s.ms);
  }
  if (byRole.size === 0) lines.push(`- Step time by Role: ${NONE}`);
  else lines.push(`- Step time by Role: ${[...byRole].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, ms]) => `${r} ${duration(ms / 1000)}`).join(', ')}`);
  lines.push('');
  return lines;
}

const count = (n) => Number.isSafeInteger(n) && n >= 0;

// True when each folder from root down to the file is a plain folder or file, not a link.
function plainPath(root, segments) {
  let at = root;
  for (const [i, seg] of segments.entries()) {
    at = path.join(at, seg);
    const st = fs.lstatSync(at);
    if (st.isSymbolicLink() || (i < segments.length - 1 ? !st.isDirectory() : !st.isFile())) return false;
    if (i === segments.length - 1 && st.size > MAX_EVAL_BYTES) return false;
  }
  return true;
}

// "<label>: <k> of <n> (<date>)" from the last eval record of `version`, else "<label>: not recorded".
// Only checked numbers and a date cut from a checked UTC time are printed. Any trouble reads as not recorded.
function evalLine(root, version, [label, segments]) {
  try {
    if (!plainPath(root, segments)) return `${label}: ${NONE}`;
    let found;
    for (const line of fs.readFileSync(path.join(root, ...segments), 'utf8').split('\n')) {
      if (line.length > MAX_EVAL_LINE) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof rec === 'object' && rec !== null && !Array.isArray(rec) && rec.aico === version) found = rec;
    }
    const ok = found && found.v === 1 && count(found.caught) && count(found.total) && found.caught <= found.total && typeof found.at === 'string' && TIME.test(found.at) && !Number.isNaN(Date.parse(found.at));
    return ok ? `${label}: ${found.caught} of ${found.total} (${found.at.slice(0, 10)})` : `${label}: ${NONE}`;
  } catch {
    return `${label}: ${NONE}`;
  }
}

// The report text for `version`: LF only, Role ids only.
export function gateReport({ root, version }) {
  if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error('version must be plain semver (x.y.z)');
  const runs = runsOf(root, version);
  const lines = [`# Gate Report v${version}`, '', 'Recorded data only. A value that was not recorded reads "not recorded"; nothing is estimated.', ''];
  for (const entry of EVAL_FILES) lines.push(evalLine(root, version, entry));
  lines.push('');
  if (runs.length === 0) lines.push(`Runs: ${NONE} for this version.`, '');
  else {
    lines.push(`Runs: ${runs.length}`, '');
    for (const r of runs) lines.push(...runLines(r, root));
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !SEMVER.test(args[0])) {
    console.error('usage: node scripts/gate-report.mjs <x.y.z>');
    process.exit(1);
  }
  process.stdout.write(gateReport({ root: process.cwd(), version: args[0] }));
}
