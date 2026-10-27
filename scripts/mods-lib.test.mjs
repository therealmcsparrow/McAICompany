import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_STDOUT, MODS_DEFAULTS, trimEol, cleanText, parseJson, str, int, bool, oneOf, arr, obj, opt, rec, pattern,
  interpretRun, guardSettings, guardRunActive, guardReviewDepth
} from '../mods/lib/guard.mjs';
import { composeStatus, IDLE, STATUS_CAPS, STATUS_MAX } from '../mods/lib/status.mjs';
import { readyText } from '../mods/lib/ready.mjs';
import { commitIntent } from '../mods/lib/git-commit.mjs';
import { cut, cellWidth, fit, fmtInt, fmtCompact, fmtPct, fmtDuration, fmtMinutes, fmtClock, colorEnabled } from '../mods/lib/format.mjs';
import {
  MAIN_LIFETIME_MS, SUBAGENT_LIFETIME_MS, LIFETIME_LABEL, SUBAGENT_LINE, EMPTY_CLOCK, noteRequest, cacheClock, clockLines, clockStatus, wrap
} from '../mods/lib/cache-clock.mjs';
import { MODS_DEFAULTS as SETTINGS_DEFAULTS } from './settings.mjs';
import { progressRows } from '../mods/lib/bars.mjs';
import {
  SPAWN_SCAN, cleanPath, isWindowsRoot, isReprompter, parseOutputLine, checkSpawn, allowsTool, remember, refusalReason, refusalToast, guardArmed
} from '../mods/lib/reprompt-gate.mjs';

// ---- guard.mjs: hostile input first

test('trimEol removes trailing CR and LF only', () => {
  assert.equal(trimEol('{"a":1}\r\n'), '{"a":1}');
  assert.equal(trimEol('x\n\n\r\n'), 'x');
  assert.equal(trimEol(' x \r\n'), ' x ');
  assert.equal(trimEol(42), '');
});

test('cleanText replaces control and bidi characters and cuts to length', () => {
  assert.equal(cleanText('a\u0000b\u001bc\u202ed\u2066e', 40), 'a b c d e');
  assert.equal(cleanText('line\r\nbreak\t!', 40), 'line  break !');
  assert.equal(cleanText('abcdefghij', 5), 'abcd…');
  assert.equal(cleanText('abc', 5), 'abc');
  assert.equal(cleanText(7, 5), undefined);
  assert.equal(cleanText({}, 5), undefined);
});

test('cleanText bounds a 10 MiB string', () => {
  const big = 'x'.repeat(10 * 1024 * 1024);
  const t0 = Date.now();
  const out = cleanText(big, 40);
  assert.equal(out.length, 40);
  assert.ok(Date.now() - t0 < 500);
});

test('parseJson refuses oversize, bad JSON and non-strings', () => {
  assert.deepEqual(parseJson('x'.repeat(MAX_STDOUT + 1)), { ok: false, reason: 'oversize' });
  assert.deepEqual(parseJson('{bad'), { ok: false, reason: 'json' });
  assert.deepEqual(parseJson(''), { ok: false, reason: 'json' });
  assert.deepEqual(parseJson(undefined), { ok: false, reason: 'json' });
  assert.equal(parseJson('{"a":1}').ok, true);
});

test('parseJson drops __proto__, constructor and prototype keys and returns null-prototype objects', () => {
  const r = parseJson('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":2,"a":{"__proto__":1,"b":2}}');
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.value), null);
  assert.deepEqual(Object.keys(r.value), ['a']);
  assert.equal(Object.getPrototypeOf(r.value.a), null);
  assert.deepEqual(Object.keys(r.value.a), ['b']);
  assert.equal({}.polluted, undefined);
});

test('parseJson bounds nesting depth', () => {
  const deep = '['.repeat(100) + ']'.repeat(100);
  assert.deepEqual(parseJson(deep), { ok: false, reason: 'json' });
});

test('combinators: str, int, bool, oneOf, pattern', () => {
  assert.equal(str(3)('abcdef'), 'ab…');
  assert.equal(str(3)(1), undefined);
  assert.equal(int(1, 9)(5), 5);
  assert.equal(int(1, 9)(10), undefined);
  assert.equal(int(1, 9)(1.5), undefined);
  assert.equal(int(0, 9)('3'), undefined);
  assert.equal(int(0, 9)(NaN), undefined);
  assert.equal(bool(true), true);
  assert.equal(bool('true'), undefined);
  assert.equal(oneOf(['a', 'b'])('a'), 'a');
  assert.equal(oneOf(['a', 'b'])('toString'), undefined);
  assert.equal(pattern(/^\d{2}$/)('07'), '07');
  assert.equal(pattern(/^\d{2}$/)('07\n'), undefined);
  assert.equal(pattern(/^\d{2}$/)(7), undefined);
});

test('obj keeps known keys only and rejects wrong types', () => {
  const g = obj({ a: int(0, 9), b: opt(str(5)) });
  const v = g(JSON.parse('{"a":1,"extra":2,"__proto__":{"x":1}}'));
  assert.deepEqual({ ...v }, { a: 1, b: null });
  assert.equal(Object.getPrototypeOf(v), null);
  assert.equal(g({ a: 'x' }), undefined);
  assert.equal(g({ b: 'x' }), undefined);
  assert.equal(g([1]), undefined);
  assert.equal(g(null), undefined);
  assert.equal(g({ a: 1, b: 5 }), undefined);
});

test('obj does not read inherited keys', () => {
  const g = obj({ a: int(0, 9) });
  const child = Object.create({ a: 1 });
  assert.equal(g(child), undefined);
});

test('arr bounds length and can skip invalid items', () => {
  assert.equal(arr(int(0, 9), 2)([1, 2, 3]), undefined);
  assert.deepEqual(arr(int(0, 9), 5)([1, 'x']), undefined);
  assert.deepEqual(arr(int(0, 9), 5, true)([1, 'x', 2]), [1, 2]);
  assert.equal(arr(int(0, 9), 5)('no'), undefined);
});

test('rec checks key pattern and count', () => {
  const g = rec(/^[a-z]{1,5}$/, int(0, 9), 2);
  assert.deepEqual({ ...g({ ab: 1 }) }, { ab: 1 });
  assert.equal(g({ 'A!': 1 }), undefined);
  assert.equal(g({ a: 1, b: 2, c: 3 }), undefined);
  assert.equal(g({ ab: 'x' }), undefined);
});

test('interpretRun maps every failure to a reason and trims CRLF', () => {
  const g = obj({ a: int(0, 9) });
  const ok = interpretRun({ exitCode: 0, stdout: '{"a":3}\r\n' }, g);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.a, 3);
  assert.equal(interpretRun({ exitCode: 2, stdout: '{"a":3}' }, g).reason, 'exit');
  assert.equal(interpretRun({ exitCode: 0, stdout: 'x'.repeat(MAX_STDOUT + 1) }, g).reason, 'oversize');
  assert.equal(interpretRun({ exitCode: 0, stdout: '{"a":3}', isStdoutTruncated: true }, g).reason, 'oversize');
  assert.equal(interpretRun({ exitCode: 0, stdout: 'nope' }, g).reason, 'json');
  assert.equal(interpretRun({ exitCode: 0, stdout: '{"a":99}' }, g).reason, 'guard');
  assert.equal(interpretRun(undefined, g).reason, 'exit');
  assert.equal(interpretRun(null, g).reason, 'exit');
  assert.equal(interpretRun({ exitCode: 0 }, g).reason, 'json');
});

test('MODS_DEFAULTS equal the settings script defaults', () => {
  assert.deepEqual(MODS_DEFAULTS, SETTINGS_DEFAULTS);
});

test('guardSettings keeps the mods block and role names, drops the rest', () => {
  const text = JSON.stringify({
    revision: 3,
    roles: { architect: { name: 'Ava', model: 'opus' }, 'frontend-engineer': { name: 'Freya' } },
    mods: structuredClone(MODS_DEFAULTS),
    secrets: { token: 'x' }
  });
  const r = interpretRun({ exitCode: 0, stdout: text + '\r\n' }, guardSettings);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.value.mods.blast_radius }, MODS_DEFAULTS.blast_radius);
  assert.equal(r.value.roles['frontend-engineer'].name, 'Freya');
  assert.equal(r.value.secrets, undefined);
  assert.equal(r.value.roles.architect.model, undefined);
});

test('guardSettings refuses a bad mode, a missing mod and a hostile role key', () => {
  const bad = structuredClone(MODS_DEFAULTS);
  bad.reflect.mode = 'rm -rf';
  assert.equal(guardSettings({ roles: {}, mods: bad }), undefined);
  const missing = structuredClone(MODS_DEFAULTS);
  delete missing.savvy;
  assert.equal(guardSettings({ roles: {}, mods: missing }), undefined);
  assert.equal(guardSettings(JSON.parse('{"roles":{"__proto__":{"name":"x"}},"mods":' + JSON.stringify(MODS_DEFAULTS) + '}')), undefined);
  assert.equal(guardSettings({ roles: { 'a b': { name: 'x' } }, mods: MODS_DEFAULTS }), undefined);
});

const VIEW = {
  v: 1, slug: 'x', state: 'running', started: '2026-10-26T10:00:00Z', ended: null, outcome: null, wave: 2,
  gates: [{ gate: 'brief', result: 'passed', at: '2026-10-26T10:01:00Z' }], round: 1, tier: 'high',
  steps: [{ step: '05', role: 'backend-engineer', status: 'done', round: 0, file: '05-backend-engineer.md', mtime: '2026-10-26T10:05:00Z' }],
  warnings: ['line 7 skipped']
};

test('guardRunActive accepts the run view and the empty answer', () => {
  const some = guardRunActive({ slug: 'x', view: VIEW });
  assert.equal(some.view.wave, 2);
  assert.equal(some.view.steps[0].role, 'backend-engineer');
  assert.deepEqual({ ...guardRunActive({ slug: null, view: null }) }, { slug: null, view: null });
});

test('guardRunActive refuses hostile values', () => {
  assert.equal(guardRunActive({ slug: '../x', view: null }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, state: 'weird' } }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, started: 'yesterday' } }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, wave: 100 } }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, steps: [{ ...VIEW.steps[0], file: '../../etc/passwd' }] } }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, steps: [{ ...VIEW.steps[0], role: 'A\u001b[31m' }] } }), undefined);
  assert.equal(guardRunActive('x'), undefined);
});

