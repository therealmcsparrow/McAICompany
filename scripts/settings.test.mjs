import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BRAINSTORM_DEFAULTS, CONTEXT_CAP_DEFAULT, GATE_DEFAULTS, checkLayers, resolvePersonalities, MODS_DEFAULTS, PIPELINE_DEFAULTS, PLAN_CHECK_DEFAULTS, REPROMPT_DEFAULTS, Refusal, SKILLSPECTOR_DEFAULTS, pluginDefaults, readLayer, readProfile, resolveSettings, run,
  MODEL_RANK, loadModelFloor, modelEnvLine, readClaudeVersion, templateOptions, validateLayer, writeLayer, writeProfile
} from './settings.mjs';

const script = path.join(import.meta.dirname, 'settings.mjs');

const PROTECTED_IN_SANDBOX = ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'];

// The sandbox plugin's floor table: each Role's frontmatter model is its floor.
function writeFloor(pluginRoot, { protectedRoles = PROTECTED_IN_SANDBOX, floor } = {}) {
  const table = floor ?? Object.fromEntries(Object.entries(AGENTS).map(([r, a]) => [r, a.model]));
  fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor: table, protected: protectedRoles }));
}

const AGENTS = {
  architect: { model: 'opus', effort: 'high', name: 'Ava' },
  qa: { model: 'sonnet', effort: 'medium', name: 'Quinn' },
  security: { model: 'opus', effort: 'xhigh', name: 'Sam' }
};

function agentFile(role, { model, effort }) {
  return ['---', `name: ${role}`, `description: The ${role}.`, 'tools: Read', `model: ${model}`, `effort: ${effort}`, '---', `# ${role}`, ''].join('\n');
}

function sandbox(t, { company = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  if (company) fs.mkdirSync(path.join(cwd, '.company'));
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'company'));
  fs.mkdirSync(path.join(pluginRoot, 'skills', 'lead', 'references'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
  const names = {};
  for (const [role, a] of Object.entries(AGENTS)) {
    fs.writeFileSync(path.join(pluginRoot, 'agents', `${role}.md`), agentFile(role, a));
    names[role] = a.name;
  }
  fs.writeFileSync(path.join(pluginRoot, 'company', 'names.json'), JSON.stringify(names));
  writeFloor(pluginRoot);
  const ctx = { home, cwd, pluginRoot };
  const config = path.join(home, 'config.json');
  const projectFile = path.join(cwd, '.company', 'settings.json');
  return {
    ...ctx,
    ctx,
    config,
    projectFile,
    user: (layer, extra = {}) => fs.writeFileSync(config, JSON.stringify({ ...extra, aico_settings: { version: 1, ...layer } })),
    project: (layer) => fs.writeFileSync(projectFile, JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    cli: (...args) => {
      const r = spawnSync(process.execPath, [script, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, MCSPARROW_HOME: home }
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    }
  };
}

const roleSet = new Set(Object.keys(AGENTS));

test('plugin defaults come from frontmatter and names.json', (t) => {
  const s = sandbox(t);
  const d = pluginDefaults(s.pluginRoot);
  assert.deepEqual(d.roles, AGENTS);
  assert.deepEqual(d.pipeline, PIPELINE_DEFAULTS);
  assert.deepEqual(d.gates, GATE_DEFAULTS);
  assert.deepEqual(d.brainstorm, { film_script: false, debate: 'crossfire' });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.roles.qa, {
    name: 'Quinn', model: 'sonnet', effort: 'medium', context_cap: 95000, floor: 'sonnet', protected: false,
    source: { name: 'plugin', model: 'plugin', effort: 'plugin', context_cap: 'plugin' }
  });
  assert.deepEqual(r.pipeline, { ...PIPELINE_DEFAULTS, second_reviewer_model_effective: 'opus' });
  assert.deepEqual(r.gates, GATE_DEFAULTS);
  assert.deepEqual(r.brainstorm, BRAINSTORM_DEFAULTS);
  assert.equal(r.pipeline.context_cap, 95000);
  assert.deepEqual(r.unlocked, []);
  assert.deepEqual(r.ignored, []);
  assert.deepEqual(r.warnings, []);
  assert.match(r.revision, /^[0-9a-f]{64}$/);
});

test('project beats user beats plugin, per field', (t) => {
  const s = sandbox(t);
  s.user({ roles: { qa: { model: 'opus' } }, pipeline: { fix_rounds: 4 } });
  s.project({ roles: { qa: { effort: 'high' } }, pipeline: { fix_rounds: 0, lanes: { legal: 'on' } } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.roles.qa, {
    name: 'Quinn', model: 'opus', effort: 'high', context_cap: 95000, floor: 'sonnet', protected: false,
    source: { name: 'plugin', model: 'user', effort: 'project', context_cap: 'plugin' }
  });
  assert.equal(r.pipeline.fix_rounds, 0);
  assert.equal(r.pipeline.dispatch, 'parallel');
  assert.equal(r.pipeline.lanes.legal, 'on');
  assert.equal(r.pipeline.lanes.persona, true);
});

test('validateLayer refuses', () => {
  const cases = [
    [{ roles: { qa: { model: 'gpt4' } } }, 'roles.qa.model'],
    [{ roles: { qa: { effort: 'huge' } } }, 'roles.qa.effort'],
    [{ roles: { qa: { name: 'Q1' } } }, 'roles.qa.name'],
    [{ pipeline: { fix_rounds: 6 } }, 'pipeline.fix_rounds'],
    [{ pipeline: { fix_rounds: 1.5 } }, 'pipeline.fix_rounds'],
    [{ pipeline: { dispatch: 'fast' } }, 'pipeline.dispatch'],
    [{ pipeline: { lanes: { legal: true } } }, 'pipeline.lanes.legal'],
    [{ pipeline: { lanes: { persona: 'yes' } } }, 'pipeline.lanes.persona'],
    [{ gates: { ship: 'yes' } }, 'gates.ship'],
    [{ unlocked: ['brief'] }, 'unlocked'],
    [{ roles: { ghost: { model: 'opus' } } }, 'ghost'],
    [{ foo: 1 }, 'foo'],
    [{ roles: { qa: { foo: 1 } } }, 'roles.qa.foo'],
    [{ gates: { unlocked: ['ship'] } }, 'gates.unlocked']
  ];
  for (const [layer, field] of cases) {
    const reasons = validateLayer({ version: 1, ...layer }, roleSet);
    assert.equal(reasons.length, 1, JSON.stringify(layer) + ' ' + JSON.stringify(reasons));
    assert.ok(reasons[0].includes(field), `${reasons[0]} should name ${field}`);
  }
  assert.equal(validateLayer({ version: 2 }, roleSet).length, 1);
  assert.equal(validateLayer(null, roleSet).length, 1);
  assert.deepEqual(validateLayer({
    version: 1,
    roles: { qa: { name: "D'Arcy Lee-Ann", model: 'inherit', effort: 'max' } },
    pipeline: { fix_rounds: 5, dispatch: 'sequential', lanes: { legal: 'off', security: false } },
    gates: { brief: 'auto', plan: 'ask', ship: 'auto', installs: 'auto' },
    unlocked: ['ship', 'security', 'installs']
  }, roleSet), []);
});

test('ship auto without a user unlock stays ask', (t) => {
  const s = sandbox(t);
  s.user({ gates: { ship: 'auto', brief: 'auto', plan: 'auto' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'ask');
  assert.equal(r.gates.brief, 'auto');
  assert.equal(r.gates.plan, 'auto');
  assert.ok(r.ignored.some((x) => x.includes('gates.ship')), JSON.stringify(r.ignored));
});

test('project unlocked is ignored', (t) => {
  const s = sandbox(t);
  s.project({ unlocked: ['ship'], gates: { ship: 'auto' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'ask');
  assert.deepEqual(r.unlocked, []);
  assert.ok(r.ignored.includes('project unlocked: ship'), JSON.stringify(r.ignored));
});

test('security lane off needs the user security unlock', (t) => {
  const s = sandbox(t);
  s.project({ pipeline: { lanes: { security: false, compliance: false, persona: false } }, gates: { installs: 'auto' } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.lanes.security, true);
  assert.equal(r.pipeline.lanes.compliance, true);
  assert.equal(r.pipeline.lanes.persona, false);
  assert.equal(r.gates.installs, 'ask');
  assert.ok(r.ignored.some((x) => x.includes('pipeline.lanes.security')));
  assert.ok(r.ignored.some((x) => x.includes('pipeline.lanes.compliance')));
  assert.ok(r.ignored.some((x) => x.includes('gates.installs')));
  s.user({ unlocked: ['security', 'installs'] });
  r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.lanes.security, false);
  assert.equal(r.pipeline.lanes.compliance, false);
  assert.equal(r.gates.installs, 'auto');
  assert.deepEqual(r.unlocked, ['security', 'installs']);
  assert.deepEqual(r.ignored, []);
});

test('project can lock again', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['ship', 'security'], gates: { ship: 'auto' }, pipeline: { lanes: { security: false } } });
  assert.equal(resolveSettings(s.ctx).gates.ship, 'auto');
  s.project({ gates: { ship: 'ask' }, pipeline: { lanes: { security: true } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'ask');
  assert.equal(r.pipeline.lanes.security, true);
});

test('duplicate effective names are refused on write', (t) => {
  const s = sandbox(t);
  assert.throws(
    () => writeLayer('user', { version: 1, roles: { qa: { name: 'Ava' } } }, s.ctx),
    (e) => e instanceof Refusal && e.message.includes('Ava') && e.message.includes('architect')
  );
  assert.throws(
    () => writeLayer('user', { version: 1, roles: { qa: { name: 'ava' } } }, s.ctx),
    (e) => e instanceof Refusal && e.message.includes('architect')
  );
  assert.equal(fs.existsSync(s.config), false);
  // A project rename frees the name for the user layer.
  s.project({ roles: { architect: { name: 'Ada' } } });
  writeLayer('user', { version: 1, roles: { qa: { name: 'Ava' } } }, s.ctx);
  assert.equal(resolveSettings(s.ctx).roles.qa.name, 'Ava');
});

test('broken config.json falls back to defaults with a warning', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{broken');
  let r = resolveSettings(s.ctx);
  assert.deepEqual(r.roles.qa.source, { name: 'plugin', model: 'plugin', effort: 'plugin', context_cap: 'plugin' });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not valid JSON/);

  // Wrong types: only the bad parts drop.
  s.user({ roles: { qa: { model: 'opus', effort: 7 }, ghost: { model: 'haiku' } }, pipeline: { fix_rounds: 'two', dispatch: 'sequential' } });
  s.project({ gates: 'auto' });
  r = resolveSettings(s.ctx);
  assert.equal(r.roles.qa.model, 'opus');
  assert.equal(r.roles.qa.effort, 'medium');
  assert.equal(r.roles.ghost, undefined);
  assert.equal(r.pipeline.fix_rounds, 2);
  assert.equal(r.pipeline.dispatch, 'sequential');
  assert.deepEqual(r.gates, GATE_DEFAULTS);
  assert.deepEqual(r.brainstorm, BRAINSTORM_DEFAULTS);
  assert.equal(r.pipeline.context_cap, 95000);
  assert.equal(r.warnings.length, 4, JSON.stringify(r.warnings));

  const { layer, warnings } = readLayer('user', s.ctx);
  assert.deepEqual(layer, { version: 1, roles: { qa: { model: 'opus' } }, pipeline: { dispatch: 'sequential' } });
  assert.equal(warnings.length, 3);

  const cli = s.cli('get', 'roles.qa.effort');
  assert.equal(cli.code, 0);
  assert.match(cli.err, /^warning: /m);
});

test('writeLayer user keeps aico_language and other keys', (t) => {
  const s = sandbox(t);
  s.user({ roles: { qa: { model: 'haiku' } } }, { aico_language: 'nl', keep: { a: [1] } });
  writeLayer('user', { version: 1, gates: { brief: 'auto' } }, s.ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')), {
    aico_language: 'nl',
    keep: { a: [1] },
    aico_settings: { version: 1, gates: { brief: 'auto' } }
  });
  writeLayer('project', { version: 1, roles: { qa: { effort: 'low' } } }, s.ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.projectFile, 'utf8')), {
    aico_settings: { version: 1, roles: { qa: { effort: 'low' } } }
  });
});

test('project write without .company/ is refused', (t) => {
  const s = sandbox(t, { company: false });
  assert.throws(() => writeLayer('project', { version: 1 }, s.ctx), Refusal);
  assert.equal(fs.existsSync(path.join(s.cwd, '.company')), false);
});

test('write is atomic', (t) => {
  const s = sandbox(t);
  s.user({ roles: { qa: { model: 'haiku' } } }, { aico_language: 'nl' });
  const before = fs.readFileSync(s.config);
  const { revision } = resolveSettings(s.ctx);
  assert.throws(
    () => writeLayer('user', { version: 1, roles: { qa: { model: 'gpt4' } }, pipeline: { fix_rounds: 9 } }, s.ctx),
    (e) => e instanceof Refusal && e.message.includes('; ')
  );
  assert.deepEqual(fs.readFileSync(s.config), before);
  assert.equal(resolveSettings(s.ctx).revision, revision);
  writeLayer('user', { version: 1, roles: { qa: { model: 'opus' } } }, s.ctx);
  writeLayer('project', { version: 1, roles: { qa: { model: 'fable' } } }, s.ctx);
  assert.notEqual(resolveSettings(s.ctx).revision, revision);
  const leftovers = [s.home, path.join(s.cwd, '.company')]
    .flatMap((dir) => fs.readdirSync(dir))
    .filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('get CLI prints JSON', (t) => {
  const s = sandbox(t);
  const r = s.cli('get');
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
  const data = JSON.parse(r.out);
  assert.deepEqual(Object.keys(data).sort(), ['brainstorm', 'gates', 'ignored', 'language', 'mods', 'pipeline', 'plan_check', 'profile', 'reprompt', 'revision', 'roles', 'skillspector', 'unlocked', 'warnings']);
  assert.equal(Object.keys(data.roles).length, fs.readdirSync(path.join(import.meta.dirname, '..', 'agents')).filter((f) => f.endsWith('.md')).length);
  assert.equal(data.roles.architect.name, 'Ava');
});

test('get roles.qa.model prints sonnet', (t) => {
  const s = sandbox(t);
  assert.deepEqual(s.cli('get', 'roles.qa.model'), { code: 0, out: 'sonnet\n', err: '' });
  assert.equal(s.cli('get', 'pipeline.fix_rounds').out, '2\n');
  assert.deepEqual(JSON.parse(s.cli('get', 'pipeline.lanes').out), PIPELINE_DEFAULTS.lanes);
  fs.writeFileSync(path.join(s.home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, roles: { qa: { model: 'haiku' } } } }));
  assert.equal(s.cli('get', 'roles.qa.model').out, 'haiku\n');
  const missing = s.cli('get', 'roles.nobody.model');
  assert.equal(missing.code, 2);
  assert.match(missing.out, /^refused: /);
});

test('unknown commands print usage and exit 2', (t) => {
  const s = sandbox(t);
  const usage = 'refused: usage: settings.mjs get [key] | serve [--no-open] | model-env';
  for (const args of [[], ['bogus'], ['serve', '--bogus'], ['serve', '--no-open', 'x'], ['get', 'a', 'b'], ['model-env', 'x']]) {
    assert.deepEqual(run(args, s.ctx), { code: 2, out: usage }, args.join(' '));
  }
  assert.deepEqual(run(['serve'], s.ctx), { code: 0, serve: { open: true } });
  assert.deepEqual(run(['serve', '--no-open'], s.ctx), { code: 0, serve: { open: false } });
});

const PROJECT_MD = [
  '# Project profile', '', '<!-- note -->', '',
  'product_type: plugin', 'engagement: own', 'client: none', 'audience: the CEO',
  'languages: en', 'voice: technical + clear', 'standards: .company/standards.md', '',
  '## Personas', 'product_type: not a header line', '- (none)', ''
].join('\r\n');

function projectMd(s, text = PROJECT_MD) {
  const file = path.join(s.cwd, '.company', 'project.md');
  fs.writeFileSync(file, text);
  return file;
}

test('templateOptions parses the template and skips placeholders', (t) => {
  const s = sandbox(t);
  assert.deepEqual(templateOptions(s.pluginRoot), {
    product_type: ['web', 'desktop', 'game'],
    engagement: ['own', 'client'],
    voice: ['clear', 'bold', 'technical']
  });
});

test('writeProfile changes only edited lines', (t) => {
  const s = sandbox(t);
  const file = projectMd(s);
  writeProfile({ audience: 'makers', goal: 'ship it' }, s.ctx);
  const lines = PROJECT_MD.split('\r\n');
  lines[lines.indexOf('audience: the CEO')] = 'audience: makers';
  lines.splice(lines.indexOf('languages: en'), 0, 'goal: ship it');
  // goal is inserted after the last header key line, so rebuild the expectation that way
  const want = PROJECT_MD.split('\r\n');
  want[want.indexOf('audience: the CEO')] = 'audience: makers';
  want.splice(want.indexOf('standards: .company/standards.md') + 1, 0, 'goal: ship it');
  assert.equal(fs.readFileSync(file, 'utf8'), want.join('\r\n'));
  assert.equal(readProfile(s.ctx).fields.goal, 'ship it');
  assert.equal(readProfile(s.ctx).fields.audience, 'makers');
});

test('writeProfile keeps LF files LF', (t) => {
  const s = sandbox(t);
  const file = projectMd(s, PROJECT_MD.replaceAll('\r\n', '\n'));
  writeProfile({ client: 'Acme' }, s.ctx);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('\r'));
  assert.ok(text.includes('\nclient: Acme\n'));
});

test('writeProfile refuses bad values', (t) => {
  const s = sandbox(t);
  const file = projectMd(s);
  const before = fs.readFileSync(file, 'utf8');
  for (const changes of [
    { product_type: 'spaceship' },
    { goal: 'a\nb' },
    { audience: 'x'.repeat(201) },
    { languages: 'en, xx-!!' },
    { voice: 'clear + loud' },
    { nonsense: 'x' }
  ]) {
    assert.throws(() => writeProfile(changes, s.ctx), Refusal, JSON.stringify(changes).slice(0, 40));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('writeProfile accepts valid values', (t) => {
  const s = sandbox(t);
  projectMd(s);
  writeProfile({ audience: 'x'.repeat(200), languages: 'en, nl-NL', product_type: 'game', voice: 'bold + clear' }, s.ctx);
  const f = readProfile(s.ctx).fields;
  assert.equal(f.languages, 'en, nl-NL');
  assert.equal(f.product_type, 'game');
  assert.equal(f.voice, 'bold + clear');
});

test('voice accepts "technical + clear"', (t) => {
  const s = sandbox(t);
  projectMd(s);
  writeProfile({ voice: 'clear + technical' }, s.ctx);
  assert.equal(readProfile(s.ctx).fields.voice, 'clear + technical');
});

test('an unchanged stored value outside the options is kept', (t) => {
  const s = sandbox(t);
  projectMd(s);
  writeProfile({ product_type: 'plugin', audience: 'makers' }, s.ctx);
  const f = readProfile(s.ctx).fields;
  assert.equal(f.product_type, 'plugin');
  assert.equal(f.audience, 'makers');
  assert.throws(() => writeProfile({ product_type: 'spaceship' }, s.ctx), Refusal);
});

test('no .company/project.md: readProfile.hasProject false and writeProfile refuses', (t) => {
  const s = sandbox(t);
  assert.deepEqual(readProfile(s.ctx), { hasProject: false, fields: {} });
  assert.throws(() => writeProfile({ goal: 'x' }, s.ctx), (e) => e instanceof Refusal && /no \.company\/project\.md/.test(e.message));
});

test('resolveSettings returns language and profile', (t) => {
  const s = sandbox(t);
  projectMd(s);
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.language, { tag: 'en', source: 'default' });
  assert.equal(r.profile.hasProject, true);
  assert.equal(r.profile.fields.voice, 'technical + clear');
  assert.deepEqual(r.profile.options.engagement, ['own', 'client']);
  const bare = sandbox(t, { company: false });
  assert.equal(resolveSettings(bare.ctx).profile.hasProject, false);
});

// A broken project layer must not drop its re-locks: the locked Gates stay ask and the locked lanes on.
const RELOCK_USER = { unlocked: ['ship', 'security'], gates: { ship: 'auto' }, pipeline: { lanes: { security: false } } };
const RELOCK = { gates: { ship: 'ask' }, pipeline: { lanes: { security: true } } };

function assertHeld(r) {
  assert.equal(r.gates.ship, 'ask');
  assert.equal(r.gates.installs, 'ask');
  assert.equal(r.pipeline.lanes.security, true);
  assert.equal(r.pipeline.lanes.compliance, true);
  assert.ok(r.warnings.some((w) => /held/.test(w) && w.includes('ship')), JSON.stringify(r.warnings));
}

test('a valid project layer without re-locks keeps the user unlocks', (t) => {
  const s = sandbox(t);
  s.user(RELOCK_USER);
  s.project({ roles: { qa: { effort: 'low' } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'auto');
  assert.equal(r.pipeline.lanes.security, false);
  assert.deepEqual(r.warnings, []);
});

test('project version 2 holds the locks', (t) => {
  const s = sandbox(t);
  s.user(RELOCK_USER);
  fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 2, ...RELOCK } }));
  assertHeld(resolveSettings(s.ctx));
});

test('an invalid project lock value holds the locks', (t) => {
  const s = sandbox(t);
  s.user(RELOCK_USER);
  s.project({ gates: { ship: 'Ask' }, pipeline: { lanes: { security: 'on' } } });
  assertHeld(resolveSettings(s.ctx));
});

test('invalid project JSON holds the locks', (t) => {
  const s = sandbox(t);
  s.user(RELOCK_USER);
  fs.writeFileSync(s.projectFile, '{"aico_settings": {"version": 1, "gates": {"ship": "ask"');
  assertHeld(resolveSettings(s.ctx));
});

test('an unreadable project layer warns and holds the locks', (t) => {
  const s = sandbox(t);
  s.user(RELOCK_USER);
  s.project(RELOCK);
  const statSync = fs.statSync;
  t.mock.method(fs, 'statSync', (p, ...rest) => {
    if (path.resolve(String(p)) === path.resolve(s.projectFile)) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return statSync(p, ...rest);
  });
  const r = resolveSettings(s.ctx);
  assertHeld(r);
  assert.ok(r.warnings.some((w) => w.includes('EACCES')), JSON.stringify(r.warnings));
});

test('the temp file name is not predictable and never overwrites what is there', (t) => {
  const s = sandbox(t);
  const old = `${s.config}.${process.pid}.tmp`;
  fs.writeFileSync(old, 'keep');
  writeLayer('user', { version: 1, gates: { brief: 'auto' } }, s.ctx);
  assert.equal(fs.readFileSync(old, 'utf8'), 'keep');
  assert.equal(JSON.parse(fs.readFileSync(s.config, 'utf8')).aico_settings.gates.brief, 'auto');
  assert.deepEqual(fs.readdirSync(s.home).filter((f) => f.endsWith('.tmp')), [path.basename(old)]);
});

test('writeProfile inserts into a header without key lines', (t) => {
  const s = sandbox(t);
  const file = projectMd(s, ['# Project profile', '', '## Personas', '- (none)', ''].join('\n'));
  writeProfile({ goal: 'ship it' }, s.ctx);
  assert.equal(fs.readFileSync(file, 'utf8'), ['# Project profile', '', 'goal: ship it', '## Personas', '- (none)', ''].join('\n'));
  assert.equal(readProfile(s.ctx).fields.goal, 'ship it');
});

test('writeProfile inserts two missing fields in order', (t) => {
  const s = sandbox(t);
  const file = projectMd(s, ['# Project profile', '', '## Personas', '- (none)', ''].join('\n'));
  writeProfile({ goal: 'ship it', license: 'MIT' }, s.ctx);
  assert.equal(fs.readFileSync(file, 'utf8'), ['# Project profile', '', 'goal: ship it', 'license: MIT', '## Personas', '- (none)', ''].join('\n'));
  const keyed = sandbox(t);
  const keyedFile = projectMd(keyed);
  writeProfile({ goal: 'ship it', license: 'MIT' }, keyed.ctx);
  const want = PROJECT_MD.split('\r\n');
  want.splice(want.indexOf('standards: .company/standards.md') + 1, 0, 'goal: ship it', 'license: MIT');
  assert.equal(fs.readFileSync(keyedFile, 'utf8'), want.join('\r\n'));
});

test('names refuse edge spaces and double spaces, allow combining marks, clash case-insensitively', (t) => {
  for (const name of [' Ava', 'Ava ', 'Ava  Lee', 'Ava\tLee']) {
    assert.equal(validateLayer({ version: 1, roles: { qa: { name } } }, roleSet).length, 1, JSON.stringify(name));
  }
  for (const name of ['Ava Lee', 'Zoé', "D'Arcy Lee-Ann", 'Lucía']) {
    assert.deepEqual(validateLayer({ version: 1, roles: { qa: { name } } }, roleSet), [], JSON.stringify(name));
  }
  assert.equal(validateLayer({ version: 1, roles: { qa: { name: '́Ava' } } }, roleSet).length, 1);
  const s = sandbox(t);
  s.user({ roles: { qa: { name: 'Zed' }, security: { name: 'ZED' } } });
  assert.ok(resolveSettings(s.ctx).warnings.some((w) => w.includes('qa') && w.includes('security')));
});

test('context_cap is deprecated and reported 95000', (t) => {
  const s = sandbox(t);
  let r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.context_cap, 95000);
  assert.equal(r.roles.qa.context_cap, 95000);
  assert.equal(r.roles.qa.source.context_cap, 'plugin');
  s.user({ roles: { qa: { context_cap: 200000 } }, pipeline: { context_cap: 100000 } });
  s.project({ roles: { qa: { context_cap: 60000 } }, pipeline: { context_cap: 1000000 } });
  r = resolveSettings(s.ctx);
  assert.equal(r.roles.qa.context_cap, 95000);
  assert.equal(r.roles.qa.source.context_cap, 'plugin');
  assert.equal(r.roles.architect.context_cap, 95000);
  assert.equal(r.pipeline.context_cap, 95000);
  assert.deepEqual(r.warnings, []);
  assert.equal(s.cli('get', 'roles.qa.context_cap').out, '95000\n');
  assert.equal(s.cli('get', 'pipeline.context_cap').out, '95000\n');
});

