import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BRAINSTORM_DEFAULTS, GATE_DEFAULTS, PIPELINE_DEFAULTS, Refusal, pluginDefaults, readLayer, readProfile, resolveSettings, run,
  templateOptions, validateLayer, writeLayer, writeProfile
} from './settings.mjs';

const script = path.join(import.meta.dirname, 'settings.mjs');

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
    name: 'Quinn', model: 'sonnet', effort: 'medium', context_cap: 150000,
    source: { name: 'plugin', model: 'plugin', effort: 'plugin', context_cap: 'plugin' }
  });
  assert.deepEqual(r.pipeline, PIPELINE_DEFAULTS);
  assert.deepEqual(r.gates, GATE_DEFAULTS);
  assert.deepEqual(r.brainstorm, BRAINSTORM_DEFAULTS);
  assert.equal(r.pipeline.context_cap, 150000);
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
    name: 'Quinn', model: 'opus', effort: 'high', context_cap: 150000,
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
  assert.equal(r.pipeline.context_cap, 150000);
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
  assert.deepEqual(Object.keys(data).sort(), ['brainstorm', 'gates', 'ignored', 'language', 'pipeline', 'profile', 'revision', 'roles', 'unlocked', 'warnings']);
  assert.equal(Object.keys(data.roles).length, 32);
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
  const usage = 'refused: usage: settings.mjs get [key] | serve [--no-open]';
  for (const args of [[], ['bogus'], ['serve', '--bogus'], ['serve', '--no-open', 'x'], ['get', 'a', 'b']]) {
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

test('context_cap: Role beats pipeline, project beats user, plugin default 150000', (t) => {
  const s = sandbox(t);
  s.user({ roles: { qa: { context_cap: 200000 } }, pipeline: { context_cap: 100000 } });
  let r = resolveSettings(s.ctx);
  assert.equal(r.roles.qa.context_cap, 200000);
  assert.equal(r.roles.qa.source.context_cap, 'user');
  assert.equal(r.roles.architect.context_cap, 100000);
  assert.equal(r.roles.architect.source.context_cap, 'pipeline:user');
  assert.equal(r.pipeline.context_cap, 100000);
  s.project({ roles: { qa: { context_cap: 60000 } }, pipeline: { context_cap: 1000000 } });
  r = resolveSettings(s.ctx);
  assert.equal(r.roles.qa.context_cap, 60000);
  assert.equal(r.roles.qa.source.context_cap, 'project');
  assert.equal(r.roles.architect.context_cap, 1000000);
  assert.equal(r.roles.architect.source.context_cap, 'pipeline:project');
  assert.equal(s.cli('get', 'roles.qa.context_cap').out, '60000\n');
  assert.equal(s.cli('get', 'pipeline.context_cap').out, '1000000\n');
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
  assert.equal(r.pipeline.context_cap, 90000);
  assert.equal(r.roles.qa.context_cap, 90000);
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