test('guardRunActive accepts a run without a wave yet', () => {
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, wave: null, steps: [], gates: [] } }).view.wave, null);
});

const DEPTH = {
  v: 1, source: 'staged', base: null, tier: 'unknown', depth: 'full',
  paths: [{ path: 'docs/contracts/x.md', categories: ['contract'], module: null }, { path: 'hooks/a.tsx', categories: ['security', 'core'], module: 'mods' }],
  reasons: [{ path: 'hooks/a.tsx', rule: 'security path' }], truncated: false
};

test('guardReviewDepth keeps tier, depth and paths exactly', () => {
  const v = guardReviewDepth(DEPTH);
  assert.equal(v.tier, 'unknown');
  assert.equal(v.depth, 'full');
  assert.deepEqual([...v.paths[1].categories], ['security', 'core']);
  assert.equal(v.paths[1].module, 'mods');
  assert.equal(v.truncated, false);
});

test('guardReviewDepth ignores unknown categories and refuses a bad depth or tier', () => {
  const odd = { ...DEPTH, paths: [{ path: 'a', categories: ['other', 'core'], module: null }] };
  assert.deepEqual([...guardReviewDepth(odd).paths[0].categories], ['core']);
  assert.equal(guardReviewDepth({ ...DEPTH, depth: 'deep' }), undefined);
  assert.equal(guardReviewDepth({ ...DEPTH, tier: 'extreme' }), undefined);
  assert.equal(guardReviewDepth({ ...DEPTH, paths: 'x' }), undefined);
  assert.equal(guardReviewDepth({ ...DEPTH, paths: new Array(501).fill(DEPTH.paths[0]) }), undefined);
});

// ---- status.mjs

test('composeStatus ignores prototype keys, unknown keys and non-string values', () => {
  const hostile = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","extra":"e","savvy":7,"blast":["b"],"cost":{"a":1},"reflect":null}');
  assert.equal(composeStatus(hostile), undefined);
  const mixed = JSON.parse('{"__proto__":"x","constructor":"y","unknown":"u","cost":"spend 1"}');
  assert.equal(composeStatus(mixed), 'spend 1');
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal({}.x, undefined);
});

test('composeStatus cuts a 10 MiB part to its cap', () => {
  const line = composeStatus({ savvy: 'x'.repeat(10 * 1024 * 1024) });
  assert.equal(cellWidth(line), STATUS_CAPS.savvy);
  assert.ok(line.endsWith('…'));
});

test('composeStatus makes CR, LF, tab and ESC one clean line', () => {
  const line = composeStatus({ savvy: 'a\r\nb\tc\u001b[31md' });
  assert.ok(!/[\r\n\t\u001b]/.test(line));
  assert.ok(line.startsWith('a b c'));
});

test('composeStatus cuts a CJK part to its cell cap', () => {
  const line = composeStatus({ blast: '漢'.repeat(30) });
  assert.ok(cellWidth(line) <= STATUS_CAPS.blast);
  assert.ok(line.endsWith('…'));
});

test('composeStatus joins parts in order savvy, blast, cost, reflect', () => {
  assert.equal(composeStatus({ reflect: '2 lessons', cost: '5 tax', blast: '⚠ core', savvy: 'W1 S01' }),
    'W1 S01 · ⚠ core · 5 tax · 2 lessons');
});

test('composeStatus returns undefined when there is nothing to say', () => {
  assert.equal(composeStatus({}), undefined);
  assert.equal(composeStatus({ savvy: '', cost: '   ', blast: null, reflect: undefined }), undefined);
  assert.equal(composeStatus(undefined), undefined);
  assert.equal(composeStatus(null), undefined);
  assert.equal(composeStatus('x'), undefined);
});

test('STATUS_CAPS add up so the whole line stays on 70 cells, so the host prefix of 8 leaves 2 spare', () => {
  const sum = Object.values(STATUS_CAPS).reduce((a, b) => a + b, 0);
  assert.equal(STATUS_MAX, 70);
  assert.deepEqual(STATUS_CAPS, { savvy: 22, blast: 12, cost: 17, reflect: 10 });
  assert.ok(sum + 3 * 3 <= STATUS_MAX);
});

test('composeStatus with all four parts at their cap is at most 70 cells and keeps every part', () => {
  const line = composeStatus({ savvy: 's'.repeat(200), blast: 'b'.repeat(200), cost: 'c'.repeat(200), reflect: 'r'.repeat(200) });
  assert.ok(cellWidth(line) <= 70);
  assert.equal(line.split(' · ').length, 4);
  const wide = composeStatus({ savvy: '漢'.repeat(200), blast: '漢'.repeat(200), cost: '漢'.repeat(200), reflect: '漢'.repeat(200) });
  assert.ok(cellWidth(wide) <= 70);
  assert.ok(8 + cellWidth(wide) <= 78);
  assert.equal(wide.split(' · ').length, 4);
  const real = composeStatus({ savvy: 'W3 S12 be-eng 14m', blast: '⚠ security', cost: '9007.2P tax 120m', reflect: '20 lessons' });
  assert.equal(real, 'W3 S12 be-eng 14m · ⚠ security · 9007.2P tax 120m · 20 lessons');
  assert.ok(cellWidth(real) <= 70);
});

test('composeStatus with a small max drops reflect, cost, blast, then cuts savvy', () => {
  const parts = { savvy: 's'.repeat(20), blast: 'b'.repeat(8), cost: 'c'.repeat(15), reflect: 'r'.repeat(8) };
  const l1 = composeStatus(parts, { max: 55 });
  assert.ok(cellWidth(l1) <= 55 && !l1.includes('r'.repeat(8)) && l1.includes('c'.repeat(15)));
  const l2 = composeStatus(parts, { max: 40 });
  assert.ok(cellWidth(l2) <= 40);
  assert.ok(!l2.includes('r'.repeat(8)) && !l2.includes('c'.repeat(15)) && l2.includes('b'.repeat(8)));
  const l3 = composeStatus(parts, { max: 15 });
  assert.ok(cellWidth(l3) <= 15);
  assert.ok(l3.endsWith('…') && !l3.includes('b'));
});

test('composeStatus with idle shows `aico idle` in the first slot when no run part is there', () => {
  assert.equal(IDLE, 'aico idle');
  assert.equal(composeStatus({}, { idle: true }), 'aico idle');
  assert.equal(composeStatus({ savvy: '', cost: '   ' }, { idle: true }), 'aico idle');
  assert.equal(composeStatus(undefined, { idle: true }), 'aico idle');
  assert.equal(composeStatus({ cost: '5 tax', blast: '⚠ core' }, { idle: true }), 'aico idle · ⚠ core · 5 tax');
  assert.equal(composeStatus({}), undefined);
  assert.equal(composeStatus({}, { idle: false }), undefined);
});

test('composeStatus with idle gives way to the Savvy part and keeps the 70 cell budget', () => {
  assert.equal(composeStatus({ savvy: 'W3 S12 be-eng 14m', cost: '5 tax' }, { idle: true }), 'W3 S12 be-eng 14m · 5 tax');
  assert.equal(composeStatus({ savvy: 'ended ok 14m' }, { idle: true }), 'ended ok 14m');
  const all = composeStatus({ blast: 'b'.repeat(200), cost: 'c'.repeat(200), reflect: 'r'.repeat(200) }, { idle: true });
  assert.ok(cellWidth(all) <= STATUS_MAX);
  assert.equal(all.split(' · ').length, 4);
  assert.ok(all.startsWith('aico idle · '));
  assert.ok(cellWidth(composeStatus({}, { idle: true })) <= STATUS_CAPS.savvy);
  const small = composeStatus({ blast: 'b'.repeat(8), cost: 'c'.repeat(15), reflect: 'r'.repeat(8) }, { idle: true, max: 15 });
  assert.ok(cellWidth(small) <= 15);
});

test('composeStatus with idle ignores hostile parts and a hostile option', () => {
  const hostile = JSON.parse('{"__proto__":"x","savvy":7,"blast":["b"],"cost":{"a":1}}');
  assert.equal(composeStatus(hostile, { idle: true }), 'aico idle');
  assert.equal(composeStatus({}, { idle: 'yes' }), undefined);
});

test('readyText lists the mods that are on, in a fixed order', () => {
  const on = (enabled) => ({ enabled });
  assert.equal(readyText({ savvy: on(true), cache_tax: on(true), reflect: on(true), blast_radius: on(true) }, true),
    'aico mods ready: Savvy, Cache Tax, Reflect, Blast Radius');
  assert.equal(readyText({ savvy: on(false), cache_tax: on(true), reflect: on(false), blast_radius: on(true) }, true),
    'aico mods ready: Cache Tax, Blast Radius');
  assert.equal(readyText({ savvy: on(false) }, true), 'aico mods ready: none on');
});

test('readyText says when the settings are unknown and survives hostile input', () => {
  assert.equal(readyText({ savvy: { enabled: true } }, false), 'aico mods ready (settings unknown): Savvy');
  for (const bad of [null, undefined, 'x', 7]) assert.equal(readyText(bad, true), 'aico mods ready');
  const hostile = JSON.parse('{"__proto__":{"enabled":true},"savvy":"yes","reflect":{"enabled":"true"},"blast_radius":null}');
  assert.equal(readyText(hostile, true), 'aico mods ready: none on');
  assert.ok(readyText({ savvy: { enabled: true } }, true).length <= 80);
});

test('fmtCompact shortens a count to at most 7 cells', () => {
  const cases = [[0, '0'], [999, '999'], [1000, '1k'], [12400, '12.4k'], [99999, '100k'], [123456, '123k'], [98765572, '98.8M'], [2e9, '2G']];
  for (const [n, out] of cases) assert.equal(fmtCompact(n), out);
  assert.ok(cellWidth(fmtCompact(Number.MAX_SAFE_INTEGER)) <= 7);
  for (const bad of [-1, NaN, Infinity, 1.5, 'x', undefined, null]) assert.equal(fmtCompact(bad), '?');
});

test('fmtMinutes prints whole minutes and hours', () => {
  assert.equal(fmtMinutes(0), '0m');
  assert.equal(fmtMinutes(59999), '0m');
  assert.equal(fmtMinutes(12 * 60000 + 59000), '12m');
  assert.equal(fmtMinutes(65 * 60000), '1h05m');
  for (const bad of [-1, NaN, Infinity, 'x', undefined]) assert.equal(fmtMinutes(bad), '?');
});

