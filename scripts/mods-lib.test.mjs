import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_STDOUT, MODS_DEFAULTS, trimEol, cleanText, parseJson, str, int, bool, oneOf, arr, obj, opt, rec, pattern,
  interpretRun, guardSettings, guardRunActive, guardReviewDepth, parseOutputText
} from '../mods/lib/guard.mjs';
import { composeStatus, IDLE, STATUS_CAPS, STATUS_MAX } from '../mods/lib/status.mjs';
import { readyText } from '../mods/lib/ready.mjs';
import { parseVersion } from '../mods/lib/version.mjs';
import { cut, cellWidth, fit, fmtInt, fmtCompact, fmtPct, fmtDuration, fmtMinutes, fmtClock, colorEnabled } from '../mods/lib/format.mjs';
import {
  MAIN_LIFETIME_MS, SUBAGENT_LIFETIME_MS, LIFETIME_LABEL, SUBAGENT_LINE, EMPTY_CLOCK, noteRequest, cacheClock, clockLines, clockStatus, wrap
} from '../mods/lib/cache-clock.mjs';
import { MODS_DEFAULTS as SETTINGS_DEFAULTS } from './settings.mjs';
import { progressRows } from '../mods/lib/bars.mjs';
import {
  SPAWN_SCAN, cleanPath, isWindowsRoot, isReprompter, parseOutputLine, checkSpawn, allowsTool, remember, refusalReason, refusalToast, guardArmed, ARM_TTL_MS, runEnded, armLive
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
  assert.deepEqual(Object.keys(r.value.mods).sort(), ['cache_tax', 'reflect', 'savvy']);
  assert.deepEqual(Object.keys(MODS_DEFAULTS).sort(), ['cache_tax', 'reflect', 'savvy']);
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

test('guardRunActive accepts a Step past 99 and refuses a four-digit one', () => {
  const s100 = { ...VIEW.steps[0], step: '100', file: '100-backend-engineer.md' };
  const some = guardRunActive({ slug: 'x', view: { ...VIEW, steps: [VIEW.steps[0], s100] } });
  assert.equal(some.view.steps[1].step, '100');
  assert.equal(some.view.steps[1].file, '100-backend-engineer.md');
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, steps: [{ ...s100, step: '1000' }] } }), undefined);
  assert.equal(guardRunActive({ slug: 'x', view: { ...VIEW, steps: [{ ...s100, file: '1000-backend-engineer.md' }] } }), undefined);
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
  const hostile = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","extra":"e","savvy":7,"gone":["b"],"cost":{"a":1},"reflect":null}');
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
  const line = composeStatus({ cost: '漢'.repeat(30) });
  assert.ok(cellWidth(line) <= STATUS_CAPS.cost);
  assert.ok(line.endsWith('…'));
});

test('composeStatus joins parts in order savvy, cost, reflect', () => {
  assert.equal(composeStatus({ reflect: '2 lessons', cost: '5 tax', savvy: 'W1 S01' }),
    'W1 S01 · 5 tax · 2 lessons');
});

test('composeStatus returns undefined when there is nothing to say', () => {
  assert.equal(composeStatus({}), undefined);
  assert.equal(composeStatus({ savvy: '', cost: '   ', reflect: undefined }), undefined);
  assert.equal(composeStatus(undefined), undefined);
  assert.equal(composeStatus(null), undefined);
  assert.equal(composeStatus('x'), undefined);
});

test('STATUS_CAPS add up so the whole line stays on 70 cells, so the host prefix of 8 leaves 2 spare', () => {
  const sum = Object.values(STATUS_CAPS).reduce((a, b) => a + b, 0);
  assert.equal(STATUS_MAX, 70);
  assert.deepEqual(STATUS_CAPS, { version: 8, savvy: 17, cost: 13, reflect: 10 });
  assert.equal(Object.keys(STATUS_CAPS).length, 4);
  assert.ok(sum + 3 * 3 <= STATUS_MAX);
});

test('composeStatus with all four parts at their cap is at most 70 cells and keeps every part', () => {
  const line = composeStatus({ version: 'v' + '9'.repeat(200), savvy: 's'.repeat(200), cost: 'c'.repeat(200), reflect: 'r'.repeat(200) });
  assert.ok(cellWidth(line) <= 70);
  assert.equal(line.split(' · ').length, 4);
  const wide = composeStatus({ version: 'v10.2.30', savvy: '漢'.repeat(200), cost: '漢'.repeat(200), reflect: '漢'.repeat(200) });
  assert.ok(cellWidth(wide) <= 70);
  assert.ok(8 + cellWidth(wide) <= 78);
  assert.equal(wide.split(' · ').length, 4);
  const real = composeStatus({ version: 'v0.20.0', savvy: 'W3 S12 be-eng 14m', cost: '12.4k tax 60m', reflect: '9 lessons' });
  assert.equal(real, 'v0.20.0 · W3 S12 be-eng 14m · 12.4k tax 60m · 9 lessons');
  assert.ok(cellWidth(real) <= 70);
  const twenty = composeStatus({ version: 'v0.21.0', savvy: 'W3 S12 be-eng 14m', cost: '12.4k tax 60m', reflect: '20 lessons' });
  assert.equal(twenty, 'v0.21.0 · W3 S12 be-eng 14m · 12.4k tax 60m · 20 lessons');
  assert.ok(cellWidth(twenty) <= 70);
});