test('a stored context_cap stays on disk and is still accepted by set', (t) => {
  const s = sandbox(t);
  s.user({ pipeline: { context_cap: 100000 } });
  assert.deepEqual(readLayer('user', s.ctx).layer.pipeline, { context_cap: 100000 });
  assert.deepEqual(resolveSettings(s.ctx).warnings, []);
  assert.equal(PIPELINE_DEFAULTS.context_cap, 95000);
  assert.equal(CONTEXT_CAP_DEFAULT, 95000);
});

test('context_cap refuses anything but a whole number from 60000 to 1000000', () => {
  for (const bad of [59999, 1000001, 150000.5, '150000', null, true, -1, Number.NaN]) {
    for (const layer of [{ pipeline: { context_cap: bad } }, { roles: { qa: { context_cap: bad } } }]) {
      const reasons = validateLayer({ version: 1, ...layer }, roleSet);
      assert.deepEqual(reasons, ['context_cap must be a whole number from 60000 to 1000000'], JSON.stringify(layer));
    }
  }
  for (const ok of [60000, 150000, 1000000]) {
    assert.deepEqual(validateLayer({ version: 1, pipeline: { context_cap: ok }, roles: { qa: { context_cap: ok } } }, roleSet), []);
  }
});

test('brainstorm keys validate, resolve per field and are not locks', (t) => {
  const s = sandbox(t);
  assert.deepEqual(validateLayer({ version: 1, brainstorm: { film_script: true, debate: 'full_pass' } }, roleSet), []);
  assert.deepEqual(validateLayer({ version: 1, brainstorm: { debate: 'duel' } }, roleSet), ['brainstorm.debate must be crossfire or full_pass']);
  assert.equal(validateLayer({ version: 1, brainstorm: { film_script: 'yes' } }, roleSet).length, 1);
  assert.equal(validateLayer({ version: 1, brainstorm: { nope: 1 } }, roleSet).length, 1);
  assert.equal(validateLayer({ version: 1, brainstorm: [] }, roleSet).length, 1);
  s.user({ brainstorm: { film_script: true, debate: 'full_pass' } });
  s.project({ brainstorm: { debate: 'crossfire' } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.brainstorm, { film_script: true, debate: 'crossfire' });
  assert.deepEqual(r.ignored, []);
  assert.equal(s.cli('get', 'brainstorm.debate').out, 'crossfire\n');
  assert.equal(s.cli('get', 'brainstorm.film_script').out, 'true\n');
  assert.deepEqual(JSON.parse(s.cli('get').out).brainstorm, { film_script: true, debate: 'crossfire' });
});

test('a bad brainstorm or context_cap layer falls back to the level below with a warning', (t) => {
  const s = sandbox(t);
  s.user({ brainstorm: { debate: 'full_pass' }, pipeline: { context_cap: 90000 } });
  s.project({ brainstorm: { debate: 'duel' }, pipeline: { context_cap: 5 }, roles: { qa: { context_cap: 'big' } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.brainstorm.debate, 'full_pass');
  assert.equal(r.pipeline.context_cap, 95000);
  assert.equal(r.roles.qa.context_cap, 95000);
  assert.equal(r.warnings.filter((w) => /brainstorm\.debate|context_cap/.test(w)).length, 3);
});

test('a bad project debate value changes no lock and the fail-closed rule still holds', (t) => {
  const s = sandbox(t);
  s.user({ gates: { ship: 'auto' }, unlocked: ['ship'], brainstorm: { debate: 'full_pass' } });
  s.project({ brainstorm: { debate: 'duel' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.brainstorm.debate, 'full_pass');
  assert.equal(r.gates.ship, 'ask', 'a project layer with problems still fails closed');
});

test('writeLayer refuses a bad debate value with the Contract text and writes nothing', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, brainstorm: { debate: 'duel' } }, s.ctx), /brainstorm\.debate must be crossfire or full_pass/);
  assert.equal(fs.existsSync(s.config), false);
  writeLayer('user', { version: 1, brainstorm: { film_script: true, debate: 'full_pass' }, pipeline: { context_cap: 120000 } }, s.ctx);
  assert.deepEqual(readLayer('user', s.ctx).layer, { version: 1, brainstorm: { film_script: true, debate: 'full_pass' }, pipeline: { context_cap: 120000 } });
  const out = s.cli('get', 'brainstorm.nope');
  assert.equal(out.code, 2);
  assert.equal(out.out, 'refused: no setting brainstorm.nope\n');
});

test('pipeline.review_format rejects hostile values first and accepts only plain or pilot', () => {
  const msg = ['pipeline.review_format must be plain or pilot'];
  for (const bad of ['PILOT', 'Plain', ' pilot', '__proto__', 3, true, null, ['pilot'], { a: 1 }, 'x'.repeat(10 * 1024)]) {
    assert.deepEqual(validateLayer({ version: 1, pipeline: { review_format: bad } }, roleSet), msg, String(bad).slice(0, 20));
  }
  for (const ok of ['plain', 'pilot']) assert.deepEqual(validateLayer({ version: 1, pipeline: { review_format: ok } }, roleSet), []);
});

test('review_format defaults to plain, resolves per field and is not a lock', (t) => {
  const s = sandbox(t);
  assert.equal(PIPELINE_DEFAULTS.review_format, 'plain');
  assert.equal(resolveSettings(s.ctx).pipeline.review_format, 'plain');
  assert.equal(s.cli('get', 'pipeline.review_format').out, 'plain\n');
  s.user({ gates: { ship: 'auto' }, unlocked: ['ship'], pipeline: { review_format: 'plain' } });
  s.project({ pipeline: { review_format: 'pilot' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.review_format, 'pilot');
  assert.deepEqual(r.ignored, []);
  assert.equal(s.cli('get', 'pipeline.review_format').out, 'pilot\n');
  assert.equal(JSON.parse(s.cli('get').out).pipeline.review_format, 'pilot');
});

test('a bad review_format layer falls back to the level below with a warning and a fail-closed project does not change it', (t) => {
  const s = sandbox(t);
  s.user({ gates: { ship: 'auto' }, unlocked: ['ship'], pipeline: { review_format: 'pilot' } });
  s.project({ pipeline: { review_format: 'PILOT' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.review_format, 'pilot');
  assert.equal(r.warnings.filter((w) => /review_format/.test(w)).length, 1);
  assert.equal(r.gates.ship, 'ask');
  s.user({ pipeline: { review_format: 7 } });
  assert.equal(resolveSettings(s.ctx).pipeline.review_format, 'plain');
});

test('writeLayer refuses a bad review_format with the Contract text and writes nothing', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, pipeline: { review_format: 'Pilot' } }, s.ctx), /pipeline\.review_format must be plain or pilot/);
  assert.equal(fs.existsSync(s.config), false);
  writeLayer('user', { version: 1, pipeline: { review_format: 'pilot' } }, s.ctx);
  assert.deepEqual(readLayer('user', s.ctx).layer, { version: 1, pipeline: { review_format: 'pilot' } });
});

test('no keep-warm key exists in the schema', () => {
  assert.equal(validateLayer({ version: 1, mods: { keep_warm: true } }, roleSet).length > 0, true);
  assert.equal(JSON.stringify(PIPELINE_DEFAULTS).includes('warm'), false);
});

// ---------- mods.* (aico-settings v1.1) ----------
const MODS_ALL = {
  savvy: { enabled: true, pane: 'auto' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' }
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const modsOf = (s) => plain(resolveSettings(s.ctx).mods);

test('MODS_DEFAULTS: all four mods on, Blast Radius core ask, contract warn, security ask, no keep-warm key', () => {
  assert.deepEqual(plain(MODS_DEFAULTS), MODS_ALL);
  assert.ok(!JSON.stringify(MODS_DEFAULTS).includes('keep_warm'));
});

test('a fresh install resolves every mod on, through get and get <key>', (t) => {
  const s = sandbox(t);
  assert.deepEqual(modsOf(s), MODS_ALL);
  assert.deepEqual(plain(pluginDefaults(s.pluginRoot).mods), MODS_ALL);
  assert.deepEqual(JSON.parse(s.cli('get').out).mods, MODS_ALL);
  assert.equal(s.cli('get', 'mods.blast_radius.security').out, 'ask\n');
  assert.equal(s.cli('get', 'mods.blast_radius.contract').out, 'warn\n');
  assert.equal(s.cli('get', 'mods.reflect.mode').out, 'deterministic\n');
});

test('mods.* refuses hostile values first, each with the Contract text', () => {
  const hostile = ['__proto__', 'ASK', 'Warn', 7, null, ['ask'], { a: 1 }, 'x'.repeat(10240), ''];
  const cases = [
    [['savvy', 'enabled'], 'mods.savvy.enabled must be true or false'],
    [['cache_tax', 'enabled'], 'mods.cache_tax.enabled must be true or false'],
    [['reflect', 'enabled'], 'mods.reflect.enabled must be true or false'],
    [['blast_radius', 'enabled'], 'mods.blast_radius.enabled must be true or false'],
    [['reflect', 'step_check'], 'mods.reflect.step_check must be true or false'],
    [['reflect', 'retrospective'], 'mods.reflect.retrospective must be true or false'],
    [['savvy', 'pane'], 'mods.savvy.pane must be auto or command'],
    [['cache_tax', 'pane'], 'mods.cache_tax.pane must be auto or command'],
    [['reflect', 'mode'], 'mods.reflect.mode must be deterministic or model'],
    [['blast_radius', 'core'], 'mods.blast_radius.core must be ask or warn'],
    [['blast_radius', 'contract'], 'mods.blast_radius.contract must be ask or warn'],
    [['blast_radius', 'security'], 'mods.blast_radius.security must be ask or warn']
  ];
  for (const [[mod, key], msg] of cases) {
    for (const bad of hostile) {
      assert.deepEqual(validateLayer({ version: 1, mods: { [mod]: { [key]: bad } } }, roleSet), [msg], `${mod}.${key} ${String(bad).slice(0, 12)}`);
    }
  }
  for (const [mod, key, ok] of [['savvy', 'enabled', false], ['savvy', 'pane', 'command'], ['reflect', 'mode', 'model'], ['blast_radius', 'core', 'warn']]) {
    assert.deepEqual(validateLayer({ version: 1, mods: { [mod]: { [key]: ok } } }, roleSet), []);
  }
});

test('mods.* refuses unknown keys, unknown mods and wrong shapes; keep_warm is unknown', () => {
  assert.deepEqual(validateLayer({ version: 1, mods: { cache_tax: { keep_warm: true } } }, roleSet), ['mods.cache_tax.keep_warm: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: { cache_tax: { keep_warm: { enabled: true } } } }, roleSet), ['mods.cache_tax.keep_warm: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: { nope: {} } }, roleSet), ['mods.nope: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: JSON.parse('{"__proto__":{"enabled":true}}') }, roleSet), ['mods.__proto__: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: JSON.parse('{"savvy":{"__proto__":"x"}}') }, roleSet), ['mods.savvy.__proto__: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: { savvy: { core: 'ask' } } }, roleSet), ['mods.savvy.core: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: { savvy: { mode: 'model' } } }, roleSet), ['mods.savvy.mode: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, mods: 'on' }, roleSet), ['mods: must be an object']);
  assert.deepEqual(validateLayer({ version: 1, mods: [] }, roleSet), ['mods: must be an object']);
  assert.deepEqual(validateLayer({ version: 1, mods: { savvy: 'on' } }, roleSet), ['mods.savvy: must be an object']);
  assert.deepEqual(validateLayer({ version: 1, mods: { savvy: null } }, roleSet), ['mods.savvy: must be an object']);
});

test('writeLayer refuses a bad mods value and writes nothing; a good one round-trips and keeps options when off', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, mods: { reflect: { mode: 'free' } } }, s.ctx), (e) => e instanceof Refusal && e.message === 'mods.reflect.mode must be deterministic or model');
  assert.ok(!fs.existsSync(s.config));
  assert.throws(() => writeLayer('user', { version: 1, mods: { cache_tax: { keep_warm: true } } }, s.ctx), /unknown key/);
  assert.ok(!fs.existsSync(s.config));
  writeLayer('user', { version: 1, mods: { savvy: { enabled: false, pane: 'command' } } }, s.ctx);
  assert.deepEqual(modsOf(s).savvy, { enabled: false, pane: 'command' });
  assert.deepEqual(plain(readLayer('user', s.ctx).layer.mods.savvy), { enabled: false, pane: 'command' });
});