test('only mods/shared/status.ts calls $.ui.status', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test' && entry.name !== 'node_modules') walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name) && relative(root, full).split(sep).join('/') !== 'mods/shared/status.ts') {
        if (/\bui\.status\s*\(/.test(readFileSync(full, 'utf8'))) found.push(relative(root, full));
      }
    }
  };
  for (const top of ['hooks', 'mods']) if (existsSync(join(root, top))) walk(join(root, top));
  assert.deepEqual(found, []);
  assert.match(readFileSync(join(root, 'mods/shared/status.ts'), 'utf8'), /\bui\.status\s*\(/);
});

// ---- git-commit.mjs

const BASH = (c) => commitIntent(c, 'bash');
const PS = (c) => commitIntent(c, 'powershell');

test('commitIntent is total for hostile input', () => {
  for (const bad of [undefined, null, 42, {}, [], '', ' ', ';;;', '&&', '|||', '"', "'", '`', '\\', '$(', '(((', '))))']) {
    const r = BASH(bad);
    assert.equal(typeof r.isCommit, 'boolean');
    const q = PS(bad);
    assert.equal(typeof q.isCommit, 'boolean');
  }
  assert.equal(BASH(42).isCommit, false);
  assert.equal(commitIntent('git commit', 'nonsense').isCommit, true);
  assert.equal(commitIntent('git commit').isCommit, true);
});

test('commitIntent bounds a 10 MiB command', () => {
  const t0 = Date.now();
  const big = 'a '.repeat(5 * 1024 * 1024);
  assert.equal(BASH(big).isCommit, false);
  assert.equal(BASH(big + ' git commit').isCommit, true);
  assert.equal(PS('git '.repeat(500000)).isCommit, false);
  assert.ok(Date.now() - t0 < 3000);
});

test('a result carries no staged-only scope: the gate always reads worktree, staged and untracked', () => {
  assert.deepEqual(BASH('git commit -m y'), { isCommit: true, repo: null, unknown: false });
  assert.deepEqual(BASH('ls'), { isCommit: false, repo: null, unknown: false });
  for (const c of ['git commit -m y', 'git add -A && git commit -m x', 'git commit --pathspec-from-file=p -m x', 'git commit --amend --no-edit', 'git commit -F m.txt']) {
    assert.equal('scope' in BASH(c), false, c);
  }
});

test('bash: plain and prefixed commits', () => {
  const c = BASH('git -C x commit -m y');
  assert.equal(c.isCommit, true);
  assert.equal(c.repo, 'x');
  assert.equal(BASH('A=1 git commit').isCommit, true);
  assert.equal(BASH('A=1 B="x y" git commit -m z').isCommit, true);
  assert.equal(BASH('echo commit && git commit').isCommit, true);
  assert.equal(BASH('bash -c "git commit"').isCommit, true);
  assert.equal(BASH('git -c user.name=x --no-pager commit').isCommit, true);
  assert.equal(BASH('/usr/bin/git commit').isCommit, true);
  assert.equal(BASH('if true; then git commit -m x; fi').isCommit, true);
  assert.equal(BASH('(git commit -m x)').isCommit, true);
  assert.equal(BASH('true || git commit').isCommit, true);
  assert.equal(BASH('sudo git commit').isCommit, true);
  assert.equal(BASH('echo x | xargs git commit').isCommit, true);
  assert.equal(BASH('git add . \\\n && git commit -m x').isCommit, true);
  assert.equal(BASH('command git commit -m x').isCommit, true);
});

test('bash: a commit after git add, in any form, is a commit', () => {
  for (const c of ['git add -A && git commit -m x', 'git add mods/a.ts; git commit -m x', 'git stage . && git commit -m x', 'git add . ; git commit -m x',
    'git commit --pathspec-from-file=p.txt', 'git commit --pathspec-from-file p.txt -m x']) {
    assert.equal(BASH(c).isCommit, true, c);
  }
});

test('bash: not a commit', () => {
  assert.equal(BASH('git log --grep commit').isCommit, false);
  assert.equal(BASH('gitcommit').isCommit, false);
  assert.equal(BASH('git status').isCommit, false);
  assert.equal(BASH('echo "git commit"').isCommit, false);
  assert.equal(BASH('git -C commit status').isCommit, false);
  assert.equal(BASH('git commit-graph write').isCommit, false);
  assert.equal(BASH('grep commit file.txt').isCommit, false);
  assert.deepEqual(BASH('ls'), { isCommit: false, repo: null, unknown: false });
  assert.equal(BASH('# git commit').isCommit, false);
  assert.equal(BASH('git diff --cached && git log -3 --oneline').isCommit, false);
  assert.equal(BASH('git add . && git push origin main').isCommit, false);
  assert.equal(BASH('npm test').isCommit, false);
  assert.equal(BASH('git --version').isCommit, false);
  assert.equal(BASH('git').isCommit, false);
});

test('bash: options, settings and variables that make an allowed git run a commit are a commit', () => {
  for (const c of [
    "git -c diff.external='git commit -am x' diff",
    "git -c core.fsmonitor='git commit -am x' status",
    "git -c core.sshCommand='git commit -am x' fetch",
    'git -c user.name=x status',
    'git -cfoo.bar=x status',
    'git --config-env=core.fsmonitor=VAR status',
    'git --config-env core.fsmonitor=VAR status',
    "GIT_EXTERNAL_DIFF='git commit -am x' git diff",
    "GIT_EXTERNAL_DIFF='git commit -am x'; export GIT_EXTERNAL_DIFF; git diff",
    "export GIT_EXTERNAL_DIFF='git commit -am x'; git diff",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0='git commit -am x' git status",
    "git config core.fsmonitor 'git commit -am x'; git status",
    "git config diff.external 'git commit -am x' && git diff",
    "git grep -O'git commit -am x' foo",
    "git grep -O 'git commit -am x' foo",
    "git grep --open-files-in-pager='git commit -am x' foo",
    "git fetch --upload-pack='git commit -am x' .",
    "git fetch --upload-pack 'git commit -am x' .",
    "git ls-remote --upload-pack='git commit -am x' .",
    "git push --receive-pack='git commit -am x' origin",
    "git push --exec='git commit -am x' origin",
    "git fetch --upload-p='git commit -am x' .",
    "git clone -u 'git commit -am x' . out",
    "git clone -u'git commit -am x' . out",
    "git diff --ext-diff --ext-diff='git commit -am x'",
    "git -c diff.external='git commit' diff",
    "git status && git -c x.y=z log --grep commit"
  ]) {
    assert.equal(BASH(c).isCommit, true, c);
  }
});

