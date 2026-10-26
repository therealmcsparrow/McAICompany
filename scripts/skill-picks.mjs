#!/usr/bin/env node
// Lints the `## Recommended set` of a skill-researcher file and, with `vet`, scans each pick itself.
// Usage: node skill-picks.mjs lint .company/work/<slug>/<NN>-skill-researcher.md   (cwd = product repo)
//        node skill-picks.mjs vet  .company/work/<slug>/<NN>-skill-researcher.md --json
// Contract: docs/contracts/skill-recommendation.md. Offending text is never echoed; refusals go to stdout.
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignSkills, parseSkillsSection } from './install-skills.mjs';
import { scanInstalled, settingsMode, vetCandidates } from './skillspector.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const HANDOFF_RE = /^\.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/\d{2}-skill-researcher\.md$/;
const AREA_RE = /^(stack|product-type|company-type|design)$/;
const LINE_RE = /^- area: (stack|product-type|company-type|design); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); why: ([^;]+); approved: pending$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const NONE_LINE = '- (none: no candidate passed vetting and scan)';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 500;
const MAX_ENTRIES = 5;

export class Refused extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readHandoff(arg, cwd) {
  const m = typeof arg === 'string' ? HANDOFF_RE.exec(arg) : null;
  if (!m) throw new Refused('handoff path must be .company/work/<slug>/<NN>-skill-researcher.md');
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

// Returns { field, reason } on failure or { pick } on success.
function checkLine(text, n, area, today, manifest) {
  if (text.length > MAX_LINE_CHARS) return { field: 'line', reason: 'too long' };
  if (CONTROL_RE.test(text)) return { field: 'line', reason: 'control character' };
  const m = LINE_RE.exec(text);
  if (!m) return { field: 'line', reason: 'malformed' };
  const [, lineArea, name, source, license, vetted, commit, why] = m;
  if (lineArea !== area) return { field: 'area', reason: 'differs from the Handoff area' };
  const plugin = source.startsWith('plugin ');
  if (plugin && area !== 'design') return { field: 'source', reason: 'plugin source is design only' };
  const command = source.length >= 3 && source.startsWith('`') && source.endsWith('`');
  const repo = !plugin && !command;
  if (repo ? !COMMIT_RE.test(commit) : commit !== '-') return { field: 'commit', reason: 'invalid' };
  const approved = localDay(today);
  const head = `name: ${name}; source: ${source}; license: ${license}; vetted: ${vetted}`;
  // The record is built here and then parsed by the same parsers the installer uses.
  const record = area === 'design'
    ? `- ${head}; ${repo ? `commit: ${commit}; ` : ''}why: ${why}; approved: ${approved}`
    : `- area: ${area}; ${head}; commit: ${commit}; why: ${why}; approved: ${approved}`;
  try {
    const parsed = area === 'design'
      ? parseDesignSkills(`## Design skills\n${record}`, manifest, today)
      : parseSkillsSection(`## Skills\n${record}`, manifest, today);
    if (parsed.length !== 1) return { field: 'line', reason: 'malformed' };
  } catch (e) {
    const f = /^(?:design skill|skills) line \d+: ([a-z]+) ([a-z ]+)$/.exec(String(e?.message));
    return { field: f ? f[1] : 'line', reason: f ? f[2] : 'malformed' };
  }
  const p = Object.create(null);
  p.n = n; p.kind = plugin ? 'plugin' : command ? 'command' : 'repo'; p.name = name; p.source = source; p.commit = commit; p.record = record;
  return { pick: p };
}

export function lint(arg, today = new Date(), cwd = process.cwd()) {
  const text = readHandoff(arg, cwd);
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const area = frontmatterArea(lines);
  if (!area || !AREA_RE.test(area)) throw new Refused('handoff has no valid area');
  const start = lines.findIndex((l) => l.trimEnd() === '## Recommended set');
  const verdicts = [];
  const picks = [];
  if (start !== -1) {
    const manifest = loadManifest();
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
      const t = lines[i];
      if (t.trim() === '' || t === NONE_LINE) continue;
      const n = i + 1;
      if (verdicts.length >= MAX_ENTRIES) { verdicts.push(verdict(n, false, 'line', 'too many entries')); continue; }
      const r = t.startsWith('- ') ? checkLine(t, n, area, today, manifest) : { field: 'line', reason: 'malformed' };
      if (r.pick) { verdicts.push(verdict(n, true)); picks.push(r.pick); } else verdicts.push(verdict(n, false, r.field, r.reason));
    }
  }
  return { v: 1, area, lines: verdicts, picks };
}