test('free keys resolve per field, project over user over plugin', (t) => {
  const s = sandbox(t);
  s.user({ mods: { savvy: { enabled: false, pane: 'command' }, reflect: { step_check: false } } });
  s.project({ mods: { savvy: { enabled: true }, reflect: { retrospective: false } } });
  const m = modsOf(s);
  assert.deepEqual(m.savvy, { enabled: true, pane: 'command' });
  assert.deepEqual(m.reflect, { enabled: true, step_check: false, retrospective: false, mode: 'deterministic' });
});

test('lock 1: Reflect model counts only from the user level', (t) => {
  const s = sandbox(t);
  s.project({ mods: { reflect: { mode: 'model' } } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.mods.reflect.mode, 'deterministic');
  assert.ok(r.ignored.some((i) => i.startsWith('mods.reflect.mode: model from project')), r.ignored.join(' | '));
  s.user({ mods: { reflect: { mode: 'model' } } });
  s.project({ mods: { reflect: { mode: 'model' } } });
  r = resolveSettings(s.ctx);
  assert.equal(r.mods.reflect.mode, 'model', 'the user level may spend');
  assert.ok(r.ignored.some((i) => i.startsWith('mods.reflect.mode: model from project')));
  s.project({ mods: { reflect: { mode: 'deterministic' } } });
  r = resolveSettings(s.ctx);
  assert.equal(r.mods.reflect.mode, 'deterministic', 'a project may only tighten');
  assert.equal(r.ignored.filter((i) => i.startsWith('mods.reflect.mode')).length, 0);
});

test('lock 2: a project only tightens Blast Radius', (t) => {
  const s = sandbox(t);
  s.project({ mods: { blast_radius: { core: 'warn', contract: 'ask', enabled: false } } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.mods.blast_radius.core, 'ask');
  assert.equal(r.mods.blast_radius.contract, 'ask', 'a project ask over the warn default is kept');
  assert.equal(r.mods.blast_radius.enabled, true);
  assert.ok(r.ignored.some((i) => i.startsWith('mods.blast_radius.core: warn from project')), r.ignored.join(' | '));
  assert.ok(r.ignored.some((i) => i.startsWith('mods.blast_radius.enabled: off from project')), r.ignored.join(' | '));
  assert.ok(!r.ignored.some((i) => i.startsWith('mods.blast_radius.contract')));
  s.user({ unlocked: ['security'], mods: { blast_radius: { core: 'warn', enabled: false } } });
  s.project({ mods: { blast_radius: { core: 'warn' } } });
  r = resolveSettings(s.ctx);
  assert.equal(r.mods.blast_radius.core, 'warn', 'the user value stays');
  assert.equal(r.mods.blast_radius.enabled, false);
  s.project({ mods: { blast_radius: { enabled: true } } });
  assert.equal(resolveSettings(s.ctx).mods.blast_radius.enabled, true);
});

test('lock 3: security warn and Blast Radius off need the user security unlock', (t) => {
  const s = sandbox(t);
  s.user({ mods: { blast_radius: { security: 'warn', enabled: false, core: 'warn', contract: 'warn' } } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.mods.blast_radius.security, 'ask');
  assert.equal(r.mods.blast_radius.enabled, true);
  assert.equal(r.mods.blast_radius.core, 'warn', 'core and contract warn need no unlock');
  assert.ok(r.ignored.some((i) => i.startsWith('mods.blast_radius.security: warn from user needs the user unlock security')), r.ignored.join(' | '));
  assert.ok(r.ignored.some((i) => i.startsWith('mods.blast_radius.enabled: off from user needs the user unlock security')), r.ignored.join(' | '));
  s.user({ unlocked: ['security'], mods: { blast_radius: { security: 'warn', enabled: false } } });
  r = resolveSettings(s.ctx);
  assert.equal(r.mods.blast_radius.security, 'warn');
  assert.equal(r.mods.blast_radius.enabled, false);
  assert.ok(!r.ignored.some((i) => i.startsWith('mods.blast_radius')));
  s.user({ mods: { blast_radius: { security: 'warn' } } });
  s.project({ unlocked: ['security'] });
  assert.equal(resolveSettings(s.ctx).mods.blast_radius.security, 'ask', 'a project unlock never counts');
});

test('a broken project layer holds Blast Radius at defaults and Reflect deterministic', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['security'], mods: { blast_radius: { enabled: false, security: 'warn', core: 'warn' }, reflect: { mode: 'model' } } });
  s.project({ mods: { savvy: { pane: 'sideways' } } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(plain(r.mods.blast_radius), MODS_ALL.blast_radius);
  assert.equal(r.mods.reflect.mode, 'deterministic');
  assert.ok(r.warnings.some((w) => /held/.test(w) && w.includes('mods.blast_radius')), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => w.includes('mods.savvy.pane must be auto or command')));
  assert.equal(r.mods.savvy.pane, 'auto', 'the bad field falls back to the level below');
  s.project({ roles: { qa: { effort: 'low' } } });
  const ok = resolveSettings(s.ctx);
  assert.equal(ok.mods.blast_radius.enabled, false);
  assert.equal(ok.mods.reflect.mode, 'model');
});

test('a bad mods layer value falls back to the level below with a warning', (t) => {
  const s = sandbox(t);
  s.user({ mods: { savvy: { pane: 'command' } } });
  s.project({ mods: { savvy: { pane: 'AUTO' } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.mods.savvy.pane, 'command');
  assert.equal(r.warnings.filter((w) => w.includes('mods.savvy.pane')).length, 1);
});

test('a hostile config file cannot reach Object.prototype through mods', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{"aico_settings":{"version":1,"mods":{"__proto__":{"enabled":false},"constructor":{"prototype":{"x":1}},"savvy":{"__proto__":{"enabled":false}}}}}');
  const r = resolveSettings(s.ctx);
  assert.equal({}.enabled, undefined);
  assert.equal({}.x, undefined);
  assert.equal(r.mods.savvy.enabled, true);
  assert.equal(r.warnings.length, 3, r.warnings.join(' | '));
});

// ---------- skillspector.mode (aico-settings v1.2) ----------
const SS_MSG = 'skillspector.mode must be no-llm or claude_cli';
const modeOf = (s) => resolveSettings(s.ctx).skillspector.mode;

test('SKILLSPECTOR_DEFAULTS is no-llm and a fresh install resolves it through get and get <key>', (t) => {
  assert.deepEqual(plain(SKILLSPECTOR_DEFAULTS), { mode: 'no-llm' });
  const s = sandbox(t);
  assert.deepEqual(plain(pluginDefaults(s.pluginRoot).skillspector), { mode: 'no-llm' });
  assert.deepEqual(plain(resolveSettings(s.ctx).skillspector), { mode: 'no-llm' });
  assert.deepEqual(JSON.parse(s.cli('get').out).skillspector, { mode: 'no-llm' });
  assert.equal(s.cli('get', 'skillspector.mode').out, 'no-llm\n');
});

test('skillspector.mode refuses anything but no-llm and claude_cli, with the Contract text and no echo', () => {
  const hostile = ['__proto__', 'NO-LLM', 'Claude_CLI', 'claude', 'no_llm', 7, null, true, ['no-llm'], { a: 1 }, 'x'.repeat(10240), ''];
  for (const bad of hostile) {
    assert.deepEqual(validateLayer({ version: 1, skillspector: { mode: bad } }, roleSet), [SS_MSG], String(bad).slice(0, 12));
  }
  for (const ok of ['no-llm', 'claude_cli']) assert.deepEqual(validateLayer({ version: 1, skillspector: { mode: ok } }, roleSet), []);
});

test('skillspector refuses unknown keys and wrong shapes', () => {
  assert.deepEqual(validateLayer({ version: 1, skillspector: { model: 'x' } }, roleSet), ['skillspector.model: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, skillspector: JSON.parse('{"__proto__":{"mode":"claude_cli"}}') }, roleSet), ['skillspector.__proto__: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, skillspector: JSON.parse('{"mode":"no-llm","constructor":1}') }, roleSet), ['skillspector.constructor: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, skillspector: 'no-llm' }, roleSet), ['skillspector: must be an object']);
  assert.deepEqual(validateLayer({ version: 1, skillspector: [] }, roleSet), ['skillspector: must be an object']);
  assert.deepEqual(validateLayer({ version: 1, skillspector: null }, roleSet), ['skillspector: must be an object']);
});

test('writeLayer refuses a bad skillspector.mode and writes nothing; a good one round-trips', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, skillspector: { mode: 'free' } }, s.ctx), (e) => e instanceof Refusal && e.message === SS_MSG);
  assert.ok(!fs.existsSync(s.config));
  writeLayer('user', { version: 1, skillspector: { mode: 'claude_cli' } }, s.ctx);
  assert.equal(modeOf(s), 'claude_cli');
  assert.equal(s.cli('get', 'skillspector.mode').out, 'claude_cli\n');
});