test('bash: a network or search subcommand next to the word commit is a commit, whatever its options', () => {
  for (const c of [
    "git push --e='git commit -qam x;:' .",
    "git ls-remote --u='git commit -qam x;:' .",
    "git clone --no-local --u='git commit -qam x;:' . ../y",
    "git grep -iO'git commit -qam x;:' kk",
    "git clone -c core.sshCommand='git -C r commit -qam x;:' ssh://h/x y",
    "git fetch --up='git commit -qam x;:' .",
    "git archive --ex='git commit -qam x;:' HEAD",
    "git archive --remote=. HEAD; echo commit",
    'git push origin main; echo commit'
  ]) {
    assert.equal(BASH(c).isCommit, true, c);
  }
  for (const c of ['git push -u origin main', 'git clone https://example.com/r.git out', 'git grep -n foo', 'git fetch --all', 'git archive HEAD', 'git ls-remote origin']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: a payload that lands work on the branch without the word commit is a commit', () => {
  for (const c of [
    "git ls-remote --upload-pack='git stash -q; git merge -q --no-edit refs/stash;:' .",
    "GIT_EXTERNAL_DIFF='git stash -q; git merge -q --no-edit refs/stash;:' git diff",
    "git config diff.external 'git stash -q; git merge -q --no-edit refs/stash;:'; git diff",
    "git fetch --upload-pack='git cherry-pick -n x' .",
    "git fetch --upload-pack='git pull' .",
    "git fetch --upload-pack='git revert x' .",
    "git fetch --upload-pack='git am p' .",
    "git fetch --upload-pack='git rebase x' .",
    "git fetch --upload-pack='git reset --soft x' .",
    "git fetch --upload-pack='git update-ref refs/heads/x y' .",
    "git fetch --upload-pack='git commit-tree t' .",
    "git config diff.external 'x'; git log -p --ext-diff; echo merge",
    "GIT_EXTERNAL_DIFF=./x git diff; git status -s -- git"
  ]) {
    assert.equal(BASH(c).isCommit, true, c);
  }
  // a nested git outside the program position is enough, whatever the other words are
  assert.equal(BASH("git ls-remote --upload-pack='git x' .").isCommit, true);
  assert.equal(BASH("GIT_EXTERNAL_DIFF='git x' git diff").isCommit, true);
  assert.equal(BASH("git config diff.external 'git x'; git diff").isCommit, true);
  for (const c of ['git fetch origin && git status', 'git push origin main', 'export PATH=x; git status', 'git stash', 'git merge-base a b', 'git ls-remote origin',
    'git fetch --upload-pack', 'git diff --exit-code', 'git config user.name x', 'git reset --hard; git status']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: an abbreviated runner option of three or more characters counts when the command names commit', () => {
  for (const c of ["git diff --ext 'commit'", "git log --ext-d -p commit", "git diff --ext=x commit", "git log --ext commit", "git show --ext commit",
    "git diff-files --ext commit", "git format-patch --ext commit", "git range-diff --ext commit", "git diff --ext-diff commit", "git diff --open commit",
    "git diff --rec commit", "git diff --upl commit", 'git diff --e commit', 'git log --e commit', 'git diff --o commit']) {
    assert.equal(BASH(c).isCommit, true, c);
  }
  for (const c of ['git diff --exit-code commit', 'git diff --stat commit', 'git log --oneline --graph commit',
    'git diff --name-only commit', 'git diff --ext']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: Contract-pinned commit and not-a-commit cases', () => {
  for (const c of ['export GIT_EXTERNAL_DIFF; git diff --stat commit', "git archive --e='x' commit", 'git add --fo a && git commit -m x', 'git add --fo a; git commit -m x']) {
    assert.equal(BASH(c).isCommit, true, c);
  }
  assert.equal(BASH('git add --fo a && git commit -m x').unknown, true);
  for (const c of ["printf 'git commit\\n'", 'git fetch origin && git status', 'git clone https://h/x.git y', 'export PATH=x; git status', 'rg TODO', 'rg commit']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: printf -v, a bare export and set -a set the environment for git', () => {
  for (const c of [
    "printf -v GIT_EXTERNAL_DIFF '%s' 'git commit -qam x;:'; export GIT_EXTERNAL_DIFF; git diff",
    "set -a; printf -v GIT_EXTERNAL_DIFF '%s' 'git commit -qam x;:'; git diff",
    "printf -v GIT_EXTERNAL_DIFF '%s' 'git commit -qam x;:'; git diff",
    'export GIT_EXTERNAL_DIFF; git diff; echo commit',
    'set -a; git diff; echo commit'
  ]) {
    assert.equal(BASH(c).isCommit, true, c);
  }
  for (const c of ['export GIT_EXTERNAL_DIFF; git diff', 'set -a; git diff', "printf '%s' x; git diff", 'printf -v X y; git status']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: rg is not harmless: --pre runs a program', () => {
  assert.equal(BASH('touch commit; GIT_EDITOR="echo m >" rg --pre git x commit').isCommit, true);
  assert.equal(BASH('git status; rg --pre git x commit').isCommit, true);
  assert.equal(BASH('rg foo src').isCommit, false);
});

test('bash: git add -f in a commit command is an unknown-scope commit', () => {
  for (const c of ['git add -f core.mjs && git commit -m x', 'git add --force core.mjs && git commit -m x', 'git add -fA && git commit -m x', 'git stage -f a; git commit -m x',
    'git add --forc a && git commit -m x']) {
    const r = BASH(c);
    assert.equal(r.isCommit, true, c);
    assert.equal(r.unknown, true, c);
  }
  assert.equal(BASH('git add a && git commit -m x').unknown, false);
  assert.equal(BASH('git add -f a').isCommit, false);
});

test('powershell: an environment variable that makes git run a program is a commit', () => {
  for (const c of [
    "$env:GIT_EXTERNAL_DIFF='git commit -am x'; git diff",
    "$env:GIT_EXTERNAL_DIFF = 'git commit -am x'; git diff",
    "git -c diff.external='git commit -am x' diff",
    "git fetch --upload-pack='git commit -am x' ."
  ]) {
    assert.equal(PS(c).isCommit, true, c);
  }
});

test('bash: harmless uses of config, -u, -c-free options and variables stay not a commit', () => {
  for (const c of [
    'git config user.name x',
    'git config --get user.email',
    'git config user.name x; git status',
    'git push -u origin main',
    'git clone https://example.com/r.git out',
    'git fetch --upload-pack',
    'git diff --stat',
    'git grep -n foo',
    'git status --porcelain',
    'FOO=1 git status',
    'export FOO=1; git log --oneline',
    'git log --grep=commit',
    'git log -O'
  ]) {
    assert.equal(BASH(c).isCommit, false, c);
  }
  assert.equal(PS('$env:FOO = 1; git status').isCommit, false);
});

test('bash: quoted separators and heredoc messages do not hide or invent a commit', () => {
  assert.equal(BASH('git commit -m "a; b && c | d"').isCommit, true);
  assert.equal(BASH('echo "x; git commit"').isCommit, false);
  assert.equal(BASH("git commit -m 'it''s'").isCommit, true);
  const heredoc = 'git commit -m "$(cat <<\'EOF\'\nfix: thing\n\nbody; more\nEOF\n)"';
  assert.deepEqual(BASH(heredoc), { isCommit: true, repo: null, unknown: false });
});

test('bash: doubt counts as a commit', () => {
  assert.deepEqual(BASH('git commit -m "unterminated'), { isCommit: true, repo: null, unknown: false });
  assert.equal(BASH('echo "x && git commit').isCommit, true);
  assert.equal(BASH('echo $(git commit -m x)').isCommit, true);
  assert.equal(BASH('x=`git commit`').isCommit, true);
  assert.equal(BASH('eval "git commit"').isCommit, true);
  assert.equal(BASH('bash -c "echo hi"').isCommit, false);
});

test('bash: evasions of the program name or the subcommand are commits (allow-list, not block-list)', () => {
  for (const c of [
    'G=git; $G commit -m x',
    'g=git; $g commit',
    '"$G" commit -m x',
    "$'git' commit -m x",
    "git $'commit' -m x",
    "git $'\\x63ommit' -m x",
    'git "$sub" -m x',
    'g=git\n$g commit',
    'git -c alias.ci=commit ci -m x',
    'git -c Alias.x=commit x',
    'git --config-env=alias.x=VAR x',
    'git ci -m x',
    'git cm -m x',
    'a=(commit -m x); git "${a[@]}"',
    'a=(commit -m x); git ${a[@]}',
    '/usr/bin/gi? commit',
    '/usr/bin/g[i]t commit',
    '/usr/bin/gi* commit',
    '{git,commit} -m x',
    'git commit-tree abc -m x',
    'git.cmd commit -m x',
    'git.bat commit',
    'node -e "require(\'child_process\').execSync(\'git commit -m x\')"',
    'find . -exec git commit -m x \\;',
    'find . -name x -exec git commit -m x {} +',
    'stdbuf -o0 git commit',
    'echo commit | xargs git',
    'echo x | xargs -I{} git commit -m {}',
    'xargs -a list.txt git commit',
    'python3 -c "import os; os.system(\'git commit\')"',
    'env git commit',
    'env -i git commit',
    'nice git commit',
    'time git commit',
    'timeout 5 git commit',
    'git merge feature',
    'git cherry-pick abc',
    'git revert HEAD',
    'git rebase main',
    'git am p.patch',
    'git pull',
    'git write-tree',
    'git update-ref refs/heads/x abc',
    '. ./go.sh; git commit',
    'bash c.sh && git log --grep commit'
  ]) {
    assert.equal(BASH(c).isCommit, true, c);
  }
});

test('bash: git-dir, work-tree and index overrides are doubt that asks as unknown', () => {
  for (const c of [
    'git --git-dir=/x/.git commit -m y',
    'git --git-dir /x/.git commit -m y',
    'git --work-tree=/x commit -m y',
    'git --work-tree /x --git-dir /y commit -m y',
    'GIT_DIR=/x/.git git commit -m y',
    'GIT_WORK_TREE=/x git commit -m y',
    'GIT_INDEX_FILE=/tmp/idx git commit -m y',
    'export GIT_INDEX_FILE=/tmp/idx; git commit -m y',
    'GIT_DIR=/x/.git; export GIT_DIR; git commit',
    'git -c core.worktree=/x commit -m y',
    'sudo git --git-dir=/x commit',
    'bash -c "GIT_DIR=/x git commit"'
  ]) {
    const r = BASH(c);
    assert.equal(r.isCommit, true, c);
    assert.equal(r.unknown, true, c);
  }
  assert.equal(BASH('git commit -m y').unknown, false);
  assert.equal(BASH('git -C sub commit -m y').unknown, false);
  assert.equal(BASH('git --git-dir=/x/.git status').isCommit, false);
});

test('bash: the words git and commit in a printer or a search are not a commit', () => {
  for (const c of ['echo commit | cat', 'printf "git commit\\n"', 'grep -rn "git commit" docs', 'cat docs/git-commit.md', 'ls commit', 'git log --oneline | grep commit']) {
    assert.equal(BASH(c).isCommit, false, c);
  }
});

test('bash: the repo comes from -C and a leading cd', () => {
  assert.equal(BASH('cd sub && git commit -m x').repo, 'sub');
  assert.equal(BASH('cd sub; git -C inner commit').repo, 'sub/inner');
  assert.equal(BASH('git -C /abs commit').repo, '/abs');
  assert.equal(BASH('cd sub; git -C /abs commit').repo, '/abs');
  assert.equal(BASH('git commit').repo, null);
  assert.equal(BASH('git -C ' + 'a'.repeat(9000) + ' commit').repo.length, 4096);
});

test('powershell: commits', () => {
  assert.equal(PS('cd x; git commit -m y').isCommit, true);
  assert.equal(PS('cd x; git commit -m y').repo, 'x');
  assert.equal(PS('git add .; git commit -am y').isCommit, true);
  assert.equal(PS('& git commit -m y').isCommit, true);
  assert.equal(PS('& "git.exe" commit').isCommit, true);
  assert.equal(PS("& 'C:\\Program Files\\Git\\cmd\\git.exe' commit -m y").isCommit, true);
  assert.equal(PS('git commit `\n-m y').isCommit, true);
  assert.equal(PS('git commit `\r\n-m y').isCommit, true);
  assert.equal(PS('$env:GIT_X=1; git commit').isCommit, true);
  assert.equal(PS('git status && git commit').isCommit, true);
  assert.equal(PS('git status || git commit').isCommit, true);
  assert.equal(PS('GIT.EXE commit -m x').isCommit, true);
  assert.equal(PS('Set-Location -Path sub; git commit').repo, 'sub');
  assert.equal(PS('git commit -m (Get-Date)').isCommit, true);
  assert.equal(PS('if ($true) { git commit -m x }').isCommit, true);
  assert.equal(PS('pwsh -Command "git commit"').isCommit, true);
  assert.equal(PS('Invoke-Expression "git commit"').isCommit, true);
  assert.equal(PS('git commit -m "a`"b"').isCommit, true);
});

test('powershell: evasions are commits', () => {
  for (const c of [
    "$g='git'; & $g commit",
    '$g = "git"; & $g commit -m x',
    '& $g commit',
    '. git commit -m x',
    '. $g commit',
    '& (Get-Command git) commit -m x',
    '& (Get-Command git).Source commit',
    '$a = @("commit","-m","x"); git @a',
    'git @a',
    'git $sub -m x',
    'git.cmd commit -m x',
    'git.ps1 commit',
    '& git.cmd commit',
    'git -c alias.x=commit x',
    'git commit-tree abc',
    'Start-Process git -ArgumentList commit',
    'Invoke-Command { git commit }',
    'cmd /c git commit -m x',
    '$env:GIT_DIR="x"; git commit -m y',
    '$env:GIT_INDEX_FILE="x"; git commit -m y',
    '& "$env:ProgramFiles\\Git\\cmd\\git.exe" commit'
  ]) {
    assert.equal(PS(c).isCommit, true, c);
  }
  for (const c of ['$env:GIT_DIR="x"; git commit -m y', 'git --git-dir=x commit', '$env:GIT_WORK_TREE="x"; git commit', '$env:GIT_INDEX_FILE="x"; git commit']) {
    assert.equal(PS(c).unknown, true, c);
  }
});

test('powershell: not a commit', () => {
  assert.equal(PS('Write-Output commit').isCommit, false);
  assert.equal(PS('git log --grep commit').isCommit, false);
  assert.equal(PS('git status; Get-ChildItem').isCommit, false);
  assert.equal(PS('Write-Host "git commit"').isCommit, false);
  assert.equal(PS('git add .').isCommit, false);
  assert.equal(PS('$x = 5').isCommit, false);
});

test('powershell: a backslash path is not an escape', () => {
  assert.equal(PS('git -C C:\\repo\\sub commit -m x').repo, 'C:\\repo\\sub');
  assert.equal(PS('cd C:\\repo; git commit').repo, 'C:\\repo');
});

test('the same command can be a commit in one shell and not another', () => {
  assert.equal(BASH('a && git commit').isCommit, true);
  assert.equal(PS('a & git commit').isCommit, true);
  assert.equal(BASH('a & git commit').isCommit, true);
});

// ---- format.mjs

test('cut and fit never exceed the width', () => {
  assert.equal(cut('abcdef', 4), 'abc…');
  assert.equal(cut('abc', 4), 'abc');
  assert.equal(cut('abc', 0), '');
  assert.equal(cut('abc', 1), '…');
  assert.equal(cut(5, 4), '');
  for (const w of [1, 5, 39, 40]) {
    for (const t of ['x'.repeat(100), '日本語'.repeat(20), 'a\u0301'.repeat(50), 'e😀'.repeat(30)]) {
      assert.ok(cellWidth(fit(t, w)) <= w, `${w}:${t.slice(0, 6)}`);
    }
  }
  assert.equal(fit('abc', 0), '');
  assert.equal(fit('日本語', 5), '日本…');
});

test('cellWidth counts wide characters as two and marks as zero', () => {
  assert.equal(cellWidth('abc'), 3);
  assert.equal(cellWidth('日本'), 4);
  assert.equal(cellWidth('a\u0301'), 1);
  assert.equal(cellWidth(5), 0);
});

test('fit cuts a 10 MiB string quickly', () => {
  const t0 = Date.now();
  assert.ok(cellWidth(fit('y'.repeat(10 * 1024 * 1024), 39)) <= 39);
  assert.ok(Date.now() - t0 < 500);
});

test('fmtInt prints exact integers and ? otherwise', () => {
  assert.equal(fmtInt(1234567), '1234567');
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(1.5), '?');
  assert.equal(fmtInt('5'), '?');
  assert.equal(fmtInt(NaN), '?');
  assert.equal(fmtInt(2 ** 60), '?');
  assert.equal(fmtInt(-3), '-3');
});

test('fmtPct, fmtDuration, fmtClock', () => {
  assert.equal(fmtPct(1, 4), '25');
  assert.equal(fmtPct(0, 0), '?');
  assert.equal(fmtPct(1, 0), '?');
  assert.equal(fmtPct(2, 3), '67');
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(59999), '59s');
  assert.equal(fmtDuration(252000), '4m12s');
  assert.equal(fmtDuration(3720000), '1h02m');
  assert.equal(fmtDuration(-1), '?');
  assert.equal(fmtDuration(NaN), '?');
  assert.equal(fmtDuration('x'), '?');
  const d = new Date(2026, 9, 26, 9, 5);
  assert.equal(fmtClock(d.getTime()), '09:05');
  assert.equal(fmtClock(NaN), '?');
});

test('colorEnabled follows NO_COLOR', () => {
  assert.equal(colorEnabled(undefined), true);
  assert.equal(colorEnabled(''), true);
  assert.equal(colorEnabled('1'), false);
  assert.equal(colorEnabled(null), true);
});

// ---- cache-clock.mjs: hostile input first

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);
const MIN = 60000;

test('no main-loop request seen is unknown, whatever the time', () => {
  assert.deepEqual(cacheClock(EMPTY_CLOCK, T0), { kind: 'unknown' });
  assert.deepEqual(cacheClock(undefined, T0), { kind: 'unknown' });
  assert.deepEqual(cacheClock(null, T0), { kind: 'unknown' });
  assert.deepEqual(cacheClock('x', T0), { kind: 'unknown' });
  assert.deepEqual(cacheClock({ lastRequestMs: null, lifetimeMs: null, source: null }, T0), { kind: 'unknown' });
  assert.equal(clockStatus({ kind: 'unknown' }), '?');
});

test('a clock before the request is unknown, not a negative time left', () => {
  const state = noteRequest(EMPTY_CLOCK, T0);
  assert.deepEqual(cacheClock(state, T0 - 1), { kind: 'unknown' });
  assert.deepEqual(cacheClock(state, T0 - 3600000), { kind: 'unknown' });
});

test('bad times never throw and never become a request', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, '5', null, undefined, {}, 1e300]) {
    assert.deepEqual(noteRequest(EMPTY_CLOCK, bad), EMPTY_CLOCK);
    assert.deepEqual(cacheClock(noteRequest(EMPTY_CLOCK, T0), bad), { kind: 'unknown' });
  }
  for (const bad of [{ lastRequestMs: NaN }, { lastRequestMs: '1' }, { lastRequestMs: -5 }, { lastRequestMs: Infinity }, { lastRequestMs: 1e300 }]) {
    assert.deepEqual(cacheClock(bad, T0), { kind: 'unknown' });
  }
  assert.deepEqual(cacheClock(JSON.parse('{"__proto__":{"lastRequestMs":5},"lastRequestMs":null}'), T0), { kind: 'unknown' });
});

