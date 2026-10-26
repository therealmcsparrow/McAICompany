import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, checkBrainstorm, checkPack, checkPacks } from './check.mjs';

const tempDirs = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

function fixture({ skills = {}, agents = {}, names }) {
  const root = mkdtempSync(join(tmpdir(), 'aico-'));
  tempDirs.push(root);
  for (const [dir, text] of Object.entries(skills)) {
    mkdirSync(join(root, 'skills', dir), { recursive: true });
    writeFileSync(join(root, 'skills', dir, 'SKILL.md'), text);
  }
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [name, text] of Object.entries(agents)) writeFileSync(join(root, 'agents', `${name}.md`), text);
  if (names) {
    mkdirSync(join(root, 'company'), { recursive: true });
    writeFileSync(join(root, 'company', 'names.json'), JSON.stringify(names));
  }
  return root;
}
const skill = (name, body = 'Body.', desc = 'Use when testing.') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`;
const agent = (name, body = 'Body.', model = 'sonnet', effort = 'medium') =>
  `---\nname: ${name}\ndescription: Dispatch when testing.\ntools: Read\nmodel: ${model}\n${effort ? `effort: ${effort}\n` : ''}---\n${body}\n`;

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
  const r = check(fixture({ skills: { a: skill('a', long(122)) }, agents: { qa: agent('qa', long(44)) } }));
  assert.ok(r.warnings.some(w => w.includes('agent 51 > 50 lines')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('skill 126 > 125 lines')), r.warnings.join('\n'));
  assert.deepEqual(r.errors, []);
});

test('invalid model is an error', () => {
  const r = check(fixture({ agents: { qa: agent('qa', 'Body.', 'gpt4') } }));
  assert.ok(r.errors.some(e => e.includes('invalid model')));
});

test('invalid effort is an error', () => {
  const r = check(fixture({ agents: { qa: agent('qa', 'Body.', 'sonnet', 'extreme') } }));
  assert.ok(r.errors.some(e => e.includes('invalid effort extreme')));
});

test('missing effort is an error', () => {
  const r = check(fixture({ agents: { qa: agent('qa', 'Body.', 'sonnet', '') } }));
  assert.ok(r.errors.some(e => e.includes('missing effort')));
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
  const good = skill('b', '```\nCompany profile: x\nLanguage: en\nName: Ava\nGoal: y\n```');
  const r = check(fixture({ skills: { a: bad, b: good } }));
  assert.ok(r.errors.some(e => e.includes('skills/a/SKILL.md:') && e.includes('no Language:')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('skills/b/')), r.errors.join('\n'));
});

test('dispatch block without Name: is an error', () => {
  const bad = skill('a', '```\nCompany profile: x\nLanguage: en\nGoal: y\n```');
  const good = skill('b', '```\nCompany profile: x\nLanguage: en\nName: Ava\nGoal: y\n```');
  const r = check(fixture({ skills: { a: bad, b: good } }));
  assert.ok(r.errors.some(e => e.includes('skills/a/SKILL.md:') && e.includes('no Name:')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('skills/b/')), r.errors.join('\n'));
});

test('a longer fence is closed only by an equal or longer fence', () => {
  const nested = skill('a', '````\nCompany profile: x\n```\ninner\n```\nLanguage: en\nName: Ava\n````');
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

test('roles.md model or effort that differs from frontmatter is an error', () => {
  const root = fixture({ agents: { qa: agent('qa', 'Body.', 'sonnet', 'medium') } });
  write(root, 'documentation/roles.md', '| **qa** | opus | medium | x |');
  let r = check(root);
  assert.ok(r.errors.some(e => e.includes('documentation/roles.md: qa model opus != sonnet')), r.errors.join('\n'));
  write(root, 'documentation/roles.md', '| **qa** (lead) | sonnet | high | x |');
  r = check(root);
  assert.ok(r.errors.some(e => e.includes('documentation/roles.md: qa effort high != medium')), r.errors.join('\n'));
  write(root, 'documentation/roles.md', '| **qa** | sonnet | medium | x |');
  r = check(root);
  assert.ok(!r.errors.some(e => e.includes('roles.md')), r.errors.join('\n'));
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
  test(`Playbook ${name} resolves the language (aico:pipeline or section 1.6) and its dispatch blocks carry Language: and Name:`, () => {
    const r = check(REPO);
    assert.ok(!r.errors.some(e => e.includes(`skills/${name}/SKILL.md`) && (e.includes('Language rule') || e.includes('no Language:') || e.includes('no Name:'))), r.errors.join('\n'));
  });
}

const nameAgents = { qa: agent('qa'), support: agent('support') };

test('names.json missing a Role is an error', () => {
  const r = check(fixture({ agents: nameAgents, names: { support: 'Sofia' } }));
  assert.ok(r.errors.some(e => e.includes('company/names.json: qa has no name')), r.errors.join(', '));
});

test('duplicate names (case-insensitive) are an error', () => {
  const r = check(fixture({ agents: nameAgents, names: { qa: 'Sam', support: 'sam' } }));
  assert.ok(r.errors.some(e => e.includes('duplicate name sam')), r.errors.join(', '));
});

test('invalid name is an error', () => {
  const r = check(fixture({ agents: nameAgents, names: { qa: 'Sam!', support: 'Sofia' } }));
  assert.ok(r.errors.some(e => e.includes('invalid name')), r.errors.join(', '));
});

test('a name for an unknown Role is an error', () => {
  const r = check(fixture({ agents: nameAgents, names: { qa: 'Quinn', support: 'Sofia', ghost: 'Gus' } }));
  assert.ok(r.errors.some(e => e.includes('ghost is not a Role')), r.errors.join(', '));
});

test('valid names.json has no errors', () => {
  const r = check(fixture({ agents: nameAgents, names: { qa: 'Quinn', support: 'Lucía' } }));
  assert.deepEqual(r.errors, []);
});

test('names with edge or double spaces are errors; combining marks are fine', () => {
  for (const bad of ['Sam ', ' Sam', 'Sam  Lee']) {
    const r = check(fixture({ agents: nameAgents, names: { qa: bad, support: 'Sofia' } }));
    assert.ok(r.errors.some(e => e.includes('invalid name')), JSON.stringify(bad));
  }
  const r = check(fixture({ agents: nameAgents, names: { qa: 'Zoé', support: 'Sofia Lee' } }));
  assert.deepEqual(r.errors, []);
});

// ---- brainstorm-file v2 and rule-pack v1.1 (T1) ----
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const bs = name => readFileSync(join(FIX, 'brainstorm', name), 'utf8');
const pk = name => readFileSync(join(FIX, 'packs', name), 'utf8');
const CHECK = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs');
const TODAY = '2026-10-26';

// Replaces `from` with `to` and fails loudly when the fixture no longer contains `from`.
function swap(text, from, to) {
  assert.ok(text.includes(from), `fixture lacks ${JSON.stringify(from)}`);
  return text.replace(from, () => to);
}
const has = (errs, ...parts) => errs.some(e => parts.every(p => e.includes(p)));

test('brainstorm: v1 files pass and are not asked for v2 sections', () => {
  for (const f of ['v1-open.md', 'v1-built.md', 'v1-summary-only.md']) assert.deepEqual(checkBrainstorm(bs(f)), [], f);
});

test('brainstorm: v1 needs frontmatter with topic, started, status and roles', () => {
  assert.ok(has(checkBrainstorm('## Summary\nx\n'), 'rule 1', 'frontmatter'));
  assert.ok(has(checkBrainstorm(swap(bs('v1-open.md'), 'status: open', 'status: done')), 'rule 1', 'status'));
  assert.ok(has(checkBrainstorm(swap(bs('v1-open.md'), 'roles: product-manager, architect\n', '')), 'rule 1', 'roles'));
});

test('brainstorm: both v2 fixtures pass, with CRLF too', () => {
  for (const f of ['v2-crossfire.md', 'v2-full-pass.md']) {
    assert.deepEqual(checkBrainstorm(bs(f)), [], f);
    assert.deepEqual(checkBrainstorm(bs(f).replace(/\n/g, '\r\n')), [], `${f} CRLF`);
  }
});

test('brainstorm: errors name the file and the rule', () => {
  const e = checkBrainstorm(swap(bs('v2-crossfire.md'), 'format: 2', 'format: 3'), { file: 'x.md' });
  assert.ok(e[0].startsWith('ERROR x.md: rule 2'), e[0]);
  assert.ok(e[0].includes('unknown brainstorm format'));
});

test('brainstorm rule 3: sections, order and Digest parts', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, '## Questions', '## Extras')), 'rule 3'));
  assert.ok(has(checkBrainstorm(t + '## Appendix\nx\n'), 'rule 3'));
  assert.ok(has(checkBrainstorm(swap(t, '### Dissent', '### Dissent2')), 'rule 3'));
  const swapped = swap(swap(t, '## Digest', '## TMP'), '## Questions', '## Digest').replace('## TMP', '## Questions');
  assert.ok(has(checkBrainstorm(swapped), 'rule 3'));
});

test('brainstorm rule 3: Estimate is required with an architect and takes two shapes', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, '### Estimate\n- M, 3–5 d — src: R2\n', '')), 'rule 3', 'Estimate'));
  assert.ok(has(checkBrainstorm(swap(t, '- M, 3–5 d — src: R2', '- about a week — src: R2')), 'rule 3', 'Estimate'));
  assert.deepEqual(checkBrainstorm(swap(t, '- M, 3–5 d — src: R2', '- not estimated')), []);
  const noArch = swap(swap(t, 'roles: architect, writer, product-manager', 'roles: writer, product-manager'), '### Estimate\n- M, 3–5 d — src: R2\n', '');
  assert.deepEqual(checkBrainstorm(noArch).filter(e => e.includes('Estimate')), []);
});

test('brainstorm rule 4: question lines', () => {
  const t = bs('v2-crossfire.md');
  const q2 = '- Q-2 [nice-to-have] votes:1 status:open — Follow the system theme? — options: follow | manual — default: follow — src: R2';
  assert.ok(has(checkBrainstorm(swap(t, q2, q2.replace('default: follow', 'default: never'))), 'rule 4', 'default'));
  assert.ok(has(checkBrainstorm(swap(t, q2, q2.replace('[nice-to-have]', '[urgent]'))), 'rule 4'));
  assert.ok(has(checkBrainstorm(swap(t, q2, q2.replace('options: follow | manual', 'options: follow'))), 'rule 4'));
  assert.ok(has(checkBrainstorm(swap(t, q2, q2.replace('Q-2', 'Q-1'))), 'rule 4', 'duplicate'));
  assert.deepEqual(checkBrainstorm(swap(t, q2, q2.replace('src: R2', 'src: R2 CEO'))), []);
});

test('brainstorm rule 5: Digest items end with a src that names an existing round', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, '— src: R2\n### Dissent', '\n### Dissent')), 'rule 5'));
  assert.ok(has(checkBrainstorm(swap(t, '— ideas: I-1.1, I-1.2 — src: R2', '— ideas: I-1.1, I-1.2 — src: R9')), 'rule 5', 'R9'));
});

test('brainstorm rule 6: a Decision quote is byte for byte in the CEO line of its round', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, '"Yes, ship dark mode first, light stays the default."', '"Yes, ship dark mode first, light stays default."')), 'rule 6'));
  assert.ok(has(checkBrainstorm(swap(t, 'light stays the default." — src: R1', 'light stays the default." — src: R2')), 'rule 6'));
  assert.deepEqual(checkBrainstorm(swap(t, '"Yes, ship dark mode first, light stays the default."', '"light stays the default."')), []);
});

test('brainstorm rule 6: a Dissent quote comes from a non-skip reply of that Role in that round, any pass', () => {
  const t = bs('v2-crossfire.md');
  const q = '"A theme switch touches every component, so it is not small."';
  assert.deepEqual(checkBrainstorm(t), []); // quote from a crossfire reply
  assert.ok(has(checkBrainstorm(swap(t, q, '"Nobody said this."')), 'rule 6', 'Dissent'));
  assert.ok(has(checkBrainstorm(swap(t, q + ' — src: R2', q + ' — src: R1')), 'rule 6'));
  const fp = bs('v2-full-pass.md');
  assert.deepEqual(checkBrainstorm(fp), []); // quote from a full-pass reply
  assert.ok(has(checkBrainstorm(swap(fp, '- Ren (writer) — "Users read', '- Ava (architect) — "Users read')), 'rule 6'));
});

test('brainstorm rule 6: a Role whose replies in a round are all skip has no Digest entry from it', () => {
  const t = bs('v2-crossfire.md');
  const withThread = swap(t, '- I-1.2 ← Ren (writer) challenge: "Copy must survive both themes." — src: R2', '- I-1.2 ← Ren (writer) challenge: "x" — src: R1');
  assert.ok(has(checkBrainstorm(withThread), 'rule 6', 'skip'));
  const dissent = swap(t, '- Ava (architect) — "A theme switch', '- Ren (writer) — "skip" — src: R1\n- Ava (architect) — "A theme switch');
  assert.ok(has(checkBrainstorm(dissent), 'rule 6'));
});

test('brainstorm rule 7: answered questions and decisions match one to one', () => {
  const t = bs('v2-crossfire.md');
  const d1 = '- D-1 — Q-1 — "Yes, ship dark mode first, light stays the default." — src: R1';
  assert.ok(has(checkBrainstorm(swap(t, d1 + '\n', '')), 'rule 7', 'Q-1'));
  assert.ok(has(checkBrainstorm(swap(t, d1, d1 + '\n' + d1.replace('D-1', 'D-2'))), 'rule 7', 'Q-1'));
  assert.ok(has(checkBrainstorm(swap(t, d1, d1.replace('Q-1', 'Q-9'))), 'rule 7', 'Q-9'));
});

test('brainstorm rule 8: round headings', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, 'Round 2 — debate: crossfire', 'Round 2 — debate')), 'rule 8', 'debate round needs a style'));
  assert.ok(has(checkBrainstorm(swap(t, 'Round 2 — debate: crossfire', 'Round 2 — debate:')), 'rule 8', 'debate round needs a style'));
  assert.ok(has(checkBrainstorm(swap(t, 'Round 2 — debate: crossfire', 'Round 2 — debate: broadcast')), 'rule 8', 'unknown debate style'));
  assert.ok(has(checkBrainstorm(swap(t, 'Round 2 — debate: crossfire', 'Round 2 — shouting')), 'rule 8', 'round'));
  assert.ok(has(checkBrainstorm(swap(t, '### Round 1 — ideas', '### Round 2 — ideas')), 'rule 8', 'duplicate'));
  assert.deepEqual(checkBrainstorm(swap(t, 'Round 1 — ideas', 'Round 1 — moderated')), []);
});

test('brainstorm rule 8: reply headings', () => {
  const t = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(t, '#### Pat (product-manager)\nIdea: ask', '#### Pat\nIdea: ask')), 'rule 8', 'reply heading'));
  assert.ok(has(checkBrainstorm(swap(t, '#### Ren (writer) — crossfire', '#### Ren (writer) — rebuttal')), 'rule 8', 'reply heading'));
});

test('brainstorm rule 8: pass kinds belong to their style', () => {
  const cf = bs('v2-crossfire.md');
  assert.ok(has(checkBrainstorm(swap(cf, '#### Pat (product-manager)\nIdea: ship', '#### Pat (product-manager) — full pass\nIdea: ship')), 'rule 8', 'full pass'));
  assert.ok(has(checkBrainstorm(swap(cf, 'Round 2 — debate: crossfire', 'Round 2 — ideas')), 'rule 8', 'crossfire'));
  assert.deepEqual(checkBrainstorm(swap(cf, 'Round 2 — debate: crossfire', 'Round 2 — debate: full_pass')), []);
});

test('brainstorm rule 8: zero or two crossfire replies, never one or three', () => {
  const cf = bs('v2-crossfire.md');
  const ava = '#### Ava (architect) — crossfire\nRe: Ren. A theme switch touches every component, so it is not small.\n';
  const ren = '#### Ren (writer) — crossfire\nRe: Ava. Copy must survive both themes.\n';
  assert.ok(has(checkBrainstorm(swap(cf, ava, '')), 'rule 8', 'crossfire'));
  assert.ok(has(checkBrainstorm(swap(cf, '**Lead:** Tokens', '#### Pat (product-manager) — crossfire\nRe: Ava. Fine.\n**Lead:** Tokens')), 'rule 8', 'crossfire'));
  const none = swap(swap(cf, ava, ''), ren, '');
  const noDissent = swap(swap(none, '- Ava (architect) — "A theme switch touches every component, so it is not small." — src: R2\n', ''), '- I-1.2 ← Ren (writer) challenge: "Copy must survive both themes." — src: R2\n', '');
  assert.deepEqual(checkBrainstorm(noDissent), []);
});

test('brainstorm rule 8: passes keep their order, and one full pass per Role', () => {
  const fp = bs('v2-full-pass.md');
  const pair = '#### Ava (architect) — crossfire\nRe: Ren. Print the URL with one line of help.\n#### Ren (writer) — crossfire\nRe: Ava. One line of help is enough.\n';
  const crossFirst = swap(swap(fp, pair, ''), '#### Ava (architect) — full pass', pair + '#### Ava (architect) — full pass');
  assert.ok(has(checkBrainstorm(crossFirst), 'rule 8', 'pass out of order'));
  assert.ok(has(checkBrainstorm(swap(fp, '**Lead:** Local', '#### Ava (architect)\nLate idea.\n**Lead:** Local')), 'rule 8', 'pass out of order'));
  assert.ok(has(checkBrainstorm(swap(fp, '#### Ren (writer) — full pass', '#### Ava (architect) — full pass\nRe: Ren. Again.\n#### Ren (writer) — full pass')), 'rule 8', 'full pass'));
  assert.ok(has(checkBrainstorm(fp + '#### Ava (architect)\nToo late.\n'), 'rule 8', 'pass out of order'));
});

test('brainstorm: film files are skipped except for their frontmatter', () => {
  const film = '---\nkind: film\nsource: a.md\nlabel: rendered from stored replies; no invented lines\n---\nAny body\n## here\n';
  assert.deepEqual(checkBrainstorm(film), []);
  assert.ok(has(checkBrainstorm(film.replace('source: a.md\n', '')), 'film', 'source'));
});

test('brainstorm: size limits and hostile frontmatter keys', () => {
  assert.ok(has(checkBrainstorm(bs('v1-open.md') + 'x'.repeat(1024 * 1024)), 'rule', '1 MiB'));
  assert.ok(has(checkBrainstorm(bs('v1-open.md') + 'x'.repeat(4001) + '\n'), 'rule', '4000'));
  const t = swap(bs('v2-crossfire.md'), 'format: 2\n', 'format: 2\n__proto__: polluted\nconstructor: x\n');
  assert.deepEqual(checkBrainstorm(t), []);
  assert.equal({}.polluted, undefined);
  const evil = ('- Q-1 [blocking] votes:1 status:open — ' + ' — options: '.repeat(300)).slice(0, 3900);
  const start = Date.now();
  checkBrainstorm(swap(bs('v2-crossfire.md'), '- Q-2 [nice-to-have]', evil + '\n- Q-2 [nice-to-have]'));
  assert.ok(Date.now() - start < 1000);
});

// ---- checkPack ----
const nsrv = () => pk('nodejs-server@2026.md');
const ccp = () => pk('claude-code-plugins@2026.md');
const day = n => new Date(Date.UTC(2026, 9, 26) - n * 86400000).toISOString().slice(0, 10);
const cp = (text, o = {}) => checkPack(text, { file: 'nodejs-server@2026.md', today: TODAY, ...o });
const mini = (body, fm = {}) => `---\ntool: ${fm.tool ?? 'react'}\nversions: "${fm.versions ?? '>=19 <20'}"\nresearched: ${fm.researched ?? '2026-10-20'}\n---\n${body}`;
const rp = (text, o = {}) => checkPack(text, { file: 'react@19.md', today: TODAY, ...o });
const SRC = '— source: https://a.example/x';

test('pack: the two committed copies pass (prefix differs from tool, why optional, enforced-by)', () => {
  assert.deepEqual(cp(nsrv()), []);
  assert.deepEqual(checkPack(ccp(), { file: 'claude-code-plugins@2026.md', today: TODAY }), []);
  assert.deepEqual(cp(nsrv().replace(/\n/g, '\r\n')), []);
});

test('pack: frontmatter and file name', () => {
  assert.ok(has(rp(mini('## Must\n', { tool: 'vue' })), 'tool', 'react@19.md'));
  assert.ok(has(rp(mini('## Must\n', { versions: '' })), 'versions'));
  assert.ok(has(rp(mini('## Must\n', { researched: '2026-02-30' })), 'researched'));
  assert.ok(has(rp(mini('## Must\n', { researched: '2026-11-02' })), 'researched', 'future'));
  assert.ok(has(rp('## Must\n'), 'frontmatter'));
  assert.ok(has(checkPack(mini('## Must\n'), { file: 'react.md', today: TODAY }), 'file name'));
});

test('pack: sections are the four, once each; HTML comments hide rule-like lines', () => {
  assert.ok(has(rp(mini('## Must\n## Must\n')), 'section', 'Must'));
  assert.ok(has(rp(mini('## Notes\n')), 'section', 'Notes'));
  const hidden = mini(`<!-- ## Notes\n- bad line without structure\n-->\n## Must\n- react.M1 — rule ${SRC}\n`);
  assert.deepEqual(rp(hidden), []);
});