test('composeStatus puts the version first, shows it next to the idle part and never drops it before the others', () => {
  assert.equal(composeStatus({ version: 'v0.20.0' }), 'v0.20.0');
  assert.equal(composeStatus({ version: 'v0.20.0' }, { idle: true }), 'v0.20.0 · aico idle');
  assert.equal(composeStatus({ cost: '5 tax', version: 'v0.20.0' }), 'v0.20.0 · 5 tax');
  const parts = { version: 'v0.20.0', savvy: 's'.repeat(17), cost: 'c'.repeat(13), reflect: 'r'.repeat(10) };
  for (const max of [60, 50, 40, 30, 20]) {
    const l = composeStatus(parts, { max });
    assert.ok(cellWidth(l) <= max, String(max));
    assert.ok(l.startsWith('v0.20.0'), max + ': ' + l);
  }
  assert.equal(composeStatus(parts, { max: 20 }), 'v0.20.0 · sssssssss…');
});

test('parseVersion accepts x.y.z from plugin.json text and nothing else', () => {
  assert.equal(parseVersion('{"name":"aico","version":"0.20.0"}'), '0.20.0');
  assert.equal(parseVersion('\ufeff{"version":"10.2.30"}\r\n'), '10.2.30');
  for (const bad of ['', 'x', '[]', 'null', '{}', '{"version":7}', '{"version":"0.20"}', '{"version":"0.20.0-beta"}',
    '{"version":"v0.20.0"}', '{"version":"0.20.0\n"}', '{"version":" 0.20.0"}', '{"version":"1.2.3\u001b[31m"}',
    '{"version":"123456789.1.1"}', '{"version":"10.20.30"}', '{"version":"0.20.0"', '{"__proto__":{"version":"1.2.3"}}', undefined, null, 7, {}]) {
    assert.equal(parseVersion(bad), undefined, String(bad));
  }
  assert.equal(parseVersion('{"version":"' + '1'.repeat(1e6) + '.1.1"}'), undefined);
});

test('composeStatus with a small max drops reflect, then cost, then cuts savvy', () => {
  const parts = { savvy: 's'.repeat(17), cost: 'c'.repeat(13), reflect: 'r'.repeat(8) };
  const l1 = composeStatus(parts, { max: 40 });
  assert.ok(cellWidth(l1) <= 40 && !l1.includes('r'.repeat(8)) && l1.includes('c'.repeat(13)));
  const l2 = composeStatus(parts, { max: 30 });
  assert.ok(cellWidth(l2) <= 30);
  assert.ok(!l2.includes('r'.repeat(8)) && !l2.includes('c'.repeat(13)) && l2.includes('s'.repeat(17)));
  const l3 = composeStatus(parts, { max: 15 });
  assert.ok(cellWidth(l3) <= 15);
  assert.ok(l3.endsWith('…') && !l3.includes('c'));
});

test('composeStatus with idle shows `aico idle` in the first slot when no run part is there', () => {
  assert.equal(IDLE, 'aico idle');
  assert.equal(composeStatus({}, { idle: true }), 'aico idle');
  assert.equal(composeStatus({ savvy: '', cost: '   ' }, { idle: true }), 'aico idle');
  assert.equal(composeStatus(undefined, { idle: true }), 'aico idle');
  assert.equal(composeStatus({ cost: '5 tax', reflect: '2 lessons' }, { idle: true }), 'aico idle · 5 tax · 2 lessons');
  assert.equal(composeStatus({}), undefined);
  assert.equal(composeStatus({}, { idle: false }), undefined);
});

test('composeStatus with idle gives way to the Savvy part and keeps the 70 cell budget', () => {
  assert.equal(composeStatus({ savvy: 'W3 S12 be-eng 14m', cost: '5 tax' }, { idle: true }), 'W3 S12 be-eng 14m · 5 tax');
  assert.equal(composeStatus({ savvy: 'ended ok 14m' }, { idle: true }), 'ended ok 14m');
  const all = composeStatus({ cost: 'c'.repeat(200), reflect: 'r'.repeat(200) }, { idle: true });
  assert.ok(cellWidth(all) <= STATUS_MAX);
  assert.equal(all.split(' · ').length, 3);
  assert.ok(all.startsWith('aico idle · '));
  assert.ok(cellWidth(composeStatus({}, { idle: true })) <= STATUS_CAPS.savvy);
  const small = composeStatus({ cost: 'c'.repeat(15), reflect: 'r'.repeat(8) }, { idle: true, max: 15 });
  assert.ok(cellWidth(small) <= 15);
});