test('the main loop lifetime is the measured 60 minutes, one source, named', () => {
  assert.equal(MAIN_LIFETIME_MS, 60 * MIN);
  assert.equal(SUBAGENT_LIFETIME_MS, 5 * MIN);
  assert.equal(LIFETIME_LABEL, '1 h (measured)');
  const state = noteRequest(EMPTY_CLOCK, T0);
  assert.deepEqual(state, { lastRequestMs: T0, lifetimeMs: 60 * MIN, source: 'measured' });
});

test('the 1 hour entry expires at the request plus 60 minutes', () => {
  const state = noteRequest(EMPTY_CLOCK, T0);
  const fresh = cacheClock(state, T0);
  assert.deepEqual(fresh, { kind: 'valid', expiresMs: T0 + 60 * MIN, minutesLeft: 60 });
  assert.equal(cacheClock(state, T0 + 18 * MIN).minutesLeft, 42);
  assert.equal(cacheClock(state, T0 + 18 * MIN + 1).minutesLeft, 42);
  assert.equal(cacheClock(state, T0 + 59 * MIN + 1).minutesLeft, 1);
  assert.equal(clockStatus(cacheClock(state, T0 + 18 * MIN)), '42m');
});

test('a request at the boundary: the entry has expired at exactly the expiry time', () => {
  const state = noteRequest(EMPTY_CLOCK, T0);
  assert.equal(cacheClock(state, T0 + 60 * MIN - 1).kind, 'valid');
  assert.deepEqual(cacheClock(state, T0 + 60 * MIN), { kind: 'expired', expiresMs: T0 + 60 * MIN });
  assert.equal(cacheClock(state, T0 + 61 * MIN).kind, 'expired');
  assert.equal(clockStatus(cacheClock(state, T0 + 61 * MIN)), 'exp');
  // A request at that moment restarts it.
  const again = noteRequest(state, T0 + 60 * MIN);
  assert.deepEqual(cacheClock(again, T0 + 60 * MIN), { kind: 'valid', expiresMs: T0 + 120 * MIN, minutesLeft: 60 });
});

test('every new request restarts the clock; an older time never moves it back', () => {
  let state = noteRequest(EMPTY_CLOCK, T0);
  state = noteRequest(state, T0 + 30 * MIN);
  assert.equal(cacheClock(state, T0 + 30 * MIN).expiresMs, T0 + 90 * MIN);
  const kept = noteRequest(state, T0 + 10 * MIN);
  assert.equal(kept.lastRequestMs, T0 + 30 * MIN);
});

test('the 5 minute subagent lifetime is a sentence, never a clock', () => {
  const lines = clockLines(cacheClock(noteRequest(EMPTY_CLOCK, T0), T0 + 18 * MIN));
  assert.equal(lines[lines.length - 1], 'Subagent caches last 5 minutes; nothing keeps them warm.');
  assert.equal(SUBAGENT_LINE, lines[lines.length - 1]);
  assert.deepEqual(clockLines({ kind: 'unknown' }), ['Lead cache: unknown', SUBAGENT_LINE]);
});

test('clock lines name the time and the minutes left, or the expiry', () => {
  const state = noteRequest(EMPTY_CLOCK, T0);
  const hhmm = (ms) => fmtClock(ms);
  assert.deepEqual(clockLines(cacheClock(state, T0 + 18 * MIN)), [
    `Lead cache: expires ${hhmm(T0 + 60 * MIN)} (in 42 min)`,
    `Lifetime: ${LIFETIME_LABEL}`,
    SUBAGENT_LINE
  ]);
  assert.deepEqual(clockLines(cacheClock(state, T0 + 70 * MIN)), [
    `Lead cache: expired ${hhmm(T0 + 60 * MIN)}; the next turn rewrites it`,
    `Lifetime: ${LIFETIME_LABEL}`,
    SUBAGENT_LINE
  ]);
});

test('wrap keeps every row within the width, in cells, and loses no word', () => {
  const text = 'Lead cache: expired 11:00; the next turn rewrites it';
  for (const width of [10, 20, 39, 63]) {
    const rows = wrap(text, width);
    for (const row of rows) assert.ok(cellWidth(row) <= width, `${row} at ${width}`);
    if (width >= 12) assert.equal(rows.join(' '), text);
  }
  assert.deepEqual(wrap('', 39), ['']);
  assert.deepEqual(wrap('漢字'.repeat(30), 39).every((r) => cellWidth(r) <= 39), true);
  assert.deepEqual(wrap(7, 39), ['']);
  assert.ok(wrap('x'.repeat(10 * 1024 * 1024), 39).length <= 8);
  assert.deepEqual(wrap('a b', 0), ['']);
});

// ---- git-commit.mjs: cases pinned by aico-mods M4, one test per exact string

