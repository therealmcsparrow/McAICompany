// Acceptance tests for the model floor: plugin defaults, the floor and protected lock in aico-settings,
// the model-env warning, the agent description budget, the ledger meta line and the model verdict.
// Every test works in a temp folder; no test reads or writes the real home or spawns the real claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as settings from './settings.mjs';
import * as checkLib from './check.mjs';
import { main as ledger } from './ledger.mjs';

const { resolveSettings, run: settingsRun } = settings;
const { check } = checkLib;
const here = import.meta.dirname;
const repoRoot = path.join(here, '..');
const SETTINGS = path.join(here, 'settings.mjs');
const LEDGER = path.join(here, 'ledger.mjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cheaper-models-'));
// A ledger build that ignores the injected root writes here, never into the repo.
const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cheaper-decoy-'));
after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(decoy, { recursive: true, force: true });
});
process.chdir(decoy);

let counter = 0;
const fresh = (label) => {
  const dir = path.join(base, `${label}${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readJson = (...parts) => JSON.parse(read(...parts));

// ---------- shared fixtures ----------

const PROTECTED = ['architect', 'code-reviewer', 'pentester', 'security', 'vuln-scanner'];
// Frontmatter model and floor per fixture Role. tech-researcher and writer sit below their floor.
const FIXTURE_ROLES = {
  architect: ['opus', 'opus'],
  'code-reviewer': ['opus', 'opus'],
  pentester: ['opus', 'opus'],
  security: ['opus', 'opus'],
  'vuln-scanner': ['sonnet', 'sonnet'],
  qa: ['sonnet', 'sonnet'],
  'backend-engineer': ['sonnet', 'sonnet'],
  'tech-researcher': ['sonnet', 'opus'],
  writer: ['haiku', 'sonnet']
};
const NAMES = {
  architect: 'Ava', 'code-reviewer': 'Rex', pentester: 'Pia', security: 'Sam', 'vuln-scanner': 'Vic',
  qa: 'Quinn', 'backend-engineer': 'Bob', 'tech-researcher': 'Tess', writer: 'Wes'
};

function agentText(role, model, effort = 'medium', description = `The ${role}.`) {
  return `---\nname: ${role}\ndescription: ${description}\ntools: Read\nmodel: ${model}\neffort: ${effort}\n---\n# ${role}\n`;
}

function floorJson(roles = FIXTURE_ROLES, extra = {}) {
  const floor = {};
  for (const [r, [, f]] of Object.entries(roles)) floor[r] = f;
  return { v: 1, release: '0.16.0', floor, protected: PROTECTED, ...extra };
}

// A plugin root with its own agents, names, floor file and version.
function mkPlugin({ roles = FIXTURE_ROLES, floorText, version = '0.17.0' } = {}) {
  const root = fresh('plugin');
  fs.mkdirSync(path.join(root, 'agents'));
  fs.mkdirSync(path.join(root, 'company'));
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'skills', 'lead', 'references'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'skills', 'lead', 'references', 'project-template.md'), path.join(root, 'skills', 'lead', 'references', 'project-template.md'));
  for (const [r, [m]] of Object.entries(roles)) fs.writeFileSync(path.join(root, 'agents', `${r}.md`), agentText(r, m));
  fs.writeFileSync(path.join(root, 'company', 'names.json'), JSON.stringify(NAMES));
  if (floorText !== null) fs.writeFileSync(path.join(root, 'company', 'model-floor.json'), floorText ?? JSON.stringify(floorJson(roles)));
  if (version !== null) fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version }));
  return root;
}

// Home and product folders for settings, with optional user and project layers.
function mkCtx(pluginRoot, { user, project } = {}) {
  const root = fresh('ctx');
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  if (user) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, ...user } }));
  if (project) fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, ...project } }));
  return { home, cwd, pluginRoot };
}

const cleanChildEnv = (home, extra = {}) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_CODE_') || k.startsWith('GIT_CONFIG') || k === 'AI_AGENT' || k === 'CLAUDECODE') delete env[k];
  }
  return { ...env, HOME: home, USERPROFILE: home, MCSPARROW_HOME: path.join(home, '.mcsparrow'), ...extra };
};

// ---------- defaults ----------