test('pack: rule line shape, tier letters and ids', () => {
  const must = line => mini(`## Must\n${line}\n`);
  assert.deepEqual(rp(must(`- react.M1 — plain rule ${SRC}`)), []);
  assert.ok(has(rp(must(`- react.S4 — rule ${SRC}`)), 'react.S4', '## Must', 'tier letter'));
  assert.ok(has(rp(must('- not a rule')), 'rule line'));
  assert.ok(has(rp(must(`- react.M1 — a ${SRC}\n- react.M1 — b ${SRC}`)), 'react.M1', 'duplicate'));
  assert.ok(has(rp(mini(`## Security\n- react.M1 — rule ${SRC}\n`)), 'react.M1', '## Security'));
  assert.deepEqual(rp(mini(`## Security\n- react.M-SEC1 — rule ${SRC}\n## Should\n- react.S1 — s\n## May\n- react.Y1 — y\n`)), []);
  assert.ok(has(rp(must('- react.M1 — rule — source: http://a.example/x')), 'react.M1', 'https'));
  assert.ok(has(rp(must('- react.M1 — rule')), 'react.M1', 'https'));
});

test('pack: prefix is free but one per pack, and proj is reserved', () => {
  assert.deepEqual(rp(mini(`## Must\n- rx.M1 — a ${SRC}\n`)), []);
  assert.ok(has(rp(mini(`## Must\n- rx.M1 — a ${SRC}\n- ry.M2 — b ${SRC}\n`)), 'prefix ry differs from rx', 'one prefix per pack'));
  assert.ok(has(rp(mini(`## Must\n- proj.M1 — a ${SRC}\n`)), 'proj', 'reserved'));
  assert.ok(has(rp(mini(`## Must\n- Rx.M1 — a ${SRC}\n`)), 'rule line'));
});

