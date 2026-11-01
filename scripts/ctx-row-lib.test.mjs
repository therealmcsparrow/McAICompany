import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fmtCtx, ctxCell, leadRow, worstNote, idChunks, pairUp, NEAR_CAP, OVER_CAP } from '../mods/lib/ctx-row.mjs';
import { guardAgentCtx, guardLeadCtx } from '../mods/lib/guard.mjs';

const own = (name) => readFileSync(fileURLToPath(new URL(`../mods/lib/${name}`, import.meta.url)), 'utf8');

test('fmtCtx prints whole tokens below 1000 and thousands with one decimal', () => {
  assert.equal(fmtCtx(0), '0');
  assert.equal(fmtCtx(999), '999');
  assert.equal(fmtCtx(1000), '1.0k');
  assert.equal(fmtCtx(90000), '90.0k');
  assert.equal(fmtCtx(95000), '95.0k');
});

test('fmtCtx refuses anything that is not a count', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '90000', null, undefined, {}, [], 10000001]) assert.equal(fmtCtx(bad), '?');
});

test('ctxCell: plain, near cap past 85500, over cap past 95000, ? when unknown', () => {
  assert.equal(NEAR_CAP, 85500);
  assert.equal(OVER_CAP, 95000);
  assert.equal(ctxCell(40000), 'ctx 40.0k');
  assert.equal(ctxCell(85500), 'ctx 85.5k');
  assert.equal(ctxCell(85501), 'ctx 85.5k near cap');
  assert.equal(ctxCell(90000), 'ctx 90.0k near cap');
  assert.equal(ctxCell(95000), 'ctx 95.0k near cap');
  assert.equal(ctxCell(95001), 'ctx 95.0k over cap');
  assert.equal(ctxCell(null), 'ctx ?');
  assert.equal(ctxCell('x'), 'ctx ?');
});

test('leadRow prefixes the cell with Lead', () => {
  assert.equal(leadRow(90000), 'Lead ctx 90.0k near cap');
  assert.equal(leadRow(null), 'Lead ctx ?');
});

test('idChunks drops hostile ids before they reach argv', () => {
  const hostile = ['--json', '-x', 'a b', '../x', 'a/b', 'a'.repeat(65), '', 'ok\n', 42, null, undefined, {}, 'a;b', 'x$(y)'];
  assert.deepEqual(idChunks(hostile), []);
  assert.deepEqual(idChunks(['good_1', '--json', 'good-2']), [['good_1', 'good-2']]);
  assert.deepEqual(idChunks('abc'), []);
});

test('idChunks keeps order, drops repeats, chunks of 8, at most 5 chunks', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
  assert.deepEqual(idChunks(ids).map((c) => c.length), [8, 4]);
  assert.deepEqual(idChunks([...ids, 'a0', 'a1']).map((c) => c.length), [8, 4]);
  const many = Array.from({ length: 100 }, (_, i) => `b${i}`);
  const chunks = idChunks(many);
  assert.equal(chunks.length, 5);
  assert.equal(chunks.flat().length, 40);
});

test('pairUp matches by id, not by place, and nulls what was not answered', () => {
  const answer = { agents: [{ agent: 'b', ctx: 5 }, { agent: 'zzz', ctx: 9 }] };
  assert.deepEqual(pairUp(['a', 'b'], answer), [{ id: 'a', ctx: null }, { id: 'b', ctx: 5 }]);
  assert.deepEqual(pairUp(['a'], null), [{ id: 'a', ctx: null }]);
  assert.deepEqual(pairUp(['a'], { agents: 'x' }), [{ id: 'a', ctx: null }]);
});

test('guardAgentCtx accepts the exact shape, integers or null', () => {
  const good = { v: 1, agents: [{ agent: 'a1', ctx: 90000 }, { agent: 'a2', ctx: null }] };
  assert.deepEqual(JSON.parse(JSON.stringify(guardAgentCtx(good))), good);
  assert.deepEqual(guardAgentCtx({ v: 1, agents: [] }).agents, []);
});

test('guardAgentCtx rejects hostile shapes', () => {
  const one = (o) => ({ v: 1, agents: [{ agent: 'a1', ctx: 1, ...o }] });
  const bad = [
    null, [], 'x', 7, {}, { v: 1 }, { v: 2, agents: [] }, { agents: [] },
    { v: 1, agents: {} }, { v: 1, agents: Array.from({ length: 9 }, () => ({ agent: 'a', ctx: 1 })) },
    one({ ctx: 1.5 }), one({ ctx: -1 }), one({ ctx: '5' }), one({ ctx: 10000001 }), one({ ctx: NaN }),
    one({ agent: '--json' }), one({ agent: 'a b' }), one({ agent: 'a'.repeat(65) }), one({ agent: 3 }),
    { v: 1, agents: [{ agent: 'a1' }] }, { v: 1, agents: [{ ctx: 1 }] }, { v: 1, agents: [null] },
  ];
  for (const b of bad) assert.equal(guardAgentCtx(b), undefined, JSON.stringify(b));
});

test('guardAgentCtx ignores inherited keys and drops unknown extra keys', () => {
  const inherited = Object.create({ v: 1, agents: [] });
  assert.equal(guardAgentCtx(inherited), undefined);
  const out = guardAgentCtx(JSON.parse('{"v":1,"agents":[],"__proto__":{"x":1},"extra":1}'));
  assert.deepEqual(Object.keys(out), ['v', 'agents']);
  assert.equal(Object.getPrototypeOf(out), null);
});

test('guardLeadCtx accepts counts and nulls, rejects the rest', () => {
  const good = { v: 1, ctx: 42000, peak: 50000, at: '2026-11-01T14:00:00Z' };
  assert.deepEqual(JSON.parse(JSON.stringify(guardLeadCtx(good))), good);
  assert.deepEqual(JSON.parse(JSON.stringify(guardLeadCtx({ v: 1, ctx: null, peak: null, at: null }))), { v: 1, ctx: null, peak: null, at: null });
  const bad = [
    null, {}, { v: 1, ctx: 1, peak: 1 }, { ...good, v: 2 }, { ...good, ctx: 1.5 }, { ...good, ctx: '1' }, { ...good, peak: -1 },
    { ...good, at: 'yesterday' }, { ...good, at: 5 }, { v: 1, peak: 1, at: null }, Object.create(good),
  ];
  for (const b of bad) assert.equal(guardLeadCtx(b), undefined, JSON.stringify(b));
});

test('ctx-row.mjs imports only format.mjs and guard.mjs: no engine object, no Node module, no npm package', () => {
  const imports = own('ctx-row.mjs').match(/^import .* from '.*';$/gm) ?? [];
  assert.deepEqual(imports, ["import { UNKNOWN } from './format.mjs';", "import { AGENT_ID, MAX_CTX } from './guard.mjs';"]);
  assert.doesNotMatch(own('ctx-row.mjs'), /\$\.|node:|require\(/);
});

test('worstNote: over cap beats near cap, nothing below the line, unknowns ignored', () => {
  assert.equal(worstNote([40000, null, 'x']), '');
  assert.equal(worstNote([85500]), '');
  assert.equal(worstNote([85501, 1]), 'near cap');
  assert.equal(worstNote([90000, 95001]), 'over cap');
  assert.equal(worstNote([]), '');
  assert.equal(worstNote('nope'), '');
});
