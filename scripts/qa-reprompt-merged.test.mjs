// Acceptance net for the reprompter Role across company types, settings and personalities (ADR 0026).
// Everything runs against the shipped plugin files and the real scripts; the CLI scripts run as child processes in
// temp projects with their own home folder, so no user setting and no real project is read or changed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ALWAYS, CEO_ONLY, TYPE_ORDER, run as runCompanyType } from './company-type.mjs';
import { NAME_RE, PERSONALITY_KEYS, check, personalityProblem } from './check.mjs';
import { REPROMPT_DEFAULTS, Refusal, resolveSettings, validateLayer, writeLayer } from './settings.mjs';
import { startServer } from './settings-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));
const companyType = path.join(root, 'scripts', 'company-type.mjs');
const settingsScript = path.join(root, 'scripts', 'settings.mjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-reprompt-merged-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let counter = 0;
// A product folder with its own home folder; `type` null writes no company_type line (the default type).
function sandbox({ type = null } = {}) {
  const dir = path.join(base, `s${counter++}`);
  const home = path.join(dir, 'home');
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  const lines = ['# Project profile', '', ...(type ? [`company_type: ${type}`] : []), 'product_type: web', 'engagement: own', 'audience: the CEO', 'languages: en', 'voice: clear', ''];
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), lines.join('\n'));
  return {
    home,
    cwd,
    config: path.join(home, 'config.json'),
    projectFile: path.join(cwd, '.company', 'settings.json'),
    ctx: { home, cwd },
    user: (layer) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    project: (layer) => fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    node: (script, ...args) => {
      const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    }
  };
}

