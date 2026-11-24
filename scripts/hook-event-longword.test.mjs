// Tests: the long non-space run check in hooks/lib/event.mjs is linear in the command length and matches the regex it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { normalize, hasLongWord } from '../hooks/lib/event.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = () => ({ env: {}, schema: null, pluginRoot: ROOT, mcsHome: path.join(os.tmpdir(), 'mcs-none'), resolveRun: null });
const run = (command) => normalize({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, tool_name: 'Bash', tool_input: { command } }, mk());
const limitedOf = (r) => r.event.tool.paths.some((p) => p.raw === '' && p.dir === true);
const words = (size, n) => `${'a'.repeat(size)} `.repeat(Math.ceil(n / (size + 1)));

test('4096-char words: time grows linearly and 4 MB stays fast', async () => {
  const time = async (n) => { const t = process.hrtime.bigint(); await run(words(4096, n)); return Number(process.hrtime.bigint() - t) / 1e6; };
  await time(1 << 18);
  // Best of two cuts noise from a loaded machine (full suite runs files in parallel).
  const small = Math.min(await time(1 << 20), await time(1 << 20));
  const big = Math.min(await time(4 << 20), await time(4 << 20));
  // The ratio is the linearity check. The absolute bound only catches a quadratic blow-up (minutes), not a slow CPU.
  assert.ok(big < 30000, `4 MB took ${big} ms`);
  assert.ok(big / Math.max(small, 1) < 8, `ratio ${big / small}`);
});

test('equivalence with the replaced regex on varied inputs', () => {
  const old = (s) => /\S{4097,}/.test(s);
  const cases = [];
  for (const n of [0, 1, 4095, 4096, 4097, 4098, 8192]) {
    cases.push('a'.repeat(n), ` ${'a'.repeat(n)} `, `${'a'.repeat(n)} ${'b'.repeat(n)}`, `${'a'.repeat(n)}\n${'a'.repeat(n)}`, `${'a'.repeat(n)};${'a'.repeat(n)}`, `x ${'"'.repeat(n)}`, `${'a'.repeat(n)}\t${'a'.repeat(4097)}`);
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    let s = '';
    const parts = 1 + Math.floor(rnd() * 5);
    for (let j = 0; j < parts; j++) s += 'x'.repeat(4090 + Math.floor(rnd() * 14)) + ['', ' ', '\t', '\n', '\r', '\u00a0', '\u3000'][Math.floor(rnd() * 7)];
    cases.push(s);
  }
  for (const s of cases) assert.equal(hasLongWord(s), old(s), `length ${s.length}`);
});

test('a long run of quote characters still marks the probe limited', async () => {
  assert.equal(limitedOf(await run(`echo ${'"'.repeat(4097)}`)), true);
  assert.equal(limitedOf(await run(`echo ${'"'.repeat(4096)}`)), false);
});
