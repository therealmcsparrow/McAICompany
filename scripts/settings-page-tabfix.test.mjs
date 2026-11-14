import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Regression tests for the Skills tab card grid and the Personality tab look.
const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const STYLE = PAGE.slice(0, PAGE.indexOf('</style>'));
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));

function fnBody(src, name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `function ${name} exists`);
  const rest = src.slice(m.index + 1);
  const next = rest.search(/^(?:async )?function /m);
  return next < 0 ? rest : rest.slice(0, next);
}
// CSS rules (selector, body) whose selector list names `sel` exactly.
const rulesFor = (css, sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter((m) => m[1].split(',').some((s) => s.trim().replace(/^\/\*.*?\*\/\s*/s, '') === sel)).map((m) => m[2]);

// ---------- Item 1: Skills tab ----------

test('skills: .jacks is a fixed 4-column grid at every width', () => {
  const rules = rulesFor(STYLE, '.jacks');
  assert.ok(rules.length > 0, '.jacks has a rule');
  assert.ok(rules.some((r) => /display:\s*grid/.test(r)), '.jacks is display: grid');
  const cols = rules.flatMap((r) => [...r.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1]));
  assert.ok(cols.length > 0, '.jacks sets grid-template-columns');
  for (const c of cols) assert.match(c, /^repeat\(\s*4\s*,/, `every .jacks column rule is 4 columns, got: ${c}`);
  assert.ok(!rules.some((r) => /flex-wrap/.test(r)), '.jacks no longer a wrapping flex row');
});

test('skills: a skill card shows no info text below the card', () => {
  const src = SCRIPT.slice(SCRIPT.indexOf('function skillRow'), SCRIPT.indexOf('function skillCard'));
  const visibleInfo = [...src.matchAll(/class:\s*'([^']*jack-info[^']*)'/g)].filter((m) => !/\bvh\b/.test(m[1]));
  assert.equal(visibleInfo.length, 0, 'no visible .jack-info under a card (hide with .vh or drop it)');
  const rowLi = /row\.li = el\('div', \{ class: 'jack' \}([^;]*);/.exec(src);
  assert.ok(rowLi, 'skillRow builds row.li');
  assert.ok(!/el\('div', \{ class: 'jack-info' \}/.test(rowLi[0]), 'row.li holds no .jack-info div');
});

test('skills: cards are one fixed size (label fills the cell, long text is clipped not wrapped taller)', () => {
  const label = rulesFor(STYLE, '.jack label').join('\n');
  assert.match(label, /height:\s*100%|min-height:\s*[\d.]+r?em|aspect-ratio|(?:^|[\s;])height:\s*[\d.]+r?em/, '.jack label has a fixed or filling height');
  const meta = rulesFor(STYLE, '.jack label .meta').join('\n');
  assert.match(meta, /text-overflow:\s*ellipsis|overflow:\s*hidden|line-clamp/, 'long meta text is clipped');
  assert.ok(!/overflow-wrap:\s*anywhere/.test(meta), 'meta no longer wraps onto extra lines');
});

// ---------- Item 2: Personality tab look ----------

const persSrc = () => ['renderPersonality', 'levelFieldset', 'personalityField'].map((n) => fnBody(SCRIPT, n)).join('\n');

// Expected .pers rules of the Personality tab (whitespace-normalised).
const PERS_RULES = [
  ".pers { display: grid; gap: var(--space-2); }",
  ".pers details { border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-panel-2); }",
  ".pers details.dirty { border-color: var(--lvl-led); }",
  ".pers summary { cursor: pointer; padding: var(--space-3) var(--space-4); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px var(--space-3); align-items: baseline; list-style: none; }",
  ".pers summary::-webkit-details-marker { display: none; }",
  ".pers summary::before { content: \"+\"; font-family: var(--font-mono); color: var(--color-ink-2); grid-row: span 2; }",
  ".pers details[open] summary::before { content: \"−\"; }",
  ".pers summary .who { font-family: var(--font-display); font-weight: 600; font-size: var(--text-lg); text-transform: uppercase; letter-spacing: .03em; }",
  ".pers summary .gist { font-size: var(--text-sm); color: var(--color-ink-2); overflow-wrap: anywhere; }",
  ".pers .body { padding: 0 var(--space-4) var(--space-4); display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); }",
];

test('personality: the .pers CSS has the expected rules', () => {
  const pick = (css) => [...css.matchAll(/(^|\n)(\.pers[^{\n]*\{[^}]*\})/g)].map((m) => m[2].replace(/\s+/g, ' ').trim());
  const have = pick(STYLE);
  for (const r of PERS_RULES) assert.ok(have.includes(r), `page has rule: ${r.slice(0, 60)}`);
});

test('personality: a Role body is plain .ctl rows, no per-level fieldset', () => {
  const src = persSrc();
  assert.ok(!/class:\s*'plevel'/.test(src), 'no fieldset.plevel');
  assert.ok(!/legend/.test(src), 'no "<Role>, <level> level" legend');
  assert.ok(/class:\s*'ctl'/.test(src) || /textRow|switchRow/.test(src), 'rows are .ctl controls');
});

test('personality: no "In effect" block under the fields', () => {
  const src = persSrc();
  assert.ok(!/peff/.test(src), 'no .peff block');
  assert.ok(!/In effect for/.test(src), 'no "In effect for" heading');
});

test('personality: intelligence and creativity are segmented switches, not selects', () => {
  const src = persSrc();
  assert.ok(!/el\('select'/.test(src), 'no <select> in the Personality tab');
  assert.ok(/class:\s*'seg|segFor|switchRow/.test(src), 'a .seg switch builds the low/medium/high choice');
});

test('personality: summary gist reads "temperament · talk · topic · intelligence X, creativity Y"', () => {
  const src = fnBody(SCRIPT, 'syncPersonality');
  assert.ok(/' · '/.test(src), 'gist joins with " · "');
  assert.ok(/intelligence \$\{/.test(src) && /creativity \$\{/.test(src), 'gist ends "intelligence X, creativity Y"');
  assert.ok(!/join\(', '\)/.test(src), 'old comma-joined gist removed');
});
