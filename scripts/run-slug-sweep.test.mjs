// Sweep (pattern scripts/exact-case-sweep.test.mjs): no script or mod resolves a run argument
// with `isWorkFolder` alone. A v3 run slug `<ProjectID>/<NN>-<playbook>` fails `isWorkFolder`, so a reader that only
// asks it refuses every v3 run. Static scan of the real source files, no mocks.
// Fails on: an `isWorkFolder` use outside the allow-list, a reader seam that does not use `isRunSlug` or `workParts`,
// or a reader Contract without the reader paragraph. `isWorkFolder` keeps its v2 meaning (work-folder-name v3.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const LIB = 'mods/lib/work-folder.mjs'; // defines isWorkFolder; not scanned
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(rel);
  }
  return out;
};
const SCANNED = [...walk('scripts'), ...walk('mods')].filter((f) => f !== LIB).sort();

// Uses that remain, [file, snippet in the line, reason]: each one works on a v2 name by design and never resolves a run
// argument. A use is allowed only here. Add to this list only with a reason a reviewer can check.
const ALLOW = [
  ['scripts/run-state.mjs', 'if (isWorkFolder(name))', 'runSlugs: the top-level folder walk keeps the v2, v1.1 and legacy meaning, v3 project folders are expanded beside it'],
  ['scripts/draft-input.mjs', 'isWorkFolder(entry) ? branchId(entry)', 'takenFn: branch ids of the existing top-level folders, v2 meaning'],
  ['scripts/draft-input.mjs', "isWorkFolder(parent) ? 'too many runs this minute'", 'sibling helper name of a v2 parent (work-folder-name v3.0 line 18); a v3 parent never reaches it'],
];

// The scanned text of a file: import statements blanked (line count kept), whole-line and trailing `//` comments dropped.
function codeLines(rel) {
  const src = read(rel).replace(/^import[\s\S]*?from\s*'[^']*';?[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ''));
  return src.split(/\r?\n/).map((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return null;
    const cut = line.indexOf(' // ');
    return { no: i + 1, line: cut === -1 ? line : line.slice(0, cut) };
  }).filter((l) => l !== null);
}

const USE = /\bisWorkFolder\b/;

test('the sweep reads the real tree', () => {
  assert.ok(SCANNED.length > 40, `scanned ${SCANNED.length} files`);
  for (const rel of ['scripts/run-state.mjs', 'scripts/wayfinder.mjs', 'mods/lib/guard.mjs', 'mods/lib/plan-gate.mjs']) assert.ok(SCANNED.includes(rel), rel);
  assert.ok(!SCANNED.some((f) => /\.test\.mjs$/.test(f)));
  // the scanner finds a use, ignores an import and a comment
  const probe = "import {\n  a, isWorkFolder,\n} from './x.mjs';\n// isWorkFolder(x)\nconst ok = isWorkFolder(x); // isWorkFolder\n";
  assert.equal(USE.test(probe.replace(/^import[\s\S]*?from\s*'[^']*';?[ \t]*$/gm, '')), true);
});

test('no script or mod resolves a run argument with isWorkFolder alone', () => {
  const stray = [];
  for (const rel of SCANNED) {
    for (const { no, line } of codeLines(rel)) {
      if (!USE.test(line)) continue;
      if (!ALLOW.some(([file, snippet]) => file === rel && line.includes(snippet))) stray.push(`${rel}:${no}: ${line.trim()}`);
    }
  }
  assert.deepEqual(stray, [], `isWorkFolder outside the allow-list (use isRunSlug / workParts / runSlugs):\n${stray.join('\n')}`);
});

test('the allow-list entries name a file and a reason', () => {
  for (const [file, snippet, why] of ALLOW) {
    assert.ok(SCANNED.includes(file), file);
    assert.ok(snippet.length > 5 && why.length > 20, `${file}: ${snippet}`);
  }
});

// The five reader seams must take a run slug through the shared helpers.
const SEAMS = ['scripts/wayfinder.mjs', 'scripts/skill-picks.mjs', 'scripts/spec-check.mjs', 'mods/lib/guard.mjs', 'mods/lib/plan-gate.mjs'];

test('every reader seam uses isRunSlug or workParts on its run argument, and imports it from the one library', () => {
  const lacking = [];
  for (const rel of SEAMS) {
    const src = read(rel);
    const imports = /import\s*\{[^}]*\b(isRunSlug|workParts)\b[^}]*\}\s*from\s*'(\.\.\/mods\/lib|\.)\/work-folder\.mjs'/.test(src);
    const calls = codeLines(rel).some(({ line }) => /\b(isRunSlug|workParts)\s*\(/.test(line));
    if (!imports || !calls) lacking.push(`${rel} (import ${imports}, call ${calls})`);
  }
  assert.deepEqual(lacking, []);
});

test('no seam copies the run slug rule (no own `parseRun`, `isRunSlug` or `workParts`)', () => {
  const copies = [];
  for (const rel of [...SEAMS, ...SCANNED]) {
    if (codeLines(rel).some(({ line }) => /(function|const|let|var)\s+(parseRun|isRunSlug|workParts)\b/.test(line))) copies.push(rel);
  }
  assert.deepEqual([...new Set(copies)], []);
});

test('the four reader Contracts carry the reader paragraph', () => {
  const want = [['wayfinder', '1.2'], ['skill-recommendation', '2.1'], ['destination-spec', '1.5'], ['aico-mods', '1.8', '2.0']];
  const lacking = want.filter(([name, v, header = v]) => {
    const text = read(`docs/contracts/${name}.md`);
    return !text.startsWith(`# Contract: ${name} v${header}\n`) || !text.split('\n').some((l) => l.startsWith(`v${v} `) && /isRunSlug/.test(l) && /byte-identical/.test(l));
  });
  assert.deepEqual(lacking.map(([n]) => n), []);
});
