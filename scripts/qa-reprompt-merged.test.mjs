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
import { GUARD_SENTENCE, NAME_RE, PERSONALITY_KEYS, check, personalityProblem } from './check.mjs';
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
const frontmatter = (text) => {
  const lines = text.split('\n');
  assert.equal(lines[0], '---');
  return lines.slice(1, lines.indexOf('---', 1));
};

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

test('AC10: software resolved without a company_type line (default type) has the reprompter and every agent but the editor', () => {
  const s = sandbox();
  const r = s.node(companyType, 'resolve', '--json');
  assert.equal(r.code, 0, r.out);
  const resolved = JSON.parse(r.out);
  assert.equal(resolved.id, 'software');
  assert.equal(resolved.source, 'default');
  assert.deepEqual([...resolved.roles].sort(), agents.filter((a) => a !== 'editor'));
  assert.equal(resolved.roles.length, 34);
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

// ---------- 35 Roles, unique default names, Lynn last ----------

test('AC12: 35 agents, one default name each, names.json has no extra and no missing Role', () => {
  assert.equal(agents.length, 35);
  const names = readJson('company/names.json');
  assert.deepEqual(Object.keys(names).sort(), agents);
});

test('AC12: the 35 default names are valid and unique case-insensitively', () => {
  const names = Object.values(readJson('company/names.json'));
  assert.equal(names.length, 35);
  for (const n of names) assert.match(n, NAME_RE, n);
  assert.equal(new Set(names.map((n) => n.toLocaleLowerCase('en'))).size, 35);
});

test('AC12: Lynn is the reprompter and the last default name', () => {
  const names = readJson('company/names.json');
  assert.equal(names.reprompter, 'Lynn');
  assert.deepEqual(Object.keys(names).at(-1), 'reprompter');
  assert.equal(Object.values(names).at(-1), 'Lynn');
  assert.equal(Object.values(names).filter((n) => n === 'Lynn').length, 1);
});

test('AC12: the effective name through the settings resolver is Lynn, and all 35 stay unique', () => {
  const s = sandbox();
  const roles = resolveSettings(s.ctx).roles;
  assert.equal(Object.keys(roles).length, 35);
  assert.equal(roles.reprompter.name, 'Lynn');
  assert.equal(new Set(Object.values(roles).map((r) => r.name.toLocaleLowerCase('en'))).size, 35);
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
  assert.equal(Object.keys(personalities).at(-1), 'reprompter');
  const entry = personalities.reprompter;
  assert.deepEqual(Object.keys(entry).sort(), [...PERSONALITY_KEYS].sort());
  for (const key of PERSONALITY_KEYS) assert.equal(personalityProblem(key, entry[key]), null, key);
  assert.equal(entry.intelligence, 'high');
  assert.equal(entry.creativity, 'medium');
});

test('AC12: the Role file matches its name and carries the three tools it needs and no more', () => {
  const lines = frontmatter(read('agents/reprompter.md'));
  assert.ok(lines.includes('name: reprompter'));
  assert.ok(lines.includes('tools: Read, Skill, Write'));
  assert.ok(!lines.some((l) => /^(Bash|Edit|Grep|Glob)\b/.test(l.replace(/^tools:\s*/, ''))));
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

test('question_rounds: the Playbook reads it from the settings JSON, falls back to 1 and derives Asks left from its own count', () => {
  const playbook = read('skills/reprompt/SKILL.md');
  assert.match(playbook, /read `reprompt\.question_rounds` as `question_rounds`/);
  assert.match(playbook, /not a whole number 0 to 3 → `1`/);
  assert.match(playbook, /`Asks left:` = `question_rounds` - `held`; always `0` on an edit dispatch/);
  assert.match(read('docs/contracts/aico-settings.md'), /reprompt\.question_rounds/);
  assert.match(read('documentation/commands.md'), /Question rounds[^\n]*0 to 3[^\n]*default 1|0 to 3, default 1/);
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
  for (const needle of ["'Reprompt'", "'Question rounds'", "['reprompt', 'question_rounds']", 'selectFor([0, 1, 2, 3], l)', "describedBy: 'reprompt-hint'", "id: 'reprompt-hint'", 'state.plugin.reprompt']) {
    assert.ok(html.includes(needle), needle);
  }
  // The hint is the exact text of the aico-settings Contract, read from it, with nothing added.
  const hint = /Under it the hint "([^"]+)"/.exec(read('docs/contracts/aico-settings.md'))?.[1];
  assert.ok(hint && hint.startsWith('How often /aico:reprompt may come back with questions'), `the Contract gives the hint text: ${hint}`);
  assert.ok(html.includes(`'${hint}'`), `the page shows the Contract hint exactly: ${hint}`);
  assert.ok(!/Question rounds is a whole number from 0 to 3/.test(html), 'the old hint wording is gone');
  // Directly under the pipeline table: after the context cap hint, before the Brainstorm heading.
  const capHint = html.indexOf('The context cap is a whole number from 60000 to 1000000');
  const reprompt = html.indexOf("el('h2', {}, 'Reprompt')");
  const brainstorm = html.indexOf("el('h2', {}, 'Brainstorm')");
  assert.ok(capHint > 0 && reprompt > capHint && brainstorm > reprompt, 'order: context cap hint, Reprompt heading, Brainstorm heading');
  assert.ok(html.indexOf(`'${hint}'`) > reprompt && html.indexOf(`'${hint}'`) < brainstorm, 'the hint sits between the Reprompt and Brainstorm headings');
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

// ---------- /aico:reprompt under the Playbook rules ----------

const playbook = read('skills/reprompt/SKILL.md');
const playbookLines = playbook.split('\n');
const playbookFrontmatter = frontmatter(playbook);
const titleAt = playbookLines.findIndex((l) => l.startsWith('# Playbook: reprompt'));

// The Help template comes from the company-type Contract itself; the always-on form drops the Type step.
function helpTemplate(name) {
  const contract = read('docs/contracts/company-type.md');
  const at = contract.indexOf('**Help:** argument is exactly');
  assert.ok(at >= 0, 'template in the Contract');
  const line = contract.slice(at, contract.indexOf('\n', at));
  return line.replace('do the **Type:** step below first; then ', '').replaceAll('<name>', name);
}

test('reprompt Playbook: frontmatter has the guard sentence first and no hidden flag', () => {
  assert.ok(playbookFrontmatter.includes('name: reprompt'));
  assert.ok(playbookFrontmatter.includes('argument-hint: <prompt to improve>'));
  const description = playbookFrontmatter.find((l) => l.startsWith('description: '));
  assert.ok(description.slice('description: '.length).startsWith(GUARD_SENTENCE));
  assert.ok(!playbookFrontmatter.some((l) => l.startsWith('disable-model-invocation')), 'no hidden flag');
  assert.ok(!playbookFrontmatter.some((l) => l.startsWith('allowed-tools')));
  assert.ok(description.length <= 'description: '.length + 1024);
});

test('reprompt Playbook: the guard sentence is the shared one, and the other model-startable always-on Playbooks use it too', () => {
  for (const name of ['lead', 'triage', 'reprompt']) {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    const description = fm.find((l) => l.startsWith('description: '));
    assert.ok(description.slice('description: '.length).startsWith(GUARD_SENTENCE), name);
    assert.ok(!fm.some((l) => l.startsWith('disable-model-invocation')), name);
  }
});

test('reprompt Playbook: the Help line is the first body line and is the always-on template for reprompt', () => {
  assert.equal(playbookLines[titleAt + 1], '');
  assert.equal(playbookLines[titleAt + 2], helpTemplate('reprompt'));
  const triage = read('skills/triage/SKILL.md').split('\n');
  const triageTitle = triage.findIndex((l) => l.startsWith('# Playbook: triage'));
  assert.equal(triage[triageTitle + 2], helpTemplate('triage'), 'the derivation matches an existing always-on Playbook');
  assert.equal(playbook.split('\n').filter((l) => l.startsWith('**Help:**')).length, 1);
  assert.ok(!playbookLines[titleAt + 2].includes('aico:help'));
});

test('reprompt Playbook: the Help line answers from an entry that exists in commands.md', () => {
  const commands = read('documentation/commands.md');
  const start = commands.indexOf('### `/aico:reprompt`');
  assert.ok(start >= 0);
  const next = commands.indexOf('\n### ', start + 1);
  const entry = commands.slice(start, next < 0 ? undefined : next);
  assert.match(entry, /`\/aico:reprompt <prompt to improve>`/);
  assert.match(entry, /\/aico:reprompt help/);
  assert.match(entry, /\*\*Example\.\*\*/);
  assert.match(entry, /works in every company type|every company type/);
});

test('reprompt Playbook: the Trust line follows the Help line directly, before Start', () => {
  assert.equal(playbookLines[titleAt + 3], '');
  assert.ok(playbookLines[titleAt + 4].startsWith('**Trust:**'));
  assert.ok(playbook.indexOf('**Trust:**') < playbook.indexOf('## 1. Start'));
  assert.equal(playbook.split('\n').filter((l) => l.startsWith('**Trust:**')).length, 1);
});

test('reprompt Playbook: no Type line anywhere, and the type check is the resolve step before any write', () => {
  assert.doesNotMatch(playbook, /^\*\*Type:\*\*/m);
  assert.doesNotMatch(playbook, /check-playbook/);
  const start = playbook.slice(playbook.indexOf('## 1. Start'), playbook.indexOf('## 2. Dispatch'));
  const resolveAt = start.indexOf('run.mjs" company-type resolve');
  const writeAt = start.indexOf('With the Write tool create');
  assert.ok(resolveAt > 0 && writeAt > resolveAt, 'resolve comes before the first write');
  assert.match(start, /first line that starts with neither `ok: ` nor `company type: `/);
  assert.ok(start.indexOf('Argument empty after trimming') < resolveAt, 'an empty argument is answered before anything runs');
  assert.match(playbook, /run\.mjs" company-type check-role reprompter/);
});

test('reprompt Playbook: an empty argument shows the help and starts nothing', () => {
  const step = playbook.split('\n').find((l) => l.startsWith('1. Argument empty after trimming'));
  assert.ok(step);
  assert.match(step, /do what the Help line says/);
  assert.match(step, /stop: nothing dispatched, nothing written/);
});

test('reprompt Playbook: Use it and the image hand-over start the Lead with the Skill tool and name the command as fallback', () => {
  const useIt = playbookLines.find((l) => l.startsWith('- **Use it**'));
  assert.ok(useIt);
  assert.match(useIt, /start `aico:lead` with the Skill tool/);
  assert.match(useIt, /byte for byte/);
  assert.match(useIt, /tell the CEO to run `\/aico:lead`/);
  const image = playbook.slice(playbook.indexOf('## 6. Image prompt'));
  assert.match(image, /start `aico:lead` with the Skill tool for `prompt-artist`/);
  assert.match(image, /tell the CEO to run `\/aico:lead`/);
  assert.ok(playbook.indexOf("`end '<slug>' ship`") < playbook.indexOf('start `aico:lead`'), 'the run is ended before the hand-over');
});

test('reprompt Playbook: no git write, no Bash call with CEO text, within the size limit', () => {
  assert.ok(playbookLines.length <= 125, `${playbookLines.length} lines`);
  assert.match(playbook, /No git command except `git rev-parse --short HEAD`/);
  assert.match(playbook, /Never put CEO text through Bash, a dispatch line or an echo/);
  assert.match(playbook, /Shell calls take only tokens you made/);
  assert.doesNotMatch(playbook, /git (add|commit|push|stash|checkout|reset|clean)/);
});

test('reprompt Playbook: the dispatch block follows the dispatch-prompt Reprompt Step order', () => {
  const contract = read('docs/contracts/dispatch-prompt.md');
  const line = contract.split('\n').find((l) => l.startsWith('- **Reprompt Step (v3.3):**'));
  assert.ok(line, 'Reprompt Step line in the Contract');
  const afterColon = line.slice(line.indexOf('with those two lines:') + 'with those two lines:'.length, line.indexOf('No `Design skills:`'));
  const expected = [...afterColon.matchAll(/`([A-Za-z ]+:)`/g)].map((m) => m[1].slice(0, -1));
  assert.deepEqual(expected.slice(0, 3), ['Project profile', 'Company profile', 'Language']);
  const block = playbook.match(/## 2\. Dispatch[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(block, 'dispatch block');
  const keys = block[1].split('\n').filter(Boolean).map((l) => (l.startsWith('Follow aico:handoff') ? 'Follow aico:handoff.' : l.split(':')[0]));
  const optional = new Set(['Settings']);
  const want = expected.filter((k) => k !== 'Settings' || keys.includes('Settings'));
  assert.deepEqual(keys.filter((k) => k !== 'Follow aico:handoff.'), want, `${[...optional]} is the only optional line`);
  assert.equal(keys.at(-1), 'Follow aico:handoff.');
  for (const banned of ['Design skills', 'Review depth', 'Review format', 'Rule slice', 'Personality']) assert.ok(!keys.includes(banned), banned);
  assert.ok(keys.indexOf('Asks left') > keys.indexOf('Round') && keys.indexOf('Request') > keys.indexOf('Input Handoffs'));
});

test('reprompt Playbook: the Role file handles a bad Asks left and a missing Request file without guessing', () => {
  const agent = read('agents/reprompter.md');
  assert.match(agent, /`Asks left:` absent or not an integer 0-3 → treat it as `0`/);
  assert.match(agent, /`Request:` absent, or a file it names missing → `status: blocked`/);
  assert.match(agent, /blocked — missing handoff/);
  assert.ok(agent.split('\n').length <= 50);
});

test('triage line: the checker Contract lists the reason and the Role file names the triage colon rule', () => {
  const contract = read('docs/contracts/reprompt.md');
  const reasons = contract.split('\n').find((l) => l.startsWith('- Anything else → `ok: false`. Reasons:'));
  assert.ok(reasons, 'the Reasons line in the Contract');
  assert.ok(reasons.includes('`triage line`'), `triage line is among the reasons: ${reasons}`);
  assert.match(contract, /Triage line\*\*/);
  const agent = read('agents/reprompter.md');
  const never = agent.split('\n').find((l) => l.startsWith('**Never:**'));
  assert.ok(never, 'the Never line');
  assert.match(never, /the word triage followed by a colon in `prompt\.md` or the brief/);
  assert.match(never, /"triage result" or "triage step"/);
  const playbook = read('skills/reprompt/SKILL.md');
  assert.equal(playbook.split('a triage line in it never counts').length - 1, 2, 'Use it and the image hand-over both say a triage line in it never counts');
});
