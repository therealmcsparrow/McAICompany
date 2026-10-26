// QA net for the mods: criteria that the mod and script suites only pin from the inside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const modSources = () => [...walk('hooks'), ...walk('mods')].filter(f => /\.(ts|tsx|mjs)$/.test(f) && !f.startsWith('mods/test/'));

test('AC37 no hook rewrites an event: every next() passes the event on unchanged', () => {
  for (const f of modSources()) {
    const text = read(f);
    for (const m of text.matchAll(/(?<![.\w])next\(([^)]*)\)/g)) {
      assert.match(m[1].trim(), /^(e)?$/, `${f}: next(${m[1]}) changes the event`);
    }
    assert.doesNotMatch(text, /\b(systemPrompt|system_prompt|additionalContext|appendSystem)\b/, `${f} adds to a prompt`);
  }
});

test('AC37 the only model call in the mods is Reflect model mode', () => {
  const callers = modSources().filter(f => /\.model\.complete\s*\(/.test(read(f)));
  assert.deepEqual(callers, ['mods/reflect.tsx']);
  assert.doesNotMatch(read('mods/cache-tax.tsx'), /model\.complete|agent\.(spawn|fork|run)\s*\(/);
});

test('AC37 no mod dispatches an agent or sends a prompt of its own', () => {
  for (const f of modSources()) assert.doesNotMatch(read(f), /\$\.(agent\.(spawn|fork|run|start)|prompt\.(send|submit))\s*\(/, f);
});

test('AC36/AC43 no keep-warm anywhere in the mods or their prices', () => {
  for (const f of modSources()) assert.doesNotMatch(read(f), /keep_?warm|keepwarm/i, f);
  assert.equal(fs.existsSync(path.join(root, 'mods/prices.json')), false);
});

test('AC38 the mods change no permission and never answer allow', () => {
  for (const f of modSources()) {
    const text = read(f);
    assert.doesNotMatch(text, /permission\s*:\s*['"]allow['"]|decision\s*:\s*['"]allow['"]|behavior\s*:\s*['"]allow['"]/, f);
    assert.doesNotMatch(text, /\$\.permission/, f);
  }
});

test('AC33 every mod source and type file is LF only', () => {
  const files = [...walk('hooks'), ...walk('mods'), 'types/index.d.ts'].filter(f => /\.(ts|tsx|mjs|json)$/.test(f));
  assert.ok(files.length > 10);
  assert.deepEqual(files.filter(f => read(f).includes('\r')), []);
});

test('AC35 each mod has a test for terminal and for desktop', () => {
  for (const f of ['savvy', 'cache-tax', 'reflect', 'blast-radius']) {
    const text = read(`mods/test/${f}.test.tsx`);
    assert.match(text, /terminal/, `${f}: no terminal case`);
    assert.match(text, /desktop/, `${f}: no desktop case`);
    assert.match(text, /\$\.process|process/, `${f}: no missing-process case`);
  }
});

test('AC39 NO_COLOR is read by the mods and the cache write carries a [tax] text marker', () => {
  assert.match(read('mods/lib/format.mjs'), /NO_COLOR/);
  assert.match(read('mods/cache-tax.tsx'), /\[tax\]/);
});

test('AC36/AC48 fresh defaults: all four mods on; Blast Radius core ask, security ask, contract warn', async () => {
  const { MODS_DEFAULTS } = await import('./settings.mjs');
  const b = MODS_DEFAULTS.blast_radius;
  assert.deepEqual([b.enabled, b.core, b.contract, b.security], [true, 'ask', 'warn', 'ask']);
  for (const k of ['savvy', 'cache_tax', 'reflect']) assert.equal(MODS_DEFAULTS[k].enabled, true);
  assert.match(read('documentation/mods.md'), /`core: ask`, `security: ask`, `contract: warn`/);
});

test('AC47/AC48 the commit gate registers for Bash and PowerShell only', () => {
  const t = read('mods/blast-radius.ts');
  assert.match(t, /PowerShell/);
  assert.match(t, /\bBash\b/);
  assert.match(t, /tool\.check/);
});

test('AC49 the docs name the four mods, the shell tools, the cache clock, no keep-warm and desktop unverified', () => {
  const docs = read('documentation/mods.md');
  for (const need of ['Savvy', 'Cache Tax', 'Reflect', 'Blast Radius', 'PowerShell', 'Bash', 'cache clock', 'no keep-warm', 'Unverified', 'nobody can be asked; commit refused', 'aico · <savvy> · <blast> · <cost> · <reflect>', 'mods.cache_tax.keep_warm']) {
    assert.ok(docs.includes(need) || docs.toLowerCase().includes(need.toLowerCase()), `documentation/mods.md lacks: ${need}`);
  }
  for (const key of ['mods.savvy.enabled', 'mods.savvy.pane', 'mods.cache_tax.enabled', 'mods.cache_tax.pane', 'mods.reflect.enabled', 'mods.reflect.step_check', 'mods.reflect.retrospective', 'mods.reflect.mode', 'mods.blast_radius.enabled', 'mods.blast_radius.core', 'mods.blast_radius.contract', 'mods.blast_radius.security']) {
    assert.ok(docs.includes(`\`${key}\``), `documentation/mods.md lacks setting ${key}`);
  }
  assert.match(docs, /Locks/);
  for (const f of ['README.md', 'CHANGELOG.md', 'docs/contracts/aico-mods.md']) assert.match(read(f), /Blast Radius/, f);
  assert.match(read('docs/contracts/aico-mods.md'), /## Status line/);
});

// The constants are pinned as literals here, so editing them in blast.mjs cannot also edit the check.
test('AC48 the refusal text and the 600 character cap are the ones the brief names', async () => {
  const { NOBODY, MAX_REASON, buildReason, hitsFromDepth } = await import('../mods/lib/blast.mjs');
  assert.equal(NOBODY, 'nobody can be asked; commit refused');
  assert.equal(MAX_REASON, 600);
  const paths = Array.from({ length: 80 }, (_, i) => ({ path: `src/auth/${'x'.repeat(100)}${i}.ts`, categories: ['security'], modules: ['m'] }));
  const hits = hitsFromDepth({ tier: 'high', depth: 'full', paths, truncated: false });
  const deny = buildReason(hits, 'deny', null);
  assert.ok(deny.length <= 600, String(deny.length));
  assert.ok(deny.includes('nobody can be asked; commit refused'));
  assert.ok(buildReason(hits, 'ask', 'x'.repeat(5000)).length <= 600);
});

test('AC43 the cache lifetimes are 60 minutes for the Lead and 5 for subagents', async () => {
  const c = await import('../mods/lib/cache-clock.mjs');
  assert.equal(c.MAIN_LIFETIME_MS, 3_600_000);
  assert.equal(c.SUBAGENT_LIFETIME_MS, 300_000);
});
