import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAD = ['‮evil⁩', 'abc​def', 12.5, 99999999, '180000'];

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-echo-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('session-start warning names pipeline.context_cap and never the value', async (t) => {
  const { resolveSnapshotSettings } = await import(pathToFileURL(path.join(root, 'hooks', 'lib', 'snapshot.mjs')).href);
  for (const bad of BAD) {
    const home = tmp(t);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ version: 1, pipeline: { context_cap: bad } }));
    const { warnings } = resolveSnapshotSettings({ mcsHome: home, root: undefined, manifests: [] });
    const w = warnings.filter((x) => x.includes('pipeline.context_cap'));
    assert.equal(w.length, 1, String(bad));
    assert.ok(!/[​-‏‪-‮⁦-⁩]/.test(w[0]), 'no bidi or zero-width');
    assert.ok(!w[0].includes('evil') && !w[0].includes('abc') && !w[0].includes('12.5') && !w[0].includes('99999999'), w[0]);
    assert.ok(!/\(.*\)/.test(w[0]) && !w[0].includes('ignoring 180000'), w[0]);
  }
});

test('settings get warning names pipeline.context_cap and never the value', async (t) => {
  const { resolveSettings } = await import(pathToFileURL(path.join(root, 'scripts', 'settings.mjs')).href);
  assert.equal(typeof resolveSettings, 'function');
  for (const bad of BAD) {
    const base = tmp(t);
    const home = path.join(base, 'home');
    const cwd = path.join(base, 'repo');
    const pluginRoot = path.join(base, 'plugin');
    fs.mkdirSync(home);
    fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, 'company'));
    fs.mkdirSync(path.join(pluginRoot, 'skills', 'lead', 'references'), { recursive: true });
    fs.copyFileSync(path.join(root, 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
    fs.writeFileSync(path.join(pluginRoot, 'agents', 'qa.md'), '---\nname: qa\ndescription: The qa.\ntools: Read\nmodel: sonnet\neffort: medium\n---\n# qa\n');
    fs.writeFileSync(path.join(pluginRoot, 'company', 'names.json'), JSON.stringify({ qa: 'Quinn' }));
    fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor: { qa: 'sonnet' }, protected: [] }));
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, pipeline: { context_cap: bad } } }));
    const r = resolveSettings({ home, cwd, pluginRoot });
    const found = r.warnings.filter((x) => x.includes('context_cap'));
    assert.ok(found.length >= 1, String(bad));
    for (const w of found) {
      assert.ok(!/[​-‏‪-‮⁦-⁩]/.test(w), 'no bidi');
      assert.ok(!w.includes('evil') && !w.includes('abc') && !w.includes('12.5') && !w.includes('99999999'), w);
      assert.ok(!/context_cap \(/.test(w), w);
    }
  }
});