test('pack: markers split only at the keyed markers, each once and in order', () => {
  const ok = mini('## Must\n- rx.M1 — a — b, still the rule — why: w — x — source: https://a.example/x , https://b.example/y — enforced-by: eslint/foo\n');
  assert.deepEqual(rp(ok), []);
  assert.ok(has(rp(mini(`## Must\n- rx.M1 — a — why: w — why: v ${SRC}\n`)), 'rx.M1', 'why'));
  assert.ok(has(rp(mini(`## Must\n- rx.M1 — a ${SRC} — why: w\n`)), 'rx.M1', 'order'));
  assert.ok(has(rp(mini(`## Must\n- rx.M1 —  ${SRC}\n`)), 'rx.M1', 'empty'));
});

test('pack: check: is refused in packs, in any position', () => {
  assert.ok(has(rp(mini(`## Must\n- rx.M1 — a ${SRC} — check: lf\n`)), 'rx.M1', 'check:', 'checks.json'));
  assert.ok(has(rp(mini('## Should\n- rx.S1 — a — check: judgment\n')), 'rx.S1', 'check:'));
});

test('pack: size cap, 256 KiB', () => {
  assert.ok(has(rp(mini('<!-- ' + 'x'.repeat(256 * 1024) + ' -->\n## Must\n')), 'too large'));
});

