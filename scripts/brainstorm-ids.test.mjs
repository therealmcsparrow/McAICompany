import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync as __mkdtemp, rmSync as __rmTree, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { newFile, applyReplies, answerQuestion, inputFor, renderFilm, crossfirePair } from './brainstorm.mjs';
import { checkBrainstorm } from './check.mjs';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SCRIPT = join(here, 'brainstorm.mjs');
const FIX = join(root, 'tests', 'fixtures', 'brainstorm');
const tempDirs = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'aico-ids-')); tempDirs.push(d); return d; };
const home = tmp();

const reply = n => readFileSync(join(FIX, 'replies', n), 'utf8');
const fixture = n => readFileSync(join(FIX, n), 'utf8');
const NOW = new Date(2026, 9, 26, 14, 5);
const ROLES = ['architect', 'writer', 'product-manager'];
const NAMES = { architect: 'Ava (architect)', writer: 'Ren (writer)', 'product-manager': 'Pat (product-manager)' };
const files = { 1: { architect: 'r1-architect.txt', writer: 'r1-writer.txt', 'product-manager': 'r1-pm.txt' }, 2: { architect: 'r2-architect.txt', writer: 'r2-writer.txt', 'product-manager': 'r2-pm.txt' },
  full: { architect: 'r2-full-architect.txt', writer: 'r2-full-writer.txt', 'product-manager': 'r2-full-pm.txt' } };
const bare = k => Object.fromEntries(Object.entries(files[k]).map(([r, f]) => [r, reply(f)]));
const named = k => Object.fromEntries(Object.entries(files[k]).map(([r, f]) => [NAMES[r], reply(f)]));
const refusedWith = (fn, re) => assert.throws(fn, e => e.name === 'Refused' && re.test(e.message), `expected refusal ${re}`);
const errs = (text, re) => checkBrainstorm(text, { file: 'x.md' }).filter(e => re.test(e));
const lines = t => t.split('\n');

