import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check.mjs';

const tempDirs = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

function fixture({ skills = {}, agents = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'aico-'));
  tempDirs.push(root);
  for (const [dir, text] of Object.entries(skills)) {
    mkdirSync(join(root, 'skills', dir), { recursive: true });
    writeFileSync(join(root, 'skills', dir, 'SKILL.md'), text);
  }
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [name, text] of Object.entries(agents)) writeFileSync(join(root, 'agents', `${name}.md`), text);
  return root;
}
const skill = (name, body = 'Body.', desc = 'Use when testing.') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`;
const agent = (name, body = 'Body.', model = 'sonnet') => `---\nname: ${name}\ndescription: Dispatch when testing.\ntools: Read\nmodel: ${model}\n---\n${body}\n`;

test('good fixture has no errors', () => {
  const r = check(fixture({ skills: { a: skill('a', 'See aico:b and aico:qa.') , b: skill('b') }, agents: { qa: agent('qa') } }));
  assert.deepEqual(r.errors, []);
});

test('name must match folder', () => {
  const r = check(fixture({ skills: { x: skill('y') } }));
  assert.ok(r.errors.some(e => e.includes('name mismatch')));
});

test('description over 1024 chars is an error', () => {
  const r = check(fixture({ skills: { a: skill('a', 'Body.', 'x'.repeat(1025)) } }));
  assert.ok(r.errors.some(e => e.includes('description too long')));
});

test('missing description is an error', () => {
  const r = check(fixture({ skills: { a: '---\nname: a\n---\nBody\n' } }));
  assert.ok(r.errors.some(e => e.includes('missing description')));
});

test('unknown aico reference is an error', () => {
  const r = check(fixture({ skills: { a: skill('a', 'Load aico:missing now.') } }));
  assert.ok(r.errors.some(e => e.includes('unknown reference aico:missing')));
});

test('oversized agent and skill are warnings, not errors', () => {
  const long = n => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const r = check(fixture({ skills: { a: skill('a', long(122)) }, agents: { qa: agent('qa', long(45)) } }));
  assert.ok(r.warnings.some(w => w.includes('agent 51 > 50 lines')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('skill 126 > 125 lines')), r.warnings.join('\n'));
  assert.deepEqual(r.errors, []);
});

test('invalid model is an error', () => {
  const r = check(fixture({ agents: { qa: agent('qa', 'Body.', 'gpt4') } }));
  assert.ok(r.errors.some(e => e.includes('invalid model')));
});

test('skill and agent with the same name is an error', () => {
  const r = check(fixture({ skills: { support: skill('support') }, agents: { support: agent('support') } }));
  assert.ok(r.errors.some(e => e.includes('name clash support')));
});

test('mismatched version across files is an error; matching is clean', () => {
  const root = fixture({ skills: { a: skill('a') } });
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{\n  "version": "0.7.0"\n}\n');
  mkdirSync(join(root, 'documentation'), { recursive: true });
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [0.6.0] - 2026-10-20\n- old\n');
  writeFileSync(join(root, 'documentation', 'README.md'), 'Current: **0.7.0**\n');
  const r = check(root);
  assert.ok(r.errors.some(e => e.includes('CHANGELOG.md: version 0.6.0 != plugin.json 0.7.0')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('documentation/README.md: version')), r.errors.join('\n'));
});

test('version check is skipped when plugin.json is absent', () => {
  const r = check(fixture({ skills: { a: skill('a') } }));
  assert.deepEqual(r.errors, []);
});

// ---- 0.9.0 checks: Language rule, manifest, Role counts, Playbook docs ----
const REPO = fileURLToPath(new URL('..', import.meta.url));
const playbook = (name, body = 'Resolves the language in Setup §1.6.') =>
  `---\nname: ${name}\ndescription: Use when testing.\ndisable-model-invocation: true\n---\n${body}\n`;
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const manifestRoot = m => {
  const root = fixture({});
  write(root, 'deps/skills.json', typeof m === 'string' ? m : JSON.stringify(m));
  return root;
};

test('dispatch block with Company profile: but no Language: is an error', () => {
  const bad = skill('a', 'See below.\n\n```\nCompany profile: x\nGoal: y\n```');
  const good = skill('b', '```\nCompany profile: x\nLanguage: en\nGoal: y\n```');
  const r = check(fixture({ skills: { a: bad, b: good } }));
  assert.ok(r.errors.some(e => e.includes('skills/a/SKILL.md:') && e.includes('no Language:')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('skills/b/')), r.errors.join('\n'));
});

test('a longer fence is closed only by an equal or longer fence', () => {
  const nested = skill('a', '````\nCompany profile: x\n```\ninner\n```\nLanguage: en\n````');
  assert.deepEqual(check(fixture({ skills: { a: nested } })).errors, []);
});

test('Playbook mentioning neither aico:pipeline nor section 1.6 is an error', () => {
  const r = check(fixture({ skills: {
    p: playbook('p', 'Does things.'),
    q: playbook('q', 'Language: see §1.6.'),
    s: skill('s', 'Does things.'),
  } }));
  assert.ok(r.errors.some(e => e.includes('skills/p/SKILL.md') && e.includes('Language rule')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('skills/q/') || e.includes('skills/s/')), r.errors.join('\n'));
});

test('setup and language Playbooks are exempt from the Language rule; others still fail', () => {
  const r = check(fixture({ skills: {
    setup: playbook('setup', 'Installs.'),
    language: playbook('language', 'Runs the CLI.'),
    other: playbook('other', 'Does things.'),
  } }));
  assert.ok(!r.errors.some(e => e.includes('skills/setup/') || e.includes('skills/language/')), r.errors.join('\n'));
  assert.ok(r.errors.some(e => e.includes('skills/other/SKILL.md') && e.includes('Language rule')), r.errors.join('\n'));
});

test('the 5 UI agents carry the Design skills line (AC23)', () => {
  for (const a of ['ui-ux-designer', 'frontend-engineer', 'desktop-engineer', 'game-engineer', 'brand-artist']) {
    const t = readFileSync(join(REPO, 'agents', `${a}.md`), 'utf8');
    assert.match(t, /`Design skills:`/, a);
    assert.match(t, /missing design skill: <name>/, a);
  }
});

test('project template has ## Design skills in the empty form (DS)', () => {
  const t = readFileSync(join(REPO, 'skills', 'lead', 'references', 'project-template.md'), 'utf8');
  assert.match(t, /^## Design skills\r?\n<!--[^\n]*-->\r?\n- \(none yet; the design-researcher proposes them\)\r?$/m);
  assert.doesNotMatch(t, /aico_language:/);
});

test('Playbook without a ### /aico:<name> entry in documentation/commands.md is an error', () => {
  const root = fixture({ skills: { p: playbook('p'), q: playbook('q') } });
  write(root, 'documentation/commands.md', '# Commands\n\n### `/aico:p`\n\ntext\n');
  const r = check(root);
  assert.ok(r.errors.some(e => e.includes('Playbook q has no ### /aico:q')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('Playbook p ')), r.errors.join('\n'));
  write(root, 'documentation/commands.md', '### /aico:p\n### /aico:q\n');
  assert.deepEqual(check(root).errors, []);
});

test('research entries need license and vetted', () => {
  const entry = extra => ({ research: [{ name: 'find-skills', source: 'vercel-labs/skills', ...extra }] });
  assert.deepEqual(check(manifestRoot(entry({ license: 'MIT', vetted: '2026-10-22' }))).errors, []);
  for (const bad of [{}, { license: 'MIT' }, { vetted: '2026-10-22' }, { license: 'MIT', vetted: '2026-02-30' }, { license: 'a b', vetted: '2026-10-22' }]) {
    const r = check(manifestRoot(entry(bad)));
    assert.ok(r.errors.some(e => e.includes('research entry needs')), JSON.stringify(bad));
  }
});

test('manifest name and source must match the agentsec.M-SEC7 patterns', () => {
  const badNames = ['a;b', 'a b', '-a', 'A', 'a$(x)', '', 'x'.repeat(65), 'a*b'];
  for (const name of badNames) {
    const r = check(manifestRoot({ core: [{ name, source: 'o/r' }] }));
    assert.ok(r.errors.some(e => e.includes('name fails')), JSON.stringify(name));
  }
  const badSources = ['o/r;x', 'o/r && x', 'o|r/x', 'o/..', 'o/.', '/r', 'o/', 'o/r/x', '-o/r', 'o/r`x`', 'o/r\nx', '%PATH%/x', 'o/r x', 'o/r>x', 'o/r$(x)', 'o/r^x', 'o/r"x'];
  for (const source of badSources) {
    const r = check(manifestRoot({ core: [{ name: 'x', source }] }));
    assert.ok(r.errors.some(e => e.includes('source fails')), JSON.stringify(source));
  }
  const good = { core: [
    { name: 'golang-*', source: 'samber/cc-skills-golang' },
    { name: 'impeccable', install: 'npx -y impeccable skills install' },
    { include: 'research' },
  ] };
  assert.deepEqual(check(manifestRoot(good)).errors, []);
});

test('manifest that is not valid JSON or not an object of groups is an error', () => {
  assert.ok(check(manifestRoot('{nope')).errors.some(e => e.includes('invalid JSON')));
  assert.ok(check(manifestRoot('[]')).errors.some(e => e.includes('top level')));
  assert.ok(check(manifestRoot({ core: {} })).errors.some(e => e.includes('must be an array')));
});

test('manifest check survives a __proto__ group key', () => {
  const r = check(manifestRoot('{"__proto__": [{"name":"a;b","source":"o/r"}]}'));
  assert.ok(r.errors.some(e => e.includes('name fails')), r.errors.join('\n'));
});

test('Role count in plugin.json, README, roles.md and spec must equal agents/*.md', () => {
  const root = fixture({ agents: { qa: agent('qa'), support: agent('support') } });
  write(root, '.claude-plugin/plugin.json', '{ "description": "a Lead and 3 Role agents" }');
  write(root, 'README.md', 'routes work to 2 **Role** agents. See all 5 Roles.');
  write(root, 'documentation/roles.md', 'The company has **2 Role agents**. **qa** **support**');
  write(root, 'docs/spec.md', '| qa | x |\n| support | x |\n2 Role agents.');
  const r = check(root);
  assert.ok(r.errors.some(e => e.includes('.claude-plugin/plugin.json: Role count 3 != 2')), r.errors.join('\n'));
  assert.ok(r.errors.some(e => e.includes('README.md: Role count 5 != 2')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('roles.md') || e.includes('spec.md')), r.errors.join('\n'));
});

test('an agent missing from roles.md or the spec roster is an error', () => {
  const root = fixture({ agents: { qa: agent('qa'), support: agent('support') } });
  write(root, 'documentation/roles.md', '**qa**');
  write(root, 'docs/spec.md', '| qa | x |');
  const r = check(root);
  assert.ok(r.errors.some(e => e.includes('roles.md: Role support missing')), r.errors.join('\n'));
  assert.ok(r.errors.some(e => e.includes('spec.md: Role support missing')), r.errors.join('\n'));
});

test('package.json test script is a glob, not a list of files', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const args = pkg.scripts.test.split(/\s+/).slice(2).map(a => a.replace(/^"|"$/g, ''));
  assert.ok(args.length > 0 && args.every(a => a.includes('*')), pkg.scripts.test);
  assert.ok(Number(pkg.engines.node.replace(/\D+/, '')) >= 24);
  assert.equal(pkg.private, true);
});

test('.nvmrc names an LTS major only', () => {
  assert.match(readFileSync(join(REPO, '.nvmrc'), 'utf8').trim(), /^(24|26)$/);
});

test('ci.yml is hardened: read-only token, SHA pins with tag comments, no persisted credentials', () => {
  const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /^permissions:\r?\n  contents: read\r?$/m);
  const uses = ci.split(/\r?\n/).filter(l => l.includes('uses:'));
  assert.ok(uses.length >= 2);
  for (const l of uses) assert.match(l, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, l);
  assert.match(ci, /persist-credentials: false/);
  assert.match(ci, /node-version-file: \.nvmrc/);
  assert.doesNotMatch(ci, /pull_request_target|workflow_run|npm (install|ci)/);
});

// One case per Playbook of this repo: the Language rule (dispatch-prompt v2).
const realPlaybooks = readdirSync(join(REPO, 'skills')).filter(d => {
  const f = join(REPO, 'skills', d, 'SKILL.md');
  return existsSync(f) && /^disable-model-invocation:\s*true\s*$/m.test(readFileSync(f, 'utf8'));
});

for (const name of realPlaybooks) {
  test(`Playbook ${name} resolves the language (aico:pipeline or section 1.6) and its dispatch blocks carry Language:`, () => {
    const r = check(REPO);
    assert.ok(!r.errors.some(e => e.includes(`skills/${name}/SKILL.md`) && (e.includes('Language rule') || e.includes('no Language:'))), r.errors.join('\n'));
  });
}