test('pack: freshness is 180 days by default and 90 days in library mode', () => {
  const old = n => nsrv().replace('researched: 2026-10-21', `researched: ${day(n)}`);
  assert.deepEqual(cp(old(100)), []);
  assert.deepEqual(cp(old(180)), []);
  assert.ok(has(cp(old(181)), 'stale', '180-day'));
  assert.deepEqual(cp(old(90), { maxAgeDays: 90 }), []);
  assert.ok(has(cp(old(91), { maxAgeDays: 90 }), 'stale', '90-day', day(91)));
});

test('pack: an advisory dated after researched is an error for that tool only', () => {
  const adv = [{ tool: 'nodejs-server', date: '2026-10-25', id: 'CVE-2026-1234', source: 'https://nodejs.org/x' }, { tool: 'npm', date: '2026-10-25', id: 'CVE-1', source: 'https://a.example/x' }];
  const e = cp(nsrv(), { advisories: adv });
  assert.equal(e.length, 1, e.join('\n'));
  assert.ok(has(e, 'advisory CVE-2026-1234 (2026-10-25) after researched 2026-10-21'));
  assert.deepEqual(cp(nsrv(), { advisories: [{ ...adv[0], date: '2026-10-21' }] }), []);
});

// ---- checkPacks (a folder), --packs and repo mode ----
function packDir(files, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aico-packs-'));
  tempDirs.push(dir);
  for (const [n, t] of Object.entries({ ...files, ...extra })) writeFileSync(join(dir, n), t);
  return dir;
}

