import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Refusal, resolveSettings, writeLayer } from './settings.mjs';

// aico-settings v4.0 (AC5, AC6): second_reviewer, second_reviewer_model, review_format and the efficient-browser-use mod id
// are retired: a stored key is ignored with a note, `set` and `set-mod` refuse it, `get` JSON drops it.
// pipeline.plan_review is new: off | on, default off.
const here = import.meta.dirname;
const script = path.join(here, 'settings.mjs');
const pluginRoot = path.join(here, '..');
const RETIRED_PIPELINE = [['second_reviewer', 'on'], ['second_reviewer_model', 'opus'], ['review_format', 'pilot']];

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-retired-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  const config = path.join(home, 'config.json');
  const projectFile = path.join(cwd, '.company', 'settings.json');
  const ctx = { home, cwd, pluginRoot };
  return {
    ctx, home, cwd, config, projectFile,
    put: (level, layer) => fs.writeFileSync(level === 'user' ? config : projectFile, JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    file: (level) => (level === 'user' ? config : projectFile),
    cli: (...args) => {
      const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    }
  };
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
const quiet = (r) => { const { revision, warnings, ignored, ...rest } = JSON.parse(JSON.stringify(r)); return rest; };
const notes = (r) => [...r.warnings, ...r.ignored];

// ---------- AC5: pipeline.plan_review ----------
test('AC5: pipeline.plan_review defaults to off', (t) => {
  const s = sandbox(t);
  assert.equal(resolveSettings(s.ctx).pipeline.plan_review, 'off');
  const r = s.cli('get', 'pipeline.plan_review');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'off\n');
});

test('AC5: a stored user plan_review on resolves to on', (t) => {
  const s = sandbox(t);
  s.put('user', { pipeline: { plan_review: 'on' } });
  assert.equal(resolveSettings(s.ctx).pipeline.plan_review, 'on');
  assert.equal(s.cli('get', 'pipeline.plan_review').out, 'on\n');
});