test('claude_cli counts from the user level; a project claude_cli is ignored and listed', (t) => {
  const s = sandbox(t);
  s.project({ skillspector: { mode: 'claude_cli' } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.skillspector.mode, 'no-llm');
  assert.ok(r.ignored.includes('skillspector.mode: claude_cli from project needs the user level'), r.ignored.join(' | '));
  s.user({ skillspector: { mode: 'claude_cli' } });
  r = resolveSettings(s.ctx);
  assert.equal(r.skillspector.mode, 'claude_cli', 'the user level decides');
  assert.ok(r.ignored.some((i) => i.startsWith('skillspector.mode: claude_cli from project')));
  assert.equal(JSON.parse(s.cli('get').out).skillspector.mode, 'claude_cli');
});

test('a project no-llm counts and tightens a user claude_cli, without an ignored line', (t) => {
  const s = sandbox(t);
  s.user({ skillspector: { mode: 'claude_cli' } });
  s.project({ skillspector: { mode: 'no-llm' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.skillspector.mode, 'no-llm');
  assert.ok(!r.ignored.some((i) => i.startsWith('skillspector')));
});

test('a project unlocked entry never turns claude_cli on', (t) => {
  const s = sandbox(t);
  s.project({ unlocked: ['security', 'ship', 'installs'], skillspector: { mode: 'claude_cli' } });
  assert.equal(modeOf(s), 'no-llm');
});

test('a bad skillspector.mode falls back to the level below, ending at no-llm, with a warning', (t) => {
  const s = sandbox(t);
  s.user({ skillspector: { mode: 'claude_cli' } });
  s.project({ skillspector: { mode: 'CLAUDE_CLI' } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.skillspector.mode, 'claude_cli', 'the project value is dropped, the user value stays');
  assert.equal(r.warnings.filter((w) => w.includes(SS_MSG)).length, 1);
  s.user({ skillspector: { mode: 'sure' } });
  s.project({ skillspector: { mode: 'sure' } });
  r = resolveSettings(s.ctx);
  assert.equal(r.skillspector.mode, 'no-llm', 'fails closed');
  assert.equal(r.warnings.filter((w) => w.includes(SS_MSG)).length, 2);
  assert.ok(!r.warnings.join('|').includes('sure'), 'a refused value is never echoed');
});

test('a broken user file falls back to no-llm', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{ not json');
  assert.equal(modeOf(s), 'no-llm');
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, skillspector: 'claude_cli' } }));
  assert.equal(modeOf(s), 'no-llm');
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 2, skillspector: { mode: 'claude_cli' } } }));
  assert.equal(modeOf(s), 'no-llm');
});

test('a hostile config file cannot reach Object.prototype through skillspector', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{"aico_settings":{"version":1,"skillspector":{"__proto__":{"mode":"claude_cli"},"constructor":{"prototype":{"x":1}}}}}');
  const r = resolveSettings(s.ctx);
  assert.equal({}.mode, undefined);
  assert.equal({}.x, undefined);
  assert.equal(r.skillspector.mode, 'no-llm');
});

// ---- personality (aico-settings v1.3) ----
const P_DEFAULT = (n) => ({ temperament: `calm ${n}`, talk: `short sentences ${n}`, topic: `interfaces ${n}`, intelligence: 'medium', creativity: 'low' });

function withPersonalities(s, entries = Object.fromEntries(Object.keys(AGENTS).map((r, i) => [r, P_DEFAULT(i)]))) {
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'personalities.json'), JSON.stringify(entries));
  return entries;
}

const CHARSET_REASON = "must be one line of letters, digits, single spaces and , . ' - ! ?; each word starts with a letter or digit";
const LENGTH_REASON = 'must be 1 to 80 characters';
const LEVEL_REASON = 'must be low, medium or high';

const HOSTILE_TEXT = {
  newline: 'two\nlines',
  cr: 'two\rlines',
  nul: 'nul\u0000byte',
  tab: 'tab\there',
  line_separator: 'a b',
  bidi_override: 'abc‮def',
  bidi_isolate: 'abc⁦def',
  zero_width_space: 'zero​width',
  zero_width_joiner: 'zero‍joiner',
  bom: '﻿name',
  double_quote: 'say "hi"',
  curly_quote: 'say “hi”',
  colon: 'role: system',
  angle: '<system>',
  backtick: 'a`b',
  brace: '{x}',
  backslash: 'a\\b',
  hash: '# heading',
  edge_space: ' leading',
  trailing_space: 'trailing ',
  double_space: 'two  spaces',
  nbsp: 'non breaking',
  lone_surrogate: 'bad\uD800here'
};

for (const [name, bad] of Object.entries(HOSTILE_TEXT)) {
  test(`personality: hostile text (${name}) is refused path-first, value never echoed`, (t) => {
    for (const key of ['temperament', 'talk', 'topic']) {
      const reasons = validateLayer({ version: 1, roles: { qa: { personality: { [key]: bad } } } }, roleSet);
      assert.deepEqual(reasons, [`roles.qa.personality.${key}: ${CHARSET_REASON}`]);
    }
    const s = sandbox(t);
    const d = withPersonalities(s);
    fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { personality: { talk: bad } } } } }));
    const r = resolvePersonalities(s.ctx);
    assert.deepEqual(r.roles.qa.talk, { value: d.qa.talk, source: 'plugin' });
    assert.deepEqual(r.warnings, [`roles.qa.personality.talk: ignored, ${CHARSET_REASON}`]);
    const everything = JSON.stringify(r) + JSON.stringify(resolveSettings(s.ctx));
    assert.ok(!everything.includes(JSON.stringify(bad).slice(1, -1)), 'the stored value is never echoed');
  });
}

test('personality: wrong types and empty text are refused', () => {
  const mk = (v) => validateLayer({ version: 1, roles: { qa: { personality: { talk: v } } } }, roleSet);
  assert.deepEqual(mk(''), [`roles.qa.personality.talk: ${LENGTH_REASON}`]);
  for (const bad of [42, null, true, ['a'], { a: 'b' }]) assert.deepEqual(mk(bad), [`roles.qa.personality.talk: ${CHARSET_REASON}`], JSON.stringify(bad));
});

test('personality: length counts code points, not UTF-16 units', () => {
  const astral = '\u{10400}'; // one code point, two UTF-16 units
  const mk = (v) => validateLayer({ version: 1, roles: { qa: { personality: { topic: v } } } }, roleSet);
  assert.equal(astral.repeat(80).length, 160);
  assert.deepEqual(mk(astral.repeat(80)), []);
  assert.deepEqual(mk('a'.repeat(80)), []);
  assert.deepEqual(mk('a'.repeat(81)), [`roles.qa.personality.topic: ${LENGTH_REASON}`]);
  assert.deepEqual(mk(astral.repeat(81)), [`roles.qa.personality.topic: ${LENGTH_REASON}`]);
  for (const v of ['Zoé', 'café', '日本語の話', 'ça va, très bien!', "it's a well-known fact.", 'room 101?']) assert.deepEqual(mk(v), [], v);
});

test('personality: a combining-mark flood and a huge string stay bounded and are refused', () => {
  const mk = (v) => validateLayer({ version: 1, roles: { qa: { personality: { talk: v } } } }, roleSet);
  const started = process.hrtime.bigint();
  assert.deepEqual(mk(`a${'́'.repeat(200)}`), [`roles.qa.personality.talk: ${LENGTH_REASON}`]);
  assert.deepEqual(mk('a '.repeat(500000)), [`roles.qa.personality.talk: ${LENGTH_REASON}`]);
  assert.deepEqual(mk(`${'a'.repeat(79)}\n`), [`roles.qa.personality.talk: ${CHARSET_REASON}`]);
  assert.deepEqual(mk(`${'a '.repeat(39)}a\u0000`), [`roles.qa.personality.talk: ${CHARSET_REASON}`]);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 500, 'linear time');
  assert.deepEqual(mk(`a${'́'.repeat(79)}`), []);
});

test('personality: only low, medium, high pass as a level', () => {
  const mk = (key, v) => validateLayer({ version: 1, roles: { qa: { personality: { [key]: v } } } }, roleSet);
  for (const key of ['intelligence', 'creativity']) {
    for (const ok of ['low', 'medium', 'high']) assert.deepEqual(mk(key, ok), []);
    for (const bad of ['', 'HIGH', 'High', ' high', 'extreme', 3, null, true, ['high'], { a: 1 }, '__proto__', 'constructor', 'toString']) {
      assert.deepEqual(mk(key, bad), [`roles.qa.personality.${key}: ${LEVEL_REASON}`], JSON.stringify(bad));
    }
  }
});

test('personality: shape refusals are path-first lines', () => {
  const v = (personality) => validateLayer({ version: 1, roles: { qa: { personality } } }, roleSet);
  for (const bad of ['x', 3, null, [], true]) assert.deepEqual(v(bad), ['roles.qa.personality: must be an object']);
  assert.deepEqual(v({ mood: 'x' }), ['roles.qa.personality.mood: unknown key']);
  assert.deepEqual(v({ 'Bad Key!': 'x' }), ['roles.qa.personality.?: unknown key']);
  assert.deepEqual(v({ ['k'.repeat(21)]: 'x' }), ['roles.qa.personality.?: unknown key']);
  assert.deepEqual(v({ '': 'x' }), ['roles.qa.personality.?: unknown key']);
  assert.deepEqual(v({ talk: 'fine', topic: 'a:b', creativity: 'wild' }), [
    `roles.qa.personality.topic: ${CHARSET_REASON}`,
    `roles.qa.personality.creativity: ${LEVEL_REASON}`
  ]);
});