test('checkPacks library mode: 90 days, advisories.json, no cross-pack id rule', () => {
  const dir = packDir({ 'nodejs-server@2026.md': nsrv(), 'claude-code-plugins@2026.md': ccp() });
  assert.deepEqual(checkPacks(dir, { today: TODAY, maxAgeDays: 90 }), []);
  assert.ok(has(checkPacks(dir, { today: '2027-02-01', maxAgeDays: 90 }), 'nodejs-server@2026.md', 'stale'));
  const adv = packDir({ 'nodejs-server@2026.md': nsrv() }, { 'advisories.json': JSON.stringify([{ tool: 'nodejs-server', date: '2026-10-25', id: 'CVE-9', source: 'https://a.example/x' }]) });
  assert.ok(has(checkPacks(adv, { today: TODAY, maxAgeDays: 90 }), 'advisory CVE-9'));
  const dup = packDir({ 'nodejs-server@2026.md': nsrv(), 'nodejs-server@2027.md': nsrv() });
  assert.deepEqual(checkPacks(dup, { today: TODAY, maxAgeDays: 90 }), []);
});

test('checkPacks: a malformed or hostile advisories.json is an error, not a crash', () => {
  const bodies = ['not json', '{"a":1}', '[{"tool":"x"}]',
    '[{"__proto__":{"x":1},"tool":"nodejs-server","date":"2026-10-25","id":"A","source":"http://a"}]',
    '[{"tool":"nodejs-server","date":"nope","id":"A","source":"https://a.example/x"}]'];
  for (const body of bodies) {
    const dir = packDir({ 'nodejs-server@2026.md': nsrv() }, { 'advisories.json': body });
    assert.ok(has(checkPacks(dir, { today: TODAY, maxAgeDays: 90 }), 'advisories.json'), body);
  }
  const big = packDir({ 'nodejs-server@2026.md': nsrv() }, { 'advisories.json': ' '.repeat(256 * 1024 + 1) });
  assert.ok(has(checkPacks(big, { today: TODAY, maxAgeDays: 90 }), 'advisories.json', 'too large'));
});