test('plugin defaults: tech-researcher is sonnet and every other Role keeps its earlier model', () => {
  const ctx = mkCtx(repoRoot);
  const got = resolveSettings(ctx);
  const opus = ['architect', 'code-reviewer', 'pentester', 'product-manager', 'security', 'senior-engineer'];
  const haiku = ['localizer', 'prompt-artist'];
  const roles = fs.readdirSync(path.join(repoRoot, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(got.roles).sort(), roles.sort());
  for (const r of roles) {
    const expected = r === 'tech-researcher' ? 'sonnet' : opus.includes(r) ? 'opus' : haiku.includes(r) ? 'haiku' : 'sonnet';
    assert.equal(got.roles[r].model, expected, r);
    assert.equal(got.roles[r].source.model, 'plugin', r);
  }
  const researcher = read('agents', 'tech-researcher.md');
  assert.match(researcher, /^model: sonnet$/m);
  assert.match(researcher, /^effort: medium$/m);
});

test('plugin defaults: get exposes floor and protected per Role, the floor being the earlier model', () => {
  const out = settingsRun(['get'], mkCtx(repoRoot));
  assert.equal(out.code, 0);
  const got = JSON.parse(out.out);
  const first = Object.values(got.roles)[0];
  assert.deepEqual(Object.keys(first).sort(), ['context_cap', 'effort', 'floor', 'model', 'name', 'protected', 'source']);
  assert.equal(got.roles['tech-researcher'].floor, 'opus');
  assert.equal(got.roles['tech-researcher'].protected, false);
  assert.equal(got.roles['localizer'].floor, 'haiku');
  assert.equal(got.roles['qa'].floor, 'sonnet');
  const protectedNow = Object.entries(got.roles).filter(([, v]) => v.protected).map(([k]) => k).sort();
  assert.deepEqual(protectedNow, PROTECTED);
  for (const r of PROTECTED) assert.equal(got.roles[r].floor, r === 'vuln-scanner' ? 'sonnet' : 'opus', r);
});

test('floor file ships with the plugin, in the agreed shape', () => {
  const floor = readJson('company', 'model-floor.json');
  assert.deepEqual(Object.keys(floor).sort(), ['floor', 'protected', 'release', 'v']);
  assert.equal(floor.v, 1);
  assert.equal(floor.release, '0.16.0');
  assert.deepEqual([...floor.protected].sort(), PROTECTED);
  const roles = fs.readdirSync(path.join(repoRoot, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(floor.floor).sort(), roles.sort());
  assert.ok(fs.statSync(path.join(repoRoot, 'company', 'model-floor.json')).size <= 16 * 1024);
  for (const v of Object.values(floor.floor)) assert.ok(['haiku', 'sonnet', 'opus'].includes(v));
});

test('loadModelFloor and MODEL_RANK: ranked families, unranked fable, downgraded Roles', () => {
  const { MODEL_RANK, loadModelFloor } = settings;
  assert.ok(MODEL_RANK.haiku < MODEL_RANK.sonnet && MODEL_RANK.sonnet < MODEL_RANK.opus);
  assert.equal(Object.hasOwn(MODEL_RANK, 'fable'), false);
  assert.equal(Object.hasOwn(MODEL_RANK, 'inherit'), false);
  const real = loadModelFloor(repoRoot);
  assert.deepEqual(Object.keys(real).sort(), ['downgraded', 'floor', 'protected', 'release', 'warnings']);
  assert.deepEqual(real.downgraded, ['tech-researcher']);
  assert.deepEqual(real.warnings, []);
  const fixture = loadModelFloor(mkPlugin());
  assert.deepEqual([...fixture.downgraded].sort(), ['tech-researcher', 'writer']);
});

// ---------- high tier floor (the pipeline raises, settings reports) ----------

test('a CEO override below the floor resolves as set and reports the floor for the Lead to apply', () => {
  const plugin = mkPlugin();
  const ctx = mkCtx(plugin, { user: { roles: { 'tech-researcher': { model: 'haiku' }, qa: { model: 'haiku' } } } });
  const got = JSON.parse(settingsRun(['get'], ctx).out);
  assert.equal(got.roles['tech-researcher'].model, 'haiku');
  assert.equal(got.roles['tech-researcher'].floor, 'opus');
  assert.equal(got.roles['tech-researcher'].protected, false);
  assert.equal(got.roles['tech-researcher'].source.model, 'user');
  assert.equal(got.roles.qa.model, 'haiku');
  assert.deepEqual(got.warnings.filter((w) => /floor/.test(w)), []);
});

test('pipeline text: the floor rule raises on high tier or protected, leaves low and medium alone, and traces it', () => {
  const text = read('skills', 'pipeline', 'SKILL.md');
  const floorPara = text.split('\n').find((l) => l.startsWith('**Floor:**'));
  assert.ok(floorPara, 'a Floor paragraph exists');
  assert.match(floorPara, /high/);
  assert.match(floorPara, /protected/);
  assert.match(floorPara, /`haiku` < `sonnet` < `opus`/);
  assert.match(floorPara, /model: <floor>/);
  assert.match(floorPara, /also when it equals the frontmatter/);
  assert.match(floorPara, /Settings: model=<floor>[^`]*floor/);
  assert.match(floorPara, /low or medium/);
  assert.match(floorPara, /resolved model/);
  assert.match(floorPara, /any other value counts as below/);
});

test('dispatch-prompt contract: the Settings line may end with floor', () => {
  const doc = read('docs', 'contracts', 'dispatch-prompt.md');
  assert.match(doc, /v3\.4/);
  assert.ok(doc.includes('Settings: model=<m> effort=<e>[ floor]'));
});

// ---------- protected lock ----------

const lockWarning = (role, m, f) => `roles.${role}.model: ${m} is below the protected floor ${f}, not applied`;

test('protected Roles keep their floor at user and project level for every lower model', () => {
  const plugin = mkPlugin();
  for (const level of ['user', 'project']) {
    for (const lower of ['haiku', 'sonnet', 'fable']) {
      const ctx = mkCtx(plugin, { [level]: { roles: { architect: { model: lower }, security: { model: lower } } } });
      const got = resolveSettings(ctx);
      for (const r of ['architect', 'security']) {
        assert.equal(got.roles[r].model, 'opus', `${level} ${lower} ${r}`);
        assert.equal(got.roles[r].source.model, 'floor', `${level} ${lower} ${r}`);
        assert.equal(got.roles[r].protected, true);
        assert.ok(got.warnings.includes(lockWarning(r, lower, 'opus')), `${level} ${lower} ${r}: ${JSON.stringify(got.warnings)}`);
      }
    }
  }
});

test('protected Role: opus is applied without a warning, inherit is not judged here', () => {
  const plugin = mkPlugin();
  const got = resolveSettings(mkCtx(plugin, { user: { roles: { architect: { model: 'opus' }, pentester: { model: 'inherit' } } } }));
  assert.equal(got.roles.architect.model, 'opus');
  assert.equal(got.roles.architect.source.model, 'user');
  assert.equal(got.roles.pentester.model, 'inherit');
  assert.deepEqual(got.warnings.filter((w) => /floor/.test(w)), []);
});

test('no unlock and no broken project layer lifts the protected lock', () => {
  const plugin = mkPlugin();
  const ctx = mkCtx(plugin, {
    user: { unlocked: ['ship', 'security', 'installs'], roles: { 'code-reviewer': { model: 'haiku' } } },
    project: { roles: { architect: { model: 'sonnet' } }, bogus_key: true }
  });
  const got = resolveSettings(ctx);
  assert.equal(got.roles['code-reviewer'].model, 'opus');
  assert.equal(got.roles['code-reviewer'].source.model, 'floor');
  assert.equal(got.roles.architect.model, 'opus');
});

test('an unprotected Role set below its floor is applied as set, with no floor warning', () => {
  const plugin = mkPlugin();
  const got = resolveSettings(mkCtx(plugin, { project: { roles: { qa: { model: 'haiku' }, 'tech-researcher': { model: 'fable' } } } }));
  assert.equal(got.roles.qa.model, 'haiku');
  assert.equal(got.roles['tech-researcher'].model, 'fable');
  assert.equal(got.roles.qa.source.model, 'project');
  assert.deepEqual(got.warnings.filter((w) => /floor/.test(w)), []);
});

test('floor file hostile or unreadable: every Role is held at opus with one warning', () => {
  const cases = {
    missing: null,
    'not json': '{nope',
    'array': '[]',
    'proto key in floor': '{"v":1,"release":"0.16.0","floor":{"__proto__":{"architect":"haiku"}},"protected":["architect","code-reviewer","pentester","security","vuln-scanner"]}',
    'role missing from floor': JSON.stringify((() => { const f = floorJson(); delete f.floor.qa; return f; })()),
    'unranked floor value': JSON.stringify((() => { const f = floorJson(); f.floor.qa = 'fable'; return f; })())
  };
  const warning = 'model floor: company/model-floor.json unreadable, every Role held at opus';
  for (const [label, text] of Object.entries(cases)) {
    const plugin = mkPlugin({ floorText: text });
    const got = resolveSettings(mkCtx(plugin));
    assert.equal(({}).architect, undefined, label);
    assert.ok(got.warnings.includes(warning), `${label}: ${JSON.stringify(got.warnings)}`);
    for (const [r, v] of Object.entries(got.roles)) {
      assert.equal(v.protected, true, `${label} ${r}`);
      assert.equal(v.floor, 'opus', `${label} ${r}`);
      assert.equal(v.model, 'opus', `${label} ${r}`);
    }
  }
});

// ---------- model-env ----------

const FORCE = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE';
const VAR = 'CLAUDE_CODE_SUBAGENT_MODEL';
const envLine = (v, f, ver, effect, floor) => `model env: ${VAR}=${v} ${FORCE}=${f}, Claude Code ${ver}: ${effect}; floor ${floor}`;
const parseVer = (v) => (v ? v.split('.').map(Number) : null);
const modelEnv = (env, version) => settingsRun(['model-env'], { env, readVersion: () => parseVer(version) });

test('model-env: neither variable set prints nothing and exits 0', () => {
  for (const env of [{}, { [VAR]: '' }, { [VAR]: 'inherit' }, { [FORCE]: '' }, { [FORCE]: '0' }, { [VAR]: 'inherit', [FORCE]: '0' }]) {
    const r = settingsRun(['model-env'], { env, readVersion: () => { throw new Error('version read without a variable set'); } });
    assert.equal(r.code, 0, JSON.stringify(env));
    assert.equal(r.out ?? '', '', JSON.stringify(env));
  }
});

test('model-env: the five rows, in order', () => {
  const rows = [
    // below 2.1.251 with the variable set
    [{ [VAR]: 'haiku' }, '2.1.200', envLine('haiku', 'unset', '2.1.200', "overrides every Role's model, the Agent model included", 'bypassed')],
    [{ [VAR]: 'haiku' }, '2.1.250', envLine('haiku', 'unset', '2.1.250', "overrides every Role's model, the Agent model included", 'bypassed')],
    // 2.1.257 or later with FORCE on
    [{ [VAR]: 'haiku', [FORCE]: '1' }, '2.1.260', envLine('haiku', '1', '2.1.260', 'forces haiku on every Role', 'bypassed')],
    [{ [VAR]: 'haiku', [FORCE]: '1' }, '2.1.257', envLine('haiku', '1', '2.1.257', 'forces haiku on every Role', 'bypassed')],
    [{ [FORCE]: 'true' }, '2.1.311', envLine('unset', 'true', '2.1.311', "forces the main conversation's model on every Role", 'bypassed')],
    // variable set, new enough, no force
    [{ [VAR]: 'sonnet' }, '2.1.311', envLine('sonnet', 'unset', '2.1.311', 'a default only; every aico Role sets model in its frontmatter, so no Role changes', 'kept')],
    [{ [VAR]: 'sonnet' }, '2.1.251', envLine('sonnet', 'unset', '2.1.251', 'a default only; every aico Role sets model in its frontmatter, so no Role changes', 'kept')],
    [{ [VAR]: 'sonnet', [FORCE]: '1' }, '2.1.256', envLine('sonnet', '1', '2.1.256', 'a default only; every aico Role sets model in its frontmatter, so no Role changes', 'kept')],
    [{ [VAR]: 'sonnet', [FORCE]: '0' }, '2.1.311', envLine('sonnet', '0', '2.1.311', 'a default only; every aico Role sets model in its frontmatter, so no Role changes', 'kept')],
    // FORCE only, too old to force
    [{ [FORCE]: '1' }, '2.1.255', envLine('unset', '1', '2.1.255', 'FORCE needs Claude Code 2.1.257; no Role changes', 'kept')],
    [{ [FORCE]: '1' }, '2.1.200', envLine('unset', '1', '2.1.200', 'FORCE needs Claude Code 2.1.257; no Role changes', 'kept')],
    // unknown version wins
    [{ [VAR]: 'sonnet' }, null, envLine('sonnet', 'unset', 'unknown', "version unknown, may override every Role's model", 'bypassed')],
    [{ [FORCE]: '1' }, null, envLine('unset', '1', 'unknown', "version unknown, may override every Role's model", 'bypassed')]
  ];
  for (const [env, version, line] of rows) {
    const r = modelEnv(env, version);
    assert.equal(r.code, 0, line);
    assert.equal(r.out, line);
  }
});

test('model-env: hostile values print (hidden), on one line, and nothing else is read', () => {
  const hostile = ['a b', 'x\ny', 'x\r\ny', 'a;b', 'a'.repeat(65), '$(id)', '`id`', 'a"b', '../x', '‮evil'];
  for (const value of hostile) {
    const r = modelEnv({ [VAR]: value, [FORCE]: value, ANTHROPIC_API_KEY: 'sk-secret-123' }, '2.1.311');
    assert.equal(r.code, 0);
    assert.equal(r.out.split('\n').length, 1, JSON.stringify(value));
    assert.ok(r.out.startsWith(`model env: ${VAR}=(hidden) ${FORCE}=(hidden)`), r.out);
    assert.equal(r.out.includes(value), false, JSON.stringify(value));
    assert.equal(r.out.includes('sk-secret'), false);
  }
  const edge = modelEnv({ [VAR]: 'a'.repeat(64) }, '2.1.311');
  assert.ok(edge.out.includes(`${VAR}=${'a'.repeat(64)} `));
  const family = modelEnv({ [VAR]: 'claude-sonnet-4.5:200k[1m]' }, '2.1.311');
  assert.ok(family.out.includes(`${VAR}=claude-sonnet-4.5:200k[1m] `));
});

test('model-env: extra arguments are refused with the usage line', () => {
  const r = settingsRun(['model-env', 'extra'], mkCtx(repoRoot));
  assert.equal(r.code, 2);
  assert.equal(r.out, 'refused: usage: settings.mjs get [key] | serve [--no-open] | model-env');
});

test('model-env from the command line: no variable prints nothing; a variable with an unreachable claude reads unknown', () => {
  const home = fresh('home');
  const none = spawnSync(process.execPath, [SETTINGS, 'model-env'], { cwd: home, encoding: 'utf8', env: cleanChildEnv(home) });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');
  const emptyBin = fresh('emptybin');
  const set = spawnSync(process.execPath, [SETTINGS, 'model-env'], {
    cwd: home, encoding: 'utf8', timeout: 20000,
    env: cleanChildEnv(home, { [VAR]: 'haiku', PATH: emptyBin })
  });
  assert.equal(set.status, 0);
  assert.equal(set.stdout.trim(), envLine('haiku', 'unset', 'unknown', "version unknown, may override every Role's model", 'bypassed'));
});

test('pipeline text: Setup runs model-env once, shows the line, and a bypass reaches the Brief Gate on high tier', () => {
  const text = read('skills', 'pipeline', 'SKILL.md');
  const setup = text.split('\n').find((l) => l.startsWith('7. **Settings (§1.7)**'));
  assert.ok(setup);
  assert.ok(setup.includes('scripts/settings.mjs" model-env'));
  assert.match(setup, /once/);
  assert.match(setup, /first chat message/);
  assert.match(setup, /floor bypassed/);
  assert.match(setup, /Brief Gate/);
  assert.match(setup, /high/);
  assert.match(setup, /model-floor\.json/);
});

// ---------- docs ----------

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && l.replace(/^#+ /, '').replaceAll('`', '').trim() === heading);
  assert.ok(start >= 0, `heading ${heading}`);
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#+) /);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('concepts page: the source order, versions, citations and the two unverified marks', () => {
  const s = section(read('documentation', 'concepts.md'), 'Which model a Role runs on');
  for (const needle of ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', '2.1.251', '2.1.257', 'roles.<role>.model', 'frontmatter', 'floor', 'protected']) {
    assert.ok(s.includes(needle), needle);
  }
  assert.ok(s.includes('https://code.claude.com/docs/en/sub-agents'));
  assert.ok((s.match(/unverified/gi) ?? []).length >= 2);
  assert.match(s, /15,000/);
  assert.match(s, /Agent[^\n]*`?model`?/);
  for (const r of PROTECTED) assert.ok(s.includes(r), r);
});

test('roles page: tech-researcher on sonnet, the protected list and both rollback lines', () => {
  const doc = read('documentation', 'roles.md');
  assert.match(doc, /tech-researcher[^\n]*sonnet/i);
  for (const r of PROTECTED) assert.ok(doc.includes(r), r);
  assert.match(doc, /roles\.<role>\.model/);
  assert.match(doc, /\/aico:settings/);
  assert.match(doc, /`stable`/);
  assert.match(doc, /v0\.16/);
});

test('commands page and feedback Playbook: the verdict line is shown in the report and never stops the run', () => {
  const commands = read('documentation', 'commands.md');
  assert.match(section(commands, '/aico:feedback'), /model verdict/);
  const feedback = read('skills', 'feedback', 'SKILL.md');
  assert.ok(feedback.includes('scripts/ledger.mjs" model-verdict'));
  assert.ok(feedback.includes('`## Model`'));
  const para = feedback.split('\n').filter((l) => l.includes('model-verdict')).join('\n');
  assert.match(para, /never stops the run/);
  assert.match(para, /never read as a pass/);
});

test('release notes and the model section state no money, percent or saving', () => {
  const changelog = read('CHANGELOG.md');
  const start = changelog.search(/^## \[?0\.17\.0/m);
  assert.ok(start >= 0, 'a 0.17.0 entry exists');
  const rest = changelog.slice(start + 1);
  const next = rest.search(/^## /m);
  const entry = next < 0 ? rest : rest.slice(0, next);
  const concepts = section(read('documentation', 'concepts.md'), 'Which model a Role runs on');
  const verdictLines = section(read('documentation', 'commands.md'), '/aico:feedback').split('\n').join(' ').split(/(?<=\.)\s+/).filter((l) => /model verdict|model-verdict|## Model/.test(l)).join('\n');
  assert.notEqual(verdictLines, '');
  for (const text of [entry, concepts, verdictLines]) {
    assert.doesNotMatch(text, /cheaper|saving|savings|\bsave[sd]?\b|price|pricing|cost|money|euro|[€$£%]|\bEUR\b|\bUSD\b/i);
  }
});

test('contracts and decision records carry the new versions', () => {
  assert.match(read('docs', 'contracts', 'aico-settings.md'), /v1\.6/);
  assert.match(read('docs', 'contracts', 'dispatch-prompt.md'), /v3\.4/);
  assert.match(read('docs', 'contracts', 'token-ledger.md'), /v1\.2/);
  assert.ok(fs.existsSync(path.join(repoRoot, 'docs', 'adr', '0031-model-floor-table.md')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'docs', 'adr', '0032-plugin-version-ledger-meta.md')));
});

// ---------- description budget and floor checks in check.mjs ----------

function agentsRoot(descriptions, { names, floor, models = {} } = {}) {
  const root = fresh('agents');
  fs.mkdirSync(path.join(root, 'agents'));
  for (const [name, d] of Object.entries(descriptions)) {
    fs.writeFileSync(path.join(root, 'agents', `${name}.md`), agentText(name, models[name] ?? 'sonnet', 'medium', d));
  }
  if (names || floor !== undefined) {
    fs.mkdirSync(path.join(root, 'company'));
    if (names) fs.writeFileSync(path.join(root, 'company', 'names.json'), JSON.stringify(names));
    if (floor !== undefined && floor !== null) fs.writeFileSync(path.join(root, 'company', 'model-floor.json'), floor);
  }
  return root;
}

// Forty Roles named r00..r39. Each estimate is bytes("aico:rNN") + bytes(description) + 4 = description bytes + 12.
function budgetSet(lastBytes) {
  const out = {};
  for (let i = 0; i < 39; i += 1) out[`r${String(i).padStart(2, '0')}`] = 'x'.repeat(370);
  out.r39 = 'y'.repeat(lastBytes);
  return out;
}
const budgetErrors = (r) => r.errors.filter((e) => /description budget|descriptions ~|one line/.test(e));

test('description budget constants are exported', () => {
  assert.deepEqual({ ...checkLib.DESCRIPTION_BUDGET }, { total: 15000, perRole: 400, perEntry: 4 });
});

test('description total: 14999 passes, 15000 fails, and the note shows total and headroom', () => {
  // 39 * 382 = 14898; the last Role adds description + 12.
  const under = check(agentsRoot(budgetSet(89)));
  assert.deepEqual(budgetErrors(under), []);
  assert.ok(under.notes.includes('agent descriptions: ~14999 of 15000 tokens, headroom 1'), JSON.stringify(under.notes));
  const at = check(agentsRoot(budgetSet(90)));
  assert.deepEqual(budgetErrors(at), ['ERROR agents: descriptions ~15000 tokens, at or above the 15000 limit']);
  assert.ok(at.notes.some((n) => n.startsWith('agent descriptions: ~15000 of 15000 tokens, headroom 0')), JSON.stringify(at.notes));
});

test('description total counts bytes, not characters', () => {
  // 'é' is two bytes: 39 plain Roles plus one with 45 'é' (90 bytes) must read 15000, not 14954.
  const set = budgetSet(1);
  set.r39 = 'é'.repeat(45);
  const r = check(agentsRoot(set));
  assert.deepEqual(budgetErrors(r), ['ERROR agents: descriptions ~15000 tokens, at or above the 15000 limit']);
});

test('per-Role cap: 400 passes, 401 names the Role, bytes count', () => {
  const ok = check(agentsRoot({ alpha: 'a'.repeat(400 - 'aico:alpha'.length - 4), beta: 'short' }));
  assert.deepEqual(budgetErrors(ok), []);
  const over = check(agentsRoot({ alpha: 'a'.repeat(401 - 'aico:alpha'.length - 4), beta: 'short' }));
  assert.deepEqual(budgetErrors(over), ['ERROR agents/alpha.md: description budget ~401 > 400 tokens']);
  const wide = check(agentsRoot({ gamma: 'é'.repeat(195) }));
  assert.deepEqual(budgetErrors(wide), ['ERROR agents/gamma.md: description budget ~404 > 400 tokens']);
});

test('a description that is not one line is an error, never under-counted', () => {
  const root = fresh('multi');
  fs.mkdirSync(path.join(root, 'agents'));
  const text = (d) => `---\nname: ${d.name}\ndescription: ${d.block}\ntools: Read\nmodel: sonnet\neffort: medium\n---\nBody\n`;
  fs.writeFileSync(path.join(root, 'agents', 'folded.md'), text({ name: 'folded', block: '>\n  a long\n  description' }));
  fs.writeFileSync(path.join(root, 'agents', 'literal.md'), text({ name: 'literal', block: '|-\n  a long\n  description' }));
  fs.writeFileSync(path.join(root, 'agents', 'plain.md'), text({ name: 'plain', block: 'one line' }));
  const errors = check(root).errors;
  assert.ok(errors.includes('ERROR agents/folded.md: description must be one line'), JSON.stringify(errors));
  assert.ok(errors.includes('ERROR agents/literal.md: description must be one line'), JSON.stringify(errors));
  assert.equal(errors.some((e) => e.includes('plain.md') && e.includes('one line')), false);
});

test('the shipped plugin passes its own checks and prints its headroom', () => {
  const r = check(repoRoot);
  assert.deepEqual(r.errors, []);
  assert.ok(r.notes.some((n) => /^agent descriptions: ~\d+ of 15000 tokens, headroom \d+$/.test(n)), JSON.stringify(r.notes));
});

const CHECK_ROLES = { ...Object.fromEntries(PROTECTED.map((r) => [r, 'opus'])), qa: 'sonnet' };
function floorFixture(mutate = (f) => f, models = CHECK_ROLES) {
  const floor = { v: 1, release: '0.16.0', floor: { ...CHECK_ROLES }, protected: [...PROTECTED] };
  const text = typeof mutate === 'string' ? mutate : JSON.stringify(mutate(floor));
  const names = Object.fromEntries(Object.keys(CHECK_ROLES).map((r) => [r, NAMES[r]]));
  const descriptions = Object.fromEntries(Object.keys(CHECK_ROLES).map((r) => [r, `The ${r}.`]));
  return check(agentsRoot(descriptions, { names, floor: text, models }));
}
const floorErrors = (r) => r.errors.filter((e) => /floor/i.test(e));

test('floor file check: a valid file passes and each way to break it is an error', () => {
  assert.deepEqual(floorErrors(floorFixture()), []);
  const broken = {
    'extra key': (f) => ({ ...f, extra: 1 }),
    'wrong v': (f) => ({ ...f, v: 2 }),
    'bad release': (f) => ({ ...f, release: 'v0.16' }),
    'unranked value': (f) => ({ ...f, floor: { ...f.floor, qa: 'fable' } }),
    'missing Role': (f) => { const { qa, ...rest } = f.floor; return { ...f, floor: rest }; },
    'unknown Role': (f) => ({ ...f, floor: { ...f.floor, ghost: 'opus' } }),
    'short protected list': (f) => ({ ...f, protected: f.protected.slice(1) }),
    'extra protected Role': (f) => ({ ...f, protected: [...f.protected, 'qa'] }),
    'not json': '{nope'
  };
  for (const [label, mutate] of Object.entries(broken)) {
    assert.ok(floorErrors(floorFixture(mutate)).length > 0, label);
  }
  const missing = check(agentsRoot(Object.fromEntries(Object.keys(CHECK_ROLES).map((r) => [r, 'd'])), { names: Object.fromEntries(Object.keys(CHECK_ROLES).map((r) => [r, NAMES[r]])) }));
  assert.ok(floorErrors(missing).length > 0, 'missing file');
});

test('floor file check: a file over 16 KiB is an error, and a protected Role below its floor names the Role', () => {
  const valid = JSON.stringify({ v: 1, release: '0.16.0', floor: { ...CHECK_ROLES }, protected: [...PROTECTED] });
  const big = floorFixture(`${valid}${' '.repeat(17 * 1024)}`);
  assert.ok(floorErrors(big).length > 0);
  const below = floorFixture((f) => f, { ...CHECK_ROLES, architect: 'sonnet' });
  assert.ok(below.errors.some((e) => /architect/.test(e) && /floor/i.test(e)), JSON.stringify(below.errors));
});

// ---------- ledger: meta line ----------

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const START = Date.UTC(2026, 9, 1, 8, 0, 0);
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const ledgerDir = (root) => path.join(root, '.company', 'ledger');
const ledgerFile = (root, run) => path.join(ledgerDir(root), `${run}.jsonl`);
const mkProduct = () => {
  const root = fresh('product');
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  return root;
};
const writeLedger = (root, run, lines) => fs.writeFileSync(ledgerFile(root, run), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
const readLines = (root, run) => fs.readFileSync(ledgerFile(root, run), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const led = (root, args, pluginRoot) => ledger(args, { now: NOW, root, pluginRoot });
const step = (run, id, agent, role, spend, model) => ({
  v: 1, run, kind: 'step', id, role, agent, src: 'transcript', ...(model ? { model } : {}),
  tokens: { in: spend, cache_write: 0, cache_read: 5000, out: 0 }
});

test('ship writes one meta line with the plugin version just before the ship record', () => {
  const root = mkProduct();
  writeLedger(root, 'feat-a', [step('feat-a', '01', 'a1', 'backend-engineer', 100)]);
  const out = led(root, ['ship', 'feat-a', '2'], mkPlugin({ version: '0.17.0' }));
  assert.equal(out.code, 0);
  const recs = readLines(root, 'feat-a');
  const metaAt = recs.findIndex((r) => r.kind === 'meta');
  assert.ok(metaAt > 0);
  assert.deepEqual(recs[metaAt], { v: 1, run: 'feat-a', kind: 'meta', aico: '0.17.0' });
  assert.equal(recs[metaAt + 1].kind, 'ship');
  assert.equal(recs.filter((r) => r.kind === 'meta').length, 1);
});

test('ship writes no meta line for excluded runs or an unreadable or odd version', () => {
  const plugin = mkPlugin({ version: '0.17.0' });
  for (const run of ['brainstorm-x', 'replay-x', 'baseline-x']) {
    const root = mkProduct();
    writeLedger(root, run, [step(run, '01', 'a1', 'backend-engineer', 100)]);
    led(root, ['ship', run, '1'], plugin);
    assert.equal(readLines(root, run).some((r) => r.kind === 'meta'), false, run);
  }
  for (const version of [null, '0.17', '0.17.0-beta', '1234.1.1', '0.17.0\nx']) {
    const root = mkProduct();
    writeLedger(root, 'feat-b', [step('feat-b', '01', 'a1', 'backend-engineer', 100)]);
    led(root, ['ship', 'feat-b', '1'], mkPlugin({ version }));
    assert.equal(readLines(root, 'feat-b').some((r) => r.kind === 'meta'), false, String(version));
  }
});

test('report and scorecard give the same numbers with a meta line present', () => {
  const root = mkProduct();
  const body = [step('feat-c', '01', 'a1', 'backend-engineer', 400), { v: 1, run: 'feat-c', kind: 'ship', acs: 2, fix_rounds: 1, high_blockers: 0 }];
  writeLedger(root, 'feat-c', body);
  const without = led(root, ['report', 'feat-c']).lines;
  writeLedger(root, 'feat-c', [body[0], { v: 1, run: 'feat-c', kind: 'meta', aico: '0.17.0' }, body[1]]);
  const withMeta = led(root, ['report', 'feat-c']).lines;
  assert.deepEqual(withMeta, without);
});

// ---------- ledger: model verdict ----------

// One shipped run. side 17 carries a meta line; key is the plan-check state of the run.
let seq = 0;
function shipped(root, name, o = {}) {
  const { side = 17, acs = 2, fix = 1, high = 0, backend = 1000, tech = side === 17 ? 200 : 600, writer = 0, key = 'warn', aico = '0.17.0', extra = [] } = o;
  const start = START + seq * 7200000;
  seq += 1;
  const recs = [step(name, '01', 'a1', 'backend-engineer', backend, 'sonnet')];
  if (tech) recs.push(step(name, '02', 'a2', 'tech-researcher', tech, side === 17 ? 'sonnet' : 'opus'));
  if (writer) recs.push(step(name, '03', 'a3', 'writer', writer, side === 17 ? 'haiku' : 'sonnet'));
  recs.push(...(typeof extra === 'function' ? extra(name) : extra));
  if (side === 17 && aico) recs.push({ v: 1, run: name, kind: 'meta', aico });
  recs.push({ v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high, t_start: iso(start), t_ship: iso(start + 3600000), wait: 60 });
  writeLedger(root, name, recs);
  const dir = path.join(root, '.company', 'work', name);
  fs.mkdirSync(dir, { recursive: true });
  const at = iso(start);
  if (key === 'off') fs.writeFileSync(path.join(dir, 'plan-check.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'off', policy: 'off' })}\n`);
  else if (key === 'warn' || key === 'block') {
    fs.writeFileSync(path.join(dir, 'plan-check.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'scan', policy: key, plan: '03-plan.md', patterns: '23b24ae5466b', findings: 0, decided: 0 })}\n`);
  }
}

function fleet(root, { n17 = 10, n16 = 5, o17 = {}, o16 = {} } = {}) {
  for (let i = 0; i < n16; i += 1) shipped(root, `old-${i}`, { side: 16, ...o16 });
  for (let i = 0; i < n17; i += 1) shipped(root, `new-${i}`, { side: 17, ...o17 });
}

const verdict = (root, plugin, ...args) => led(root, ['model-verdict', ...args], plugin);
const segments = (line) => line.split(' | ');
const one = (r) => {
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.lines.length, 1, JSON.stringify(r));
  return r.lines[0];
};

test('verdict pass: every segment of the one line', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  fleet(root);
  const line = one(verdict(root, plugin));
  assert.deepEqual(segments(line), [
    'model verdict: pass',
    'runs 10 v0.17, 5 v0.16 (plan check warn)',
    'spend/AC 600 (v0.16 800)',
    'downgraded spend/AC 100 (v0.16 300)',
    'fix rounds median 1.0 (v0.16 1.0)',
    'high blockers median 0.0 (v0.16 0.0)',
    'downgraded: tech-researcher',
    'lower model: 10 of 10',
    'excluded: 0',
    'not counted: 0'
  ]);
});

test('verdict uses only the newest runs of each side', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  for (let i = 0; i < 2; i += 1) shipped(root, `oldest-new-${i}`, { side: 17, tech: 90000, fix: 9, high: 9 });
  fleet(root);
  const line = one(verdict(root, plugin));
  assert.ok(segments(line).includes('runs 10 v0.17, 5 v0.16 (plan check warn)'), line);
  assert.ok(segments(line).includes('downgraded spend/AC 100 (v0.16 300)'), line);
  assert.ok(segments(line)[0] === 'model verdict: pass', line);
  const fewer = one(verdict(root, plugin, '--runs', '3'));
  assert.ok(segments(fewer).includes('runs 3 v0.17, 3 v0.16 (plan check warn)'), fewer);
});

test('verdict insufficient: too few v0.17 runs, too few v0.16 runs, no downgraded Role', () => {
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  const a = mkProduct();
  fleet(a, { n17: 9 });
  assert.equal(segments(one(verdict(a, plugin)))[0], 'model verdict: insufficient (n=9)');
  const b = mkProduct();
  fleet(b, { n16: 4 });
  assert.equal(segments(one(verdict(b, plugin)))[0], 'model verdict: insufficient (n=10)');
  const c = mkProduct();
  fleet(c);
  const flat = mkPlugin({ roles: Object.fromEntries(Object.entries(FIXTURE_ROLES).map(([r, [, f]]) => [r, [f, f]])) });
  assert.equal(segments(one(verdict(c, flat)))[0], 'model verdict: insufficient (n=10)');
  const d = mkProduct();
  assert.equal(segments(one(verdict(d, plugin)))[0], 'model verdict: insufficient (n=0)');
});

test('verdict fail on a guard rolls back every downgraded Role', () => {
  const plugin = mkPlugin();
  for (const guard of [{ fix: 3 }, { high: 2 }, { backend: 3000 }]) {
    const root = mkProduct();
    fleet(root, { o17: guard });
    const parts = segments(one(verdict(root, plugin)));
    assert.equal(parts[0], 'model verdict: fail', JSON.stringify(guard));
    const rollback = parts.find((p) => p.startsWith('roll back: '));
    assert.ok(rollback, JSON.stringify(parts));
    assert.match(rollback, /tech-researcher/);
    assert.match(rollback, /writer/);
  }
});

test('verdict fail on spend alone rolls back only the Roles whose own spend did not fall', () => {
  const root = mkProduct();
  const plugin = mkPlugin();
  for (let i = 0; i < 5; i += 1) shipped(root, `old-${i}`, { side: 16, backend: 1000, tech: 600, writer: 300 });
  for (let i = 0; i < 10; i += 1) shipped(root, `new-${i}`, { side: 17, backend: 100, tech: 200, writer: 1000 });
  const parts = segments(one(verdict(root, plugin)));
  assert.equal(parts[0], 'model verdict: fail');
  const rollback = parts.find((p) => p.startsWith('roll back: '));
  assert.match(rollback, /writer/);
  assert.doesNotMatch(rollback, /tech-researcher/);
});

test('verdict leaves out runs whose plan check differs and counts them as excluded', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  fleet(root);
  for (let i = 0; i < 2; i += 1) shipped(root, `blocked-old-${i}`, { side: 16, key: 'block', tech: 90000, fix: 9 });
  shipped(root, 'off-old', { side: 16, key: 'off', tech: 90000 });
  shipped(root, 'none-old', { side: 16, key: 'none', tech: 90000 });
  const parts = segments(one(verdict(root, plugin)));
  assert.equal(parts[0], 'model verdict: pass');
  assert.ok(parts.includes('runs 10 v0.17, 5 v0.16 (plan check warn)'), JSON.stringify(parts));
  assert.ok(parts.includes('spend/AC 600 (v0.16 800)'), JSON.stringify(parts));
  assert.ok(parts.includes('excluded: 4'), JSON.stringify(parts));
});

test('verdict takes its plan check key from the newest v0.17 run', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  for (let i = 0; i < 5; i += 1) shipped(root, `old-${i}`, { side: 16, key: 'block' });
  for (let i = 0; i < 9; i += 1) shipped(root, `mid-${i}`, { side: 17, key: 'block' });
  shipped(root, 'newest', { side: 17, key: 'warn' });
  const parts = segments(one(verdict(root, plugin)));
  assert.ok(parts.some((p) => p.includes('(plan check warn)')), JSON.stringify(parts));
  assert.equal(parts[0], 'model verdict: insufficient (n=1)');
  assert.ok(parts.includes('excluded: 14'), JSON.stringify(parts));
});

test('verdict counts runs it cannot use as not counted, and skips excluded run names silently', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  fleet(root);
  shipped(root, 'no-acs', { side: 17, acs: 0 });
  shipped(root, 'unreconciled', { side: 17, extra: [{ v: 1, run: 'unreconciled', kind: 'step', id: '09', role: 'qa', agent: 'zz', src: 'notification', ctx_end: 100 }] });
  shipped(root, 'too-old-meta', { side: 17, aico: '0.16.5' });
  writeLedger(root, 'untimed', [step('untimed', '01', 'a1', 'backend-engineer', 10), { v: 1, run: 'untimed', kind: 'meta', aico: '0.17.0' }, { v: 1, run: 'untimed', kind: 'ship', acs: 1, fix_rounds: 0, high_blockers: 0 }]);
  shipped(root, 'brainstorm-skip', { side: 17, tech: 99999 });
  shipped(root, 'replay-skip', { side: 16, tech: 99999 });
  shipped(root, 'baseline-skip', { side: 16, tech: 99999 });
  const parts = segments(one(verdict(root, plugin)));
  assert.equal(parts[0], 'model verdict: pass');
  assert.ok(parts.includes('not counted: 4'), JSON.stringify(parts));
  assert.ok(parts.includes('excluded: 0'), JSON.stringify(parts));
});

test('verdict newer than 0.17.0 counts on the v0.17 side', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  fleet(root, { n17: 9 });
  shipped(root, 'later', { side: 17, aico: '0.18.2' });
  assert.equal(segments(one(verdict(root, plugin)))[0], 'model verdict: pass');
});

test('verdict line holds only Roles from the floor file, whatever the ledger says', () => {
  const root = mkProduct();
  const plugin = mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } });
  fleet(root, { o17: { extra: (name) => [step(name, '07', 'a7', 'zz-sneaky-role', 5, 'sonnet')] } });
  fs.writeFileSync(ledgerFile(root, 'garbage'), 'not json\n{"v":1,"kind":"ship"\n');
  const r = verdict(root, plugin);
  assert.equal(r.code, 0);
  const line = one(r);
  assert.equal(line.includes('zz-sneaky-role'), false);
  assert.equal(line.includes('\n'), false);
});

test('verdict runs option: bounds are refused, a missing ledger folder is not an error', () => {
  const plugin = mkPlugin();
  const root = mkProduct();
  for (const bad of ['2', '51', 'abc', '', '-1', '5.5', '1e1']) {
    const r = verdict(root, plugin, '--runs', bad);
    assert.equal(r.code, 2, bad);
    assert.ok(r.lines[0].startsWith('refused: '), bad);
  }
  assert.equal(verdict(root, plugin, '--runs', '3').code, 0);
  assert.equal(verdict(root, plugin, '--runs', '50').code, 0);
  const empty = fresh('empty');
  const r = verdict(empty, plugin);
  assert.equal(r.code, 0);
  assert.equal(segments(one(r))[0], 'model verdict: insufficient (n=0)');
});

test('verdict line states no money, percent or saving, and a fail still exits 0', () => {
  const plugin = mkPlugin();
  const lines = [];
  const pass = mkProduct();
  fleet(pass, { o17: { tech: 100 } });
  lines.push(one(verdict(pass, mkPlugin({ roles: { ...FIXTURE_ROLES, writer: ['sonnet', 'sonnet'] } }))));
  const fail = mkProduct();
  fleet(fail, { o17: { fix: 5 } });
  const failed = verdict(fail, plugin);
  assert.equal(failed.code, 0);
  lines.push(one(failed));
  lines.push(one(verdict(mkProduct(), plugin)));
  assert.equal(segments(lines[1])[0], 'model verdict: fail');
  for (const line of lines) {
    assert.doesNotMatch(line, /[%$€£]|cheaper|saving|savings|\bsave[sd]?\b|cost|price|money|euro|\bEUR\b|\bUSD\b/i, line);
  }
});

test('verdict from the command line prints one line and exits 0 in an empty product', () => {
  const root = mkProduct();
  const home = fresh('home');
  const r = spawnSync(process.execPath, [LEDGER, 'model-verdict'], { cwd: root, encoding: 'utf8', env: cleanChildEnv(home) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.match(r.stdout, /^model verdict: insufficient \(n=0\)/);
});