const PINNED_COMMIT = [
  // stash then merge, run through a runner option, an env variable and diff.external
  String.raw`git ls-remote --upload-pack='git stash -q; git merge -q --no-edit refs/stash;:' .`,
  String.raw`GIT_EXTERNAL_DIFF='git stash -q; git merge -q --no-edit refs/stash;:' git diff`,
  String.raw`git config diff.external 'git stash -q; git merge -q --no-edit refs/stash;:'; git diff`,
  // nested git with no commit word
  String.raw`git ls-remote --upload-pack='git branch -f main x;:' .`,
  String.raw`GIT_EXTERNAL_DIFF='/usr/bin/git branch -f main x;:' git diff`,
  String.raw`git config diff.external 'git branch -f main x;:'; git diff`,
  String.raw`git fetch --u='git.exe branch -f main x;:' .`,
  // each history word alone
  ...['merge', 'pull', 'cherry-pick', 'revert', 'am', 'rebase', 'stash', 'reset', 'update-ref', 'commit-tree'].map((w) => `git push --e=./x.sh . ${w}`),
  // history word with the environment rule
  String.raw`export GIT_EXTERNAL_DIFF; git diff --stat merge`,
  String.raw`GIT_EXTERNAL_DIFF=./x.sh git diff --stat rebase`,
  // 3-character runner prefix
  String.raw`git diff --e commit`,
  String.raw`git log --e commit`,
  String.raw`git log --o stash`,
  String.raw`git show --u=./x.sh reset`,
  String.raw`git diff --r=./x.sh revert`,
  // other programs, not-literal programs, doubt with a history word
  String.raw`bash -c "git merge x"`,
  String.raw`find . -exec git cherry-pick x \;`,
  String.raw`echo am | xargs git`,
  String.raw`node -e "require('child_process').execSync('git stash; git merge refs/stash')"`,
  String.raw`g=gi""t; $g merge x`,
  String.raw`echo "git pull`,
  String.raw`echo "$(git merge x)"`
];

const PINNED_PS_COMMIT = [
  String.raw`$env:GIT_EXTERNAL_DIFF='git stash -q; git merge -q --no-edit refs/stash;:'; git diff`,
  String.raw`git ls-remote --upload-pack='git branch -f main x;:' .`
];

const PINNED_NOT_COMMIT = [
  'git push origin main',
  'git fetch origin main && git status',
  'GIT_PAGER=cat git log -1',
  'git ls-remote --upload-pack=git-upload-pack .',
  'git ls-remote --upload-pack=./x.sh .',
  'git push --e=./x.sh . merges',
  'git diff -- commit',
  'git log --no-merges',
  'git merge-base HEAD main',
  'git stash',
  'git stash list',
  'git reset HEAD mods/a.ts',
  'git log --grep git',
  'cd git && git status',
  'echo I am here; git status',
  'bash -c "git status"',
  'npm run git-hooks',
  'git clone https://h/x.git y && cd y && git status'
];

for (const c of PINNED_COMMIT) {
  test(`M4 pinned commit (bash): ${c}`, () => {
    assert.equal(BASH(c).isCommit, true, c);
  });
}
for (const c of PINNED_PS_COMMIT) {
  test(`M4 pinned commit (powershell): ${c}`, () => {
    assert.equal(PS(c).isCommit, true, c);
  });
}
for (const c of PINNED_NOT_COMMIT) {
  test(`M4 pinned not a commit: ${c}`, () => {
    assert.equal(BASH(c).isCommit, false, c);
  });
}

test('M4 pinned case counts: 31 commit + 2 PowerShell commit + 18 not a commit', () => {
  assert.equal(PINNED_COMMIT.length, 31);
  assert.equal(PINNED_PS_COMMIT.length, 2);
  assert.equal(PINNED_NOT_COMMIT.length, 18);
});

test('M4: program-name nesting, hyphen word ends and oversize payloads are commits', () => {
  for (const c of [
    String.raw`bash -c "git stash -q; git merge -q --no-edit refs/stash"`,
    String.raw`echo -q --no-edit refs/stash | (git stash -q; xargs git merge)`,
    String.raw`echo "$(git stash -q; git merge -q --no-edit refs/stash)"`,
    String.raw`GIT_EXTERNAL_DIFF='/mingw64/bin/git add -A; c=comm; /mingw64/bin/git ${'$'}{c}it -qm x;:' git diff`,
    String.raw`git ls-remote --upload-pack='git.exe add -A; c=comm; git.exe ${'$'}{c}it -qm x;:' .`,
    String.raw`git ls-remote --upload-pack='s=-stash; m=-merge; gi""t ${'$'}{s#-} -q; gi""t ${'$'}{m#-} -q --no-edit refs/sta""sh;:' .`,
    String.raw`git ls-remote --upload-pack='C:\Git\bin\git.exe x' .`,
    'x '.repeat(40000) + 'git stash; git merge refs/stash'
  ]) {
    assert.equal(BASH(c).isCommit, true, c.slice(0, 80));
  }
  assert.equal(BASH('x '.repeat(40000)).isCommit, false);
});

// ---- bars.mjs: Gates and Steps progress rows

const gate = (g, result = 'passed', at = '2026-01-01T10:00:00Z') => ({ gate: g, result, at });
const stepRow = (n, status) => ({ step: String(n).padStart(2, '0'), role: 'architect', status, round: 0, file: `${String(n).padStart(2, '0')}-architect.md`, mtime: '2026-01-01T10:00:00Z' });
const barView = (over = {}) => ({
  v: 1, slug: 'demo', state: 'running', started: '2026-01-01T10:00:00Z', ended: null, outcome: null, wave: 1,
  gates: [], round: 0, tier: 'medium', steps: [], warnings: [], ...over
});
const eightSteps = (done) => Array.from({ length: 8 }, (_, i) => stepRow(i + 1, i < done ? 'done' : 'unknown'));

test('progressRows draws the count first, then the bar', () => {
  const rows = progressRows(barView({ gates: [gate('brief')], steps: eightSteps(5) }), 32);
  assert.equal(rows[0], 'Gates 1/3 [###-----] last: brief');
  assert.equal(rows[1], 'Steps 5/8 [#####---]');
});

test('progressRows caps the bar at 20 cells', () => {
  const rows = progressRows(barView({ gates: [gate('brief'), gate('plan')], steps: eightSteps(4) }), 400);
  assert.equal(rows[0], `Gates 2/3 [${'#'.repeat(13)}${'-'.repeat(7)}] last: plan`);
  assert.equal(rows[1], `Steps 4/8 [${'#'.repeat(10)}${'-'.repeat(10)}]`);
});

test('progressRows counts only passed gates and names the latest', () => {
  const view = barView({ gates: [gate('brief', 'changed'), gate('brief'), gate('plan', 'stopped'), gate('plan', 'passed', '2026-01-01T11:00:00Z')] });
  assert.match(progressRows(view, 60)[0], /^Gates 2\/3 \[.*\] last: plan$/);
  assert.match(progressRows(barView({ gates: [gate('plan', 'stopped')] }), 60)[0], /^Gates 0\/3 \[-+\] last: none$/);
});

test('progressRows: no steps is Steps 0/0 with no bar', () => {
  const rows = progressRows(barView(), 40);
  assert.equal(rows[1], 'Steps 0/0');
  assert.match(rows[0], /^Gates 0\/3 \[-+\] last: none$/);
});