// ---------- vet ----------
const approvableScan = (s) => s.verdict === 'pass'
  || (s.verdict === 'findings' && s.blocking === false && s.counts.critical === 0 && s.counts.high === 0);

const badness = (s) => (s.verdict === 'error' ? 3 : s.verdict === 'findings' ? (s.blocking ? 2 : 1) : 0);

function judge(scan, refused) {
  const out = { scan: scan ?? null, scan_refused: refused ?? null, approvable: false, reject_code: null };
  if (scan) {
    out.approvable = approvableScan(scan);
    if (!out.approvable) out.reject_code = scan.verdict === 'error' ? 'scan-error' : 'scan-findings';
  } else {
    out.reject_code = 'scan-not-possible';
  }
  return out;
}

// A refusal that stops the whole run: nothing is approvable without the scanner or git.
function stopOn(reason) {
  if (reason === 'skillspector missing') throw new Refused(reason, 3);
  if (reason === 'git missing') throw new Refused(reason, 2);
}

export async function vet(arg, { today = new Date(), cwd = process.cwd(), deps = {}, progress = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const base = lint(arg, today, cwd);
  const mode = await (deps.settingsMode ?? settingsMode)();
  const vetRepo = deps.vetCandidates ?? vetCandidates;
  const vetInstalled = deps.scanInstalled ?? scanInstalled;
  // One fetch per distinct (source, commit).
  const groups = new Map();
  for (const p of base.picks) {
    if (p.kind !== 'repo') continue;
    const key = `${p.source}\n${p.commit}`;
    if (!groups.has(key)) groups.set(key, { source: p.source, commit: p.commit, names: [] });
    groups.get(key).names.push(p.name);
  }
  const fetched = new Map();
  for (const [key, g] of groups) {
    const r = await vetRepo({ source: g.source, commit: g.commit, names: g.names, mode }, deps);
    if (r.refused !== undefined) stopOn(r.refused);
    fetched.set(key, r);
  }
  const picks = [];
  let i = 0;
  for (const p of base.picks) {
    let j;
    if (p.kind === 'plugin') {
      j = { scan: null, scan_refused: null, approvable: true, reject_code: null };
    } else if (p.kind === 'command') {
      const r = await vetInstalled({ name: p.name, mode }, deps);
      if (r.refused !== undefined) stopOn(r.refused);
      // Two installed folders can share a name; the worst result decides.
      j = r.refused !== undefined || r.results.length === 0
        ? judge(null, r.refused ?? 'skill not found')
        : judge(r.results.reduce((x, y) => (badness(y) > badness(x) ? y : x)));
    } else {
      const f = fetched.get(`${p.source}\n${p.commit}`);
      if (f.refused !== undefined) j = judge(null, f.refused);
      else {
        const one = f.results[p.name];
        j = one.refused !== undefined ? judge(null, one.refused) : judge(one);
      }
    }
    picks.push({ ...p, ...j });
    progress(`vet: ${++i}/${base.picks.length} ${p.name} ${j.scan ? j.scan.verdict : p.kind === 'plugin' ? 'not-scanned' : 'refused'}`);
  }
  return { v: 1, area: base.area, mode, lines: base.lines, picks };
}

export async function main(args, opts = {}) {
  try {
    let out;
    if (args.length === 2 && args[0] === 'lint') out = lint(args[1], opts.today, opts.cwd);
    else if (args.length === 3 && args[0] === 'vet' && args[2] === '--json') out = await vet(args[1], opts);
    else throw new Refused('usage: lint <handoff> | vet <handoff> --json');
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.log(`refused: ${e.message}`);
    return e.exitCode;
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => {
    process.stderr.write('error: internal\n');
    process.exitCode = 1;
  });
}
