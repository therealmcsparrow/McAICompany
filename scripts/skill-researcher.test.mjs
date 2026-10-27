// Text pins for the skill-researcher Role, the Lead's skill-picks reference, the /aico:skillspector Playbook,
// the install constants and the wording of the scan mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const order = (text, parts) => {
  let at = -1;
  for (const p of parts) {
    const i = text.indexOf(p, at + 1);
    assert.ok(i > at, `missing or out of order: ${p}`);
    at = i;
  }
};
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

// ---------- the Role file ----------
test('AC4 agent skill-researcher: frontmatter, tools, model, effort, at most 50 lines', () => {
  const text = read(AGENT);
  const fm = frontmatter(text);
  assert.equal(fm.name, 'skill-researcher');
  assert.deepEqual(fm.tools.split(',').map((x) => x.trim()), ['Read', 'Grep', 'Glob', 'Skill', 'Write', 'WebSearch', 'WebFetch']);
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.effort, 'medium');
  assert.ok(text.split(/\r?\n/).length <= 51, 'at most 50 lines');
});
test('AC4 agent skill-researcher: names the residual Write and WebFetch risk and deviates: agentsec.S5', () => {
  const text = read(AGENT);
  assert.match(text, /deviates: agentsec\.S5/);
  assert.match(text, /aico:sourcing/);
  assert.match(text, /WebFetch/);
  assert.match(text, /bypass/i, 'names bypass and auto-accept modes');
});
for (const [label, re] of FORBIDDEN) {
  test(`AC4 agent skill-researcher never contains "${label}"`, () => {
    assert.doesNotMatch(read(AGENT), re);
  });
}
test('AC4 agent has no Bash and holds no skillspector command (the Lead scans)', () => {
  const text = read(AGENT);
  assert.ok(!frontmatter(text).tools.split(',').map((x) => x.trim()).includes('Bash'), 'tools: has no Bash');
  assert.doesNotMatch(text, /skillspector\.mjs/);
});
test('AC4 agent never lists or calls the MCP tool and never passes --mode (the CEO Playbook does)', () => {
  const text = read(AGENT);
  assert.doesNotMatch(text, /mcp__/);
  assert.doesNotMatch(text, /--mode/);
});
test('AC3 agent does not probe the scanner; the Lead does before the dispatch', () => {
  const text = read(AGENT);
  assert.doesNotMatch(text, /skillspector missing|\bdetect\b/);
});

// ---------- scan_skill always passes use_llm: false ----------
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

// ---------- install commands: byte-identical in Contract, Playbook, script constant ----------
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
test('AC10 the Playbook holds the same commands byte for byte and names v2.13.1', () => {
  const text = read('skills/skillspector/SKILL.md');
  for (const c of [...INSTALL, ...ROLLBACK]) assert.ok(text.includes(c), c);
  assert.ok(text.includes('v2.13.1'));
  assert.match(text, /user[- ]scope|--scope user/);
});
test('AC10 the script constant prints the same commands (install-commands --json)', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'skillspector.mjs'), 'install-commands', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.install, INSTALL);
  assert.deepEqual(j.rollback, ROLLBACK);
  assert.ok(read('scripts/skillspector.mjs').includes('v2.13.1'));
});
test('AC10 no other file in agents/ or skills/ carries an install command for skillspector', () => {
  for (const f of ['agents', 'skills'].flatMap((d) => walk(join(root, d)))) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (rel === 'skills/skillspector/SKILL.md') continue;
    assert.doesNotMatch(read(rel), /uv tool install|claude mcp add/, rel);
  }
});

// ---------- the Playbook ----------
test('AC8 Playbook skills/skillspector/SKILL.md: frontmatter, disable-model-invocation, at most 125 lines', () => {
  const text = read('skills/skillspector/SKILL.md');
  const fm = frontmatter(text);
  assert.equal(fm.name, 'skillspector');
  assert.equal(fm['disable-model-invocation'], 'true');
  assert.ok(text.split(/\r?\n/).length <= 126, 'at most 125 lines');
});
test('AC8 Playbook never puts user text on a command line: argument matched against list output', () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /string equality/i);
  assert.match(text, /\blist\b/);
  assert.match(text, /aico:pipeline/);
});
test('AC11 Playbook maps --no-llm / --claude-cli to fixed --mode tokens and discloses claude_cli', () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /--mode no-llm/);
  assert.match(text, /--mode claude_cli/);
  assert.match(text, /error not-successful/, 'discloses what happens when claude is unavailable');
});
test('AC14 Playbook reports findings with suggested removal commands and runs none', () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(text, /never run|do not run|runs none|none (is|are) run/i);
});
test('AC8 the command is documented in documentation/commands.md', () => {
  assert.match(read('documentation/commands.md'), /\/aico:skillspector/);
});

// ---------- Role registration ----------
test('AC7 company/names.json names the skill-researcher Selin', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names['skill-researcher'], 'Selin');
});
test('AC7 the Lead routes to skill-researcher and sourcing names it', () => {
  assert.match(read('skills/lead/SKILL.md'), /skill-researcher/);
  assert.match(read('skills/sourcing/SKILL.md'), /skill-researcher/);
});
test('AC7 documentation/roles.md lists the skill-researcher', () => {
  assert.match(read('documentation/roles.md'), /skill-researcher/);
});
test('guard: the new files stay inside the line caps the pins above assume', () => {
  for (const p of ['agents/skill-researcher.md', 'skills/skillspector/SKILL.md']) {
    if (!existsSync(join(root, p)) || !statSync(join(root, p)).isFile()) continue;
    const limit = p.startsWith('agents') ? 51 : 126;
    assert.ok(read(p).split(/\r?\n/).length <= limit, p);
  }
});

