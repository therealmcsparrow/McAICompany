import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const FILES = [
  'docs/adr/0057-dashboard-reads-script-json-only.md',
  'docs/adr/0058-dashboard-access-token.md',
  'docs/contracts/dashboard.md',
  'docs/contracts/intake-record.md',
  'docs/contracts/pr-links.md',
  'docs/contracts/roadmap-list.md',
  'docs/contracts/run-stage.md',
  'docs/contracts/run-state.md',
  'scripts/run-state.mjs',
  'scripts/run-state.test.mjs',
  'scripts/run-state-v15.test.mjs',
  'scripts/run-state-list.test.mjs',
  'scripts/run-stage.mjs',
  'scripts/run-stage.test.mjs',
  'scripts/intake.mjs',
  'scripts/intake.test.mjs',
  'scripts/pr-links.mjs',
  'scripts/pr-links.test.mjs',
  'scripts/roadmap.mjs',
  'scripts/roadmap.test.mjs',
  'scripts/dashboard-tokens.mjs',
  'scripts/dashboard-tokens.test.mjs',
  'scripts/dashboard-data.mjs',
  'scripts/dashboard-board-fixtures.mjs',
  'scripts/dashboard-board-columns.test.mjs',
  'scripts/dashboard-card.test.mjs',
  'scripts/dashboard-rounds.test.mjs',
  'scripts/dashboard-run.mjs',
  'scripts/dashboard-run.test.mjs',
  'scripts/dashboard-run-slug.test.mjs',
  'scripts/dashboard-routing-inflight.test.mjs',
  'scripts/dashboard-server.mjs',
  'scripts/dashboard-server-helpers.mjs',
  'scripts/dashboard-server.test.mjs',
  'scripts/dashboard-server-token.test.mjs',
  'scripts/dashboard-wiring.test.mjs',
  'scripts/dashboard-live.test.mjs',
  'scripts/dashboard-page-board.test.mjs',
  'scripts/dashboard-page-drawer.test.mjs',
  'scripts/dashboard-page/index.html',
  'scripts/dashboard-page/board.js',
  'scripts/dashboard-page/drawer.js',
  'scripts/dashboard-page/live.js',
  'skills/dashboard/SKILL.md',
  'skills/lead/SKILL.md',
  'skills/triage/SKILL.md',
  'skills/pipeline/references/run-state.md',
  'documentation/commands/dashboard.md',
  'documentation/commands/README.md',
  'documentation/README.md',
  'README.md',
  'CHANGELOG.md',
];

// Packages the repo already lists; none today.
const KNOWN_PACKAGES = [];

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const CODE = FILES.filter((f) => /\.(mjs|js)$/.test(f));

function specifiers(src) {
  const out = [];
  const patterns = [
    /^\s*(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

test('AC18: every listed file exists and is LF only', () => {
  for (const f of FILES) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
    assert.ok(!read(f).includes('\r'), `CR byte in ${f}`);
  }
});

test('AC18: no new dependency in package.json', () => {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const key of ['dependencies', 'devDependencies']) {
    const names = Object.keys(pkg[key] ?? {});
    const extra = names.filter((n) => !KNOWN_PACKAGES.includes(n));
    assert.deepEqual(extra, [], `${key} names new packages`);
  }
});

test('AC18: code files import only node: built-ins or existing repo files', () => {
  for (const f of CODE) {
    for (const spec of specifiers(read(f))) {
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${f} imports package or bare module ${spec}`);
      const target = path.resolve(path.dirname(path.join(root, f)), spec);
      assert.ok(fs.existsSync(target), `${f} imports missing file ${spec}`);
      assert.ok(target.startsWith(root + path.sep), `${f} imports outside repo ${spec}`);
    }
  }
});

test('AC18: listed files hold no zazencodes text', () => {
  const needle = ['zazen', 'codes'].join('');
  for (const f of FILES) {
    assert.ok(!read(f).toLowerCase().includes(needle), `${f} names the GPL source`);
  }
});

test('AC18: the server imports only node: built-ins and three repo modules', () => {
  const allowed = new Set(['./dashboard-data.mjs', './dashboard-run.mjs', './pr-links.mjs']);
  for (const spec of specifiers(read('scripts/dashboard-server.mjs'))) {
    assert.ok(spec.startsWith('node:') || allowed.has(spec), `server imports ${spec}`);
  }
});

test('AC18: page assets load no external code and do not use innerHTML', () => {
  for (const f of FILES.filter((x) => x.startsWith('scripts/dashboard-page/'))) {
    const src = read(f);
    assert.ok(!/innerHTML|insertAdjacentHTML/.test(src), `${f} writes HTML`);
    assert.ok(!/(?:src|href)\s*=\s*["']https?:/i.test(src), `${f} loads an external URL`);
  }
});

test('AC18: docs name start, stop, token link, --lan and the warning', () => {
  const doc = read('documentation/commands/dashboard.md');
  const server = read('scripts/dashboard-server.mjs');
  const board = read('scripts/dashboard-page/board.js');
  const live = read('scripts/dashboard-page/live.js');
  assert.match(doc, /\*\*Start:\*\*/);
  assert.match(doc, /\*\*Stop:\*\*/);
  assert.match(doc, /\/t\/<token>\//);
  assert.match(doc, /--lan/);
  assert.match(doc, /WARNING/);

  const warning = server.match(/LAN_WARNING\s*=\s*'([^']+)'/);
  assert.ok(warning, 'LAN_WARNING not found in server');
  assert.ok(doc.includes(warning[1]), 'docs do not quote the server warning');

  const banner = board.match(/LAN_TEXT\s*=\s*'([^']+)'/);
  assert.ok(banner, 'LAN_TEXT not found in board.js');
  assert.ok(doc.includes(banner[1]), 'docs do not quote the page banner');

  const stopped = live.match(/STOPPED\s*=\s*'([^']+)'/);
  assert.ok(stopped, 'STOPPED not found in live.js');
  assert.ok(doc.includes(stopped[1]), 'docs do not quote the stopped text');
  for (const text of ['Updates paused', 'Updates resumed']) {
    assert.ok(live.includes(`'${text}'`), `live.js lacks ${text}`);
    assert.ok(doc.includes(text), `docs lack ${text}`);
  }
});

test('AC18: the skill repeats the --lan warning and names the launch command', () => {
  const skill = read('skills/dashboard/SKILL.md');
  assert.match(skill, /--lan/);
  assert.match(skill, /dashboard-server\.mjs/);
  assert.match(skill, /warning/i);
  assert.match(skill, /link/i);
});