test('personality: defaults resolve with source plugin', (t) => {
  const s = sandbox(t);
  const d = withPersonalities(s);
  const r = resolvePersonalities(s.ctx);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.ignored, []);
  assert.deepEqual(r.roles.qa.talk, { value: d.qa.talk, source: 'plugin' });
  assert.deepEqual(Object.keys(r.roles.architect).sort(), ['creativity', 'intelligence', 'talk', 'temperament', 'topic']);
});

test('personality: project beats user beats plugin, per key', (t) => {
  const s = sandbox(t);
  const d = withPersonalities(s);
  s.user({ roles: { qa: { personality: { talk: 'user talk', creativity: 'high', topic: 'user topic' } } } });
  s.project({ roles: { qa: { personality: { talk: 'project talk', intelligence: 'high' } } } });
  const q = resolvePersonalities(s.ctx).roles.qa;
  assert.deepEqual(q.talk, { value: 'project talk', source: 'project' });
  assert.deepEqual(q.topic, { value: 'user topic', source: 'user' });
  assert.deepEqual(q.creativity, { value: 'high', source: 'user' });
  assert.deepEqual(q.intelligence, { value: 'high', source: 'project' });
  assert.deepEqual(q.temperament, { value: d.qa.temperament, source: 'plugin' });
});

test('personality: a project value counts without an unlock', (t) => {
  const s = sandbox(t);
  withPersonalities(s);
  s.project({ roles: { qa: { personality: { topic: 'cats' } } } });
  const r = resolvePersonalities(s.ctx);
  assert.equal(r.roles.qa.topic.source, 'project');
  assert.deepEqual(r.warnings, []);
});

test('personality: a bad user value falls back to the plugin default, a bad project value to the user value', (t) => {
  const s = sandbox(t);
  const d = withPersonalities(s);
  s.user({ roles: { qa: { personality: { talk: 'user talk', topic: 'a<b' } } } });
  s.project({ roles: { qa: { personality: { talk: 'bad: one', topic: 'also bad "x"' } } } });
  const q = resolvePersonalities(s.ctx).roles.qa;
  assert.deepEqual(q.talk, { value: 'user talk', source: 'user' });
  assert.deepEqual(q.topic, { value: d.qa.topic, source: 'plugin' });
});

test('personality: prototype keys never pollute and never resolve', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'personalities.json'),
    '{"qa":{"temperament":"calm","talk":"short","topic":"tests","intelligence":"low","creativity":"low"},"__proto__":{"talk":"polluted"},"constructor":{"talk":"x"}}');
  fs.writeFileSync(s.config, '{"aico_settings":{"version":1,"roles":{"qa":{"personality":{"__proto__":{"talk":"polluted"},"constructor":{"prototype":{"x":1}},"prototype":"y"}},"__proto__":{"personality":{"talk":"p"}},"constructor":{"personality":{"talk":"p"}}}}}');
  const r = resolvePersonalities(s.ctx);
  assert.equal({}.talk, undefined);
  assert.equal({}.x, undefined);
  assert.equal(Object.getPrototypeOf(r.roles), null);
  assert.equal(Object.hasOwn(r.roles, 'constructor'), false);
  assert.equal(Object.hasOwn(r.roles, '__proto__'), false);
  assert.equal(r.roles.qa.talk.value, 'short');
  assert.equal(Object.getPrototypeOf(r.roles.qa), null);
  assert.equal(Object.hasOwn(r.roles.qa, 'constructor'), false);
});

test('personality: a bad plugin default is ignored with a warning naming role and key only', (t) => {
  const s = sandbox(t);
  withPersonalities(s, { qa: { ...P_DEFAULT(1), talk: 'bad: value', creativity: 'wild' }, ghost: P_DEFAULT(2) });
  const r = resolvePersonalities(s.ctx);
  assert.equal(Object.hasOwn(r.roles.qa, 'talk'), false);
  assert.equal(Object.hasOwn(r.roles.qa, 'creativity'), false);
  assert.equal(r.roles.qa.topic.value, 'interfaces 1');
  assert.ok(r.warnings.some((w) => w.startsWith('company/personalities.json: qa.talk: ignored, ')), r.warnings.join('|'));
  assert.ok(r.warnings.some((w) => w.includes('ghost')));
  assert.ok(!r.warnings.join('|').includes('bad: value'));
  assert.ok(!r.warnings.join('|').includes('wild'));
  assert.equal(Object.hasOwn(r.roles, 'ghost'), false);
});

test('personality: personalities.json missing or invalid gives no defaults and does not throw', (t) => {
  const s = sandbox(t);
  assert.deepEqual(Object.keys(resolvePersonalities(s.ctx).roles.qa ?? {}), []);
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'personalities.json'), '{ nope');
  const r = resolvePersonalities(s.ctx);
  assert.deepEqual(Object.keys(r.roles.qa ?? {}), []);
  assert.ok(r.warnings.some((w) => w.startsWith('company/personalities.json')));
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'personalities.json'), '[1,2]');
  assert.ok(resolvePersonalities(s.ctx).warnings.length > 0);
});

test('personality: ignored entries name their level and path, never the value', (t) => {
  const s = sandbox(t);
  withPersonalities(s);
  s.user({ roles: { qa: { personality: { topic: 'a<b' } } } });
  s.project({ roles: { architect: { personality: { talk: 'x"y', creativity: 'wild' } } } });
  const r = resolvePersonalities(s.ctx);
  assert.deepEqual(r.ignored.map((e) => [e.level, e.path]).sort(), [
    ['project', 'roles.architect.personality.creativity'],
    ['project', 'roles.architect.personality.talk'],
    ['user', 'roles.qa.personality.topic']
  ]);
  for (const e of r.ignored) {
    assert.deepEqual(Object.keys(e).sort(), ['level', 'path', 'reason']);
    assert.ok(!/a<b|x"y|wild/.test(e.reason));
  }
});

test('personality: a bad project value makes the project layer broken, so locks fail closed', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['ship'], gates: { ship: 'auto' } });
  assert.equal(resolveSettings(s.ctx).gates.ship, 'auto');
  s.project({ roles: { qa: { personality: { talk: 'a\nb' } } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'ask');
  assert.ok(r.warnings.some((w) => w.includes('held at ask')));
});

test('personality: get is byte-identical with and without valid personalities, except revision', (t) => {
  const s = sandbox(t);
  const strip = (o) => JSON.stringify({ ...JSON.parse(o), revision: 'x' });
  const before = s.cli('get');
  withPersonalities(s);
  s.user({ roles: { qa: { personality: { talk: 'user talk', creativity: 'high' } } } });
  s.project({ roles: { architect: { personality: { topic: 'project topic', intelligence: 'low' } } } });
  const after = s.cli('get');
  assert.equal(before.code, 0);
  assert.equal(after.code, 0);
  assert.equal(strip(after.out), strip(before.out));
  assert.notEqual(JSON.parse(after.out).revision, JSON.parse(before.out).revision);
  assert.ok(!/personalit|user talk|project topic|interfaces/i.test(after.out));
});

test('personality: get never reaches a personality key', (t) => {
  const s = sandbox(t);
  withPersonalities(s);
  s.user({ roles: { qa: { personality: { talk: 'user talk' } } } });
  for (const key of ['roles.qa.personality', 'roles.qa.personality.talk', 'personalities', 'personality']) {
    const r = s.cli('get', key);
    assert.equal(r.code, 2, key);
    assert.equal(r.out, `refused: no setting ${key}\n`);
  }
});

test('personality: a stored bad project value never blocks a user-only Save and a project Save removes it', (t) => {
  const s = sandbox(t);
  s.project({ roles: { qa: { personality: { talk: 'bad: value', topic: 'fine topic' } }, architect: { model: 'sonnet' } } });
  const stored = readLayer('project', s.ctx).layer;
  assert.deepEqual(stored.roles.qa, { personality: { topic: 'fine topic' } });
  const userBody = { version: 1, roles: { qa: { personality: { talk: 'hello' } } } };
  assert.deepEqual(checkLayers(userBody, stored, s.ctx), []);
  writeLayer('user', userBody, s.ctx);
  assert.match(fs.readFileSync(s.projectFile, 'utf8'), /bad: value/, 'a user Save leaves the project file alone');
  writeLayer('project', stored, s.ctx);
  const text = fs.readFileSync(s.projectFile, 'utf8');
  assert.ok(!text.includes('bad: value'));
  assert.ok(text.includes('fine topic'));
});

test('personality: a body that carries a bad value is refused with the level word first', (t) => {
  const s = sandbox(t);
  assert.deepEqual(checkLayers({ version: 1 }, { version: 1, roles: { qa: { personality: { talk: 'x:y' } } } }, s.ctx), [
    `project roles.qa.personality.talk: ${CHARSET_REASON}`
  ]);
  assert.deepEqual(checkLayers({ version: 1, roles: { qa: { personality: { creativity: 'wild' } } } }, { version: 1 }, s.ctx), [
    `user roles.qa.personality.creativity: ${LEVEL_REASON}`
  ]);
  assert.throws(() => writeLayer('user', { version: 1, roles: { qa: { personality: { talk: 'x"y' } } } }, s.ctx), (e) => e instanceof Refusal && !e.message.includes('x"y'));
});

test('personality: writeLayer round-trips valid personality and writes nothing on a refusal', (t) => {
  const s = sandbox(t);
  const layer = { version: 1, roles: { qa: { personality: { temperament: 'calm', creativity: 'high' } } } };
  writeLayer('user', layer, s.ctx);
  assert.deepEqual(readLayer('user', s.ctx).layer, layer);
  const before = fs.readFileSync(s.config, 'utf8');
  assert.throws(() => writeLayer('user', { version: 1, roles: { qa: { personality: { temperament: 'calm', topic: 'a\nb' } } } }, s.ctx), Refusal);
  assert.equal(fs.readFileSync(s.config, 'utf8'), before);
});

// ---------- reprompt.question_rounds (aico-settings v1.4) ----------
const RP_MSG = 'reprompt.question_rounds must be a whole number from 0 to 3';
const roundsOf = (s) => resolveSettings(s.ctx).reprompt.question_rounds;

test('hostile reprompt.question_rounds values are refused with the Contract text and no echo', () => {
  const hostile = [-1, 4, 1.5, NaN, Infinity, '1', '', null, true, [1], { a: 1 }, 1e21, '__proto__', 'x'.repeat(10240)];
  for (const bad of hostile) {
    assert.deepEqual(validateLayer({ version: 1, reprompt: { question_rounds: bad } }, roleSet), [RP_MSG], String(bad).slice(0, 12));
  }
  for (const ok of [0, 1, 2, 3]) assert.deepEqual(validateLayer({ version: 1, reprompt: { question_rounds: ok } }, roleSet), []);
});

test('reprompt refuses unknown keys and wrong shapes', () => {
  assert.deepEqual(validateLayer({ version: 1, reprompt: { rounds: 1 } }, roleSet), ['reprompt.rounds: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, reprompt: JSON.parse('{"__proto__":{"question_rounds":3}}') }, roleSet), ['reprompt.__proto__: unknown key']);
  for (const bad of ['1', [], null, 1]) assert.deepEqual(validateLayer({ version: 1, reprompt: bad }, roleSet), ['reprompt: must be an object']);
});

test('REPROMPT_DEFAULTS is 1 and a fresh install resolves it through get and get <key>', (t) => {
  assert.deepEqual(plain(REPROMPT_DEFAULTS), { question_rounds: 1 });
  const s = sandbox(t);
  assert.deepEqual(plain(pluginDefaults(s.pluginRoot).reprompt), { question_rounds: 1 });
  assert.deepEqual(plain(resolveSettings(s.ctx).reprompt), { question_rounds: 1 });
  assert.deepEqual(JSON.parse(s.cli('get').out).reprompt, { question_rounds: 1 });
  assert.equal(s.cli('get', 'reprompt.question_rounds').out, '1\n');
});

test('reprompt.question_rounds resolves project, else user, else default, and 0 counts as set', (t) => {
  const s = sandbox(t);
  s.user({ reprompt: { question_rounds: 3 } });
  assert.equal(roundsOf(s), 3);
  s.project({ reprompt: { question_rounds: 0 } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.reprompt.question_rounds, 0);
  assert.deepEqual(r.ignored, [], 'not a lock: a project value counts without an unlock');
  assert.equal(s.cli('get', 'reprompt.question_rounds').out, '0\n');
});

test('a broken project layer does not change reprompt.question_rounds from a valid project value', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['ship'] });
  s.project({ reprompt: { question_rounds: 2 }, gates: { ship: 'nope' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.reprompt.question_rounds, 2);
  assert.ok(r.warnings.length > 0);
});

test('a bad reprompt.question_rounds falls back to the level below, ending at 1, with a warning', (t) => {
  const s = sandbox(t);
  s.user({ reprompt: { question_rounds: 2 } });
  s.project({ reprompt: { question_rounds: 9 } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.reprompt.question_rounds, 2, 'the project value is dropped, the user value stays');
  assert.equal(r.warnings.filter((w) => w.includes(RP_MSG)).length, 1);
  s.user({ reprompt: { question_rounds: '2' } });
  s.project({ reprompt: { question_rounds: 'many' } });
  r = resolveSettings(s.ctx);
  assert.equal(r.reprompt.question_rounds, 1);
  assert.equal(r.warnings.filter((w) => w.includes(RP_MSG)).length, 2);
  assert.ok(!r.warnings.join('|').includes('many'), 'a refused value is never echoed');
});

test('writeLayer refuses a bad reprompt.question_rounds and writes nothing; a good one round-trips', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, reprompt: { question_rounds: 4 } }, s.ctx), (e) => e instanceof Refusal && e.message === RP_MSG);
  assert.ok(!fs.existsSync(s.config));
  writeLayer('user', { version: 1, reprompt: { question_rounds: 3 } }, s.ctx);
  assert.equal(roundsOf(s), 3);
  assert.equal(s.cli('get', 'reprompt.question_rounds').out, '3\n');
});

// ---------- plan_check.policy and plan_check.runs (aico-settings v1.5) ----------
const PC_POLICY_MSG = 'plan_check.policy must be off, warn or block';
const PC_RUNS_MSG = 'plan_check.runs must be a whole number from 3 to 50';
const planCheckOf = (s) => plain(resolveSettings(s.ctx).plan_check);

