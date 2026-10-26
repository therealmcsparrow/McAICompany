// T2: text pins for the skill-researcher Role, the /aico:skillspector Playbook and the install constants.
// Cases that need files T4, T6 or T7 build are `todo` until then (npm test stays green, proj.M12); the
// owning Step removes the `todo` option as each case passes. Cases that already hold are live guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const T4 = { todo: 'T4' };
const T6 = { todo: 'T6' };
const T7 = { todo: 'T7' };
const frontmatter = (text) => {
  const lines = text.split(/\r?\n/);
  return Object.fromEntries(lines.slice(1, lines.indexOf('---', 1)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const AGENT = 'agents/skill-researcher.md';
const FORBIDDEN = [
  ['npx', /\bnpx\b/i], ['skills add', /skills\s+add/i], ['install', /install/i], ['uv tool', /uv\s+tool/i], ['pip', /\bpip3?\b/i],
  ['npm i', /\bnpm\s+(i|install|ci)\b/i], ['claude mcp', /claude\s+mcp/i], ['--mode', /--mode\b/], ['mcp__skillspector', /mcp__skillspector/],
];

// ---------- the Role file (AC4, AC3) ----------
test('AC4 agent skill-researcher: frontmatter, tools, model, effort, at most 50 lines', T6, () => {
  const text = read(AGENT);
  const fm = frontmatter(text);
  assert.equal(fm.name, 'skill-researcher');
  assert.deepEqual(fm.tools.split(',').map((x) => x.trim()), ['Read', 'Grep', 'Glob', 'Skill', 'Write', 'Bash', 'WebSearch', 'WebFetch']);
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.effort, 'medium');
  assert.ok(text.split(/\r?\n/).length <= 51, 'proj.M5: at most 50 lines');
});
test('AC4 agent skill-researcher: names the residual Write and Bash risk and deviates: agentsec.S5', T6, () => {
  const text = read(AGENT);
  assert.match(text, /deviates: agentsec\.S5/);
  assert.match(text, /aico:sourcing/);
  assert.match(text, /skillspector-scan/);
});
for (const [label, re] of FORBIDDEN) {
  test(`AC4 agent skill-researcher never contains "${label}"`, T6, () => {
    assert.doesNotMatch(read(AGENT), re);
  });
}
test('AC4 agent Bash rule: only the four P3 forms of the wrapper, nothing else', T6, () => {
  const text = read(AGENT);
  const head = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs"';
  assert.ok(text.includes(head), 'the exact wrapper command prefix is named');
  const seen = new Set();
  for (const m of text.matchAll(/skillspector\.mjs"?\s+([a-z-]+)((?:\s+[^\n`]*)?)/g)) {
    const sub = m[1];
    assert.ok(['detect', 'fetch', 'scan', 'clean'].includes(sub), `forbidden subcommand: ${sub}`);
    seen.add(sub);
    const rest = m[2] ?? '';
    if (sub === 'scan') assert.match(rest, /^\s+--quarantine\b/, 'scan only with --quarantine');
    if (sub === 'clean') { assert.match(rest, /^\s+--quarantine\b/); assert.doesNotMatch(rest, /--json/, 'clean has no --json'); }
    assert.doesNotMatch(rest, /--scope|--report|--mode|--claude-cli|--no-llm/, 'no scope, report or mode flag');
  }
  assert.deepEqual([...seen].sort(), ['clean', 'detect', 'fetch', 'scan']);
  for (const banned of ['install-commands', ' list ', 'settings.mjs']) assert.ok(!text.includes(`skillspector.mjs" ${banned.trim()}`), banned);
});
test('AC4 agent never lists or calls the MCP tool and never passes --mode (the CEO Playbook does)', T6, () => {
  const text = read(AGENT);
  assert.doesNotMatch(text, /mcp__/);
  assert.doesNotMatch(text, /--mode/);
});
test('AC3 agent: a missing tool is a blocked Handoff, not an install', T6, () => {
  const text = read(AGENT);
  assert.match(text, /skillspector missing/);
  assert.match(text, /blocked/);
});

// ---------- scan_skill always passes use_llm: false (AC4) ----------
test('AC4 every scan_skill mention in agents/, skills/ and docs/ carries use_llm: false on the same line', () => {
  const files = ['agents', 'skills', 'docs'].flatMap((d) => walk(join(root, d)));
  assert.ok(files.length > 0);
  let mentions = 0;
  for (const f of files) {
    read(relative(root, f)).split(/\r?\n/).forEach((line, i) => {
      if (!line.includes('scan_skill')) return;
      mentions++;
      assert.ok(line.includes('use_llm: false'), `${relative(root, f)}:${i + 1} mentions scan_skill without use_llm: false`);
    });
  }
  assert.ok(mentions >= 1, 'the Contract mentions scan_skill once; this pin must see it');
});

// ---------- install commands: byte-identical in Contract, Playbook, script constant (AC10) ----------
const INSTALL = [
  "uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'",
  'claude mcp add --scope user skillspector -- skillspector mcp',
];
const ROLLBACK = ['uv tool uninstall skillspector', 'claude mcp remove --scope user skillspector'];
test('AC10 the Contract holds the pinned install and rollback commands byte for byte', () => {
  const text = read('docs/contracts/skillspector-scan.md');
  for (const c of [...INSTALL, ...ROLLBACK]) assert.ok(text.includes(c), c);
  assert.ok(text.includes('@v2.13.1'));
  assert.ok(!/@v2\.12\.0/.test(INSTALL.join('')), 'sanity: the pin is not the spike version');
});
test('AC10 the Playbook holds the same commands byte for byte and names v2.13.1', T7, () => {
  const text = read('skills/skillspector/SKILL.md');
  for (const c of [...INSTALL, ...ROLLBACK]) assert.ok(text.includes(c), c);
  assert.ok(text.includes('v2.13.1'));
  assert.match(text, /user[- ]scope|--scope user/);
});
test('AC10 the script constant prints the same commands (install-commands --json)', T4, () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'skillspector.mjs'), 'install-commands', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.install, INSTALL);
  assert.deepEqual(j.rollback, ROLLBACK);
  assert.ok(read('scripts/skillspector.mjs').includes('v2.13.1'));
});
test('AC10 no other file in agents/ or skills/ carries an install command for skillspector', T7, () => {
  for (const f of ['agents', 'skills'].flatMap((d) => walk(join(root, d)))) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (rel === 'skills/skillspector/SKILL.md') continue;
    assert.doesNotMatch(read(rel), /uv tool install|claude mcp add/, rel);
  }
});

