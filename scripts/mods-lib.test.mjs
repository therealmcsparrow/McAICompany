import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_STDOUT, MODS_DEFAULTS, trimEol, cleanText, parseJson, str, int, bool, oneOf, arr, obj, opt, rec, pattern,
  interpretRun, guardSettings, guardRunActive, guardReviewDepth
} from '../mods/lib/guard.mjs';
import { composeStatus, STATUS_CAPS, STATUS_MAX } from '../mods/lib/status.mjs';
import { commitIntent } from '../mods/lib/git-commit.mjs';
import { cut, cellWidth, fit, fmtInt, fmtPct, fmtDuration, fmtMinutes, fmtClock, colorEnabled } from '../mods/lib/format.mjs';
import {
  MAIN_LIFETIME_MS, SUBAGENT_LIFETIME_MS, LIFETIME_LABEL, SUBAGENT_LINE, EMPTY_CLOCK, noteRequest, cacheClock, clockLines, clockStatus, wrap
} from '../mods/lib/cache-clock.mjs';
import { MODS_DEFAULTS as SETTINGS_DEFAULTS } from './settings.mjs';

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
  assert.equal(composeStatus(mixed), 'aico · spend 1');
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal({}.x, undefined);
});

test('composeStatus cuts a 10 MiB part to its cap', () => {
  const line = composeStatus({ savvy: 'x'.repeat(10 * 1024 * 1024) });
  assert.equal(cellWidth(line), 7 + STATUS_CAPS.savvy);
  assert.ok(line.endsWith('…'));
});

test('composeStatus makes CR, LF, tab and ESC one clean line', () => {
  const line = composeStatus({ savvy: 'a\r\nb\tc\u001b[31md' });
  assert.ok(!/[\r\n\t\u001b]/.test(line));
  assert.ok(line.startsWith('aico · a b c'));
});

test('composeStatus cuts a CJK part to its cell cap', () => {
  const line = composeStatus({ blast: '漢'.repeat(30) });
  assert.ok(cellWidth(line) - 7 <= STATUS_CAPS.blast);
  assert.ok(line.endsWith('…'));
});

test('composeStatus joins parts in order savvy, blast, cost, reflect', () => {
  assert.equal(composeStatus({ reflect: 'reflect 2 suggested', cost: 'spend 5', blast: 'blast warn contract 1', savvy: 'run x w1' }),
    'aico · run x w1 · blast warn contract 1 · spend 5 · reflect 2 suggested');
});

test('composeStatus returns undefined when there is nothing to say', () => {
  assert.equal(composeStatus({}), undefined);
  assert.equal(composeStatus({ savvy: '', cost: '   ', blast: null, reflect: undefined }), undefined);
  assert.equal(composeStatus(undefined), undefined);
  assert.equal(composeStatus(null), undefined);
  assert.equal(composeStatus('x'), undefined);
});

test('STATUS_CAPS add up to fit STATUS_MAX with all four parts', () => {
  const sum = Object.values(STATUS_CAPS).reduce((a, b) => a + b, 0);
  assert.deepEqual(STATUS_CAPS, { savvy: 52, blast: 24, cost: 46, reflect: 20 });
  assert.ok(7 + sum + 3 * 3 <= STATUS_MAX);
  const line = composeStatus({ savvy: 's'.repeat(200), blast: 'b'.repeat(200), cost: 'c'.repeat(200), reflect: 'r'.repeat(200) });
  assert.ok(cellWidth(line) <= STATUS_MAX);
  assert.equal(line.split(' · ').length, 5);
});