test('AC5: an invalid plan_review value is not taken: the setting stays off and a note says why', (t) => {
  const s = sandbox(t);
  s.put('user', { pipeline: { plan_review: 'maybe' } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.plan_review, 'off');
  assert.ok(notes(r).some((n) => n.includes('plan_review')), notes(r).join(' | '));
});

test('AC5: writeLayer accepts plan_review on and refuses other values', (t) => {
  const s = sandbox(t);
  assert.doesNotThrow(() => writeLayer('user', { version: 1, pipeline: { plan_review: 'on' } }, s.ctx));
  assert.equal(resolveSettings(s.ctx).pipeline.plan_review, 'on');
  const before = read(s.config);
  assert.throws(() => writeLayer('user', { version: 1, pipeline: { plan_review: 'sometimes' } }, s.ctx), (e) => e instanceof Refusal);
  assert.deepEqual(read(s.config), before);
});

// ---------- AC6: retired pipeline keys ----------
for (const [key, value] of RETIRED_PIPELINE) {
  for (const level of ['user', 'project']) {
    test(`AC6: a stored ${level} pipeline.${key} is ignored with a note and resolves as the file without it`, (t) => {
      const base = sandbox(t);
      base.put(level, { pipeline: { fix_rounds: 2 } });
      const expected = resolveSettings(base.ctx);

      const s = sandbox(t);
      s.put(level, { pipeline: { fix_rounds: 2, [key]: value } });
      let got;
      assert.doesNotThrow(() => { got = resolveSettings(s.ctx); });
      assert.deepEqual(quiet(got), quiet(expected));
      assert.ok(notes(got).some((n) => n.includes(key)), `a note names ${key}: ${notes(got).join(' | ')}`);
      assert.ok(!Object.hasOwn(got.pipeline, key), `pipeline.${key} is not in the resolved settings`);
    });
  }

  test(`AC6: writeLayer of pipeline.${key} is refused and leaves the file byte-identical`, (t) => {
    for (const level of ['user', 'project']) {
      const s = sandbox(t);
      s.put(level, { pipeline: { fix_rounds: 2 } });
      const before = read(s.file(level));
      assert.throws(() => writeLayer(level, { version: 1, pipeline: { [key]: value } }, s.ctx), (e) => e instanceof Refusal, `${level} ${key}`);
      assert.deepEqual(read(s.file(level)), before);
    }
  });

  test(`AC6: CLI set pipeline.${key} is refused and writes nothing`, (t) => {
    const s = sandbox(t);
    const r = s.cli('set', `pipeline.${key}`, String(value));
    assert.notEqual(r.code, 0);
    assert.equal(read(s.config), null);
    assert.equal(read(s.projectFile), null);
  });
}

test('AC6: get JSON has no second_reviewer, second_reviewer_model, second_reviewer_model_effective or review_format', (t) => {
  const s = sandbox(t);
  const r = s.cli('get');
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  for (const k of ['second_reviewer', 'second_reviewer_model', 'second_reviewer_model_effective', 'review_format']) {
    assert.ok(!Object.hasOwn(out.pipeline, k), `pipeline.${k} is gone`);
  }
  assert.equal(out.pipeline.plan_review, 'off');
});

test('AC6: CLI get of a retired key is refused as no setting', (t) => {
  const s = sandbox(t);
  for (const k of ['pipeline.second_reviewer', 'pipeline.review_format']) {
    const r = s.cli('get', k);
    assert.equal(r.code, 2, k);
    assert.match(r.out, /^refused: no setting /);
  }
});

// ---------- AC6: the efficient-browser-use mod id ----------
test('AC6: a stored mods.efficient_browser_use is ignored with a note and resolves as the file without it', (t) => {
  for (const level of ['user', 'project']) {
    const base = sandbox(t);
    base.put(level, { pipeline: { fix_rounds: 2 } });
    const expected = resolveSettings(base.ctx);
    const s = sandbox(t);
    s.put(level, { pipeline: { fix_rounds: 2 }, mods: { efficient_browser_use: { enabled: true } } });
    let got;
    assert.doesNotThrow(() => { got = resolveSettings(s.ctx); });
    assert.deepEqual(quiet(got), quiet(expected), level);
    assert.ok(notes(got).some((n) => n.includes('efficient_browser_use') || n.includes('efficient-browser-use')), notes(got).join(' | '));
    assert.ok(!Object.hasOwn(got.mods, 'efficient_browser_use'));
  }
});

test('AC6: get JSON drops mods.efficient_browser_use', (t) => {
  const s = sandbox(t);
  const out = JSON.parse(s.cli('get').out);
  assert.ok(!Object.hasOwn(out.mods, 'efficient_browser_use'));
  assert.deepEqual(Object.keys(out.mods).sort(), ['cache_tax', 'reflect', 'savings', 'savvy', 'switchboard']);
});

test('AC6: set-mod efficient-browser-use on and off is refused with exit 2 and writes nothing', (t) => {
  const s = sandbox(t);
  for (const word of ['on', 'off']) {
    const r = s.cli('set-mod', 'efficient-browser-use', word);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: /);
    assert.equal(read(s.config), null);
    assert.equal(read(s.projectFile), null);
  }
});

test('AC6: writeLayer of mods.efficient_browser_use is refused', (t) => {
  const s = sandbox(t);
  assert.throws(() => writeLayer('user', { version: 1, mods: { efficient_browser_use: { enabled: true } } }, s.ctx), (e) => e instanceof Refusal);
  assert.equal(read(s.config), null);
});

test('AC6: the other savers still switch (cache-tax, savings, switchboard)', (t) => {
  for (const id of ['cache-tax', 'savings', 'switchboard']) {
    const s = sandbox(t);
    const r = s.cli('set-mod', id, 'on');
    assert.equal(r.code, 0, `${id}: ${r.out}${r.err}`);
  }
});