// ---------- the Lead's side: skill-picks.md ----------
const PICKS = 'skills/lead/references/skill-picks.md';
test('AC3 skill-picks: detect runs before the dispatch; vet comes after the Handoff', () => {
  const t = read(PICKS);
  order(t, ['## 1. Before the dispatch', 'skillspector.mjs" detect', '## 2. Dispatch', 'skill-picks.mjs" vet']);
  assert.match(t, /always asked, whatever `gates\.installs` says/);
});
test('AC5 skill-picks: approve form then install form; the stop form is never auto', () => {
  const t = read(PICKS);
  order(t, ['**Approve form** (never auto', '**Install', 'Post-install scan']);
  assert.match(t, /Stop the run \(Recommended\) \/ Keep it and go on/);
  assert.match(t, /`blocking: true`/);
  assert.match(t, /never auto, whatever the Gate settings/);
  assert.match(t, /never answers the approve form or the stop form/);
});
test('AC14 skill-picks: the Lead suggests the removal command and runs none', () => {
  const t = read(PICKS);
  assert.match(t, /run no removal command/);
  assert.match(t, /run any removal command/);
  assert.match(t, /npx -y skills@1\.7\.4 remove <name> -a claude-code/);
});

// ---------- Playbook scope (--all, the scope form) ----------
test('AC8 Playbook: --all is an argument and a scope form asks when the scope is missing or doubled', () => {
  const text = read('skills/skillspector/SKILL.md');
  assert.match(frontmatter(text)['argument-hint'], /--all/);
  assert.match(text, /--all/);
  assert.match(text, /Project \(Recommended\)/);
  assert.match(text, /Global/);
  assert.match(text, /\bAll\b/);
});

// ---------- what no-llm sends: OSV.dev named everywhere, "nothing leaves" nowhere ----------
const MODE_FILES = ['scripts/settings-page.html', 'docs/contracts/aico-settings.md', 'docs/contracts/skillspector-scan.md', 'skills/skillspector/SKILL.md', 'documentation/commands.md', 'CHANGELOG.md'];
test('no file outside .company says nothing leaves the machine', () => {
  const claim = /nothing\s+leaves|no\s+data\s+leaves/i;
  const skip = new Set(['.git', '.company', 'node_modules', 'types']);
  const hits = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!/\.(md|mjs|js|ts|tsx|html|json)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      if (claim.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p));
    }
  };
  scan(root);
  assert.deepEqual(hits, []);
});
test('every text that describes the no-llm mode names the OSV.dev lookup', () => {
  for (const f of MODE_FILES) {
    const lines = read(f).split(/\r?\n/).filter((l) => /no-?llm/i.test(l) && /machine|static rules|leaves/i.test(l));
    assert.ok(lines.length > 0, `${f} describes no-llm`);
    for (const l of lines) assert.match(l, /OSV\.dev/, `${f}: ${l.slice(0, 80)}`);
  }
});
const EGRESS_FILES = [...MODE_FILES, 'documentation/concepts.md', 'README.md'];
test('every no-llm description names ecosystems and never says "package names and versions"', () => {
  for (const f of EGRESS_FILES) {
    const text = read(f);
    const stale = text.split(/\r?\n/).filter((l) => /package names and versions/i.test(l) && !/never "package names and versions"/.test(l));
    assert.deepEqual(stale, [], `${f} uses the old egress phrase`);
    const lines = text.split(/\r?\n/).filter((l) => /no-?llm/i.test(l) && /OSV\.dev/.test(l));
    assert.ok(lines.length > 0, `${f} describes the no-llm egress`);
    for (const l of lines) assert.match(l, /ecosystems/, `${f}: ${l.slice(0, 80)}`);
  }
});
test('the Playbook states the OSV.dev lookup before it scans', () => {
  assert.match(read('skills/skillspector/SKILL.md'), /OSV\.dev/);
});

// ---------- skill-picks.md: post-install checks ----------
const postInstall = () => {
  const t = read(PICKS);
  const i = t.indexOf('## 4.');
  const j = t.indexOf('## 5.');
  assert.ok(i >= 0 && j > i, 'sections 4 and 5 exist');
  return t.slice(i, j);
};
test('skill-picks post-install: check-install runs with the name and hash from vet, before the scan', () => {
  const t = postInstall();
  order(t, ['skill-picks.mjs" check-install --name <name> --hash <hash>', 'skillspector.mjs" scan --scope project --skill <name>']);
  assert.match(t, /`picks\[\]\.name`/);
  assert.match(t, /`picks\[\]\.hash`/);
  assert.match(t, /from the `vet` output only/);
});
test('skill-picks post-install: every other outcome stops the run', () => {
  const t = postInstall();
  assert.match(t, /Go on only when `check-install` printed `bound: true`/);
  for (const stop of ['`bound: false`', 'refused: ', 'a non-zero exit', 'output that is not one JSON document', 'an empty `results`']) {
    assert.ok(t.includes(stop), `stop case missing: ${stop}`);
  }
  assert.match(t, /\*\*stops the run\*\*/);
  assert.match(t, /never auto, whatever the Gate settings/);
});
test('skill-picks: no step runs a removal command; the removal text is only suggested', () => {
  const t = read(PICKS);
  assert.match(t, /run no removal command/);
  const mentions = t.split(/\r?\n/).filter((l) => /remove <name>/.test(l));
  assert.ok(mentions.length > 0);
  for (const l of mentions) assert.doesNotMatch(l, /^\s*(\d+\.|-)\s*`?(npx|node)\b/, `a step runs removal: ${l.slice(0, 80)}`);
});