const agents = fs.readdirSync(path.join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

// ---------- the reprompter and /aico:reprompt exist in every company type ----------

test('AC10: four shipped types, in the documented order', () => {
  assert.deepEqual(TYPE_ORDER, ['software', 'research', 'marketing', 'design']);
  const shipped = fs.readdirSync(path.join(root, 'company', 'types')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(shipped, [...TYPE_ORDER].sort());
});

for (const type of TYPE_ORDER) {
  test(`AC10: ${type}: resolve lists the reprompter Role and the reprompt Playbook once each`, () => {
    const s = sandbox({ type });
    const r = s.node(companyType, 'resolve', '--json');
    assert.equal(r.code, 0, r.out);
    const resolved = JSON.parse(r.out);
    assert.equal(resolved.id, type);
    assert.equal(resolved.roles.filter((x) => x === 'reprompter').length, 1);
    assert.equal(resolved.playbooks.filter((x) => x === 'reprompt').length, 1);
    assert.equal(resolved.playbooks.at(-1), 'reprompt', 'reprompt is the last always-on command');
    assert.deepEqual(resolved.playbooks.slice(-ALWAYS.length), [...ALWAYS]);
    for (const role of resolved.roles) assert.ok(agents.includes(role), `${role} is a shipped agent`);
  });

  test(`AC10: ${type}: check-role reprompter and check-playbook reprompt pass`, () => {
    const s = sandbox({ type });
    const role = s.node(companyType, 'check-role', 'reprompter');
    assert.equal(role.code, 0, role.out);
    assert.equal(role.out.split('\n')[0], `ok: reprompter is part of the ${type} company`);
    const playbook = s.node(companyType, 'check-playbook', 'reprompt');
    assert.equal(playbook.code, 0, playbook.out);
    assert.equal(playbook.out.split('\n')[0], `ok: reprompt is part of the ${type} company`);
    const picked = s.node(companyType, 'pick', 'reprompter');
    assert.equal(picked.code, 0);
    assert.equal(picked.out.trim(), 'reprompter');
  });

  test(`AC10: ${type}: the manifest names reprompter in roles and keeps reprompt out of playbooks`, () => {
    const manifest = readJson(`company/types/${type}.json`);
    assert.ok(manifest.roles.includes('reprompter'));
    assert.ok(manifest.roles.indexOf('reprompter') > manifest.roles.indexOf('skill-researcher'), 'after skill-researcher');
    assert.ok(!manifest.playbooks.includes('reprompt'), 'always-on commands are appended by resolve, never listed');
  });
}

test('AC10: software resolved without a company_type line (default type) has the reprompter and every agent but the editor and project-manager', () => {
  const s = sandbox();
  const r = s.node(companyType, 'resolve', '--json');
  assert.equal(r.code, 0, r.out);
  const resolved = JSON.parse(r.out);
  assert.equal(resolved.id, 'software');
  assert.equal(resolved.source, 'default');
  assert.deepEqual([...resolved.roles].sort(), agents.filter((a) => a !== 'editor' && a !== 'project-manager'));
  assert.equal(resolved.roles.length, 35);
  assert.equal(resolved.playbooks.filter((p) => ALWAYS.includes(p)).length, ALWAYS.length);
  const role = s.node(companyType, 'check-role', 'reprompter');
  assert.equal(role.code, 0, role.out);
});

test('AC10: reprompt runs in every type, so it is not a type-only command and is not CEO-only', () => {
  assert.ok(ALWAYS.includes('reprompt'));
  assert.ok(!CEO_ONLY.includes('reprompt'));
  for (const type of TYPE_ORDER) assert.ok(!readJson(`company/types/${type}.json`).playbooks.includes('reprompt'), type);
});

test('AC10: a manifest without reprompter is refused, end to end, before any Role is checked', () => {
  const plugin = path.join(base, 'plugin-no-reprompter');
  fs.cpSync(path.join(root, 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.cpSync(path.join(root, 'company'), path.join(plugin, 'company'), { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'skills'))) {
    const file = path.join(root, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    fs.mkdirSync(path.join(plugin, 'skills', name), { recursive: true });
    fs.copyFileSync(file, path.join(plugin, 'skills', name, 'SKILL.md'));
  }
  const file = path.join(plugin, 'company', 'types', 'design.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.roles = manifest.roles.filter((r) => r !== 'reprompter');
  fs.writeFileSync(file, JSON.stringify(manifest));
  const s = sandbox({ type: 'design' });
  const { code, out } = runCompanyType(['check-role', 'reprompter'], { cwd: s.cwd, pluginRoot: plugin });
  assert.notEqual(code, 0);
  assert.match(out, /^refused: .*roles must include reprompter/);
});

test('AC10: the plugin check passes, so counts, names and Playbook rules agree', () => {
  const { errors } = check(root);
  assert.deepEqual(errors, []);
});

// ---------- 37 Roles, unique default names, Lynn last ----------

test('AC12: 37 agents, one default name each, names.json has no extra and no missing Role', () => {
  assert.equal(agents.length, 37);
  const names = readJson('company/names.json');
  assert.deepEqual(Object.keys(names).sort(), agents);
});

test('AC12: the 37 default names are valid and unique case-insensitively', () => {
  const names = Object.values(readJson('company/names.json'));
  assert.equal(names.length, 37);
  for (const n of names) assert.match(n, NAME_RE, n);
  assert.equal(new Set(names.map((n) => n.toLocaleLowerCase('en'))).size, 37);
});

test('AC12: Lynn is the reprompter and the last default name before the fresh-reviewer', () => {
  const names = readJson('company/names.json');
  assert.equal(names.reprompter, 'Lynn');
  assert.deepEqual(Object.keys(names).at(-3), 'reprompter');
  assert.equal(Object.values(names).at(-3), 'Lynn');
  assert.equal(Object.values(names).filter((n) => n === 'Lynn').length, 1);
});

test('AC12: the effective name through the settings resolver is Lynn, and all 37 stay unique', () => {
  const s = sandbox();
  const roles = resolveSettings(s.ctx).roles;
  assert.equal(Object.keys(roles).length, 37);
  assert.equal(roles.reprompter.name, 'Lynn');
  assert.equal(new Set(Object.values(roles).map((r) => r.name.toLocaleLowerCase('en'))).size, 37);
});

test('AC12: a rename that would clash with Lynn, in any letter case, is refused and nothing is written', () => {
  const s = sandbox();
  for (const clash of ['Lynn', 'lynn', 'LYNN']) {
    assert.throws(() => writeLayer('user', { version: 1, roles: { qa: { name: clash } } }, s.ctx), (e) => e instanceof Refusal && /qa/.test(e.message) && /reprompter/.test(e.message));
  }
  assert.ok(!fs.existsSync(s.config));
  writeLayer('user', { version: 1, roles: { reprompter: { name: 'Mina' }, qa: { name: 'Lynn' } } }, s.ctx);
  assert.equal(resolveSettings(s.ctx).roles.qa.name, 'Lynn', 'the name frees up when the reprompter is renamed in the same save');
});

test('AC12: the reprompter personality entry is complete, valid and last', () => {
  const personalities = readJson('company/personalities.json');
  assert.deepEqual(Object.keys(personalities).sort(), agents);
  assert.equal(Object.keys(personalities).at(-3), 'reprompter');
  const entry = personalities.reprompter;
  assert.deepEqual(Object.keys(entry).sort(), [...PERSONALITY_KEYS].sort());
  for (const key of PERSONALITY_KEYS) assert.equal(personalityProblem(key, entry[key]), null, key);
  assert.equal(entry.intelligence, 'high');
  assert.equal(entry.creativity, 'medium');
});
// ---------- reprompt.question_rounds ----------

const RP_MSG = 'reprompt.question_rounds must be a whole number from 0 to 3';
const rounds = (s) => s.node(settingsScript, 'get', 'reprompt.question_rounds');

test('question_rounds: default is 1 with no setting anywhere, through get and through the resolver', () => {
  assert.deepEqual({ ...REPROMPT_DEFAULTS }, { question_rounds: 1 });
  const s = sandbox();
  assert.equal(rounds(s).out, '1\n');
  assert.deepEqual(JSON.parse(s.node(settingsScript, 'get').out).reprompt, { question_rounds: 1 });
  assert.equal(resolveSettings(s.ctx).reprompt.question_rounds, 1);
});

test('question_rounds: every whole number 0 to 3 is accepted at user and project level', () => {
  for (const n of [0, 1, 2, 3]) {
    assert.deepEqual(validateLayer({ version: 1, reprompt: { question_rounds: n } }, new Set(agents)), [], String(n));
    const s = sandbox();
    s.user({ reprompt: { question_rounds: n } });
    assert.equal(rounds(s).out, `${n}\n`, `user ${n}`);
    const p = sandbox();
    p.project({ reprompt: { question_rounds: n } });
    assert.equal(rounds(p).out, `${n}\n`, `project ${n}`);
  }
});

test('question_rounds: the project value counts, even 0, and beats the user value without any unlock', () => {
  const s = sandbox();
  s.user({ reprompt: { question_rounds: 3 } });
  s.project({ reprompt: { question_rounds: 0 } });
  assert.equal(rounds(s).out, '0\n');
  const all = JSON.parse(s.node(settingsScript, 'get').out);
  assert.equal(all.reprompt.question_rounds, 0);
  assert.deepEqual(all.unlocked, [], 'the project value is not a lock and needs no unlock');
  assert.ok(!JSON.stringify(all.ignored).includes('question_rounds'), 'a project value here is never reported as ignored');
  const up = sandbox();
  up.user({ reprompt: { question_rounds: 2 } });
  assert.equal(rounds(up).out, '2\n', 'the user value wins when the project sets none');
});

test('question_rounds: a project layer without the key leaves the user value, and other project keys do not hide it', () => {
  const s = sandbox();
  s.user({ reprompt: { question_rounds: 2 } });
  s.project({ pipeline: { fix_rounds: 2 } });
  assert.equal(rounds(s).out, '2\n');
});

const HOSTILE = [4, -1, 1.5, 99, 1e9, '2', '', 'SECRET-VALUE-77', null, true, [3], { n: 3 }, 'x'.repeat(500), '0x2', ' 2'];

test('question_rounds: hostile values are refused with the fixed text and never echoed', () => {
  for (const bad of HOSTILE) {
    const reasons = validateLayer({ version: 1, reprompt: { question_rounds: bad } }, new Set(agents));
    assert.deepEqual(reasons, [RP_MSG], JSON.stringify(bad)?.slice(0, 20));
  }
  const s = sandbox();
  for (const bad of HOSTILE) {
    assert.throws(() => writeLayer('user', { version: 1, reprompt: { question_rounds: bad } }, s.ctx), (e) => {
      assert.ok(e instanceof Refusal);
      assert.equal(e.message, RP_MSG);
      return true;
    });
  }
  assert.ok(!fs.existsSync(s.config), 'nothing was written by a refused save');
  assert.ok(!fs.existsSync(s.projectFile));
});

test('question_rounds: unknown keys and wrong shapes under reprompt are refused', () => {
  assert.deepEqual(validateLayer({ version: 1, reprompt: { rounds: 1 } }, new Set(agents)), ['reprompt.rounds: unknown key']);
  for (const bad of ['1', [], null, 3]) assert.deepEqual(validateLayer({ version: 1, reprompt: bad }, new Set(agents)), ['reprompt: must be an object']);
  const r = sandbox().node(settingsScript, 'get', 'reprompt.nope');
  assert.equal(r.code, 2);
  assert.equal(r.out.trim(), 'refused: no setting reprompt.nope');
});

test('question_rounds: a bad stored project value falls back to the user value with a warning that does not echo it', () => {
  const s = sandbox();
  s.user({ reprompt: { question_rounds: 2 } });
  s.project({ reprompt: { question_rounds: 'SECRET-VALUE-77' } });
  const r = rounds(s);
  assert.equal(r.code, 0);
  assert.equal(r.out, '2\n');
  assert.match(r.err, /question_rounds/);
  assert.ok(!r.err.includes('SECRET-VALUE-77') && !r.out.includes('SECRET-VALUE-77'));
});

test('question_rounds: bad stored values at every level end at the default 1, never at a bad value', () => {
  for (const bad of [4, -2, 2.5, '3', 'many', null, [1]]) {
    const s = sandbox();
    s.user({ reprompt: { question_rounds: bad } });
    s.project({ reprompt: { question_rounds: bad } });
    const r = rounds(s);
    assert.equal(r.code, 0, JSON.stringify(bad));
    assert.equal(r.out, '1\n', JSON.stringify(bad));
  }
});

test('question_rounds: a corrupt reprompt block does not disturb other settings or the Role names', () => {
  const s = sandbox();
  s.project({ reprompt: { question_rounds: 7 }, pipeline: { fix_rounds: 1 } });
  const all = JSON.parse(s.node(settingsScript, 'get').out);
  assert.equal(all.reprompt.question_rounds, 1);
  assert.equal(all.roles.reprompter.name, 'Lynn');
  assert.equal(all.roles.reprompter.model, 'sonnet');
});

// ---------- settings page ----------

async function pageServer(t, s) {
  const server = await startServer({ home: s.home, cwd: s.cwd, pluginRoot: root, open: false, log: () => {} });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const api = (p, init = {}) => fetch(`${origin}${p}`, { ...init, headers: { 'X-Aico-Token': server.token, ...init.headers } });
  const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json' } });
  return { origin, api, post, state: async () => (await api('/api/state')).json() };
}

test('settings page: the served page has the Reprompt table and the Question rounds row with its hint', async (t) => {
  const { api } = await pageServer(t, sandbox());
  const res = await api('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const needle of ["sectionHead('Reprompt')", "label: 'Question rounds'", "['reprompt', 'question_rounds']", 'options: [0, 1, 2, 3]', "id: 'reprompt-hint'", 'state.plugin.reprompt']) {
    assert.ok(html.includes(needle), needle);
  }
  // Directly under the pipeline table: after the context cap hint, before the Brainstorm heading.
  const capHint = html.indexOf("const capHint = () => `How many tokens one Step may use");
  const reprompt = html.indexOf("sectionHead('Reprompt')");
  const brainstorm = html.indexOf("sectionHead('Brainstorm')");
  assert.ok(capHint > 0 && reprompt > capHint && brainstorm > reprompt, 'order: context cap hint, Reprompt heading, Brainstorm heading');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'the page loads no outside script');
});

test('settings page: state carries the default 1 and the effective value, and a saved project value wins', async (t) => {
  const s = sandbox();
  const { post, state } = await pageServer(t, s);
  const before = await state();
  assert.deepEqual(before.plugin.reprompt, { question_rounds: 1 });
  assert.deepEqual(before.resolved.reprompt, { question_rounds: 1 });
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, reprompt: { question_rounds: 3 } }, project: { version: 1, reprompt: { question_rounds: 0 } } });
  assert.equal(res.status, 200);
  const { state: after } = await res.json();
  assert.deepEqual(after.resolved.reprompt, { question_rounds: 0 });
  assert.equal(rounds(s).out, '0\n', 'the script reads what the page saved');
});

test('settings page: a bad value is refused with the fixed text, not echoed, and nothing is written', async (t) => {
  const s = sandbox();
  const { post, state } = await pageServer(t, s);
  const before = await state();
  for (const bad of [4, -1, 1.5, '2', 'SECRET-VALUE-77']) {
    const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, reprompt: { question_rounds: bad } } });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.ok(text.includes(RP_MSG), text);
    assert.ok(!text.includes('SECRET-VALUE-77'));
  }
  assert.ok(!fs.existsSync(s.config));
  assert.ok(!fs.existsSync(s.projectFile));
});