test('composeStatus with a small max drops reflect, cost, blast, then cuts savvy', () => {
  const parts = { savvy: 's'.repeat(40), blast: 'b'.repeat(20), cost: 'c'.repeat(30), reflect: 'r'.repeat(15) };
  const l1 = composeStatus(parts, { max: 105 });
  assert.ok(cellWidth(l1) <= 105 && !l1.includes('r'.repeat(15)) && l1.includes('c'.repeat(30)));
  const l2 = composeStatus(parts, { max: 75 });
  assert.ok(cellWidth(l2) <= 75);
  assert.ok(!l2.includes('r'.repeat(15)) && !l2.includes('c'.repeat(30)) && l2.includes('b'.repeat(20)));
  const l3 = composeStatus(parts, { max: 20 });
  assert.ok(cellWidth(l3) <= 20);
  assert.ok(l3.endsWith('…') && !l3.includes('b'));
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

test('bash: plain and prefixed commits', () => {
  assert.deepEqual(BASH('git commit -m y'), { isCommit: true, scope: 'staged', repo: null });
  const c = BASH('git -C x commit -m y');
  assert.equal(c.isCommit, true);
  assert.equal(c.repo, 'x');
  assert.equal(c.scope, 'staged');
  assert.equal(BASH('A=1 git commit').isCommit, true);
  assert.equal(BASH('A=1 B="x y" git commit -m z').isCommit, true);
  assert.equal(BASH('echo commit && git commit').isCommit, true);
  assert.equal(BASH('bash -c "git commit"').isCommit, true);
  assert.equal(BASH('git -c user.name=x --no-pager commit').isCommit, true);
  assert.equal(BASH('git --git-dir=a --work-tree=b commit').isCommit, true);
  assert.equal(BASH('git --git-dir a commit').isCommit, true);
  assert.equal(BASH('/usr/bin/git commit').isCommit, true);
  assert.equal(BASH('if true; then git commit -m x; fi').isCommit, true);
  assert.equal(BASH('(git commit -m x)').isCommit, true);
  assert.equal(BASH('true || git commit').isCommit, true);
  assert.equal(BASH('sudo git commit').isCommit, true);
  assert.equal(BASH('echo x | xargs git commit').isCommit, true);
  assert.equal(BASH('git add . \\\n && git commit -m x').isCommit, true);
});

test('bash: not a commit', () => {
  assert.equal(BASH('git log --grep commit').isCommit, false);
  assert.equal(BASH('gitcommit').isCommit, false);
  assert.equal(BASH('git status').isCommit, false);
  assert.equal(BASH('echo "git commit"').isCommit, false);
  assert.equal(BASH('git commit-tree abc').isCommit, false);
  assert.equal(BASH('git -C commit status').isCommit, false);
  assert.equal(BASH('git commit-graph write').isCommit, false);
  assert.equal(BASH('grep commit file.txt').isCommit, false);
  assert.deepEqual(BASH('ls'), { isCommit: false, scope: null, repo: null });
  assert.equal(BASH('# git commit').isCommit, false);
});

test('bash: scope', () => {
  for (const c of ['git commit -a -m y', 'git commit -am y', 'git commit --all -m y', 'git commit -i f', 'git commit --include f',
    'git commit -o f', 'git commit --only f', 'git commit f.txt', 'git commit -m y -- f.txt', 'git commit -sa', 'git commit -p', 'git commit --patch',
    'git commit --al -m y', 'git commit --weird']) {
    assert.equal(BASH(c).scope, 'worktree', c);
  }
  for (const c of ['git commit -m y', 'git commit -m "all the things"', 'git commit --amend --no-edit', 'git commit -m "-a"', 'git commit -F msg.txt', 'git commit --message=a',
    'git commit --message all', 'git commit -S -m x', 'git commit -mall', 'git commit -sm x', 'git commit --allow-empty -m x', 'git commit --no-verify -m x', 'git commit -v']) {
    assert.equal(BASH(c).scope, 'staged', c);
  }
});

test('bash: quoted separators and heredoc messages do not hide or invent a commit', () => {
  assert.equal(BASH('git commit -m "a; b && c | d"').isCommit, true);
  assert.equal(BASH('echo "x; git commit"').isCommit, false);
  assert.equal(BASH("git commit -m 'it''s'").isCommit, true);
  const heredoc = 'git commit -m "$(cat <<\'EOF\'\nfix: thing\n\nbody; more\nEOF\n)"';
  assert.deepEqual(BASH(heredoc), { isCommit: true, scope: 'staged', repo: null });
});

test('bash: doubt counts as a commit', () => {
  assert.deepEqual(BASH('git commit -m "unterminated'), { isCommit: true, scope: 'staged', repo: null });
  assert.equal(BASH('echo "x && git commit').scope, 'worktree');
  const s = BASH('echo $(git commit -m x)');
  assert.equal(s.isCommit, true);
  assert.equal(BASH('x=`git commit`').isCommit, true);
  assert.equal(BASH('eval "git commit"').isCommit, true);
  assert.equal(BASH('bash -c "echo hi"').isCommit, false);
});

test('bash: repo comes from -C and a leading cd', () => {
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
  assert.equal(PS('git add .; git commit -am y').scope, 'worktree');
  assert.equal(PS('& git commit -m y').isCommit, true);
  assert.equal(PS('& "git.exe" commit').isCommit, true);
  assert.equal(PS("& 'C:\\Program Files\\Git\\cmd\\git.exe' commit -m y").isCommit, true);
  assert.equal(PS('git commit `\n-m y').isCommit, true);
  assert.equal(PS('git commit `\r\n-m y').scope, 'staged');
  assert.equal(PS('git commit -a `\r\n-m y').scope, 'worktree');
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

test('powershell: not a commit', () => {
  assert.equal(PS('Write-Output commit').isCommit, false);
  assert.equal(PS('git log --grep commit').isCommit, false);
  assert.equal(PS('git status; Get-ChildItem').isCommit, false);
  assert.equal(PS('Write-Host "git commit"').isCommit, false);
  assert.equal(PS('git add .').isCommit, false);
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
  assert.equal(clockStatus({ kind: 'unknown' }), 'cache ?');
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
  assert.equal(clockStatus(cacheClock(state, T0 + 18 * MIN)), 'cache 42m');
});

test('a request at the boundary: the entry has expired at exactly the expiry time', () => {
  const state = noteRequest(EMPTY_CLOCK, T0);
  assert.equal(cacheClock(state, T0 + 60 * MIN - 1).kind, 'valid');
  assert.deepEqual(cacheClock(state, T0 + 60 * MIN), { kind: 'expired', expiresMs: T0 + 60 * MIN });
  assert.equal(cacheClock(state, T0 + 61 * MIN).kind, 'expired');
  assert.equal(clockStatus(cacheClock(state, T0 + 61 * MIN)), 'cache expired');
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