test('progressRows keeps the bar full only at the full count and empty only at zero', () => {
  const many = (done) => Array.from({ length: 200 }, (_, i) => stepRow((i % 99) + 1, i < done ? 'done' : 'unknown'));
  assert.match(progressRows(barView({ steps: many(199) }), 40)[1], /^Steps 199\/200 \[#+-\]$/);
  assert.match(progressRows(barView({ steps: many(1) }), 40)[1], /^Steps 1\/200 \[#-+\]$/);
  const at4 = (done) => progressRows(barView({ gates: [gate('brief')], steps: Array.from({ length: 20 }, (_, i) => stepRow(i + 1, i < done ? 'done' : 'unknown')) }), 28)[1];
  assert.equal(at4(1), 'Steps 1/20 [#---]');
  assert.equal(at4(19), 'Steps 19/20 [###-]');
});

test('progressRows: an ended ship run is full, an ended abort shows the real counts', () => {
  const ended = { state: 'ended', ended: '2026-01-01T12:00:00Z', steps: eightSteps(3), gates: [gate('brief')] };
  assert.deepEqual(progressRows(barView({ ...ended, outcome: 'ship' }), 31), [`Gates 3/3 [${'#'.repeat(8)}] last: ship`, `Steps 8/8 [${'#'.repeat(8)}]`]);
  assert.deepEqual(progressRows(barView({ ...ended, outcome: 'abort' }), 32), ['Gates 1/3 [###-----] last: brief', 'Steps 3/8 [###-----]']);
});

test('progressRows: unknown input shows ? and no bar', () => {
  for (const view of [null, undefined, barView({ state: 'none' }), { state: 'unknown' }, { state: 'running', gates: 'x', steps: null }]) {
    assert.deepEqual(progressRows(view, 39), ['Gates ?', 'Steps ?']);
  }
});

test('progressRows is ASCII, fits every width from 10 to 400, shares one cell count and puts the count first', () => {
  const full = Array.from({ length: 200 }, (_, i) => stepRow((i % 99) + 1, 'done'));
  const views = [
    null,
    barView(),
    barView({ gates: [gate('brief'), gate('plan'), gate('ship')], steps: eightSteps(8) }),
    barView({ gates: [gate('plan')], steps: full }),
    barView({ state: 'ended', outcome: 'ship', steps: eightSteps(2) })
  ];
  for (const view of views) {
    for (let width = 10; width <= 400; width++) {
      const rows = progressRows(view, width);
      const cells = rows.map((row) => (row.match(/\[([#-]+)\]/) ?? [])[1]?.length);
      for (const row of rows) {
        assert.ok(row.length <= width, `${row} at ${width}`);
        assert.match(row, /^[\x20-\x7e]+$/);
        assert.match(row, /\?|\d+\/\d+/);
        if (row.includes('[')) assert.ok(row.indexOf('/') < row.indexOf('['), `${row} count before bar`);
      }
      const drawn = cells.filter((c) => c !== undefined);
      if (drawn.length === 2) assert.equal(drawn[0], drawn[1], `same cells at ${width}`);
      if (drawn.length) assert.ok(drawn[0] >= 4 && drawn[0] <= 20);
    }
  }
});

test('progressRows drops the last gate, then shortens the label, never the count', () => {
  const full = Array.from({ length: 200 }, (_, i) => stepRow((i % 99) + 1, 'done'));
  const view = barView({ gates: [gate('brief')], steps: full });
  assert.equal(progressRows(view, 14)[0], 'Gates 1/3');
  assert.deepEqual(progressRows(view, 10), ['Gates 1/3', 'S 200/200']);
  assert.equal(progressRows(view, 22)[0], 'Gates 1/3 last: brief');
  assert.equal(progressRows(view, 20)[0], 'Gates 1/3');
});

test('progressRows: a hostile view gives question marks or plain zero counts', () => {
  const hostile = JSON.parse('{"state":"running","gates":[{"__proto__":{"gate":"brief"},"gate":"__proto__","result":"passed"}],"steps":[{"__proto__":{"status":"done"}}]}');
  const rows = progressRows(hostile, 40);
  assert.match(rows[0], /^Gates 0\/3/);
  assert.match(rows[1], /^Steps 0\/1/);
  for (const view of ['x', 5, [], { state: 'running', gates: {}, steps: 1 }, { state: 'bogus', gates: [], steps: [] }]) {
    assert.deepEqual(progressRows(view, 39), ['Gates ?', 'Steps ?']);
  }
});

// ---- reprompt-gate.mjs: hostile input first

const GATE_ROOT = '/work/proj';
const WIN_ROOT = 'C:\\Users\\me\\proj';
const GATE_PLUGIN = '/plug/aico';
const GATE_SLUG = 'reprompt-20260101-0930';
const gateRec = (root = GATE_ROOT) => ({ slug: GATE_SLUG, nn: '01', root });
const RUN = `${GATE_ROOT}/.company/work/${GATE_SLUG}`;
const wr = (path) => allowsTool('Write', { file_path: path, content: 'x' }, gateRec(), GATE_PLUGIN);
const rd = (path, root = GATE_ROOT, plugin = GATE_PLUGIN) => allowsTool('Read', { file_path: path }, gateRec(root), plugin);
const spawn = (over = {}) => ({
  prompt: `Name: Lynn\nOutput: .company/work/${GATE_SLUG}/01-reprompter.md\nGoal: x\n`,
  ...over
});

test('cleanPath accepts absolute POSIX and drive paths and folds separators', () => {
  assert.equal(cleanPath('/a/b/c.md', false), '/a/b/c.md');
  assert.equal(cleanPath('C:\\a\\b.md', true), 'c:/a/b.md');
  assert.equal(cleanPath('C:/a/B.md', false), 'C:/a/B.md');
});

test('cleanPath refuses everything that is not a plain absolute path', () => {
  const bad = [
    '', 'relative/x.md', './x.md', '../x.md', '/a/../b', '/a/./b', '/a//b', '//a/b', '\\\\srv\\share\\x', '/a/b/', '/', 'C:', 'C:/', 'C:x/y',
    '/a/prompt.md:x', '/a/prompt.md::$DATA', 'C:/a/b:c', '/a/b.', '/a/b ', '/a/b./c', '/a /c', '/a/b\u0000.md', '/a/b\n.md', '/a/\u007fb',
    '/a/\u0085b', 'D:\\a\\..\\b', '/a/b\\..\\c', '/a\\.\\b'
  ];
  for (const p of bad) assert.equal(cleanPath(p, false), null, JSON.stringify(p));
  for (const v of [undefined, null, 5, {}, ['/a/b'], true]) assert.equal(cleanPath(v, false), null);
});

test('cleanPath bounds the input at 4096 characters', () => {
  const edge = '/' + 'a'.repeat(4095);
  assert.equal(cleanPath(edge, false), edge);
  assert.equal(cleanPath(edge + 'a', false), null);
  const t0 = Date.now();
  assert.equal(cleanPath('/' + 'a/'.repeat(5_000_000), false), null);
  assert.ok(Date.now() - t0 < 500);
});

test('cleanPath folds only ASCII letters when case is ignored', () => {
  assert.equal(cleanPath('C:/Work/PROMPT.md', true), 'c:/work/prompt.md');
  assert.notEqual(cleanPath('c:/wor\u212A/x', true), cleanPath('c:/work/x', true));
  assert.notEqual(cleanPath('c:/\u0130/x', true), cleanPath('c:/i/x', true));
});

test('isWindowsRoot reads a drive letter', () => {
  assert.equal(isWindowsRoot('C:\\x'), true);
  assert.equal(isWindowsRoot('c:/x'), true);
  assert.equal(isWindowsRoot('/x'), false);
  assert.equal(isWindowsRoot(undefined), false);
});

test('isReprompter matches the bare and the plugin-qualified name only', () => {
  for (const t of ['reprompter', 'aico:reprompter']) assert.equal(isReprompter(t), true);
  for (const t of ['Reprompter', 'x:reprompter', 'reprompter ', ' reprompter', 'reprompter\n', 'aico:reprompter2', 'aico:aico:reprompter', 'editor', '', undefined, 5, null]) {
    assert.equal(isReprompter(t), false, String(t));
  }
});

test('parseOutputLine takes exactly one well-formed Output line', () => {
  assert.deepEqual(parseOutputLine(spawn().prompt), { slug: GATE_SLUG, nn: '01' });
  assert.deepEqual(parseOutputLine('Output: .company/work/reprompt-20260101-0930-9/123-reprompter.md'), { slug: 'reprompt-20260101-0930-9', nn: '123' });
});

test('parseOutputLine refuses every near miss', () => {
  const good = `Output: .company/work/${GATE_SLUG}/01-reprompter.md`;
  const bad = [
    '', 'x', good + '\r\n', good + ' ', ' ' + good, good + '\nOutput: .company/work/reprompt-20260101-0930/02-reprompter.md', good + '\nOutput: x',
    `Output: .company/work/${GATE_SLUG}/1-reprompter.md`, `Output: .company/work/${GATE_SLUG}/1234-reprompter.md`,
    `Output: .company/work/${GATE_SLUG}/01-reprompter.md.evil`, `Output: .company/work/${GATE_SLUG}/../x/01-reprompter.md`,
    `Output: /.company/work/${GATE_SLUG}/01-reprompter.md`, `Output: .company/work/reprompt-20260101-0930-1/01-reprompter.md`,
    `Output: .company/work/reprompt-20260101-0930-10/01-reprompter.md`, `Output: .company/work/reprompt-2026010-0930/01-reprompter.md`,
    `Output: .company/work/other/01-reprompter.md`, `Output: .company/work/${GATE_SLUG}/01-editor.md`, `Output:.company/work/${GATE_SLUG}/01-reprompter.md`,
    `Output:  .company/work/${GATE_SLUG}/01-reprompter.md`, `Output: .company/work/${GATE_SLUG}\\01-reprompter.md`
  ];
  for (const p of bad) assert.equal(parseOutputLine(p), null, JSON.stringify(p));
  for (const v of [undefined, null, 5, {}]) assert.equal(parseOutputLine(v), null);
});

test('parseOutputLine ignores a line cut by the 64 KiB scan window', () => {
  const line = `Output: .company/work/${GATE_SLUG}/01-reprompter.md`;
  // the line ends exactly at the window edge and goes on: not a complete line
  const pad = 'y'.repeat(SPAWN_SCAN - line.length - 1) + '\n';
  assert.equal(pad.length + line.length, SPAWN_SCAN);
  assert.equal(parseOutputLine(pad + line + '.evil\n'), null);
  // complete only when its line break is inside the window as well; otherwise refused
  assert.equal(parseOutputLine(pad + line + '\n'), null);
  const inside = 'y'.repeat(SPAWN_SCAN - line.length - 2) + '\n';
  assert.deepEqual(parseOutputLine(inside + line + '\n'), { slug: GATE_SLUG, nn: '01' });
  // a second Output line past the window is not seen: the first 64 KiB decide
  assert.deepEqual(parseOutputLine(inside + line + '\n' + 'z\n'.repeat(40000) + 'Output: bad\n'), { slug: GATE_SLUG, nn: '01' });
});

test('parseOutputLine stays linear on a 10 MiB prompt', () => {
  const t0 = Date.now();
  assert.equal(parseOutputLine('Output: ' + 'a'.repeat(10 * 1024 * 1024)), null);
  assert.ok(Date.now() - t0 < 500);
});

test('checkSpawn passes a plain dispatch, with no cwd or the session root', () => {
  assert.deepEqual(checkSpawn(spawn(), GATE_ROOT), { slug: GATE_SLUG, nn: '01' });
  assert.deepEqual(checkSpawn(spawn({ cwd: GATE_ROOT, fork: false }), GATE_ROOT), { slug: GATE_SLUG, nn: '01' });
  assert.deepEqual(checkSpawn(spawn({ cwd: 'c:/users/me/PROJ' }), WIN_ROOT), { slug: GATE_SLUG, nn: '01' });
});

test('checkSpawn refuses a fork, a teammate, a workflow agent, a resume, a foreign cwd and a bad root', () => {
  const refused = [
    spawn({ fork: true }), spawn({ isTeammate: true }), spawn({ workflow: { runId: 'wf_1', agentIndex: 1 } }), spawn({ resume: { agentId: 'a' } }),
    spawn({ cwd: '/elsewhere' }), spawn({ cwd: '' }), spawn({ cwd: null }), spawn({ cwd: GATE_ROOT + '/sub' }), spawn({ cwd: '/work/PROJ' }),
    spawn({ cwd: GATE_ROOT + '/' }), spawn({ cwd: '/work/proj/..' }), spawn({ prompt: 'Goal: no output line' })
  ];
  for (const e of refused) assert.equal(checkSpawn(e, GATE_ROOT), null, JSON.stringify(e));
  assert.equal(checkSpawn(spawn(), '/'), null);
  assert.equal(checkSpawn(spawn(), 'relative'), null);
  assert.equal(checkSpawn(spawn(), undefined), null);
  assert.equal(checkSpawn(null, GATE_ROOT), null);
});

test('Write is allowed only on prompt.md and this dispatch Handoff in the run folder', () => {
  assert.equal(wr(`${RUN}/prompt.md`), true);
  assert.equal(wr(`${RUN}/01-reprompter.md`), true);
  const refused = [
    `${RUN}/02-reprompter.md`, `${RUN}/1-reprompter.md`, `${RUN}/001-reprompter.md`, `${RUN}/request.md`, `${RUN}/.gate-01`, `${RUN}/.tree.json`, `${RUN}/.gitignore`,
    `${RUN}/prompt.md:x`, `${RUN}/prompt.md.`, `${RUN}/prompt.md `, `${RUN}/Prompt.md`, `${RUN}/sub/prompt.md`, `${RUN}/../prompt.md`, `${RUN}/./prompt.md`,
    `${RUN}//prompt.md`, `${RUN}/prompt.md\u0000`, `${RUN}/prompt.md/`, RUN, `${GATE_ROOT}/.company/work/reprompt-20260101-0931/prompt.md`,
    `${GATE_ROOT}/prompt.md`, `${GATE_ROOT}/node_modules/x.js`, `${GATE_ROOT}/.claude/settings.json`, '/root/.bashrc', '~/.bashrc', 'prompt.md', '', 'x'.repeat(5000)
  ];
  for (const p of refused) assert.equal(wr(p), false, JSON.stringify(p));
  for (const v of [undefined, null, 5, {}, [`${RUN}/prompt.md`]]) assert.equal(wr(v), false);
});

test('Write ignores keys that are not an own file_path and refuses a bad input shape', () => {
  assert.equal(allowsTool('Write', { path: `${RUN}/prompt.md` }, gateRec(), GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', {}, gateRec(), GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', Object.create({ file_path: `${RUN}/prompt.md` }), gateRec(), GATE_PLUGIN), false);
  for (const v of [null, undefined, 'x', 5, []]) assert.equal(allowsTool('Write', v, gateRec(), GATE_PLUGIN), false);
});

test('Read is allowed on project.md, PROFILE.md, the run folder files and the handoff skill', () => {
  const ok = [
    `${GATE_ROOT}/.company/project.md`, `${GATE_PLUGIN}/company/PROFILE.md`, `${RUN}/request.md`, `${RUN}/answers-1.md`, `${RUN}/answers-12.md`, `${RUN}/edit-3.md`,
    `${RUN}/prompt.md`, `${RUN}/01-reprompter.md`, `${RUN}/02-reprompter.md`, `${RUN}/123-reprompter.md`, `${GATE_PLUGIN}/skills/handoff/SKILL.md`,
    `${GATE_PLUGIN}/skills/handoff/ref/deep/x.md`
  ];
  for (const p of ok) assert.equal(rd(p), true, p);
});

test('Read refuses secrets, other runs, the gate marker and every near miss', () => {
  const refused = [
    `${GATE_ROOT}/.env`, `${GATE_ROOT}/.company/work/other/request.md`, `${GATE_ROOT}/.company/work/reprompt-20260101-0931/request.md`, `${RUN}/.gate-01`,
    `${RUN}/.tree.json`, `${RUN}/run-state.jsonl`, `${RUN}/answers-.md`, `${RUN}/answers-x.md`, `${RUN}/edit-1.md.`, `${RUN}/request.md:x`, `${RUN}/Request.md`,
    `${RUN}/1-reprompter.md`, `${RUN}/1234-reprompter.md`, `${RUN}/sub/request.md`, `${RUN}/../request.md`, `${GATE_ROOT}/.company/project.md.`, `${GATE_ROOT}/.company/Project.md`,
    `${GATE_PLUGIN}/company/profile.md`, `${GATE_PLUGIN}/company/PROFILE.md.`, `${GATE_PLUGIN}/company/personalities.json`, `${GATE_PLUGIN}/skills/handoff`,
    `${GATE_PLUGIN}/skills/handoff/`, `${GATE_PLUGIN}/skills/handoffx/SKILL.md`, `${GATE_PLUGIN}/skills/handoff/../writing/SKILL.md`, `${GATE_PLUGIN}/skills/writing/SKILL.md`,
    `${GATE_PLUGIN}/scripts/reprompt-check.mjs`, '/home/me/.ssh/id_rsa', '/etc/passwd', 'C:/Users/me/.claude.json', ''
  ];
  for (const p of refused) assert.equal(rd(p), false, JSON.stringify(p));
});

test('Read of the plugin files needs a usable plugin root', () => {
  for (const plugin of [undefined, '', 'relative', '/plug/../aico', '/']) {
    assert.equal(allowsTool('Read', { file_path: `${GATE_PLUGIN}/company/PROFILE.md` }, gateRec(), plugin), false, String(plugin));
  }
  assert.equal(allowsTool('Read', { file_path: `${RUN}/request.md` }, gateRec(), undefined), true);
});

test('On Windows the path match ignores ASCII case and reads backslashes', () => {
  const run = 'C:\\Users\\me\\proj\\.company\\work\\' + GATE_SLUG;
  const rec = gateRec(WIN_ROOT);
  const plugin = 'C:\\Users\\me\\.claude\\plugins\\aico';
  assert.equal(allowsTool('Write', { file_path: run + '\\PROMPT.MD' }, rec, plugin), true);
  assert.equal(allowsTool('Write', { file_path: 'c:/users/ME/proj/.company/work/' + GATE_SLUG + '/01-Reprompter.md' }, rec, plugin), true);
  assert.equal(allowsTool('Read', { file_path: 'C:/Users/me/.claude/plugins/aico/company/profile.MD' }, rec, plugin), true);
  assert.equal(allowsTool('Read', { file_path: 'C:/Users/me/proj/.COMPANY/Project.md' }, rec, plugin), true);
  assert.equal(allowsTool('Write', { file_path: run + '\\prompt.md::$DATA' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: run + '\\prompt.md.' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: run + '\\prompt.md ' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: run.replace('work', 'wor\u212A') + '\\prompt.md' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: 'D:\\Users\\me\\proj\\.company\\work\\' + GATE_SLUG + '\\prompt.md' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: '\\\\srv\\share\\prompt.md' }, rec, plugin), false);
  assert.equal(allowsTool('Write', { file_path: '/c/Users/me/proj/.company/work/' + GATE_SLUG + '/prompt.md' }, rec, plugin), false);
});

test('On POSIX the path match is case sensitive', () => {
  assert.equal(wr(`${GATE_ROOT}/.company/work/${GATE_SLUG}/PROMPT.md`), false);
  assert.equal(wr(`/WORK/proj/.company/work/${GATE_SLUG}/prompt.md`), false);
});

test('Skill is allowed only as exactly aico:handoff', () => {
  const sk = (input) => allowsTool('Skill', input, gateRec(), GATE_PLUGIN);
  assert.equal(sk({ skill: 'aico:handoff' }), true);
  assert.equal(sk({ skill: 'aico:handoff', args: 'x' }), true);
  for (const s of ['aico:writing', 'handoff', 'AICO:handoff', 'aico:handoff ', ' aico:handoff', 'aico:handoff\n', 'aico:handoff2', 'aico:reprompt', 'plugin-authoring', '', undefined, 5, null, ['aico:handoff']]) {
    assert.equal(sk({ skill: s }), false, JSON.stringify(s));
  }
  assert.equal(sk({}), false);
  assert.equal(sk(Object.create({ skill: 'aico:handoff' })), false);
  assert.equal(sk(null), false);
});

test('Every other tool is refused, MCP and look-alike names included', () => {
  const args = { file_path: `${RUN}/prompt.md`, command: 'ls', skill: 'aico:handoff', path: RUN, notebook_path: `${RUN}/prompt.md` };
  const names = [
    'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'SendMessage', 'Workflow',
    'mcp__srv__write', 'mcp__srv__Read', 'write', 'read', 'skill', 'Write ', ' Write', 'Write\n', 'Writer', 'Reader', 'Skills', 'WRITE', '', undefined, null, 5, {}
  ];
  for (const n of names) assert.equal(allowsTool(n, args, gateRec(), GATE_PLUGIN), false, String(n));
});

test('allowsTool fails closed on a record or root it cannot use', () => {
  const input = { file_path: `${RUN}/prompt.md` };
  assert.equal(allowsTool('Write', input, undefined, GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', input, null, GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', input, { slug: GATE_SLUG, nn: '01', root: '/' }, GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', input, { slug: GATE_SLUG, nn: '01', root: 'rel' }, GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', input, { slug: '../x', nn: '01', root: GATE_ROOT }, GATE_PLUGIN), false);
  assert.equal(allowsTool('Write', input, { slug: GATE_SLUG, nn: '../1', root: GATE_ROOT }, GATE_PLUGIN), false);
});

test('allowsTool answers a boolean for any input', () => {
  for (const v of [wr(`${RUN}/prompt.md`), wr('/etc/passwd'), allowsTool(undefined, undefined, undefined, undefined)]) assert.equal(typeof v, 'boolean');
});

test('remember keeps at most max records and drops the oldest', () => {
  const m = new Map();
  for (let i = 0; i < 5; i++) remember(m, `a${i}`, { i }, 3);
  assert.deepEqual([...m.keys()], ['a2', 'a3', 'a4']);
  remember(m, 'a3', { i: 9 }, 3);
  assert.deepEqual([...m.keys()], ['a2', 'a4', 'a3']);
  assert.deepEqual(m.get('a3'), { i: 9 });
});

test('refusalReason and refusalToast clean the tool name and the path', () => {
  assert.equal(refusalReason('Edit'), 'aico reprompt gate: Edit refused; the reprompter may write only prompt.md and its Handoff in its run folder');
  assert.ok(!/[\u0000-\u001f]/.test(refusalReason('Ba\u001b[2Jsh\nx')));
  assert.ok(refusalReason('x'.repeat(5000)).length < 200);
  assert.equal(refusalToast('Write', { file_path: '/etc/passwd' }), 'aico: reprompter Write refused: /etc/passwd');
  const long = refusalToast('Write', { file_path: '/a\u001b[31m\n' + 'b'.repeat(500) });
  assert.ok(!/[\u0000-\u001f]/.test(long));
  assert.ok(long.length <= 'aico: reprompter Write refused: '.length + 80);
  assert.equal(refusalToast('Bash', { command: 'rm -rf /' }), 'aico: reprompter Bash refused: ');
  assert.equal(refusalToast('Bash', null), 'aico: reprompter Bash refused: ');
  assert.equal(refusalToast(undefined, undefined), 'aico: reprompter ? refused: ');
});

test('guardArmed accepts only the armed number that was asked for', () => {
  const g = guardArmed('07');
  assert.equal(g({ armed: '07' }), '07');
  for (const v of [{ armed: '08' }, { armed: 7 }, { armed: '07', extra: 1 }, {}, null, undefined, 'armed', [], { armed: ['07'] }, { refused: 'x' }]) {
    assert.equal(g(v), undefined, JSON.stringify(v));
  }
  assert.equal(g(Object.create({ armed: '07' })), undefined);
});