test('hostile plan_check.policy values are refused with the Contract text and no echo', () => {
  const hostile = ['Warn', 'WARN', ' warn', 'warn ', 'ask', '', null, true, 1, ['warn'], { a: 1 }, '__proto__', 'x'.repeat(10240)];
  for (const bad of hostile) {
    assert.deepEqual(validateLayer({ version: 1, plan_check: { policy: bad } }, roleSet), [PC_POLICY_MSG], String(bad).slice(0, 12));
  }
  for (const ok of ['off', 'warn', 'block']) assert.deepEqual(validateLayer({ version: 1, plan_check: { policy: ok } }, roleSet), []);
});

test('hostile plan_check.runs values are refused with the Contract text and no echo', () => {
  const hostile = [2, 51, 0, -5, 5.5, NaN, Infinity, '5', '10.0', '1e1', '', null, true, [5], { a: 1 }, 1e21, 'x'.repeat(10240)];
  for (const bad of hostile) {
    assert.deepEqual(validateLayer({ version: 1, plan_check: { runs: bad } }, roleSet), [PC_RUNS_MSG], String(bad).slice(0, 12));
  }
  for (const ok of [3, 5, 50]) assert.deepEqual(validateLayer({ version: 1, plan_check: { runs: ok } }, roleSet), []);
});

test('plan_check refuses unknown keys, wrong shapes, and prints only plain key names', () => {
  assert.deepEqual(validateLayer({ version: 1, plan_check: { mode: 1 } }, roleSet), ['plan_check.mode: unknown key']);
  assert.deepEqual(validateLayer({ version: 1, plan_check: JSON.parse('{"__proto__":{"runs":3}}') }, roleSet), ['plan_check.__proto__: unknown key']);
  const long = 'k'.repeat(300);
  const reasons = validateLayer({ version: 1, plan_check: { [long]: 1, 'a b\u0000<script>': 1 } }, roleSet);
  assert.deepEqual(reasons, ['plan_check.?: unknown key', 'plan_check.?: unknown key']);
  for (const bad of ['1', [], null, 1]) assert.deepEqual(validateLayer({ version: 1, plan_check: bad }, roleSet), ['plan_check: must be an object']);
});

test('PLAN_CHECK_DEFAULTS is warn and 5 and a fresh install resolves it through get and get <key>', (t) => {
  assert.deepEqual(plain(PLAN_CHECK_DEFAULTS), { policy: 'warn', runs: 5 });
  const s = sandbox(t);
  assert.deepEqual(plain(pluginDefaults(s.pluginRoot).plan_check), { policy: 'warn', runs: 5 });
  assert.deepEqual(planCheckOf(s), { policy: 'warn', runs: 5 });
  assert.deepEqual(JSON.parse(s.cli('get').out).plan_check, { policy: 'warn', runs: 5 });
  assert.equal(s.cli('get', 'plan_check.policy').out, 'warn\n');
  assert.equal(s.cli('get', 'plan_check.runs').out, '5\n');
});

test('plan_check resolves per field, project else user else default, and is not a lock', (t) => {
  const s = sandbox(t);
  s.user({ plan_check: { policy: 'warn', runs: 20 } });
  assert.deepEqual(planCheckOf(s), { policy: 'warn', runs: 20 });
  s.project({ plan_check: { policy: 'off' } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(plain(r.plan_check), { policy: 'off', runs: 20 });
  assert.deepEqual(r.ignored, [], 'a project value counts without an unlock');
});

test('a broken project layer does not change a valid project plan_check value', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['ship'] });
  s.project({ plan_check: { policy: 'off', runs: 7 }, gates: { ship: 'nope' } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(plain(r.plan_check), { policy: 'off', runs: 7 });
  assert.ok(r.warnings.length > 0);
});

test('a bad plan_check value falls back to the level below, ending at the default, with a warning', (t) => {
  const s = sandbox(t);
  s.user({ plan_check: { policy: 'block', runs: 12 } });
  s.project({ plan_check: { policy: 'stop', runs: 99 } });
  let r = resolveSettings(s.ctx);
  assert.deepEqual(plain(r.plan_check), { policy: 'block', runs: 12 });
  assert.equal(r.warnings.filter((w) => w.includes(PC_POLICY_MSG)).length, 1);
  assert.equal(r.warnings.filter((w) => w.includes(PC_RUNS_MSG)).length, 1);
  s.user({ plan_check: { policy: 'nope', runs: '12' } });
  s.project({ plan_check: { policy: 'stop', runs: 1.5 } });
  r = resolveSettings(s.ctx);
  assert.deepEqual(plain(r.plan_check), { policy: 'warn', runs: 5 });
  assert.ok(!r.warnings.join('|').includes('stop'), 'a refused value is never echoed');
});

test('writeLayer refuses a bad plan_check value and writes nothing; a good one round-trips', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, plan_check: { policy: 'strict' } }, s.ctx), (e) => e instanceof Refusal && e.message === PC_POLICY_MSG);
  assert.throws(() => writeLayer('user', { version: 1, plan_check: { runs: 2 } }, s.ctx), (e) => e instanceof Refusal && e.message === PC_RUNS_MSG);
  assert.ok(!fs.existsSync(s.config));
  writeLayer('user', { version: 1, plan_check: { policy: 'block', runs: 50 } }, s.ctx);
  assert.deepEqual(planCheckOf(s), { policy: 'block', runs: 50 });
  assert.equal(s.cli('get', 'plan_check.runs').out, '50\n');
});

// ---- model floor and model-env (aico-settings v1.6) ----

test('MODEL_RANK ranks haiku < sonnet < opus and nothing else', () => {
  assert.ok(MODEL_RANK.haiku < MODEL_RANK.sonnet && MODEL_RANK.sonnet < MODEL_RANK.opus);
  assert.deepEqual(Object.keys(MODEL_RANK), ['haiku', 'sonnet', 'opus']);
});

test('loadModelFloor reads the table, the protected list and the downgraded Roles', (t) => {
  const s = sandbox(t);
  const table = loadModelFloor(s.pluginRoot);
  assert.equal(table.release, '0.16.0');
  assert.deepEqual(table.floor, { architect: 'opus', qa: 'sonnet', security: 'opus' });
  assert.deepEqual(table.protected, ['architect', 'security']);
  assert.deepEqual(table.downgraded, []);
  assert.deepEqual(table.warnings, []);
  writeFloor(s.pluginRoot, { floor: { architect: 'opus', qa: 'opus', security: 'opus' } });
  assert.deepEqual(loadModelFloor(s.pluginRoot).downgraded, ['qa']);
});

test('loadModelFloor fails closed: missing, hostile, oversize, unranked or incomplete files hold every Role at opus', (t) => {
  const s = sandbox(t);
  const file = path.join(s.pluginRoot, 'company', 'model-floor.json');
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = [
    null,
    '{nope',
    JSON.stringify({ ...good, pad: 'x'.repeat(17000) }),
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, release: 'x' }),
    JSON.stringify({ ...good, floor: { ...good.floor, qa: 'fable' } }),
    JSON.stringify({ ...good, floor: { architect: 'opus' } }),
    JSON.stringify({ ...good, protected: 'security' }),
    '[]'
  ];
  for (const text of bad) {
    if (text === null) fs.rmSync(file); else fs.writeFileSync(file, text);
    const table = loadModelFloor(s.pluginRoot);
    assert.equal(table.release, null, String(text).slice(0, 40));
    assert.deepEqual(table.floor, { architect: 'opus', qa: 'opus', security: 'opus' });
    assert.deepEqual(table.protected, ['architect', 'qa', 'security']);
    assert.deepEqual(table.warnings, ['model floor: company/model-floor.json unreadable, every Role held at opus']);
  }
});

test('loadModelFloor fails closed on a wrong protected list or an extra key, never fewer protections', (t) => {
  const s = sandbox(t);
  const file = path.join(s.pluginRoot, 'company', 'model-floor.json');
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wrong = [
    { ...good, protected: ['qa'] },
    { ...good, protected: [] },
    { ...good, protected: good.protected.slice(1) },
    { ...good, protected: [...good.protected, 'qa'] },
    { ...good, extra: 1 }
  ];
  for (const data of wrong) {
    fs.writeFileSync(file, JSON.stringify(data));
    const table = loadModelFloor(s.pluginRoot);
    assert.equal(table.release, null, JSON.stringify(data.protected));
    assert.deepEqual(table.protected, ['architect', 'qa', 'security']);
    assert.equal(table.warnings.length, 1);
  }
  fs.writeFileSync(file, JSON.stringify(good));
  assert.deepEqual(loadModelFloor(s.pluginRoot).protected, ['architect', 'security']);
});

test('loadModelFloor never merges a __proto__ key from the file', (t) => {
  const s = sandbox(t);
  const file = path.join(s.pluginRoot, 'company', 'model-floor.json');
  fs.writeFileSync(file, '{"v":1,"release":"0.16.0","floor":{"__proto__":"opus","architect":"opus","qa":"sonnet","security":"opus"},"protected":["architect","code-reviewer","fresh-reviewer","pentester","security","vuln-scanner"]}');
  const table = loadModelFloor(s.pluginRoot);
  assert.deepEqual(table.protected, ['architect', 'security']);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(table.floor), ['architect', 'qa', 'security']);
});

test('get shows floor and protected per Role', (t) => {
  const s = sandbox(t);
  const r = resolveSettings(s.ctx);
  assert.equal(r.roles.security.floor, 'opus');
  assert.equal(r.roles.security.protected, true);
  assert.equal(r.roles.qa.protected, false);
  assert.deepEqual(Object.keys(r.roles.qa).sort(), ['context_cap', 'effort', 'floor', 'model', 'name', 'protected', 'source']);
});

test('protected lock: a lower model at any level is not applied, with a warning', (t) => {
  for (const level of ['user', 'project']) {
    for (const model of ['haiku', 'sonnet', 'fable']) {
      const s = sandbox(t);
      s[level]({ roles: { security: { model } } });
      const r = resolveSettings(s.ctx);
      assert.equal(r.roles.security.model, 'opus', `${level} ${model}`);
      assert.equal(r.roles.security.source.model, 'floor');
      assert.deepEqual(r.warnings, [`roles.security.model: ${model} is below the protected floor opus, not applied`]);
    }
  }
});

test('protected lock: opus and inherit stay, unprotected Roles may go lower', (t) => {
  const s = sandbox(t);
  s.user({ roles: { security: { model: 'inherit' }, architect: { model: 'opus' }, qa: { model: 'haiku' } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.roles.security.model, 'inherit');
  assert.equal(r.roles.security.source.model, 'user');
  assert.equal(r.roles.architect.model, 'opus');
  assert.equal(r.roles.qa.model, 'haiku');
  assert.deepEqual(r.warnings, []);
});

test('protected lock: no unlock lifts it and a broken project layer does not change it', (t) => {
  const s = sandbox(t);
  s.user({ unlocked: ['ship', 'security', 'installs'], roles: { security: { model: 'sonnet' } } });
  fs.writeFileSync(s.projectFile, '{broken');
  const r = resolveSettings(s.ctx);
  assert.equal(r.roles.security.model, 'opus');
  assert.ok(r.warnings.some((w) => w.startsWith('roles.security.model: sonnet is below')));
});

test('protected lock: a plugin default below the floor is raised and an unknown model id is never echoed', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.pluginRoot, 'agents', 'security.md'), agentFile('security', { model: 'claude-x-9', effort: 'high' }));
  const r = resolveSettings(s.ctx);
  assert.equal(r.roles.security.model, 'opus');
  assert.deepEqual(r.warnings, ['roles.security.model: (other) is below the protected floor opus, not applied']);
});

test('an unreadable floor file protects every Role at opus with one warning', (t) => {
  const s = sandbox(t);
  fs.rmSync(path.join(s.pluginRoot, 'company', 'model-floor.json'));
  s.user({ roles: { qa: { model: 'haiku' } } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.warnings, ['model floor: company/model-floor.json unreadable, every Role held at opus']);
  for (const role of Object.values(r.roles)) {
    assert.equal(role.model, 'opus');
    assert.equal(role.floor, 'opus');
    assert.equal(role.protected, true);
  }
});

const ENV_PREFIX = 'model env: CLAUDE_CODE_SUBAGENT_MODEL=';
const line = (env, version) => modelEnvLine({ env, readVersion: () => version });

test('model-env: neither variable set prints nothing and reads no version', () => {
  let called = false;
  const readVersion = () => { called = true; return null; };
  assert.equal(modelEnvLine({ env: {}, readVersion }), '');
  assert.equal(modelEnvLine({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '0' }, readVersion }), '');
  assert.equal(modelEnvLine({ env: { CLAUDE_CODE_SUBAGENT_MODEL: '', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '' }, readVersion }), '');
  assert.equal(called, false);
});

test('model-env row 1: version unknown bypasses the floor', () => {
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, null),
    `${ENV_PREFIX}haiku CLAUDE_CODE_SUBAGENT_MODEL_FORCE=unset, Claude Code unknown: version unknown, may override every Role's model; floor bypassed`);
});

test('model-env row 2: before 2.1.251 the variable overrides the Agent model too', () => {
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, [2, 1, 250]),
    `${ENV_PREFIX}haiku CLAUDE_CODE_SUBAGENT_MODEL_FORCE=unset, Claude Code 2.1.250: overrides every Role's model, the Agent model included; floor bypassed`);
});

test('model-env row 3: FORCE from 2.1.257 forces the model, with or without the variable', () => {
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, [2, 1, 257]),
    `${ENV_PREFIX}haiku CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1, Claude Code 2.1.257: forces haiku on every Role; floor bypassed`);
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, [2, 2, 0]),
    `${ENV_PREFIX}unset CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1, Claude Code 2.2.0: forces the main conversation's model on every Role; floor bypassed`);
});

test('model-env row 4: from 2.1.251 the variable alone is a default only', () => {
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, [2, 1, 251]),
    `${ENV_PREFIX}haiku CLAUDE_CODE_SUBAGENT_MODEL_FORCE=unset, Claude Code 2.1.251: a default only; every aico Role sets model in its frontmatter, so no Role changes; floor kept`);
  assert.ok(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, [2, 1, 255]).endsWith('so no Role changes; floor kept'));
});

