import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './settings-server.mjs';

const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const pageMods = () => {
  const m = /const MODS = \[([^\]]*)\]/.exec(PAGE);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

async function boot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-mods-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  const pluginRoot = path.join(root, 'plugin');
  for (const d of [home, cwd, path.join(pluginRoot, 'agents'), path.join(pluginRoot, 'company')]) fs.mkdirSync(d, { recursive: true });
  const server = await startServer({ home, cwd, pluginRoot, open: false, log: () => {} });
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.port}/api/state`, { headers: { 'X-Aico-Token': server.token } });
  return res.json();
}

test('/api/state carries every mod key the page reads, in plugin and resolved', async (t) => {
  const state = await boot(t);
  const keys = pageMods();
  assert.equal(keys.length, 5);
  for (const view of ['plugin', 'resolved']) {
    for (const k of keys) {
      assert.ok(state[view].mods[k], `${view}.mods.${k}`);
      assert.equal(typeof state[view].mods[k].enabled, 'boolean', `${view}.mods.${k}.enabled`);
    }
  }
});
