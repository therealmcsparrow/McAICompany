import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  GATE_DEFAULTS, PIPELINE_DEFAULTS, Refusal, pluginDefaults, readLayer, resolveSettings, run,
  validateLayer, writeLayer
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
  const r = resolveSettings(s.ctx);
  assert.deepEqual(r.roles.qa, {
    name: 'Quinn', model: 'sonnet', effort: 'medium',
    source: { name: 'plugin', model: 'plugin', effort: 'plugin' }
  });
  assert.deepEqual(r.pipeline, PIPELINE_DEFAULTS);
  assert.deepEqual(r.gates, GATE_DEFAULTS);
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
    name: 'Quinn', model: 'opus', effort: 'high',
    source: { name: 'plugin', model: 'user', effort: 'project' }
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
  assert.deepEqual(r.roles.qa.source, { name: 'plugin', model: 'plugin', effort: 'plugin' });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not valid JSON/);

  // Wrong types and a deleted agent's Role key: only the bad parts drop.
  s.user({ roles: { qa: { model: 'opus', effort: 7 }, ghost: { model: 'haiku' } }, pipeline: { fix_rounds: 'two', dispatch: 'sequential' } });
  s.project({ gates: 'auto' });
  r = resolveSettings(s.ctx);
  assert.equal(r.roles.qa.model, 'opus');
  assert.equal(r.roles.qa.effort, 'medium');
  assert.equal(r.roles.ghost, undefined);
  assert.equal(r.pipeline.fix_rounds, 2);
  assert.equal(r.pipeline.dispatch, 'sequential');
  assert.deepEqual(r.gates, GATE_DEFAULTS);
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
  assert.deepEqual(Object.keys(data).sort(), ['gates', 'ignored', 'pipeline', 'revision', 'roles', 'unlocked', 'warnings']);
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
  for (const args of [[], ['bogus'], ['serve'], ['get', 'a', 'b']]) {
    assert.deepEqual(run(args, s.ctx), { code: 2, out: usage }, args.join(' '));
  }
});
