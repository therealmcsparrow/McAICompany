#!/usr/bin/env node
// Lints the `## Recommended set` of a skill-researcher Handoff and prints the lines the Lead may record.
// Usage: node skill-picks.mjs lint .company/work/<slug>/<NN>-skill-researcher.md   (cwd = product repo)
// Contract: docs/contracts/skill-recommendation.md. Read-only; offending text is never echoed.
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignSkills } from './install-skills.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const HANDOFF_RE = /^\.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/\d{2}-skill-researcher\.md$/;
const AREA_RE = /^(stack|product-type|company-type|design)$/;
const LINE_RE = /^- area: (stack|product-type|company-type|design); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); scan: ([^;]+); why: ([^;]+); approved: pending$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SCAN_RE = /^(no-llm|claude_cli|static-fallback) (\d+\.\d+\.\d+|\?)(@[0-9a-f]{7,40})? c0 h0 m(\d{1,4}) l(\d{1,4})$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const NONE_LINE = '- (none: no candidate passed vetting and scan)';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 500;
const MAX_ENTRIES = 5;

class Refused extends Error {}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readHandoff(arg) {
  const m = HANDOFF_RE.exec(arg);
  if (!m) throw new Refused('handoff path must be .company/work/<slug>/<NN>-skill-researcher.md');
  const cwd = process.cwd();
  // No link anywhere on the way, then a regular file within the size cap.
  for (const rel of ['.company', '.company/work', `.company/work/${m[1]}`, arg]) {
    let st;
    try { st = lstatSync(resolve(cwd, rel)); } catch { throw new Refused('handoff not found'); }
    if (st.isSymbolicLink()) throw new Refused('handoff path contains a link');
    if (rel === arg) {
      if (!st.isFile()) throw new Refused('handoff is not a regular file');
      if (st.size > MAX_FILE_BYTES) throw new Refused('handoff too large');
    }
  }
  try { return readFileSync(resolve(cwd, arg), 'utf8'); } catch { throw new Refused('handoff not readable'); }
}

function frontmatterArea(lines) {
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    if (lines[i].startsWith('area: ')) return lines[i].slice(6).trim();
  }
  return null;
}

function loadManifest() {
  try { return JSON.parse(readFileSync(join(ROOT, 'deps', 'skills.json'), 'utf8')); } catch { return {}; }
}

const verdict = (n, ok, field, reason) => {
  const v = Object.create(null);
  v.n = n; v.ok = ok;
  if (field) { v.field = field; v.reason = reason; }
  return v;
};

// Returns { field, reason } on failure or { record } on success.
function checkLine(text, area, today, manifest) {
  if (text.length > MAX_LINE_CHARS) return { field: 'line', reason: 'too long' };
  if (CONTROL_RE.test(text)) return { field: 'line', reason: 'control character' };
  const m = LINE_RE.exec(text);
  if (!m) return { field: 'line', reason: 'malformed' };
  const [, lineArea, name, source, license, vetted, commit, scan, why] = m;
  if (lineArea !== area) return { field: 'area', reason: 'differs from the Handoff area' };
  const plugin = source.startsWith('plugin ');
  if (plugin && area !== 'design') return { field: 'source', reason: 'plugin source is design only' };
  const repo = !plugin && !(source.length >= 3 && source.startsWith('`') && source.endsWith('`'));
  if (repo ? !COMMIT_RE.test(commit) : commit !== '-') return { field: 'commit', reason: 'invalid' };
  if (plugin ? scan !== '-' : !SCAN_RE.test(scan)) return { field: 'scan', reason: 'invalid or has critical or high findings' };
  const approved = localDay(today);
  const v1 = `- name: ${name}; source: ${source}; license: ${license}; vetted: ${vetted}; why: ${why}; approved: ${approved}`;
  try {
    if (parseDesignSkills(`## Design skills\n${v1}`, manifest, today).length !== 1) return { field: 'line', reason: 'malformed' };
  } catch (e) {
    const f = /^design skill line \d+: ([a-z]+) ([a-z ]+)$/.exec(String(e?.message));
    return { field: f ? f[1] : 'line', reason: f ? f[2] : 'malformed' };
  }
  return { record: area === 'design' ? v1 : `- area: ${area}; ${v1.slice(2)}` };
}

export function lint(arg, today = new Date()) {
  const text = readHandoff(arg);
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const area = frontmatterArea(lines);
  if (!area || !AREA_RE.test(area)) throw new Refused('handoff has no valid area');
  const start = lines.findIndex((l) => l.trimEnd() === '## Recommended set');
  const verdicts = [];
  const record = [];
  if (start !== -1) {
    const manifest = loadManifest();
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
      const t = lines[i];
      if (t.trim() === '' || t === NONE_LINE) continue;
      const n = i + 1;
      if (verdicts.length >= MAX_ENTRIES) { verdicts.push(verdict(n, false, 'line', 'too many entries')); continue; }
      const r = t.startsWith('- ') ? checkLine(t, area, today, manifest) : { field: 'line', reason: 'malformed' };
      if (r.record) { verdicts.push(verdict(n, true)); record.push(r.record); } else verdicts.push(verdict(n, false, r.field, r.reason));
    }
  }
  return { v: 1, area, lines: verdicts, record };
}

export function main(args) {
  try {
    if (args.length !== 2 || args[0] !== 'lint') throw new Refused('usage: lint <handoff>');
    console.log(JSON.stringify(lint(args[1])));
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`refused: ${e.message}`);
    return 2;
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  process.exitCode = main(process.argv.slice(2));
}