test('composeStatus with idle ignores hostile parts and a hostile option', () => {
  const hostile = JSON.parse('{"__proto__":"x","savvy":7,"gone":["b"],"cost":{"a":1}}');
  assert.equal(composeStatus(hostile, { idle: true }), 'aico idle');
  assert.equal(composeStatus({}, { idle: 'yes' }), undefined);
});

test('readyText lists the mods that are on, in a fixed order', () => {
  const on = (enabled) => ({ enabled });
  assert.equal(readyText({ savvy: on(true), cache_tax: on(true), reflect: on(true) }, true),
    'aico mods ready: Savvy, Cache Tax, Reflect');
  assert.equal(readyText({ savvy: on(true), cache_tax: on(true), reflect: on(true) }, true, '0.37.0'),
    'aico 0.37.0 mods ready: Savvy, Cache Tax, Reflect');
  assert.equal(readyText({ savvy: on(true) }, true, '0.20.0'), 'aico 0.20.0 mods ready: Savvy');
  assert.equal(readyText({ savvy: on(true) }, false, '0.20.0'), 'aico 0.20.0 mods ready (settings unknown): Savvy');
  assert.equal(readyText(null, true, '0.20.0'), 'aico 0.20.0 mods ready');
  for (const bad of ['v0.20.0', '0.20', '0.20.0\n', 'x'.repeat(100), 7, null, {}]) {
    assert.equal(readyText({ savvy: on(true) }, true, bad), 'aico mods ready: Savvy', String(bad));
  }
  assert.equal(readyText({ savvy: on(false), cache_tax: on(true), reflect: on(false) }, true),
    'aico mods ready: Cache Tax');
  assert.equal(readyText({ savvy: on(false) }, true), 'aico mods ready: none on');
});

test('readyText says when the settings are unknown and survives hostile input', () => {
  assert.equal(readyText({ savvy: { enabled: true } }, false), 'aico mods ready (settings unknown): Savvy');
  for (const bad of [null, undefined, 'x', 7]) assert.equal(readyText(bad, true), 'aico mods ready');
  const hostile = JSON.parse('{"__proto__":{"enabled":true},"savvy":"yes","reflect":{"enabled":"true"},"gone":{"enabled":true}}');
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

test('guard parseOutputText takes a three-digit Output line and refuses four digits', () => {
  assert.deepEqual(parseOutputText('Output: .company/work/demo-run/225-code-reviewer.md'), { slug: 'demo-run', step: '225', role: 'code-reviewer' });
  assert.equal(parseOutputText('Output: .company/work/demo-run/2250-code-reviewer.md'), null);
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

// ---- reprompt-gate.mjs: armed-run rules

test('ARM_TTL_MS is thirty minutes', () => {
  assert.equal(ARM_TTL_MS, 1_800_000);
});

test('runEnded needs one line that parses to an object with ev "end"', () => {
  assert.equal(runEnded('{"ev":"start"}\n{"ev":"end","outcome":"ship"}\n'), true);
  assert.equal(runEnded('{"ev":"end"}'), true);
  assert.equal(runEnded('not json\n{"ev":"end"}\n{bad'), true);
  for (const v of ['', '{"ev":"start"}\n', '{"ev":"ended"}', '{"ev":"END"}', '[{"ev":"end"}]', '"end"', 'null', '{"x":{"ev":"end"}}', '{"ev":"end"', undefined, null, 5, {}]) {
    assert.equal(runEnded(v), false, JSON.stringify(v));
  }
});

test('runEnded ignores an inherited ev', () => {
  assert.equal(runEnded('{"__proto__":{"ev":"end"}}'), false);
});

test('armLive holds inside the window and drops on age, marker or end', () => {
  const entry = { at: 1000 };
  const live = { markerFile: true, ended: false };
  assert.equal(armLive(entry, 1000, live), true);
  assert.equal(armLive(entry, 1000 + ARM_TTL_MS, live), true);
  assert.equal(armLive(entry, 1000 + ARM_TTL_MS + 1, live), false);
  assert.equal(armLive(entry, 999, live), false);
  assert.equal(armLive(entry, 2000, { markerFile: false, ended: false }), false);
  assert.equal(armLive(entry, 2000, { markerFile: true, ended: true }), false);
  assert.equal(armLive(entry, 2000, { ended: false }), false);
});