test('model-env row 5: FORCE only before 2.1.257 changes nothing', () => {
  assert.equal(line({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, [2, 1, 256]),
    `${ENV_PREFIX}unset CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1, Claude Code 2.1.256: FORCE needs Claude Code 2.1.257; no Role changes; floor kept`);
});

test('model-env: a value outside the allow-list prints as (hidden)', () => {
  const out = line({ CLAUDE_CODE_SUBAGENT_MODEL: 'sk-secret value\nmore', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'x'.repeat(65) }, [2, 1, 300]);
  assert.ok(out.startsWith(`${ENV_PREFIX}(hidden) CLAUDE_CODE_SUBAGENT_MODEL_FORCE=(hidden),`), out);
  assert.ok(!out.includes('secret'));
  assert.ok(line({ CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-4:1m[x]' }, [2, 1, 300]).includes('=claude-opus-4:1m[x] '));
});

// A directory holding a fake claude on the search path; the exec stub is injected, so nothing runs.
function pathWith(t, ...extra) {
  const bin = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bin-')));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  fs.writeFileSync(path.join(bin, name), 'x', { mode: 0o755 });
  return { bin, file: path.join(bin, name), PATH: [bin, ...extra].join(path.delimiter) };
}

test('readClaudeVersion: AI_AGENT alone answers when claude is not found', () => {
  const exec = () => { throw new Error('must not run'); };
  assert.deepEqual(readClaudeVersion({ env: { AI_AGENT: 'claude-code_2-1-310_agent', PATH: '' }, exec }), [2, 1, 310]);
});

test('readClaudeVersion: when AI_AGENT and --version disagree the lower version wins (the 2.1.251 rule)', (t) => {
  const { PATH } = pathWith(t);
  const env = { AI_AGENT: 'claude-code_2-1-310_agent', PATH };
  assert.deepEqual(readClaudeVersion({ env, exec: () => '2.1.311 (Claude Code)' }), [2, 1, 310]);
  assert.deepEqual(readClaudeVersion({ env, exec: () => '2.1.250 (Claude Code)' }), [2, 1, 250]);
});

test('readClaudeVersion: runs the absolute path from PATH, from the temp folder, no shell, 5 s, bounded output', (t) => {
  const { PATH, file } = pathWith(t);
  const exec = t.mock.fn(() => '2.1.311 (Claude Code)\n');
  assert.deepEqual(readClaudeVersion({ env: { AI_AGENT: 'other', PATH }, exec }), [2, 1, 311]);
  const [bin, args, options] = exec.mock.calls[0].arguments;
  assert.equal(bin, file);
  assert.ok(path.isAbsolute(bin));
  assert.deepEqual(args, ['--version']);
  assert.equal(options.timeout, 5000);
  assert.equal(options.cwd, os.tmpdir());
  assert.ok(options.maxBuffer <= 65536);
  assert.ok(!options.shell);
});

test('readClaudeVersion: a claude planted in the current or product folder is never run', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  fs.writeFileSync(path.join(repo, name), 'x', { mode: 0o755 });
  fs.mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', '.bin', name), 'x', { mode: 0o755 });
  const exec = t.mock.fn(() => '2.1.311');
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const PATH = ['', '.', 'relative-bin', repo, path.join(repo, 'node_modules', '.bin')].join(path.delimiter);
  assert.equal(readClaudeVersion({ env: { PATH }, exec, cwd: repo, productRoot: repo }), null);
  assert.equal(readClaudeVersion({ env: { PATH }, exec, cwd: other, productRoot: repo }), null);
  assert.equal(readClaudeVersion({ env: { PATH: repo }, exec, cwd: repo, productRoot: other }), null);
  assert.equal(exec.mock.calls.length, 0);
});

test('readClaudeVersion: a folder named "..bin" inside the product root is inside, not outside', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  fs.mkdirSync(path.join(repo, '..bin'));
  fs.writeFileSync(path.join(repo, '..bin', name), 'x', { mode: 0o755 });
  const exec = t.mock.fn(() => '2.1.311');
  assert.equal(readClaudeVersion({ env: { PATH: path.join(repo, '..bin') }, exec, cwd: repo, productRoot: repo }), null);
  assert.equal(exec.mock.calls.length, 0);
});

test('readClaudeVersion: on Windows only drive-letter entries count; device and UNC spellings of the product root are refused', { skip: process.platform !== 'win32' }, (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repo, 'claude.exe'), 'x');
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const real = fs.realpathSync.native(repo);
  const share = `\\\\localhost\\${real[0]}$${real.slice(2)}`;
  const forms = [`\\\\?\\${real}`, `\\\\.\\${real}`, share, `\\\\?\\UNC\\${share.slice(2)}`];
  for (const form of forms) {
    const exec = t.mock.fn(() => '2.1.311');
    assert.equal(readClaudeVersion({ env: { PATH: form }, exec, cwd: other, productRoot: repo }), null, form);
    assert.equal(exec.mock.calls.length, 0, form);
  }
  // an allow-list, not a block-list: a harmless device-form entry is refused too
  const { bin } = pathWith(t);
  const exec = t.mock.fn(() => '2.1.311');
  assert.equal(readClaudeVersion({ env: { PATH: `\\\\?\\${fs.realpathSync.native(bin)}` }, exec, cwd: other, productRoot: repo }), null);
  assert.equal(exec.mock.calls.length, 0);
});

test('readClaudeVersion: a later trusted PATH entry still answers when a planted one is skipped', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  fs.writeFileSync(path.join(repo, name), 'x', { mode: 0o755 });
  const { PATH, file } = pathWith(t);
  const exec = t.mock.fn(() => '2.1.311');
  assert.deepEqual(readClaudeVersion({ env: { PATH: [repo, PATH].join(path.delimiter) }, exec, cwd: repo, productRoot: repo }), [2, 1, 311]);
  assert.equal(exec.mock.calls[0].arguments[0], file);
});

