import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fmtCtx, ctxCell, leadRow, worstNote, idChunks, pairUp, NEAR_CAP, OVER_CAP } from '../mods/lib/ctx-row.mjs';
import { guardAgentCtx, guardLeadCtx, guardRunActive } from '../mods/lib/guard.mjs';

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

// ctxCell(n, cap, handover), leadRow(n, cap, handover), worstNote(counts, cap, handover): the run's values;
// absent or not a whole number 60000-1000000 (handover: not a whole number up to the cap) means 180000 and 162000.
test('AC11: ctxCell with run cap 120000 and handover 108000: near cap past 108000, over cap past 120000', () => {
  assert.equal(ctxCell(40000, 120000, 108000), 'ctx 40.0k');
  assert.equal(ctxCell(108000, 120000, 108000), 'ctx 108.0k');
  assert.equal(ctxCell(108001, 120000, 108000), 'ctx 108.0k near cap');
  assert.equal(ctxCell(110000, 120000, 108000), 'ctx 110.0k near cap');
  assert.equal(ctxCell(120000, 120000, 108000), 'ctx 120.0k near cap');
  assert.equal(ctxCell(120001, 120000, 108000), 'ctx 120.0k over cap');
  assert.equal(ctxCell(130000, 120000, 108000), 'ctx 130.0k over cap');
});

test('AC11: the old 85500 and 95000 lines are gone under a bigger run cap', () => {
  assert.equal(ctxCell(90000, 120000, 108000), 'ctx 90.0k');
  assert.equal(ctxCell(96000, 120000, 108000), 'ctx 96.0k');
  assert.equal(ctxCell(96000), 'ctx 96.0k');
});

test('AC9: absent cap and handover read 162000 and 180000', () => {
  assert.equal(ctxCell(162000), 'ctx 162.0k');
  assert.equal(ctxCell(162001), 'ctx 162.0k near cap');
  assert.equal(ctxCell(180000), 'ctx 180.0k near cap');
  assert.equal(ctxCell(180001), 'ctx 180.0k over cap');
  assert.equal(ctxCell(null), 'ctx ?');
  assert.equal(ctxCell('x'), 'ctx ?');
  assert.equal(ctxCell(null, 120000, 108000), 'ctx ?');
});

test('hostile cap and handover (string, null, negative, fraction, out of range, object) fall back to 180000 and 162000', () => {
  const bad = ['120000', null, undefined, -1, 0, 59999, 1000001, 120000.5, NaN, Infinity, {}, [120000], true];
  for (const v of bad) {
    assert.equal(ctxCell(170000, v, v), 'ctx 170.0k near cap', String(v));
    assert.equal(ctxCell(181000, v, v), 'ctx 181.0k over cap', String(v));
    assert.equal(ctxCell(150000, v, v), 'ctx 150.0k', String(v));
  }
});

test('wcag.M10: near and over marks are text words, not colour', () => {
  assert.match(ctxCell(110000, 120000, 108000), / near cap$/);
  assert.match(ctxCell(121000, 120000, 108000), / over cap$/);
  assert.doesNotMatch(ctxCell(121000, 120000, 108000), /|<|color/i);
});

test('leadRow prefixes the cell with Lead and carries the run cap', () => {
  assert.equal(leadRow(110000, 120000, 108000), 'Lead ctx 110.0k near cap');
  assert.equal(leadRow(125000, 120000, 108000), 'Lead ctx 125.0k over cap');
  assert.equal(leadRow(90000), 'Lead ctx 90.0k');
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

test('ctx-row.mjs imports only format.mjs, guard.mjs and context-cap.mjs: no engine object, no Node module, no npm package', () => {
  const imports = own('ctx-row.mjs').match(/^import .* from '.*';$/gm) ?? [];
  assert.deepEqual(imports.filter((l) => !l.includes('./context-cap.mjs')), ["import { UNKNOWN } from './format.mjs';", "import { AGENT_ID, MAX_CTX } from './guard.mjs';"]);
  for (const l of imports) assert.match(l, /from '\.\/(format|guard|context-cap)\.mjs';$/);
  assert.doesNotMatch(own('ctx-row.mjs'), /\$\.|node:|require\(/);
});

test('worstNote: over cap beats near cap, nothing below the line, unknowns ignored', () => {
  assert.equal(worstNote([40000, null, 'x'], 120000, 108000), '');
  assert.equal(worstNote([108000], 120000, 108000), '');
  assert.equal(worstNote([108001, 1], 120000, 108000), 'near cap');
  assert.equal(worstNote([110000, 120001], 120000, 108000), 'over cap');
  assert.equal(worstNote([96000, 100000], 120000, 108000), '');
  assert.equal(worstNote([], 120000, 108000), '');
  assert.equal(worstNote('nope', 120000, 108000), '');
});

test('worstNote without a run cap reads 162000 and 180000, and a hostile cap falls back to them', () => {
  assert.equal(worstNote([95001]), '');
  assert.equal(worstNote([162001]), 'near cap');
  assert.equal(worstNote([180001]), 'over cap');
  for (const v of ['120000', null, -1, 59999, 1000001, 1.5, {}]) assert.equal(worstNote([170000], v, v), 'near cap', String(v));
});

test('guardRunActive accepts view cap and handover as whole numbers or null and rejects the rest', () => {
  const view = { v: 1, slug: 'demo', state: 'running', started: null, ended: null, outcome: null, wave: 1, gates: [], round: 0, tier: 'high', steps: [], warnings: [] };
  const wrap = (extra) => ({ slug: 'demo', view: { ...view, ...extra } });
  const kept = guardRunActive(wrap({ cap: 120000, handover: 108000 }));
  assert.equal(kept.view.cap, 120000);
  assert.equal(kept.view.handover, 108000);
  const nulls = guardRunActive(wrap({ cap: null, handover: null }));
  assert.ok(nulls !== undefined);
  assert.ok(guardRunActive(wrap({})) !== undefined);
  for (const bad of ['120000', -1, 1.5, 59999, 1000001, {}, []]) {
    const out = guardRunActive(wrap({ cap: bad, handover: 108000 }));
    assert.ok(out === undefined || out.view === undefined || out.view.cap === undefined || out.view.cap === null, JSON.stringify(bad));
    assert.ok(out === undefined || out.view === undefined || out.view.cap !== bad, JSON.stringify(bad));
  }
});