const base22 = () => newFile({ topic: 'Settings server', roles: ROLES, mode: 'debate', now: NOW, ids: 'role' });
const base21 = () => newFile({ topic: 'Settings server', roles: ROLES, mode: 'debate', now: NOW });
const r1of = (t, set) => answerQuestion(applyReplies(t, { replies: set(1), lead: 'Local first.' }, { round: 1 }).text, 'Q-1', 'Local, and keep the token.');
const full22 = () => {
  let t = applyReplies(r1of(base22(), bare), { replies: bare(2), lead: '' }, { round: 2, mode: 'debate:full_pass' }).text;
  t = applyReplies(t, { replies: bare('full'), lead: '' }, { round: 2, pass: 'full' }).text;
  return t;
};
const full21 = () => {
  let t = applyReplies(r1of(base21(), named), { replies: named(2), lead: '' }, { round: 2, mode: 'debate:full_pass' }).text;
  t = applyReplies(t, { replies: named('full'), lead: '' }, { round: 2, pass: 'full' }).text;
  return t;
};
const section = (text, label) => {
  const l = lines(text.trimEnd());
  const i = l.indexOf(label);
  if (i < 0) return null;
  let j = i + 1;
  while (j < l.length && !/^[A-Z][A-Za-z -]*( of round \d+)?:$/.test(l[j])) j++;
  return l.slice(i + 1, j);
};
function cli(args, input = '') {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---- new ----
test('new writes ids: role after format; the library default and an unknown value are handled', () => {
  const t = base22();
  assert.match(t, /^---\ntopic: Settings server\nstarted: 2026-10-26 14\.05\nstatus: open\nroles: architect, writer, product-manager\nformat: 2\nids: role\nmode: debate\n---\n/);
  assert.deepEqual(checkBrainstorm(t), []);
  assert.ok(!base21().includes('ids:'));
  refusedWith(() => newFile({ topic: 'x', roles: ROLES, ids: 'name', now: NOW }), /ids/);
});

test('the new command writes ids: role', () => {
  const f = join(tmp(), 'a.md');
  assert.equal(cli(['new', f], JSON.stringify({ topic: 'T', roles: 'architect,writer' })).code, 0);
  assert.match(readFileSync(f, 'utf8'), /\nformat: 2\nids: role\n/);
  assert.equal(cli(['check', f]).code, 0);
});

// ---- apply on an ids: role file ----
test('apply with bare Role ids writes bare headings, Dissent and Threads', () => {
  let t = applyReplies(r1of(base22(), bare), { replies: bare(2), lead: '', dissent: [{ role: 'architect', quote: 'Loopback-only blocks remote-desktop users.' }] }, { round: 2, mode: 'debate:full_pass' }).text;
  t = applyReplies(t, { replies: bare('full'), lead: 'x' }, { round: 2, pass: 'full' }).text;
  assert.deepEqual(checkBrainstorm(t), []);
  for (const h of ['#### architect', '#### writer', '#### product-manager', '#### architect — full pass', '#### writer — full pass']) assert.ok(lines(t).includes(h), h);
  assert.ok(lines(t).includes('- architect — "Loopback-only blocks remote-desktop users." — src: R2'));
  assert.ok(lines(t).some(l => /^- I-1\.\d+ ← architect challenge: ".*" — src: R2$/.test(l)), 'Threads line');
  assert.ok(!/\(architect\)|\(writer\)|Ava|Ren|Pat/.test(t));
});

test('apply on a crossfire pair writes "#### <role> — crossfire"', () => {
  let t = applyReplies(r1of(base22(), bare), { replies: bare(2), lead: '' }, { round: 2, mode: 'debate:full_pass' }).text;
  t = applyReplies(t, { replies: bare('full'), lead: '' }, { round: 2, pass: 'full' }).text;
  const pair = crossfirePair(t, 2);
  assert.ok(pair, 'a pair');
  const cross = Object.fromEntries(pair.map(r => [r, reply(r === 'architect' ? 'r2-cross-architect.txt' : 'r2-cross-writer.txt')]));
  const out = applyReplies(t, { replies: cross, lead: '' }, { round: 2, pass: 'crossfire' }).text;
  assert.deepEqual(checkBrainstorm(out), []);
  for (const r of pair) assert.ok(lines(out).includes(`#### ${r} — crossfire`), r);
});

test('apply on an ids: role file refuses a named key, a named dissent role, and a Role named before a slug in lead or open_threads', () => {
  const t = r1of(base22(), bare);
  refusedWith(() => applyReplies(t, { replies: { 'Ava (architect)': reply('r2-architect.txt') }, lead: '' }, { round: 2 }), /names are not stored in this file; use the Role id/);
  refusedWith(() => applyReplies(t, { replies: bare(2), lead: '', dissent: [{ role: 'Ava (architect)', quote: 'q' }] }, { round: 2 }), /names are not stored in this file; use the Role id/);
  refusedWith(() => applyReplies(t, { replies: {}, lead: 'Rui (architect) is right. Open: none' }, { round: 2 }), /lead names a Role as "<word> \(<role>\)"; write the Role id/);
  refusedWith(() => applyReplies(t, { replies: {}, lead: 'ok. Open: none', open_threads: [{ text: 'Ask Erik (writer) first', ideas: [] }] }, { round: 2 }), /lead names a Role as/);
  refusedWith(() => applyReplies(t, { replies: bare(2), lead: 'fine (product-manager) too' }, { round: 2 }), /lead names a Role as/);
  assert.doesNotThrow(() => applyReplies(t, { replies: {}, lead: 'architect and writer agree (see Q-2). Open: Q-2' }, { round: 2 }));
  assert.doesNotThrow(() => applyReplies(t, { replies: {}, lead: '(architect) first; Open: Q-2' }, { round: 2 }), 'no word before the parenthesis');
  assert.doesNotThrow(() => applyReplies(t, { replies: {}, lead: 'Open: Q-2. A note (see docs) is fine' }, { round: 2 }));
});

test('apply on an ids: role file refuses a Role outside the roster and a bad key', () => {
  const t = r1of(base22(), bare);
  refusedWith(() => applyReplies(t, { replies: { nobody: 'Skip' }, lead: '' }, { round: 2 }), /nobody is not in the roster/);
  refusedWith(() => applyReplies(t, { replies: { 'Architect': 'Skip' }, lead: '' }, { round: 2 }), /reply key/);
  refusedWith(() => applyReplies(t, { replies: { 'architect (architect)': 'Skip' }, lead: '' }, { round: 2 }), /names are not stored/);
});

test('the refusal leaves the file unchanged on the CLI', () => {
  const f = join(tmp(), 'a.md');
  cli(['new', f], JSON.stringify({ topic: 'T', roles: 'architect,writer' }));
  const before = readFileSync(f, 'utf8');
  const r = cli(['apply', f, '1'], JSON.stringify({ replies: { 'Ava (architect)': reply('r1-architect.txt') }, lead: 'x' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /^refused: names are not stored in this file; use the Role id/);
  assert.equal(readFileSync(f, 'utf8'), before);
  const ok = cli(['apply', f, '1'], JSON.stringify({ replies: { architect: reply('r1-architect.txt') }, lead: 'Local first.' }));
  assert.equal(ok.code, 0, ok.err);
  assert.ok(readFileSync(f, 'utf8').includes('\n#### architect\n'));
});

test('a reopened v2.1 file keeps the "#### Name (role)" shape on apply', () => {
  const t = applyReplies(r1of(base21(), named), { replies: { architect: reply('r2-architect.txt'), 'Ren (writer)': reply('r2-writer.txt') }, lead: '' }, { round: 2 }).text;
  assert.deepEqual(checkBrainstorm(t), []);
  assert.ok(lines(t).filter(l => /^#### /.test(l)).every(l => /^#### \S+ \([a-z-]+\)$/.test(l)));
  assert.ok(!t.includes('ids:'));
});

// ---- the checker ----
test('the v2.2 fixture passes and every older fixture still passes', () => {
  assert.deepEqual(checkBrainstorm(fixture('v22-ids-role.md'), { file: 'v22.md' }), []);
  for (const n of ['v1-built.md', 'v1-open.md', 'v1-summary-only.md', 'v2-crossfire.md', 'v2-full-pass.md']) assert.deepEqual(checkBrainstorm(fixture(n), { file: n }), [], n);
  assert.deepEqual(checkBrainstorm(fixture('v22-ids-role.md').replace(/\n/g, '\r\n')), []);
});

test('checkBrainstorm: ids with another value is unknown ids value', () => {
  for (const v of ['name', 'Role', 'role ', 'roles', '']) {
    const t = fixture('v22-ids-role.md').replace('ids: role\n', `ids: ${v}\n`);
    assert.ok(errs(t, /unknown ids value/).length, JSON.stringify(v));
  }
});

test('checkBrainstorm: a named reply heading in an ids: role file is rule 8', () => {
  for (const h of ['#### Ava (architect)', '#### architect (architect)', '#### architect extra', '#### architect — fullpass', '#### architect — full pass extra', '####  architect', '#### Architect', '#### stranger']) {
    const t = fixture('v22-ids-role.md').replace('#### architect\n', `${h}\n`);
    const e = errs(t, /rule 8:/);
    assert.ok(e.length, h);
    assert.match(e[0], /^ERROR x\.md: rule 8:/);
  }
});

test('checkBrainstorm: a named Dissent line is rule 6 and a named Threads line is rule 5', () => {
  const f = fixture('v22-ids-role.md');
  for (const d of ['- Ava (architect) — "A theme switch touches every component, so it is not small."', '- architect (architect) — "A theme switch touches every component, so it is not small."', '- stranger — "x"', '- architect "A theme switch touches every component, so it is not small."']) {
    const t = f.replace('- architect — "A theme switch touches every component, so it is not small."', d);
    assert.ok(errs(t, /rule 6:/).length, d);
  }
  for (const d of ['- I-1.2 ← Ren (writer) challenge: "Copy must survive both themes."', '- I-1.2 ← writer (writer) challenge: "Copy must survive both themes."', '- I-1.2 ← stranger challenge: "x"', '- I-1.2 ← writer "Copy must survive both themes."']) {
    const t = f.replace('- I-1.2 ← writer challenge: "Copy must survive both themes."', d);
    assert.ok(errs(t, /rule 5:/).length, d);
  }
});

test('checkBrainstorm: without ids the v2.1 named rules hold unchanged', () => {
  const v = fixture('v2-crossfire.md');
  assert.deepEqual(checkBrainstorm(v), []);
  assert.ok(errs(v.replace('#### Ava (architect)\nIdea: CSS', '#### architect\nIdea: CSS'), /rule 8:/).length, 'a bare heading is malformed in a v2.1 file');
  assert.ok(errs(v.replace('- Ava (architect) — "A theme', '- architect — "A theme'), /rule 6:/).length);
});

// ---- round input ----
const NAME_WORDS = /\b(?:Ava|Ren|Pat)\b/;
const stamp = t => t.replace('(written at close)', "Ava's shadow-mode, Ren (writer) says no, Pat (product-manager) or Avalon. Ava-based.");

test('inputFor on a v2.1 file with names: no stored name in any pass, headings are role ids', () => {
  const t = stamp(full21());
  const asked = t;
  for (const [role, opts] of [['architect', { round: 2, pass: 'full' }], ['writer', { round: 2, pass: 'full' }]]) {
    const p = inputFor(asked, role, opts);
    assert.ok(!NAME_WORDS.test(p), p);
  }
  const p = inputFor(asked, 'writer', { round: 2, pass: 'full' });
  const others = section(p, 'Other Roles:');
  assert.ok(others.includes('#### architect') && others.includes('#### product-manager'), others.join('|'));
  assert.ok(!others.some(l => /\(/.test(l) && l.startsWith('####')));
});

test('inputFor: the scrub turns a stored name into its Role id, whole word, incl. the Summary', () => {
  const p = inputFor(stamp(full21()), 'writer', { round: 2, pass: 'full' });
  const sum = section(p, 'Summary:');
  assert.deepEqual(sum, ["> architect's shadow-mode, writer says no, product-manager or Avalon. architect-based."]);
});

test('inputFor: a v2.2 file renders the same headings and holds no name (ideas, full, crossfire, re-ask)', () => {
  const t = full22();
  const full = inputFor(t, 'writer', { round: 2, pass: 'full' });
  const other = section(full, 'Other Roles:');
  assert.ok(other.includes('#### architect') && other.includes('#### product-manager'), other.join('|'));
  const cross = inputFor(t, 'architect', { round: 2, pass: 'crossfire' });
  assert.ok(cross.includes('#### architect\n') && cross.includes('#### architect — full pass\n'), cross);
  assert.ok(cross.includes('Opponent:\n#### writer\n') && cross.includes('#### writer — full pass\n'), cross);
  const ideas = inputFor(applyReplies(r1of(base22(), bare), { replies: {}, lead: 'x' }, { round: 2 }).text, 'writer', { round: 3 });
  assert.ok(ideas.includes('Others said:'));
  const bad = applyReplies(r1of(base22(), bare), { replies: { writer: 'I: A.\nI: A.\nI: A.\nI: A.\nRisk: r' }, lead: '' }, { round: 2 }).text;
  assert.ok(inputFor(bad, 'writer', { round: 2, reask: true }).includes('Re-ask:'));
  for (const p of [full, cross, ideas]) assert.ok(!/\b(?:Ava|Ren|Pat)\b|#### [A-Z]/.test(p));
});

test('inputFor: a v2.1 crossfire input shows role headings and the pair only', () => {
  const c = inputFor(full21(), 'writer', { round: 2, pass: 'crossfire' });
  assert.ok(c.includes('Your replies of round 2:\n#### writer\n') && c.includes('#### writer — full pass\n'));
  assert.ok(c.includes('Opponent:\n#### architect\n') && c.includes('#### architect — full pass\n'));
  assert.ok(!NAME_WORDS.test(c));
});

test('inputFor: a name used inside a longer word stays; hostile names are matched as plain text', () => {
  const t = stamp(full21()).replace('(written at close)', 'x');
  assert.ok(inputFor(t, 'writer', { round: 2, pass: 'full' }).includes('Avalon'));
});

// ---- film ----
test('film of an ids: role file writes "<role>: <line>"', () => {
  const film = renderFilm(full22(), { source: 'f.md' });
  assert.deepEqual(checkBrainstorm(film), []);
  const speech = lines(film).filter(l => /^[a-z-]+: /.test(l));
  assert.ok(speech.some(l => l.startsWith('architect: ')) && speech.some(l => l.startsWith('writer: ')));
  assert.ok(!/\b(?:Ava|Ren|Pat)\b/.test(film));
});

// ---- docs ----
test('the apply key examples in SKILL.md and format-2.md are bare Role ids', () => {
  for (const f of ['skills/brainstorm/SKILL.md', 'skills/brainstorm/references/format-2.md']) {
    const t = readFileSync(join(root, f), 'utf8');
    assert.ok(!/"Name \(role\)"|Name \(role\)/.test(t), f);
    assert.ok(!/§1\.7/.test(t.split('\n').filter(l => /apply/.test(l)).join('\n')), `${f}: apply lines do not send a Name`);
  }
  assert.match(readFileSync(join(root, 'skills/brainstorm/references/format-2.md'), 'utf8'), /"replies": \{ "<role>":/);
});

test('the contract file is v2.2 with the ids rule', () => {
  const c = readFileSync(join(root, 'docs/contracts/brainstorm-file.md'), 'utf8');
  assert.match(c, /v2\.2/);
  assert.match(c, /ids: role/);
  assert.match(c, /unknown ids value/);
  assert.ok(!c.includes('\r'));
});

test('this test file and the fixture are LF only', () => {
  assert.ok(!readFileSync(fileURLToPath(import.meta.url), 'utf8').includes('\r'));
  assert.ok(!fixture('v22-ids-role.md').includes('\r'));
});