test('readClaudeVersion: the version text is bounded (no quadratic scan of a long digit run)', (t) => {
  const { PATH } = pathWith(t);
  const started = Date.now();
  assert.equal(readClaudeVersion({ env: { PATH }, exec: () => '9'.repeat(200000) }), null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(readClaudeVersion({ env: { PATH }, exec: () => '12345.1.1' }), null);
});

test('readClaudeVersion: no claude on PATH, EINVAL, timeout, bad exit and garbage are unknown', (t) => {
  assert.equal(readClaudeVersion({ env: { PATH: '' }, exec: () => { throw new Error('must not run'); } }), null);
  const { PATH } = pathWith(t);
  for (const code of ['ENOENT', 'EINVAL', 'ETIMEDOUT']) {
    const exec = () => { throw Object.assign(new Error(code), { code }); };
    assert.equal(readClaudeVersion({ env: { PATH }, exec }), null, code);
  }
  assert.equal(readClaudeVersion({ env: { PATH }, exec: () => 'no digits here' }), null);
  assert.equal(readClaudeVersion({ env: { PATH }, exec: () => '' }), null);
});

const forceLine = (env, sources) => modelEnvLine({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', ...env }, readSources: () => sources });

test('model-env FORCE: AI_AGENT 2.1.252 on a newer CLI is floor bypassed, not kept', () => {
  const out = forceLine({}, { agent: [2, 1, 252], cli: [2, 1, 311] });
  assert.ok(out.endsWith('floor bypassed'), out);
});

test('model-env FORCE: only one source, or none, is floor bypassed', () => {
  assert.ok(forceLine({}, { agent: [2, 1, 252], cli: null }).endsWith('floor bypassed'));
  assert.ok(forceLine({}, { agent: null, cli: [2, 1, 252] }).endsWith('floor bypassed'));
  assert.ok(forceLine({}, { agent: null, cli: null }).endsWith('floor bypassed'));
});

test('model-env FORCE: both sources agree below 2.1.257 keeps the floor; at or above it is bypassed', () => {
  assert.ok(forceLine({}, { agent: [2, 1, 252], cli: [2, 1, 252] }).endsWith('floor kept'));
  assert.ok(forceLine({ CLAUDE_CODE_SUBAGENT_MODEL: '' }, { agent: [2, 1, 256], cli: [2, 1, 256] }).endsWith('floor kept'));
  assert.ok(forceLine({}, { agent: [2, 1, 257], cli: [2, 1, 257] }).endsWith('floor bypassed'));
});

test('model-env FORCE: a disagreement is bypassed; without FORCE the lower version still decides', () => {
  assert.ok(forceLine({}, { agent: [2, 1, 311], cli: [2, 1, 252] }).endsWith('floor bypassed'));
  const noForce = modelEnvLine({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, readSources: () => ({ agent: [2, 1, 252], cli: [2, 1, 311] }) });
  assert.ok(noForce.endsWith('floor kept'), noForce);
});

test('model-env CLI: a claude.exe planted in the working folder is not run', (t) => {
  const s = sandbox(t);
  // The planted program is a copy of node. If it ran with --version it would print node's version, which the line
  // would show (FORCE is off, so the version is printed); the marker file is written by the .cmd twin.
  const marker = path.join(s.cwd, 'ran.txt');
  fs.copyFileSync(process.execPath, path.join(s.cwd, process.platform === 'win32' ? 'claude.exe' : 'claude'));
  fs.writeFileSync(path.join(s.cwd, 'claude.cmd'), `@echo ran> "${marker}"\r\necho 2.1.100\r\n`);
  const env = { ...process.env, MCSPARROW_HOME: s.home, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' };
  delete env.AI_AGENT;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') env[k] = ['', '.', s.cwd].join(path.delimiter);
  const r = spawnSync(process.execPath, [script, 'model-env'], { cwd: s.cwd, encoding: 'utf8', env });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Claude Code unknown: version unknown'), r.stdout);
  assert.ok(!r.stdout.includes(process.versions.node), r.stdout);
  assert.equal(fs.existsSync(marker), false);
});

test('model-env FORCE: a version known from one source prints that version, only rule 3b and an unknown version print unknown', () => {
  const out = forceLine({}, { agent: null, cli: [2, 1, 300] });
  assert.ok(out.includes('Claude Code 2.1.300: forces haiku on every Role'), out);
  const unconfirmed = forceLine({}, { agent: null, cli: [2, 1, 256] });
  assert.ok(unconfirmed.includes('Claude Code unknown: version not confirmed'), unconfirmed);
});

test('model-env CLI: silent without the variables, one line with them', (t) => {
  const s = sandbox(t);
  const env = { ...process.env, MCSPARROW_HOME: s.home, AI_AGENT: 'claude-code_2-1-310_agent' };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') env[k] = '';
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;
  const quiet = spawnSync(process.execPath, [script, 'model-env'], { cwd: s.cwd, encoding: 'utf8', env });
  assert.deepEqual([quiet.status, quiet.stdout], [0, '']);
  const loud = spawnSync(process.execPath, [script, 'model-env'], { cwd: s.cwd, encoding: 'utf8', env: { ...env, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } });
  assert.equal(loud.status, 0);
  assert.equal(loud.stdout, `${ENV_PREFIX}haiku CLAUDE_CODE_SUBAGENT_MODEL_FORCE=unset, Claude Code 2.1.310: a default only; every aico Role sets model in its frontmatter, so no Role changes; floor kept\n`);
});

// ---- pipeline.parallel_cap (aico-settings v1.7) ----

test('pipeline.parallel_cap rejects hostile values first and accepts only 3, 4 or 5', () => {
  const msg = ['pipeline.parallel_cap must be a whole number from 3 to 5'];
  for (const bad of [2, 6, 0, -4, 4.5, '4', '__proto__', null, true, [4], { a: 4 }, NaN, 'x'.repeat(10 * 1024)]) {
    assert.deepEqual(validateLayer({ version: 1, pipeline: { parallel_cap: bad } }, roleSet), msg, String(bad).slice(0, 20));
  }
  for (const ok of [3, 4, 5]) assert.deepEqual(validateLayer({ version: 1, pipeline: { parallel_cap: ok } }, roleSet), []);
});

test('parallel_cap defaults to 4, resolves project over user over plugin and is not a lock', (t) => {
  const s = sandbox(t);
  assert.equal(PIPELINE_DEFAULTS.parallel_cap, 4);
  assert.equal(resolveSettings(s.ctx).pipeline.parallel_cap, 4);
  assert.equal(s.cli('get', 'pipeline.parallel_cap').out, '4\n');
  assert.equal(JSON.parse(s.cli('get').out).pipeline.parallel_cap, 4);
  assert.deepEqual(Object.keys(JSON.parse(s.cli('get').out).pipeline).slice(0, 4), ['fix_rounds', 'dispatch', 'parallel_cap', 'short_path']);
  s.user({ gates: { ship: 'auto' }, unlocked: ['ship'], pipeline: { parallel_cap: 3 } });
  assert.equal(resolveSettings(s.ctx).pipeline.parallel_cap, 3);
  s.project({ pipeline: { parallel_cap: 5 } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.parallel_cap, 5);
  assert.deepEqual(r.ignored, []);
  assert.equal(s.cli('get', 'pipeline.parallel_cap').out, '5\n');
});

test('a bad stored parallel_cap falls back one level with one warning that does not echo the value', (t) => {
  const s = sandbox(t);
  for (const bad of [2, 6, 4.5, '4']) {
    s.user({ pipeline: { parallel_cap: 5 } });
    s.project({ pipeline: { parallel_cap: bad } });
    const r = resolveSettings(s.ctx);
    assert.equal(r.pipeline.parallel_cap, 5, String(bad));
    const w = r.warnings.filter((x) => /parallel_cap/.test(x));
    assert.equal(w.length, 1, String(bad));
    // The warning starts with the layer's file path, whose random folder name may hold digits.
    const text = w[0].replace(/^.*settings\.json: |^.*config\.json: /, '');
    assert.equal(text, 'ignoring pipeline.parallel_cap must be a whole number from 3 to 5', String(bad));
  }
  s.user({ pipeline: { parallel_cap: 6 } });
  s.project({ pipeline: {} });
  assert.equal(resolveSettings(s.ctx).pipeline.parallel_cap, 4);
});

test('a fail-closed project layer does not change parallel_cap', (t) => {
  const s = sandbox(t);
  s.user({ gates: { ship: 'auto' }, unlocked: ['ship'], pipeline: { parallel_cap: 3 } });
  s.project({ pipeline: { parallel_cap: 5, review_format: 'PILOT' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.gates.ship, 'ask');
  assert.equal(r.pipeline.parallel_cap, 5);
  assert.deepEqual(r.ignored.filter((x) => /parallel_cap/.test(x)), []);
});

test('writeLayer refuses a bad parallel_cap with the Contract text and writes nothing', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, pipeline: { parallel_cap: 6 } }, s.ctx), /pipeline\.parallel_cap must be a whole number from 3 to 5/);
  assert.equal(fs.existsSync(s.config), false);
  writeLayer('user', { version: 1, pipeline: { parallel_cap: 3 } }, s.ctx);
  assert.deepEqual(readLayer('user', s.ctx).layer, { version: 1, pipeline: { parallel_cap: 3 } });
});

test('a v1.6 file without parallel_cap resolves as before, plus the default key', (t) => {
  const s = sandbox(t);
  s.user({ pipeline: { fix_rounds: 3, dispatch: 'sequential', review_format: 'pilot' } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual([r.pipeline.fix_rounds, r.pipeline.dispatch, r.pipeline.review_format, r.pipeline.parallel_cap], [3, 'sequential', 'pilot', 4]);
});

// ---- pipeline.short_path (aico-settings v1.8) ----

test('pipeline.short_path rejects hostile values first and accepts only on or off', () => {
  const msg = ['pipeline.short_path must be on or off'];
  for (const bad of ['yes', 'ON', 'Off', ' on', 'on\n', true, false, 1, 0, null, ['on'], { a: 'on' }, '__proto__', 'x'.repeat(10 * 1024)]) {
    assert.deepEqual(validateLayer({ version: 1, pipeline: { short_path: bad } }, roleSet), msg, String(bad).slice(0, 20));
  }
  for (const ok of ['on', 'off']) assert.deepEqual(validateLayer({ version: 1, pipeline: { short_path: ok } }, roleSet), []);
});

test('short_path defaults to on in get and in get pipeline.short_path', (t) => {
  const s = sandbox(t);
  assert.equal(PIPELINE_DEFAULTS.short_path, 'on');
  assert.equal(resolveSettings(s.ctx).pipeline.short_path, 'on');
  assert.equal(s.cli('get', 'pipeline.short_path').out, 'on\n');
  assert.equal(JSON.parse(s.cli('get').out).pipeline.short_path, 'on');
  assert.deepEqual(Object.keys(JSON.parse(s.cli('get').out).pipeline), ['fix_rounds', 'dispatch', 'parallel_cap', 'short_path', 'second_reviewer', 'second_reviewer_model', 'second_reviewer_model_effective', 'worktrees', 'context_cap', 'review_format', 'lanes']);
});

test('short_path off from the user level resolves off', (t) => {
  const s = sandbox(t);
  s.user({ pipeline: { short_path: 'off' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'off');
  assert.deepEqual(r.ignored, []);
  assert.equal(s.cli('get', 'pipeline.short_path').out, 'off\n');
});

test('short_path off from the project level resolves off, with the user on or unset', (t) => {
  const s = sandbox(t);
  s.project({ pipeline: { short_path: 'off' } });
  assert.equal(resolveSettings(s.ctx).pipeline.short_path, 'off');
  s.user({ pipeline: { short_path: 'on' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'off');
  assert.deepEqual(r.ignored, []);
});

test('short_path on from the project counts when the user level is on or unset', (t) => {
  const s = sandbox(t);
  s.project({ pipeline: { short_path: 'on' } });
  assert.equal(resolveSettings(s.ctx).pipeline.short_path, 'on');
  s.user({ pipeline: { short_path: 'on' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'on');
  assert.deepEqual(r.ignored, []);
});

test('a project on under a user off is ignored and listed once', (t) => {
  const s = sandbox(t);
  s.user({ pipeline: { short_path: 'off' } });
  s.project({ pipeline: { short_path: 'on' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'off');
  assert.deepEqual(r.ignored, ['pipeline.short_path: a project can only turn the short path off']);
  assert.equal(s.cli('get', 'pipeline.short_path').out, 'off\n');
});

test('a fail-closed project layer holds short_path off and keeps the warning', (t) => {
  const s = sandbox(t);
  s.project({ pipeline: { review_format: 'PILOT' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'off');
  assert.ok(r.warnings.some((w) => /review_format/.test(w)));
  s.user({ pipeline: { short_path: 'on' } });
  assert.equal(resolveSettings(s.ctx).pipeline.short_path, 'off');
  fs.writeFileSync(s.projectFile, '{ not json');
  const broken = resolveSettings(s.ctx);
  assert.equal(broken.pipeline.short_path, 'off');
  assert.equal(broken.warnings.length, 1);
});

test('a stored short_path other than on or off falls back one level with one warning and no echo', (t) => {
  const s = sandbox(t);
  for (const bad of ['yes', true, 1, 'ON', null]) {
    s.user({ pipeline: { short_path: 'off' } });
    s.project({ pipeline: { short_path: bad } });
    const r = resolveSettings(s.ctx);
    const w = r.warnings.filter((x) => /short_path/.test(x));
    assert.equal(w.length, 1, String(bad));
    assert.equal(w[0].replace(/^.*settings\.json: |^.*config\.json: /, ''), 'ignoring pipeline.short_path must be on or off', String(bad));
    assert.equal(r.pipeline.short_path, 'off', `${bad}: off from the user level`);
  }
  s.user({ pipeline: { short_path: 'yes' } });
  fs.rmSync(s.projectFile);
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.short_path, 'on');
  assert.equal(r.warnings.filter((x) => /short_path/.test(x)).length, 1);
  assert.ok(!r.warnings.some((x) => x.includes('yes')));
});

test('writeLayer refuses a bad short_path with the Contract text and writes nothing', (t) => {
  const s = sandbox(t);
  for (const bad of ['yes', true, 1]) {
    assert.throws(() => writeLayer('user', { version: 1, pipeline: { short_path: bad } }, s.ctx), /pipeline\.short_path must be on or off/);
  }
  assert.equal(fs.existsSync(s.config), false);
  writeLayer('user', { version: 1, pipeline: { short_path: 'off' } }, s.ctx);
  assert.deepEqual(readLayer('user', s.ctx).layer, { version: 1, pipeline: { short_path: 'off' } });
});

test('a v1.7 file without short_path resolves as before, plus the default key', (t) => {
  const s = sandbox(t);
  s.user({ pipeline: { fix_rounds: 3, dispatch: 'sequential', parallel_cap: 5, review_format: 'pilot' } });
  const r = resolveSettings(s.ctx);
  assert.deepEqual([r.pipeline.fix_rounds, r.pipeline.dispatch, r.pipeline.parallel_cap, r.pipeline.review_format, r.pipeline.short_path], [3, 'sequential', 5, 'pilot', 'on']);
  assert.deepEqual(r.ignored, []);
  assert.deepEqual(r.warnings, []);
});

// ---- pipeline.second_reviewer, second_reviewer_model, worktrees (aico-settings v1.10) ----

const reviewerNames = ['architect', 'code-reviewer', 'fresh-reviewer', 'qa', 'security'];

// A sandbox whose plugin holds the Roles the second reviewer settings read.
function reviewerSandbox(t, { floorText } = {}) {
  const s = sandbox(t);
  const names = JSON.parse(fs.readFileSync(path.join(s.pluginRoot, 'company', 'names.json'), 'utf8'));
  for (const role of ['code-reviewer', 'fresh-reviewer']) {
    fs.writeFileSync(path.join(s.pluginRoot, 'agents', `${role}.md`), agentFile(role, { model: 'opus', effort: 'high' }));
    names[role] = role === 'fresh-reviewer' ? 'Fenna' : 'Rui';
  }
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'names.json'), JSON.stringify(names));
  const floor = Object.fromEntries(reviewerNames.map((r) => [r, r === 'qa' ? 'sonnet' : 'opus']));
  writeFloor(s.pluginRoot, { floor });
  if (floorText !== undefined) fs.writeFileSync(path.join(s.pluginRoot, 'company', 'model-floor.json'), floorText);
  s.roleSet = new Set(reviewerNames);
  return s;
}

test('the new pipeline keys refuse hostile values first, with messages that never echo the value', (t) => {
  const s = reviewerSandbox(t);
  const bad = [undefined, null, 1, true, [], {}, 'ON', 'on ', '', 'yes', '__proto__', 'x'.repeat(5000), 'secret-value'];
  for (const [key, msg] of [['second_reviewer', 'pipeline.second_reviewer must be off or on'], ['worktrees', 'pipeline.worktrees must be off or on']]) {
    for (const v of bad) {
      assert.deepEqual(validateLayer({ version: 1, pipeline: { [key]: v } }, s.roleSet), [msg]);
    }
    for (const ok of ['on', 'off']) assert.deepEqual(validateLayer({ version: 1, pipeline: { [key]: ok } }, s.roleSet), []);
  }
  const modelMsg = 'pipeline.second_reviewer_model must be default or a model at or above the code-reviewer floor (opus)';
  for (const v of [...bad, 'sonnet', 'haiku', 'fable', 'gpt-4o', 'inherit', 'Opus']) {
    assert.deepEqual(validateLayer({ version: 1, pipeline: { second_reviewer_model: v } }, s.roleSet), [modelMsg]);
  }
  for (const ok of ['default', 'opus']) assert.deepEqual(validateLayer({ version: 1, pipeline: { second_reviewer_model: ok } }, s.roleSet), []);
});

test('a save of a bad value is refused with the fixed message and writes nothing', (t) => {
  const s = reviewerSandbox(t);
  for (const [key, v] of [['second_reviewer', 'maybe'], ['worktrees', 'sometimes'], ['second_reviewer_model', 'gpt-4o'], ['second_reviewer_model', 'fable'], ['second_reviewer_model', 'sonnet'], ['second_reviewer_model', 'haiku']]) {
    assert.throws(() => writeLayer('user', { version: 1, pipeline: { [key]: v } }, s.ctx), (e) => e instanceof Refusal && e.message.startsWith(`pipeline.${key} must be`) && !e.message.includes(v));
  }
  assert.equal(fs.existsSync(s.config), false);
});

test('defaults: second reviewer off, model default (effective is the fresh-reviewer model), worktrees off', (t) => {
  const s = reviewerSandbox(t);
  const p = resolveSettings(s.ctx).pipeline;
  assert.equal(p.second_reviewer, 'off');
  assert.equal(p.second_reviewer_model, 'default');
  assert.equal(p.second_reviewer_model_effective, 'opus');
  assert.equal(p.worktrees, 'off');
  assert.equal(s.cli('get', 'pipeline.second_reviewer').out, 'off\n');
  assert.equal(s.cli('get', 'pipeline.worktrees').out, 'off\n');
  assert.equal(JSON.parse(s.cli('get').out).pipeline.second_reviewer_model_effective, 'opus');
  assert.equal(PIPELINE_DEFAULTS.second_reviewer, 'off');
  assert.equal(PIPELINE_DEFAULTS.worktrees, 'off');
});

test('user values count: on, opus and worktrees on', (t) => {
  const s = reviewerSandbox(t);
  s.user({ pipeline: { second_reviewer: 'on', second_reviewer_model: 'opus', worktrees: 'on' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.second_reviewer, 'on');
  assert.equal(r.pipeline.second_reviewer_model, 'opus');
  assert.equal(r.pipeline.second_reviewer_model_effective, 'opus');
  assert.equal(r.pipeline.worktrees, 'on');
  assert.deepEqual(r.ignored, []);
});

test('project values of the new keys are ignored and listed', (t) => {
  const s = reviewerSandbox(t);
  for (const v of ['on', 'off']) {
    s.project({ pipeline: { second_reviewer: v, second_reviewer_model: 'opus', worktrees: v } });
    const r = resolveSettings(s.ctx);
    assert.equal(r.pipeline.second_reviewer, 'off');
    assert.equal(r.pipeline.second_reviewer_model, 'default');
    assert.equal(r.pipeline.worktrees, 'off');
    assert.deepEqual(r.ignored, [
      'pipeline.second_reviewer: set it at the user level',
      'pipeline.second_reviewer_model: set it at the user level',
      'pipeline.worktrees: set it at the user level'
    ]);
  }
  s.user({ pipeline: { second_reviewer: 'on', worktrees: 'on' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.second_reviewer, 'on');
  assert.equal(r.pipeline.worktrees, 'on');
});

test('a fail-closed project layer leaves the new keys unchanged', (t) => {
  const s = reviewerSandbox(t);
  s.user({ pipeline: { second_reviewer: 'on', worktrees: 'on' } });
  s.project({ pipeline: { fix_rounds: 99 } });
  const r = resolveSettings(s.ctx);
  assert.ok(r.warnings.some((w) => w.includes('ignoring')));
  assert.equal(r.pipeline.second_reviewer, 'on');
  assert.equal(r.pipeline.worktrees, 'on');
});

test('a bad stored user value falls back to the default with a warning', (t) => {
  const s = reviewerSandbox(t);
  s.user({ pipeline: { second_reviewer: 'maybe', second_reviewer_model: 'fable', worktrees: 'x' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.second_reviewer, 'off');
  assert.equal(r.pipeline.second_reviewer_model, 'default');
  assert.equal(r.pipeline.worktrees, 'off');
  assert.equal(r.warnings.filter((w) => w.includes('ignoring pipeline.')).length, 3);
  assert.ok(r.warnings.some((w) => w.includes('pipeline.second_reviewer_model must be default')));
  assert.equal(r.pipeline.second_reviewer_model_effective, 'opus');
});

test('default effective model is never below opus, also with a project fresh-reviewer model below the floor', (t) => {
  const s = reviewerSandbox(t);
  s.project({ roles: { 'fresh-reviewer': { model: 'sonnet' } } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.roles['fresh-reviewer'].model, 'opus');
  assert.equal(r.pipeline.second_reviewer_model_effective, 'opus');
  s.project({ roles: { 'fresh-reviewer': { model: 'inherit' } } });
  assert.equal(resolveSettings(s.ctx).pipeline.second_reviewer_model_effective, 'opus');
});

test('an unreadable model floor file gives effective opus and a warning', (t) => {
  const s = reviewerSandbox(t, { floorText: '{not json' });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.second_reviewer_model_effective, 'opus');
  assert.ok(r.warnings.some((w) => w.startsWith('model floor:')));
  s.user({ pipeline: { second_reviewer_model: 'opus' } });
  assert.equal(resolveSettings(s.ctx).pipeline.second_reviewer_model_effective, 'opus');
});

test('the shipped plugin: six protected names and an effective opus by default', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-real-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = resolveSettings({ home, cwd: home });
  assert.equal(r.pipeline.second_reviewer_model_effective, 'opus');
  assert.equal(r.roles['fresh-reviewer'].protected, true);
  assert.equal(loadModelFloor().protected.length, 6);
});