test('checkPacks repo mode: a rule id used in two committed packs is an error', () => {
  const twin = nsrv().replace('tool: nodejs-server', 'tool: nodejs-twin');
  const dir = packDir({ 'nodejs-server@2026.md': nsrv(), 'nodejs-twin@2026.md': twin });
  const e = checkPacks(dir, { today: TODAY, maxAgeDays: 180, repo: true });
  assert.ok(has(e, 'nsrv.M1', 'nodejs-server@2026.md', 'nodejs-twin@2026.md'), e.join('\n'));
  assert.deepEqual(checkPacks(packDir({ 'nodejs-server@2026.md': nsrv() }), { today: TODAY, maxAgeDays: 180, repo: true }), []);
});

function repoRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aico-repo-'));
  tempDirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const run = args => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

test('repo mode: no .company means "no ruleset", no error', () => {
  const r = check(repoRoot({ 'agents/.keep': '' }), { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.notes, ['no ruleset']);
  const out = run([repoRoot()]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(out.stdout.split('no ruleset').length - 1, 1);
});

test('repo mode: committed copies are checked at 180 days and across packs', () => {
  const ok = repoRoot({ '.company/standards/nodejs-server@2026.md': nsrv() });
  const r = check(ok, { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.notes, []);
  const stale = check(ok, { today: '2027-06-01' });
  assert.ok(has(stale.errors, 'standards/nodejs-server@2026.md', 'stale'));
  const twin = repoRoot({ '.company/standards/nodejs-server@2026.md': nsrv(), '.company/standards/other@1.md': nsrv().replace('tool: nodejs-server', 'tool: other') });
  assert.ok(has(check(twin, { today: TODAY }).errors, 'nsrv.M1'));
});

test('repo mode: brainstorm folders are scanned, errors carry the relative path', () => {
  const good = bs('v2-crossfire.md'), bad = swap(good, 'format: 2', 'format: 9');
  const root = repoRoot({
    '.company/brainstorms/2026-10-20 10.00 - Good.md': good,
    '.company/roadmap/2026-10-20 10.01 - Old.md': bs('v1-built.md'),
    '.company/parked/2026-10-20 10.02 - Bad.md': bad,
    '.company/nice-to-have/2026-10-20 10.03 - Other.md': bs('v1-open.md'),
    '.company/work/x/notes.md': 'not scanned, not a brainstorm',
  });
  const r = check(root, { today: TODAY });
  assert.equal(r.errors.length, 1, r.errors.join('\n'));
  assert.ok(r.errors[0].includes('.company/parked/2026-10-20 10.02 - Bad.md'), r.errors[0]);
  assert.ok(r.notes.includes('no ruleset'));
});

test('--packs: exit 0 on fresh packs, 1 on a stale one, 1 on a missing folder, 2 without a folder', () => {
  const t = new Date().toISOString().slice(0, 10);
  const fresh = packDir({ 'nodejs-server@2026.md': nsrv().replace('researched: 2026-10-21', `researched: ${t}`) });
  const ok = run(['--packs', fresh]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const stale = packDir({ 'nodejs-server@2026.md': nsrv().replace('researched: 2026-10-21', 'researched: 2020-01-01') });
  const bad = run(['--packs', stale]);
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes('stale'), bad.stdout);
  assert.equal(run(['--packs', join(fresh, 'missing')]).status, 1);
  assert.equal(run(['--packs']).status, 2);
});

test('the fixtures folder holds only LF text (proj.M11)', () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const f of walk(FIX)) assert.ok(!readFileSync(f, 'utf8').includes('\r'), f);
});

// ---- T11: dispatch rule, Context cap: (dispatch-prompt v3.1) ----
const stepBlock = (extra = '', dir = 's') => '```\nProject profile: p\nCompany profile: x\nLanguage: en\nName: Ava\n' + extra + 'Output: .company/work/' + dir + '/01-r.md\nGoal: y\n```';

test('dispatch block with Output: .company/work/ but no Context cap: is an error', () => {
  const bad = skill('a', stepBlock());
  const good = skill('b', stepBlock('Context cap: 150000 handover 120000\n'));
  const r = check(fixture({ skills: { a: bad, b: good } }));
  assert.ok(r.errors.some(e => e.includes('skills/a/SKILL.md:') && e.includes('no Context cap:')), r.errors.join('\n'));
  assert.ok(!r.errors.some(e => e.includes('skills/b/')), r.errors.join('\n'));
});

test('dispatch blocks whose Output is a reply only need no Context cap:', () => {
  const bs = skill('a', '```\nCompany profile: x\nLanguage: en\nName: Ava\nOutput: your reply only.\nGoal: y\n```');
  assert.deepEqual(check(fixture({ skills: { a: bs } })).errors, []);
});

test('the research Playbook is not exempt from the Context cap: rule', () => {
  const r = check(fixture({ skills: { research: skill('research', stepBlock('', 'research-s')) } }));
  assert.ok(r.errors.some(e => e.includes('skills/research/') && e.includes('no Context cap:')), r.errors.join('\n'));
});

test('this repo passes the Context cap: rule', () => {
  const r = check(REPO);
  assert.ok(!r.errors.some(e => e.includes('Context cap')), r.errors.join('\n'));
});