// ---------- the Playbook (AC8, AC10, AC11) ----------
test('AC8 Playbook skills/skillspector/SKILL.md: frontmatter, disable-model-invocation, at most 125 lines', T7, () => {
  const text = read('skills/skillspector/SKILL.md');
  const fm = frontmatter(text);
  assert.equal(fm.name, 'skillspector');
  assert.equal(fm['disable-model-invocation'], 'true');
  assert.ok(text.split(/\r?\n/).length <= 126, 'proj.M5: at most 125 lines');
});
test('AC8 Playbook never puts user text on a command line: argument matched against list output', T7, () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /string equality/i);
  assert.match(text, /\blist\b/);
  assert.match(text, /aico:pipeline/);
});
test('AC11 Playbook maps --no-llm / --claude-cli to fixed --mode tokens and discloses claude_cli', T7, () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /--mode no-llm/);
  assert.match(text, /--mode claude_cli/);
  assert.match(text, /error not-successful/, 'discloses what happens when claude is unavailable');
});
test('AC14 Playbook reports findings with suggested removal commands and runs none', T7, () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /never run|do not run|runs none|none (is|are) run/i);
});
test('AC8 the command is documented in documentation/commands.md', T7, () => {
  assert.match(read('documentation/commands.md'), /\/aico:skillspector/);
});

// ---------- Role registration (AC1, AC7) ----------
test('AC7 company/names.json names the skill-researcher Selin', T6, () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names['skill-researcher'], 'Selin');
});
test('AC7 the Lead routes to skill-researcher and sourcing names it', T6, () => {
  assert.match(read('skills/lead/SKILL.md'), /skill-researcher/);
  assert.match(read('skills/sourcing/SKILL.md'), /skill-researcher/);
});
test('AC7 documentation/roles.md lists the skill-researcher', T6, () => {
  assert.match(read('documentation/roles.md'), /skill-researcher/);
});
test('AC4 the P3 exception is recorded in .company/standards.md under ## Exceptions (live guard)', () => {
  const text = read('.company/standards.md');
  const start = text.indexOf('## Exceptions');
  assert.ok(start >= 0);
  const next = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, next === -1 ? undefined : next);
  assert.match(section, /agentsec\.M-SEC3/);
  assert.match(section, /agents\/skill-researcher\.md/);
  assert.match(section, /signed-off:/);
});
test('guard: the new files stay inside the line caps the pins above assume', () => {
  for (const p of ['agents/skill-researcher.md', 'skills/skillspector/SKILL.md']) {
    if (!existsSync(join(root, p)) || !statSync(join(root, p)).isFile()) continue;
    const limit = p.startsWith('agents') ? 51 : 126;
    assert.ok(read(p).split(/\r?\n/).length <= limit, p);
  }
});
