import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { pluginDefaults } from './settings.mjs';
import { PERSONALITY_TEXT_RE } from './check.mjs';
import { startServer } from './settings-server.mjs';

const AGENTS = {
  architect: { model: 'opus', effort: 'high', name: 'Ava' },
  qa: { model: 'sonnet', effort: 'medium', name: 'Quinn' }
};

const PROJECT_MD = ['# Project profile', '', 'product_type: web', 'engagement: own', 'audience: the CEO', 'languages: en', 'voice: clear', '', '## Personas', '- (none)', ''].join('\n');

function sandbox(t, { company = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  if (company) {
    fs.mkdirSync(path.join(cwd, '.company'));
    fs.writeFileSync(path.join(cwd, '.company', 'project.md'), PROJECT_MD);
  }
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'company'));
  fs.mkdirSync(path.join(pluginRoot, 'skills', 'lead', 'references'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
  const names = {};
  for (const [role, a] of Object.entries(AGENTS)) {
    fs.writeFileSync(path.join(pluginRoot, 'agents', `${role}.md`), ['---', `name: ${role}`, `model: ${a.model}`, `effort: ${a.effort}`, '---', ''].join('\n'));
    names[role] = a.name;
  }
  fs.writeFileSync(path.join(pluginRoot, 'company', 'names.json'), JSON.stringify(names));
  fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor: Object.fromEntries(Object.entries(AGENTS).map(([r, a]) => [r, a.model])), protected: ['architect', 'code-reviewer', 'pentester', 'security', 'vuln-scanner'] }));
  return {
    home, cwd, pluginRoot,
    config: path.join(home, 'config.json'),
    projectFile: path.join(cwd, '.company', 'settings.json'),
    projectMd: path.join(cwd, '.company', 'project.md')
  };
}

async function start(t, s, opts = {}) {
  const server = await startServer({ home: s.home, cwd: s.cwd, pluginRoot: s.pluginRoot, open: false, log: () => {}, ...opts });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const api = (p, init = {}) => fetch(`${origin}${p}`, { ...init, headers: { 'X-Aico-Token': server.token, ...init.headers } });
  const post = (p, body, headers = {}) => api(p, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }
  });
  const state = async () => (await api('/api/state')).json();
  return { server, origin, api, post, state };
}

// A raw request, for headers fetch will not let us set (Host) or bodies sent in chunks.
function raw(port, { method = 'GET', path: p = '/', headers = {}, chunks = [] }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    for (const c of chunks) req.write(c);
    req.end();
  });
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

test('startServer binds 127.0.0.1 and returns a hex token and its URL', async (t) => {
  const { server } = await start(t, sandbox(t));
  assert.match(server.token, /^[0-9a-f]{64}$/);
  assert.equal(server.url, `http://127.0.0.1:${server.port}/?token=${server.token}`);
});

test('403 without token', async (t) => {
  const { server, origin } = await start(t, sandbox(t));
  for (const p of ['/', '/api/state']) assert.equal((await fetch(`${origin}${p}`)).status, 403, p);
  const wrong = server.token.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  for (const token of [wrong, 'short', `${server.token}0`]) {
    assert.equal((await fetch(`${origin}/api/state?token=${token}`)).status, 403);
    assert.equal((await fetch(`${origin}/api/state`, { headers: { 'X-Aico-Token': token } })).status, 403);
  }
  const done = await fetch(`${origin}/api/done`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(done.status, 403);
  assert.equal((await fetch(`${origin}/api/state?token=${server.token}`)).status, 200);
});

test('403 for a bad Host header', async (t) => {
  const { server } = await start(t, sandbox(t));
  const p = `/api/state?token=${server.token}`;
  assert.equal(await raw(server.port, { path: p, headers: { Host: `evil.example:${server.port}` } }), 403);
  assert.equal(await raw(server.port, { path: p, headers: { Host: '127.0.0.1:1' } }), 403);
  assert.equal(await raw(server.port, { path: p, headers: { Host: `localhost:${server.port}` } }), 200);
});

test('403 for a POST with foreign Origin', async (t) => {
  const { post, state } = await start(t, sandbox(t));
  const { resolved } = await state();
  const res = await post('/api/save', { revision: resolved.revision, user: { version: 1 } }, { Origin: 'http://evil.example' });
  assert.equal(res.status, 403);
  assert.equal((await post('/api/done', {}, { Origin: 'http://evil.example' })).status, 403);
});

test('403 for a POST without Origin', async (t) => {
  const s = sandbox(t);
  const { server, state } = await start(t, s);
  const { resolved } = await state();
  const body = JSON.stringify({ revision: resolved.revision, user: { version: 1, gates: { plan: 'auto' } } });
  const status = await raw(server.port, {
    method: 'POST', path: '/api/save',
    headers: { 'X-Aico-Token': server.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    chunks: [body]
  });
  assert.equal(status, 403);
  assert.equal(read(s.config), null);
});

test('415 for a POST that is not application/json', async (t) => {
  const { post, state } = await start(t, sandbox(t));
  const { resolved } = await state();
  const body = JSON.stringify({ revision: resolved.revision, user: { version: 1 } });
  assert.equal((await post('/api/save', body, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/save', body, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post('/api/save', body, { 'Content-Type': 'application/json; charset=utf-8' })).status, 200);
});

test('413 for a body over 65536 bytes', async (t) => {
  const { server, origin, post } = await start(t, sandbox(t));
  const big = JSON.stringify({ pad: 'x'.repeat(65536) });
  assert.equal((await post('/api/save', big)).status, 413);
  // Without a Content-Length the running byte count still stops it.
  const status = await raw(server.port, {
    method: 'POST', path: '/api/save',
    headers: { 'X-Aico-Token': server.token, 'Content-Type': 'application/json', Origin: origin, 'Transfer-Encoding': 'chunked' },
    chunks: ['{"pad":"', 'x'.repeat(40000), 'x'.repeat(40000), '"}']
  });
  assert.equal(status, 413);
  assert.equal((await post('/api/save', '{')).status, 400, 'server still answers');
});

test("GET / injects the token and has no http(s) URL except the server's own", async (t) => {
  const { server, api } = await start(t, sandbox(t));
  const res = await api('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const html = await res.text();
  assert.ok(html.includes(`<meta name="aico-token" content="${server.token}">`));
  assert.ok(!html.includes('__AICO_TOKEN__'));
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(html));
  assert.equal((await api('/elsewhere')).status, 404);
});

test('GET /api/state returns plugin defaults, raw layers, resolved, stored language and hasProject', async (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { model: 'haiku' } } } }));
  const { state } = await start(t, s);
  const st = await state();
  assert.deepEqual(Object.keys(st).sort(), ['hasProject', 'language', 'personalities', 'plugin', 'project', 'resolved', 'user']);
  assert.equal(st.plugin.roles.qa.model, 'sonnet');
  assert.deepEqual(st.user, { version: 1, roles: { qa: { model: 'haiku' } } });
  assert.deepEqual(st.project, { version: 1 });
  assert.equal(st.resolved.roles.qa.model, 'haiku');
  assert.deepEqual(st.language, { user: null, project: null });
  assert.equal(st.hasProject, true);
});

test('save writes user and project layers and returns new state', async (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ other: 1 }));
  const { post, state } = await start(t, s);
  const before = await state();
  const res = await post('/api/save', {
    revision: before.resolved.revision,
    user: { version: 1, roles: { qa: { model: 'haiku', name: 'Ava' } }, unlocked: ['ship'] },
    project: { version: 1, roles: { architect: { name: 'Bo' } }, gates: { ship: 'auto' } },
    profile: { audience: 'developers' },
    language: { user: 'nl', project: 'de' }
  });
  assert.equal(res.status, 200);
  const { state: after } = await res.json();
  assert.notEqual(after.resolved.revision, before.resolved.revision);
  assert.equal(after.resolved.roles.qa.model, 'haiku');
  assert.equal(after.resolved.roles.qa.name, 'Ava');
  assert.equal(after.resolved.roles.architect.name, 'Bo');
  assert.equal(after.resolved.gates.ship, 'auto');
  assert.equal(after.resolved.profile.fields.audience, 'developers');
  assert.deepEqual(after.resolved.language, { tag: 'de', source: 'project' });
  assert.deepEqual(after.language, { user: 'nl', project: 'de' }, 'the user value stays visible while the project wins');
  const config = JSON.parse(read(s.config));
  assert.equal(config.other, 1);
  assert.equal(config.aico_language, 'nl');
  assert.deepEqual(config.aico_settings.unlocked, ['ship']);
  assert.deepEqual(JSON.parse(read(s.projectFile)).aico_settings.gates, { ship: 'auto' });

  // A save that leaves a part out keeps it; null clears a language.
  const res2 = await post('/api/save', { revision: after.resolved.revision, language: { project: null } });
  assert.equal(res2.status, 200);
  const { state: again } = await res2.json();
  assert.deepEqual(again.resolved.language, { tag: 'nl', source: 'user' });
  assert.deepEqual(again.language, { user: 'nl', project: null });
  assert.equal(again.resolved.roles.qa.model, 'haiku');
  assert.ok(!read(s.projectMd).includes('aico_language'));
});

test('save refuses invalid and writes nothing', async (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ aico_language: 'en' }));
  const { post, state } = await start(t, s);
  const { resolved } = await state();
  const snapshot = () => [read(s.config), read(s.projectFile), read(s.projectMd)];
  const files = snapshot();
  const res = await post('/api/save', {
    revision: resolved.revision,
    user: { version: 1, roles: { qa: { model: 'gpt' } } },
    project: { version: 1, gates: { plan: 'maybe' } },
    profile: { voice: 'shouty' },
    language: { user: 'zz-not-a-tag-at-all', project: 'nl' }
  });
  assert.equal(res.status, 400);
  const { refused } = await res.json();
  assert.ok(Array.isArray(refused));
  assert.ok(refused.length >= 4, refused.join(' | '));
  for (const part of [/qa\.model/, /gates\.plan/, /voice/, /language/]) assert.ok(refused.some((r) => part.test(r)), String(part));
  assert.deepEqual(snapshot(), files);

  // Valid parts alone, but names clash across the two layers.
  const clash = await post('/api/save', {
    revision: resolved.revision,
    user: { version: 1, roles: { qa: { name: 'Max' } } },
    project: { version: 1, roles: { architect: { name: 'max' } } }
  });
  assert.equal(clash.status, 400);
  assert.deepEqual(snapshot(), files);

  for (const bad of ['{', '[]', '"x"', JSON.stringify({ revision: resolved.revision, extra: 1 }), JSON.stringify({ user: { version: 1 } }),
    JSON.stringify({ revision: resolved.revision, language: { user: 5 } }), JSON.stringify({ revision: resolved.revision, language: 'nl' })]) {
    const r = await post('/api/save', bad);
    assert.equal(r.status, 400, bad);
    assert.ok(Array.isArray((await r.json()).refused), bad);
  }
  assert.deepEqual(snapshot(), files);
});

test('stale revision → 409', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const stale = (await state()).resolved.revision;
  const first = await post('/api/save', { revision: stale, user: { version: 1, roles: { qa: { effort: 'low' } } } });
  assert.equal(first.status, 200);
  const files = read(s.config);
  const second = await post('/api/save', { revision: stale, user: { version: 1, roles: { qa: { effort: 'max' } } } });
  assert.equal(second.status, 409);
  const { state: current } = await second.json();
  assert.equal(current.resolved.roles.qa.effort, 'low');
  assert.notEqual(current.resolved.revision, stale);
  assert.equal(read(s.config), files);
});

test('stale revision → 409 when project.md changed between load and save', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const stale = (await state()).resolved.revision;
  const first = await post('/api/save', { revision: stale, profile: { audience: 'tab B' } });
  assert.equal(first.status, 200);
  const md = read(s.projectMd);
  const second = await post('/api/save', { revision: stale, profile: { audience: 'tab A' } });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).state.resolved.profile.fields.audience, 'tab B');
  assert.equal(read(s.projectMd), md);
  // An edit to project.md made outside the page also counts.
  const fresh = (await state()).resolved.revision;
  fs.writeFileSync(s.projectMd, md.replace('voice: clear', 'voice: bold'));
  assert.equal((await post('/api/save', { revision: fresh, language: { project: 'nl' } })).status, 409);
});

test('no .company → project save refused, user save works, hasProject false', async (t) => {
  const s = sandbox(t, { company: false });
  const { post, state } = await start(t, s);
  const st = await state();
  assert.equal(st.hasProject, false);
  assert.equal(st.resolved.profile.hasProject, false);
  const revision = st.resolved.revision;
  for (const body of [
    { revision, project: { version: 1, gates: { plan: 'auto' } } },
    { revision, profile: { audience: 'x' } },
    { revision, language: { project: 'nl' } },
    { revision, user: { version: 1, gates: { plan: 'auto' } }, project: { version: 1 } }
  ]) {
    const res = await post('/api/save', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).refused.some((r) => /\.company/.test(r)));
  }
  assert.equal(read(s.config), null);
  assert.ok(!fs.existsSync(path.join(s.cwd, '.company')));
  const ok = await post('/api/save', { revision, user: { version: 1, gates: { plan: 'auto' } }, language: { user: 'fr' } });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.equal(after.resolved.gates.plan, 'auto');
  assert.equal(after.hasProject, false);
  assert.equal(JSON.parse(read(s.config)).aico_language, 'fr');
});

test('done closes the server', async (t) => {
  const { server, origin, post } = await start(t, sandbox(t));
  const res = await post('/api/done', {});
  assert.equal(res.status, 200);
  await server.closed;
  await assert.rejects(fetch(`${origin}/api/state?token=${server.token}`));
});

test('idle timeout closes the server', async (t) => {
  const { server, origin } = await start(t, sandbox(t), { idleMs: 50 });
  await server.closed;
  await assert.rejects(fetch(`${origin}/api/state?token=${server.token}`));
});

test('startServer prints the URL', async (t) => {
  const lines = [];
  const { server } = await start(t, sandbox(t), { log: (line) => lines.push(line) });
  assert.deepEqual(lines, [`aico settings: ${server.url}`]);
});

test('page has the seven tabs, a lock dialog, and no external resources', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const tab of ['Roles', 'Personality', 'Language &amp; profile', 'Pipeline', 'Gates', 'Skill scan', 'Mods']) assert.ok(html.includes(`>${tab}<`), `tab ${tab}`);
  assert.ok(html.includes('<dialog'));
  assert.ok(html.includes('<meta name="aico-token" content="__AICO_TOKEN__">'));
  assert.ok(!/<script[^>]*\ssrc=/i.test(html));
  assert.ok(!/<link[^>]*rel="?stylesheet/i.test(html));
  assert.ok(!html.includes('@import'));
});

test('save round-trips context_cap and brainstorm keys, refuses bad ones and writes nothing', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.equal(before.plugin.pipeline.context_cap, 150000);
  assert.deepEqual(before.plugin.brainstorm, { film_script: false, debate: 'crossfire' });
  assert.deepEqual(before.resolved.brainstorm, { film_script: false, debate: 'crossfire' });
  const bad = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, brainstorm: { debate: 'duel' }, pipeline: { context_cap: 10 } } });
  assert.equal(bad.status, 400);
  const { refused } = await bad.json();
  assert.ok(refused.some((r) => r.includes('brainstorm.debate must be crossfire or full_pass')), refused.join(' | '));
  assert.ok(refused.some((r) => r.includes('context_cap must be a whole number from 60000 to 1000000')), refused.join(' | '));
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', {
    revision: before.resolved.revision,
    user: { version: 1, brainstorm: { film_script: true }, pipeline: { context_cap: 120000 } },
    project: { version: 1, brainstorm: { debate: 'full_pass' }, roles: { qa: { context_cap: 80000 } } }
  });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.deepEqual(after.resolved.brainstorm, { film_script: true, debate: 'full_pass' });
  assert.equal(after.resolved.roles.qa.context_cap, 80000);
  assert.equal(after.resolved.roles.architect.context_cap, 120000);
});

test('page has the cap, film-script and debate rows built from the existing controls', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["['pipeline', 'context_cap']", "['brainstorm', 'film_script']", "['brainstorm', 'debate']", "'crossfire'", "'full_pass'", "'context_cap'"]) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(!html.includes('type="range"') && !/<script[^>]*\ssrc=/i.test(html));
});

test('state carries reprompt defaults; save round-trips question_rounds, refuses bad values and writes nothing', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.deepEqual(before.plugin.reprompt, { question_rounds: 1 });
  assert.deepEqual(before.resolved.reprompt, { question_rounds: 1 });
  for (const bad of [4, -1, 1.5, '2']) {
    const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, reprompt: { question_rounds: bad } } });
    assert.equal(res.status, 400);
    const { refused } = await res.json();
    assert.ok(refused.some((r) => r.includes('reprompt.question_rounds must be a whole number from 0 to 3')), refused.join(' | '));
  }
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, reprompt: { question_rounds: 0 } }, project: { version: 1, reprompt: { question_rounds: 3 } } });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.deepEqual(after.resolved.reprompt, { question_rounds: 3 });
});

test('page has a Reprompt table with a Question rounds row, 0 to 3, hint tied to the field', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["'Reprompt'", "'Question rounds'", "['reprompt', 'question_rounds']", 'selectFor([0, 1, 2, 3], l)', "describedBy: 'reprompt-hint'", "id: 'reprompt-hint'", 'state.plugin.reprompt']) {
    assert.ok(html.includes(needle), needle);
  }
});

test('Reprompt hint equals the Contract text byte for byte and sits between the context-cap hint and Brainstorm', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = /the hint "(How often \/aico:reprompt[^"]*)"/.exec(contract);
  assert.ok(m, 'Contract hint not found');
  const hintCall = `el('p', { class: 'hint', id: 'reprompt-hint' }, '${m[1]}')`;
  assert.equal(html.split(hintCall).length - 1, 1, 'hint must match the Contract exactly, once');
  const cap = html.indexOf('The context cap is a whole number from 60000 to 1000000.');
  const h2 = html.indexOf("el('h2', {}, 'Reprompt')");
  const hint = html.indexOf(hintCall);
  const brainstorm = html.indexOf("el('h2', {}, 'Brainstorm')");
  assert.ok(cap > 0 && cap < h2 && h2 < hint && hint < brainstorm, `order ${cap} ${h2} ${hint} ${brainstorm}`);
});

test('page has a Review format row built like the Dispatch row, with the Contract sentence', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["'Review format'", "['pipeline', 'review_format']", "['plain', 'pilot']",
    'Pilot: the Code Reviewer and the compliance pass write a top block, finding rows and a findings ledger. Costs about 10% more tokens per review (T15d).']) {
    assert.ok(html.includes(needle), needle);
  }
});

test('save round-trips mods, refuses keep_warm and bad values with nothing written, and reports lock ignores', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.equal(before.plugin.mods.blast_radius.security, 'ask');
  assert.equal(before.resolved.mods.cache_tax.pane, 'command');
  const bad = await post('/api/save', {
    revision: before.resolved.revision,
    user: { version: 1, mods: { cache_tax: { keep_warm: true }, reflect: { mode: 'free' }, savvy: { pane: '__proto__' } } }
  });
  assert.equal(bad.status, 400);
  const { refused } = await bad.json();
  assert.ok(refused.some((r) => r.includes('mods.cache_tax.keep_warm: unknown key')), refused.join(' | '));
  assert.ok(refused.some((r) => r.includes('mods.reflect.mode must be deterministic or model')), refused.join(' | '));
  assert.ok(refused.some((r) => r.includes('mods.savvy.pane must be auto or command')), refused.join(' | '));
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', {
    revision: before.resolved.revision,
    user: { version: 1, mods: { savvy: { enabled: false, pane: 'command' }, blast_radius: { security: 'warn' } } },
    project: { version: 1, mods: { reflect: { mode: 'model' }, blast_radius: { core: 'warn' } } }
  });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.deepEqual(after.resolved.mods.savvy, { enabled: false, pane: 'command' });
  assert.equal(after.resolved.mods.blast_radius.security, 'ask');
  assert.equal(after.resolved.mods.blast_radius.core, 'ask');
  assert.equal(after.resolved.mods.reflect.mode, 'deterministic');
  for (const key of ['mods.blast_radius.security', 'mods.blast_radius.core', 'mods.reflect.mode']) {
    assert.ok(after.resolved.ignored.some((i) => i.startsWith(key)), key);
  }
});

test('page has a Mods section built from the existing controls, shows lock reasons, and never uses innerHTML', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ['id="tab-mods"', 'id="panel-mods"', 'function renderMods', "['mods', mod, 'enabled']", "['mods', 'reflect', 'mode']",
    "['mods', 'blast_radius', 'security']", "['mods', 'blast_radius', 'enabled']", "'step_check'", "'retrospective'", 'pipelineRow(', 'selectFor(']) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(!html.includes('keep_warm') && !html.includes('keep-warm'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
  assert.ok(/mods:\s*renderMods/.test(html) && /TAB_NAMES = \[[^\]]*'mods'\]/.test(html));
});

const pageHtml = () => fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const contractText = () => fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');

test('the Skill scan tab sits between Gates and Mods and holds the Scan mode row', () => {
  const html = pageHtml();
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('id="tab-gates"') < at('id="tab-scan"') && at('id="tab-scan"') < at('id="tab-mods"'));
  assert.ok(at('id="panel-gates"') < at('id="panel-scan"') && at('id="panel-scan"') < at('id="panel-mods"'));
  assert.ok(/scan:\s*renderScan/.test(html) && /TAB_NAMES = \['roles', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'\]/.test(html));
  const mods = html.slice(at('function renderMods'), at('const SCAN_NOTE'));
  assert.ok(!mods.includes('skillspector') && !mods.includes('SkillSpector'));
  const scan = html.slice(at('const SCAN_NOTE'), at('// ---------- page'));
  for (const needle of ["'SkillSpector'", "'Scan mode'", "['skillspector', 'mode']", 'aria-describedby']) assert.ok(scan.includes(needle), needle);
});

test('the Skill scan sentence is the Contract sentence byte for byte', () => {
  const line = contractText().split('\n').find((l) => l.startsWith('v1.2: the page has a **Skill scan** tab'));
  const sentence = /the sentence "([^"]+)"/.exec(line)?.[1];
  assert.ok(sentence && sentence.startsWith("No-LLM: SkillSpector's static rules"));
  assert.ok(pageHtml().includes(sentence));
  assert.ok(pageHtml().includes("id: 'scan-note'"));
});

test('the Project column offers claude_cli only when the project file already holds it, locked', () => {
  const html = pageHtml();
  const scan = html.slice(html.indexOf('const SCAN_NOTE'), html.indexOf('// ---------- page'));
  assert.ok(scan.includes("'no-llm'") && scan.includes("'claude_cli'"));
  assert.ok(/state\.project\.skillspector\?\.mode === 'claude_cli'/.test(scan));
  assert.ok(html.includes("area === 'skillspector'") && html.includes('counts only from your user settings'));
});

test('a focused control never sits under the footer, and the footer lets go on small screens', () => {
  const html = pageHtml();
  assert.ok(/scroll-padding-bottom:\s*calc\(var\(--footer-h[^)]*\)\s*\+\s*8px\)/.test(html));
  assert.ok(html.includes('new ResizeObserver') && html.includes("'--footer-h'"));
  assert.ok(/@media \(max-width: 600px\), \(max-height: 500px\) \{[^@]*footer \{[^}]*position: static/.test(html));
});

test('select and text-input borders have 3:1 contrast in light and dark', () => {
  const html = pageHtml();
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const light = html.slice(html.indexOf(':root {'), html.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'), html.indexOf('* { box-sizing'));
  for (const [scheme, css] of [['light', light], ['dark', dark]]) {
    const token = (name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
    for (const ground of ['surface', 'bg']) assert.ok(ratio(token('control-border'), token(ground)) >= 3, `${scheme} on ${ground}`);
  }
  assert.ok(/select, input\[type="text"\] \{[^}]*border: 1px solid var\(--control-border\)/.test(html));
});

test('the In effect text is a polite live region', () => {
  assert.ok(pageHtml().includes("'aria-live': 'polite'"));
});

test('the mods tabpanel has a space before aria-labelledby', () => {
  assert.ok(pageHtml().includes('id="panel-mods" aria-labelledby="tab-mods"'));
});

// ---- personality section (aico-settings v1.3) ----

const PHRASES = (() => {
  const text = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'role-names.md'), 'utf8');
  const out = { intelligence: {}, creativity: {} };
  for (const m of text.matchAll(/^\| `(low|medium|high)` \| ([^|]+) \| ([^|]+) \|$/gm)) {
    out.intelligence[m[1]] = m[2].trim();
    out.creativity[m[1]] = m[3].trim();
  }
  return out;
})();

test('the state payload carries the personality rule, phrases, per-level values and ignored entries', async (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.pluginRoot, 'company', 'personalities.json'), JSON.stringify({
    architect: { temperament: 'calm', talk: 'dry', topic: 'tea', intelligence: 'high', creativity: 'low' },
    qa: { temperament: 'blunt', talk: 'short', topic: 'bugs', intelligence: 'medium', creativity: 'medium' }
  }));
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { personality: { talk: 'user talk', creativity: 'high' } } } } }));
  fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { personality: { topic: 'a:b' } } } } }));
  const { state } = await start(t, s);
  const p = (await state()).personalities;
  assert.deepEqual(Object.keys(p).sort(), ['ignored', 'roles', 'rule']);
  assert.equal(p.rule.max, 80);
  assert.deepEqual(p.rule.levels, ['low', 'medium', 'high']);
  assert.ok(new RegExp(p.rule.text_re, p.rule.flags).test('calm and dry'));
  assert.deepEqual(p.rule.phrases, PHRASES);
  assert.equal(p.roles.qa.plugin.talk, 'short');
  assert.deepEqual(p.roles.qa.user, { talk: 'user talk', creativity: 'high' });
  assert.deepEqual(p.roles.qa.project, {});
  assert.deepEqual(p.roles.qa.effective.talk, { value: 'user talk', source: 'user' });
  assert.deepEqual(p.roles.qa.effective.topic, { value: 'bugs', source: 'plugin' });
  assert.deepEqual(p.ignored.map((e) => [e.level, e.path]), [['project', 'roles.qa.personality.topic']]);
  assert.ok(!JSON.stringify(p).includes('a:b'), 'a stored bad value is never in the payload');
});

test('the Save refusal for a bad personality value is path-first with the level word and no value', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const revision = (await state()).resolved.revision;
  const res = await post('/api/save', { revision, user: { version: 1, roles: { qa: { personality: { talk: 'say "hi"' } } } } });
  assert.equal(res.status, 400);
  const { refused } = await res.json();
  assert.deepEqual(refused, ["user roles.qa.personality.talk: must be one line of letters, digits, single spaces and , . ' - ! ?; each word starts with a letter or digit"]);
  assert.equal(read(s.config), null);
});

test('a fresh install shows no ignored notice, and saving an unrelated user change adds no skillspector to the project', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.deepEqual(before.resolved.ignored, []);
  assert.deepEqual(before.project, { version: 1 });
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { model: 'haiku' } } } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).state.resolved.ignored, []);
  assert.equal(read(s.projectFile), null);
});

// A small DOM, enough to run the page script and drive its controls.
class FakeText {
  constructor(text) { this.textContent = text; this.parentNode = null; }
}
class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDoc = doc;
    this.children = [];
    this.attrs = new Map();
    this.listeners = {};
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.own = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.id = '';
    this.className = '';
    this.selected = '';
    const self = this;
    this.classList = {
      toggle(name, on) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        if (on === undefined ? !set.has(name) : on) set.add(name); else set.delete(name);
        self.className = [...set].join(' ');
      },
      contains: (name) => self.className.split(/\s+/).includes(name)
    };
    if (tag === 'option') {
      let optionValue = '';
      Object.defineProperty(this, 'value', { get: () => optionValue, set: (v) => { optionValue = String(v); } });
    }
  }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? new FakeText(k) : k; n.parentNode = this; this.children.push(n); } }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  async fire(type) { for (const fn of this.listeners[type] ?? []) await fn({ type, key: '', preventDefault() {} }); }
  focus() { this.ownerDoc.activeElement = this; }
  getBoundingClientRect() { return { height: 0 }; }
  get textContent() { return this.children.map((c) => c.textContent).join('') + this.own; }
  set textContent(v) { this.children = []; this.own = String(v); }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get value() { return this.selected; }
  set value(v) {
    v = String(v);
    if (this.tagName !== 'SELECT') { this.selected = v; return; }
    this.selected = this.options.some((o) => o.value === v) ? v : (this.options[0]?.value ?? '');
  }
  set tabIndex(v) { this.attrs.set('tabindex', String(v)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function loadPage(initialState, { saveReply } = {}) {
  const ids = {};
  const doc = { activeElement: null };
  const make = (tag, props = {}) => {
    const n = new FakeNode(tag, doc);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    return n;
  };
  doc.documentElement = make('html');
  for (const id of ['notices', 'status', 'count', 'clear-user', 'clear-project', 'save', 'done', 'unlock', 'unlock-title', 'unlock-text', 'unlock-cancel', 'unlock-ok']) ids[id] = make('div', { id });
  ids.save.disabled = true;
  const names = ['roles', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'];
  const tabs = names.map((name) => {
    ids[`panel-${name}`] = make('section', { id: `panel-${name}`, role: 'tabpanel' });
    ids[`tab-${name}`] = make('button', { role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}` });
    return ids[`tab-${name}`];
  });
  const footer = make('footer');
  const main = make('main');
  const calls = [];
  Object.assign(doc, {
    createElement: (tag) => make(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => ids[id] ?? names.map((n) => walk(ids[`panel-${n}`], (x) => x.id === id)).find(Boolean) ?? walk(ids.status, (x) => x.id === id),
    querySelector: (sel) => (sel === 'meta[name="aico-token"]' ? { content: 'tok' } : sel === 'main' ? main : sel === 'footer' ? footer : null),
    querySelectorAll: (sel) => (sel === '[role="tab"]' ? tabs : [])
  });
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/save') {
      const reply = saveReply ?? { status: 200, body: { state: initialState } };
      return { status: reply.status, json: async () => structuredClone(reply.body) };
    }
    return { status: 200, json: async () => structuredClone(initialState) };
  };
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const NodeLike = class { static [Symbol.hasInstance](v) { return v instanceof FakeNode || v instanceof FakeText; } };
  const context = vm.createContext({ document: doc, window: { addEventListener() {}, confirm: () => true }, fetch: fakeFetch, Node: NodeLike });
  vm.runInContext(script, context);
  const panels = names.map((n) => ids[`panel-${n}`]);
  return {
    document: doc, ids, calls,
    find: (pred) => panels.map((p) => walk(p, pred)).find(Boolean) ?? null,
    all: (pred) => walkAll(ids['panel-personality'], pred),
    allRoles: (pred) => walkAll(ids['panel-roles'], pred)
  };
}
function walk(node, pred) {
  for (const c of node.children ?? []) {
    if (pred(c)) return c;
    const r = walk(c, pred);
    if (r) return r;
  }
  return null;
}
function walkAll(node, pred, out = []) {
  for (const c of node.children ?? []) { if (pred(c)) out.push(c); walkAll(c, pred, out); }
  return out;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const closest = (node, tag) => { let n = node; while (n && n.tagName !== tag) n = n.parentNode; return n; };

function pageState(overrides = {}) {
  const roles = ['architect', 'qa'];
  const defaults = pluginDefaults();
  const plugin = { ...defaults, roles: Object.fromEntries(roles.map((r) => [r, { name: r, model: 'sonnet', effort: 'medium' }])) };
  return {
    plugin, user: { version: 1 }, project: { version: 1 }, hasProject: true,
    language: { user: null, project: null },
    resolved: {
      revision: 'r1', roles: Object.fromEntries(roles.map((r) => [r, { name: r, model: 'sonnet', effort: 'medium', context_cap: 150000, source: {} }])),
      ignored: [], warnings: [], language: { tag: 'en', source: 'default' }, profile: { hasProject: true, fields: {}, options: {} }
    },
    personalities: {
      rule: { text_re: PERSONALITY_TEXT_RE.source, flags: PERSONALITY_TEXT_RE.flags, max: 80, levels: ['low', 'medium', 'high'], phrases: PHRASES },
      roles: Object.fromEntries(roles.map((r) => [r, { plugin: { temperament: 'calm', talk: 'dry', topic: 'tea', intelligence: 'medium', creativity: 'low' }, user: {}, project: {}, effective: {} }])),
      ignored: []
    },
    ...overrides
  };
}
const field = (page, role, level, key) => page.find((n) => n.id === `pf-${role}-${level}-${key}`);
const byId = (page, id) => page.find((n) => n.id === id);
const type = async (node, text) => { node.value = text; await node.fire('input'); };

test('the page builds one labelled personality card per Role, with the counter and level choices from the payload', async () => {
  const page = loadPage(pageState());
  await settle();
  assert.equal(page.all((n) => n.tagName === 'DETAILS').length, 2);
  for (const [key, label] of [['temperament', 'Temperament'], ['talk', 'Way of talking'], ['topic', 'Pet topic'], ['intelligence', 'Intelligence'], ['creativity', 'Creativity']]) {
    const control = field(page, 'qa', 'user', key);
    assert.ok(control, key);
    assert.equal(page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id).textContent, label);
  }
  assert.deepEqual(field(page, 'qa', 'user', 'intelligence').options.map((o) => o.textContent), ['Not set', 'Low', 'Medium', 'High']);
  assert.equal(byId(page, 'pf-qa-user-talk-count').textContent, '0 of 80 characters');
  assert.ok(field(page, 'qa', 'user', 'talk').getAttribute('aria-describedby').includes('pf-qa-user-talk-count'));
});

test('under each level select the page shows the payload phrase, and no phrase is copied into the page', async () => {
  const page = loadPage(pageState());
  await settle();
  const select = field(page, 'qa', 'user', 'creativity');
  const hint = byId(page, 'pf-qa-user-creativity-hint');
  assert.equal(hint.textContent, 'Not set at this level. The level below decides.');
  for (const level of ['low', 'medium', 'high']) {
    select.value = level;
    await select.fire('change');
    assert.equal(hint.textContent, `The Role is told: ${PHRASES.creativity[level]}`);
    assert.ok(select.getAttribute('aria-describedby').includes(hint.id));
  }
  const html = pageHtml();
  for (const group of Object.values(PHRASES)) for (const phrase of Object.values(group)) assert.ok(!html.includes(phrase), phrase);
});

test('without phrases in the payload the page shows no phrase line and nothing else changes', async () => {
  const st = pageState();
  delete st.personalities.rule.phrases;
  const page = loadPage(st);
  await settle();
  const select = field(page, 'qa', 'user', 'creativity');
  select.value = 'high';
  await select.fire('change');
  assert.equal(byId(page, 'pf-qa-user-creativity-hint').hidden, true);
  assert.equal(page.ids.count.textContent, '1 unsaved change');
});

test('a too long value gets an error text tied to the field, counted in code points, on blur', async () => {
  const page = loadPage(pageState());
  await settle();
  const talk = field(page, 'qa', 'user', 'talk');
  await type(talk, '\u{10400}'.repeat(80));
  await talk.fire('change');
  assert.equal(talk.getAttribute('aria-invalid'), null);
  assert.equal(byId(page, 'pf-qa-user-talk-count').textContent, '80 of 80 characters');
  await type(talk, 'a'.repeat(96));
  await talk.fire('change');
  assert.equal(talk.getAttribute('aria-invalid'), 'true');
  const err = byId(page, 'pf-qa-user-talk-err');
  assert.equal(err.textContent, 'Error: Way of talking is 96 characters. The limit is 80. Remove 16.');
  assert.ok(talk.getAttribute('aria-describedby').split(' ').includes(err.id));
  await type(talk, 'fine');
  assert.equal(talk.getAttribute('aria-invalid'), null);
});

test('the error names the first bad character in words, and the value is trimmed before it counts', async () => {
  const page = loadPage(pageState());
  await settle();
  const topic = field(page, 'qa', 'project', 'topic');
  for (const [text, words] of [['a:b', 'a colon'], ['say "hi"', 'a double quote'], ['a\tb', 'a tab'], ['x<y', 'the character <'], ['a  b', null]]) {
    await type(topic, text);
    await topic.fire('change');
    const err = byId(page, 'pf-qa-project-topic-err').textContent;
    if (words) assert.ok(err.includes(`can't contain ${words}`), err); else assert.equal(err, 'Error: Pet topic has two spaces in a row. Use one.');
  }
  await type(topic, '  tea  ');
  await topic.fire('change');
  assert.equal(topic.getAttribute('aria-invalid'), null);
  assert.equal(page.ids.count.textContent, '1 unsaved change');
});

test('a hyphen is allowed inside a word, and a word that starts with punctuation gets the word-start text', async () => {
  const page = loadPage(pageState());
  await settle();
  const topic = field(page, 'qa', 'project', 'topic');
  const errOf = async (text) => {
    await type(topic, text);
    await topic.fire('change');
    return byId(page, 'pf-qa-project-topic-err').textContent;
  };
  const start = (c) => `Error: Pet topic has a word that starts with the character ${c}. Each word must start with a letter or digit.`;
  assert.equal(await errOf('-calm'), start('-'));
  assert.equal(await errOf('Hi ,there'), start(','));
  assert.equal(await errOf('calm -ish'), start('-'));
  assert.ok(!(await errOf('calm -ish')).includes("can't contain"));
  assert.equal(await errOf('x-ray, well-known'), '');
  assert.equal(topic.getAttribute('aria-invalid'), null);
});

test('an invisible or lookalike character is named by kind with its code point', async () => {
  const page = loadPage(pageState());
  await settle();
  const topic = field(page, 'qa', 'project', 'topic');
  const errOf = async (text) => {
    await type(topic, text);
    await topic.fire('change');
    return byId(page, 'pf-qa-project-topic-err').textContent;
  };
  assert.ok((await errOf('tea️')).includes("can't contain an invisible character (U+FE0F)."), 'variation selector');
  assert.ok((await errOf('a​b')).includes('an invisible character (U+200B)'), 'zero width space');
  assert.ok((await errOf('a b')).includes('an invisible character (U+00A0)'), 'no-break space');
  assert.ok((await errOf('a˸b')).includes('a lookalike of a punctuation mark (U+02F8)'), 'modifier colon');
});

test('the cap and name inputs never cut input off; an over-long or out-of-range entry gets a field-linked error', async () => {
  const html = pageHtml();
  assert.ok(!/maxLength: (7|30)\b/.test(html));
  const page = loadPage(pageState());
  await settle();
  const cap = page.allRoles((n) => n.tagName === 'INPUT' && n.id === 'rf-qa-user-cap')[0];
  const name = page.allRoles((n) => n.tagName === 'INPUT' && n.id === 'rf-qa-user-name')[0];
  assert.equal(cap.maxLength, undefined);
  assert.equal(name.maxLength, undefined);
  await type(cap, '10000000');
  assert.equal(cap.value, '10000000', 'the typed value is kept whole');
  assert.equal(cap.getAttribute('aria-invalid'), 'true');
  const capErr = page.allRoles((n) => n.id === cap.getAttribute('aria-describedby'))[0];
  assert.equal(capErr.textContent, 'Error: Cap is out of range. Use a whole number from 60000 to 1000000.');
  await type(cap, 'abc');
  assert.equal(capErr.textContent, 'Error: Cap must be a whole number from 60000 to 1000000.');
  await type(cap, '120000');
  assert.equal(cap.getAttribute('aria-invalid'), null);
  assert.equal(cap.getAttribute('aria-describedby'), null);
  await type(name, 'n'.repeat(35));
  assert.equal(name.value.length, 35);
  assert.equal(page.allRoles((n) => n.id === name.getAttribute('aria-describedby'))[0].textContent, 'Error: Name is 35 characters. The limit is 30. Remove 5.');
  await type(name, 'Quinn');
  assert.equal(name.getAttribute('aria-invalid'), null);
});

test('a Save with a bad value sends nothing, marks the field and puts the error summary in the status', async () => {
  const page = loadPage(pageState());
  await settle();
  const talk = field(page, 'architect', 'user', 'talk');
  await type(talk, 'bad: value');
  await page.ids.save.fire('click');
  assert.equal(page.calls.filter((c) => c.url === '/api/save').length, 0);
  assert.equal(talk.getAttribute('aria-invalid'), 'true');
  assert.equal(page.document.activeElement, walk(page.ids.status, (n) => n.id === 'status-heading'), 'focus goes to the summary heading');
  assert.match(page.ids.status.textContent, /Nothing was saved\. Fix 1 field:/);
  assert.match(page.ids.status.textContent, /architect, user level, Way of talking: can.t contain a colon/);
});

test('a server refusal is mapped by its path to the field, the text comes from the page, nothing else is marked', async () => {
  const refused = ["user roles.qa.personality.talk: must be one line of letters, digits, single spaces and , . ' - ! ?; each word starts with a letter or digit", 'user roles.qa.personality: must be an object'];
  const page = loadPage(pageState(), { saveReply: { status: 400, body: { refused } } });
  await settle();
  const talk = field(page, 'qa', 'user', 'talk');
  await type(talk, 'fine value');
  await page.ids.save.fire('click');
  await settle();
  const sent = page.calls.find((c) => c.url === '/api/save');
  assert.equal(sent.body.user.roles.qa.personality.talk, 'fine value');
  assert.equal(talk.getAttribute('aria-invalid'), 'true');
  assert.equal(field(page, 'qa', 'user', 'topic').getAttribute('aria-invalid'), null);
  assert.equal(page.document.activeElement, walk(page.ids.status, (n) => n.id === 'status-heading'));
  const text = page.ids.status.textContent;
  assert.ok(text.includes('qa, user level, Way of talking: the server refused it.'));
  assert.ok(text.includes('user roles.qa.personality: must be an object'), 'an unmappable line is listed as received');
  assert.ok(!text.includes('user roles.qa.personality.talk'), 'the mapped line is not repeated raw');
  assert.ok(byId(page, 'pf-qa-user-talk-err').textContent.startsWith('Error: Way of talking was refused.'));
});

test('a card keeps its open state over a refresh and over a reload of the state', async () => {
  const page = loadPage(pageState(), { saveReply: { status: 200, body: { state: pageState() } } });
  await settle();
  const card = () => page.all((n) => n.tagName === 'DETAILS')[1];
  card().open = true;
  await card().fire('toggle');
  await type(field(page, 'qa', 'user', 'talk'), 'calm');
  assert.equal(card().open, true, 'refresh');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(card().open, true, 'a re-render after Save');
  assert.equal(page.all((n) => n.tagName === 'DETAILS')[0].open, false);
});

test('a cleared or replaced ignored value is one unsaved change, and an untouched one is none', async () => {
  const st = pageState();
  st.personalities.ignored = [
    { level: 'user', path: 'roles.qa.personality.creativity', reason: 'must be low, medium or high' },
    { level: 'project', path: 'roles.qa.personality.topic', reason: 'must be 1 to 80 characters' }
  ];
  const page = loadPage(st);
  await settle();
  assert.equal(page.ids.count.textContent, '0 unsaved changes');
  assert.equal(page.ids.save.disabled, true);
  assert.match(page.ids.notices.textContent, /user roles\.qa\.personality\.creativity: must be low, medium or high/);
  const select = field(page, 'qa', 'user', 'creativity');
  assert.equal(select.value, '__ignored__');
  assert.ok(select.options.some((o) => o.textContent === 'Ignored stored value'));
  assert.match(byId(page, 'pf-qa-user-creativity-hint').textContent, /^Ignored: this stored value is not Low, Medium or High/);
  assert.match(byId(page, 'pf-qa-project-topic-hint').textContent, /^Ignored: this stored value breaks the rule/);
  select.value = '';
  await select.fire('change');
  assert.equal(page.ids.count.textContent, '1 unsaved change');
  assert.equal(select.options.some((o) => o.textContent === 'Ignored stored value'), false);
  await type(field(page, 'qa', 'project', 'topic'), 'cats');
  assert.equal(page.ids.count.textContent, '2 unsaved changes');
  await page.ids.save.fire('click');
  await settle();
  const sent = page.calls.find((c) => c.url === '/api/save').body;
  assert.deepEqual(sent.project.roles.qa.personality, { topic: 'cats' });
  assert.deepEqual(sent.user, { version: 1 }, 'the user layer is sent without the ignored path, so the Save removes it');
});

test('the reset button clears a level for one Role, counts it and keeps focus in the card', async () => {
  const st = pageState();
  st.user = { version: 1, roles: { qa: { personality: { talk: 'dry', intelligence: 'high' } } } };
  st.personalities.roles.qa.user = { talk: 'dry', intelligence: 'high' };
  const page = loadPage(st);
  await settle();
  const reset = page.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Use plugin default for qa, user');
  assert.equal(reset.disabled, false);
  assert.equal(page.find((n) => n.textContent === 'Use plugin default for qa, project').disabled, true);
  await reset.fire('click');
  assert.equal(field(page, 'qa', 'user', 'talk').value, '');
  assert.equal(field(page, 'qa', 'user', 'intelligence').value, '');
  assert.equal(page.ids.count.textContent, '2 unsaved changes');
  assert.equal(page.document.activeElement, field(page, 'qa', 'user', 'temperament'));
});

test('without a .company folder the Project personality controls are off and say why', async () => {
  const page = loadPage(pageState({ hasProject: false }));
  await settle();
  assert.equal(field(page, 'qa', 'project', 'talk').disabled, true);
  assert.equal(field(page, 'qa', 'user', 'talk').disabled, false);
  assert.ok(page.find((n) => n.textContent === 'Needs a .company/ folder'));
});

test('a payload without personalities draws no section, and a rule that does not parse checks nothing on the page', async () => {
  const none = pageState();
  delete none.personalities;
  const a = loadPage(none);
  await settle();
  assert.equal(a.all((n) => n.tagName === 'DETAILS').length, 0);
  const broken = pageState();
  broken.personalities.rule.text_re = '(';
  const b = loadPage(broken);
  await settle();
  const talk = field(b, 'qa', 'user', 'talk');
  await type(talk, 'bad: value');
  await talk.fire('change');
  assert.equal(talk.getAttribute('aria-invalid'), null);
  assert.equal(byId(b, 'pf-qa-user-talk-count'), null);
});

test('stored plugin text with markup is shown as text and never becomes an element', async () => {
  const st = pageState();
  st.personalities.roles.qa.plugin.talk = '<img src=x onerror=alert(1)>';
  const page = loadPage(st);
  await settle();
  assert.ok(page.all((n) => n.tagName === 'DL')[1].textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(page.all((n) => n.tagName === 'IMG').length, 0);
});

test('the page keeps the layout fixes: the Roles table fits, and the footer sits above sticky row headers', () => {
  const html = pageHtml();
  assert.ok(/\.cell \{[^}]*display: grid/.test(html));
  assert.ok(/\.cell > :first-child \{[^}]*grid-column: 1 \/ -1/.test(html));
  assert.ok(/footer \{[^}]*z-index: 10/.test(html));
  assert.ok(!html.includes('1F512'), 'the lock emoji is gone');
  assert.ok(/\.lock::after \{[^}]*content: "needs unlock"/.test(html));
  assert.ok(/@media \(prefers-reduced-motion: no-preference\)/.test(html));
  assert.ok(/@media \(forced-colors: active\)/.test(html));
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/.test(html));
});

test('every colour pair the visual spec names passes its contrast floor in both schemes', () => {
  const html = pageHtml();
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const light = html.slice(html.indexOf(':root {'), html.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'), html.indexOf('* { box-sizing'));
  for (const [scheme, css] of [['light', light], ['dark', dark]]) {
    const t = (name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
    for (const [fg, bg] of [['text', 'surface'], ['muted', 'surface'], ['muted', 'head'], ['accent', 'surface'], ['warn', 'warn-bg'], ['err', 'err-bg'], ['info', 'info-bg'], ['ok', 'ok-bg'], ['err', 'surface'], ['warn', 'surface']]) {
      assert.ok(ratio(t(fg), t(bg)) >= 4.5, `${scheme} ${fg} on ${bg}: ${ratio(t(fg), t(bg)).toFixed(2)}`);
    }
    assert.ok(ratio(t('accent-text'), t('accent')) >= 4.5, `${scheme} accent-text on accent`);
    assert.ok(ratio(t('control-border'), t('set')) >= 3, `${scheme} border on set`);
    assert.ok(ratio(t('focus'), t('bg')) >= 3, `${scheme} focus`);
  }
});

// ---- page layout (aico-settings v1.3, "Page layout") ----

const namedState = () => {
  const st = pageState();
  st.resolved.roles.architect.name = 'Ava';
  return st;
};
const idOf = (n) => n.id;

test('layout: the tabs come in the Contract order and each has its panel', () => {
  const html = pageHtml();
  const tabs = [...html.matchAll(/<button role="tab" id="tab-([a-z]+)" aria-controls="panel-([a-z]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs.map(([a]) => a), ['roles', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods']);
  for (const [tab, panel] of tabs) assert.equal(tab, panel);
  const panels = [...html.matchAll(/<section role="tabpanel" id="panel-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(panels, tabs.map(([a]) => a));
});

test('layout: #status sits under the header and before the tab list, and the footer no longer holds it', () => {
  const html = pageHtml();
  const at = (s) => html.indexOf(s);
  assert.ok(at('</header>') < at('id="status"') && at('id="status"') < at('<div role="tablist"'));
  assert.ok(/id="status" role="status" aria-live="polite"/.test(html));
  const footer = html.slice(at('<footer>'), at('</footer>'));
  assert.ok(!footer.includes('id="status"'));
});

test('layout: the page never scrolls sideways: no overflow scrollers, no table min-width, no sticky cells', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(pageHtml())[1];
  assert.ok(!/overflow-x:\s*(auto|scroll)/.test(css));
  assert.ok(!/overflow:\s*(auto|scroll)/.test(css));
  assert.ok(!/(^|\n)\s*table[^{]*\{[^}]*min-width/.test(css));
  assert.ok(!/\bt[hd][^{]*\{[^}]*position:\s*sticky/.test(css));
  assert.ok(/\[role="tablist"\] \{[^}]*flex-wrap: wrap/.test(css));
  assert.ok(/@container \(max-width: \d+px\)/.test(css), 'a table that does not fit becomes stacked cards');
  assert.ok(/td::before \{[^}]*content: attr\(data-label\)/.test(css));
  assert.ok(/overflow-wrap: anywhere/.test(css));
});

test('layout: the personality section is on the Personality tab, not on the Roles tab', async () => {
  const page = loadPage(namedState());
  await settle();
  assert.equal(page.all((n) => n.tagName === 'DETAILS').length, 2);
  assert.equal(page.allRoles((n) => n.tagName === 'DETAILS').length, 0);
  assert.ok(page.allRoles((n) => n.tagName === 'TABLE').length >= 1);
  assert.ok(page.all((n) => n.tagName === 'H3' && n.className === 'dept-label').length >= 1);
  const legend = page.all((n) => n.tagName === 'LEGEND').map((n) => n.textContent);
  assert.ok(legend.includes('Ava (architect), User level'));
  assert.ok(legend.includes('qa, Project level'));
});

test('layout: the Role filter has its label and hint, hides cards, counts them, and never changes the Save body', async () => {
  const page = loadPage(namedState());
  await settle();
  const input = byId(page, 'pfilter');
  assert.equal(page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === 'pfilter').textContent, 'Filter Roles');
  assert.equal(byId(page, 'pfilter-hint').textContent, 'Name, Role or department');
  assert.equal(input.getAttribute('aria-describedby'), 'pfilter-hint');
  const count = byId(page, 'pcount');
  assert.equal(count.getAttribute('role'), 'status');
  assert.equal(count.textContent, 'Showing 2 of 2 Roles');
  const cards = () => page.all((n) => n.tagName === 'DETAILS');
  await type(input, 'AVA');
  assert.deepEqual(cards().map((c) => c.hidden), [false, true], 'the effective name matches, case-insensitively');
  assert.equal(count.textContent, 'Showing 1 of 2 Roles');
  await type(input, 'qa');
  assert.deepEqual(cards().map((c) => c.hidden), [true, false], 'the slug matches');
  await type(input, 'engineering');
  assert.deepEqual(cards().map((c) => c.hidden), [false, true], 'the department matches');
  await type(input, 'zzz');
  assert.equal(count.textContent, 'No Role matches the filter.');
  await type(field(page, 'qa', 'user', 'talk'), 'calm');
  await page.ids.save.fire('click');
  await settle();
  const body = page.calls.find((c) => c.url === '/api/save').body;
  assert.deepEqual(body.user.roles.qa.personality, { talk: 'calm' });
  assert.ok(!JSON.stringify(body).includes('zzz'), 'the filter text is never sent');
});

test('layout: every Roles-table control has a visible label that starts with its field word, and no aria-label', async () => {
  const page = loadPage(namedState());
  await settle();
  const controls = page.allRoles((n) => /^rf-/.test(idOf(n)) && (n.tagName === 'INPUT' || n.tagName === 'SELECT'));
  assert.equal(controls.length, 2 * 2 * 4, 'two Roles, two levels, four fields');
  for (const control of controls) {
    assert.equal(control.getAttribute('aria-label'), null, control.id);
    const label = page.allRoles((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id)[0];
    assert.ok(label, control.id);
    const [, role, level, key] = /^rf-([a-z-]+?)-(user|project)-(name|model|effort|cap)$/.exec(control.id);
    const word = { name: 'Name', model: 'Model', effort: 'Effort', cap: 'Cap' }[key];
    assert.equal(label.children[0].textContent, word, 'the visible text is the field word');
    assert.equal(label.textContent, `${word}, ${role === 'architect' ? 'Ava (architect)' : role}, ${level} level`);
    assert.ok(label.children[1].className.split(' ').includes('vh'), 'the context is visually hidden');
  }
});

test('layout: the Bulk bar controls are named by their wrapping labels only', async () => {
  const page = loadPage(namedState());
  await settle();
  const bulk = page.allRoles((n) => n.tagName === 'DIV' && n.className === 'bulk')[0];
  const selects = walkAll(bulk, (n) => n.tagName === 'SELECT');
  assert.equal(selects.length, 4);
  for (const s of selects) {
    assert.equal(s.getAttribute('aria-label'), null);
    assert.equal(closest(s, 'LABEL').parentNode, bulk);
  }
  assert.deepEqual(walkAll(bulk, (n) => n.tagName === 'LABEL').map((l) => l.children[0].textContent), ['Apply to', 'at', 'model', 'effort']);
});

test('layout: table cells carry their column header for the stacked layout', async () => {
  const page = loadPage(namedState());
  await settle();
  const cells = page.allRoles((n) => n.tagName === 'TD');
  assert.deepEqual([...new Set(cells.map((c) => c.getAttribute('data-label')))], ['Plugin', 'User', 'Project', 'In effect']);
});

test('layout: a refused Save puts an error summary in the status and focuses its heading', async () => {
  const page = loadPage(namedState());
  await settle();
  await type(field(page, 'architect', 'user', 'talk'), 'bad: value');
  await type(field(page, 'qa', 'project', 'topic'), 'x<y');
  page.document.activeElement = page.ids.save;
  await page.ids.save.fire('click');
  assert.equal(page.calls.filter((c) => c.url === '/api/save').length, 0);
  const heading = walk(page.ids.status, (n) => n.id === 'status-heading');
  assert.equal(heading.tagName, 'H2');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(heading.textContent, 'Nothing was saved. Fix 2 fields:');
  assert.equal(page.document.activeElement, heading);
  const links = walkAll(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(links.length, 2);
  for (const link of links) {
    const target = link.getAttribute('href').slice(1);
    assert.ok(byId(page, target), `href ${link.getAttribute('href')} names an existing field`);
  }
  assert.ok(links[0].textContent.startsWith('Ava (architect), user level, Way of talking: can'));
  assert.ok(links[1].textContent.startsWith('qa, project level, Pet topic: can'));
});

test('layout: a summary link selects the Personality tab, clears a filter that hides the Role, opens the card and focuses the field', async () => {
  const page = loadPage(namedState());
  await settle();
  await type(field(page, 'architect', 'user', 'talk'), 'bad: value');
  await page.ids.save.fire('click');
  await type(byId(page, 'pfilter'), 'zzz');
  await page.ids['tab-pipeline'].fire('click');
  assert.equal(page.ids['panel-personality'].hidden, true);
  const link = walk(page.ids.status, (n) => n.tagName === 'A');
  let prevented = false;
  for (const fn of link.listeners.click) fn({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.ids['panel-personality'].hidden, false);
  assert.equal(page.ids['tab-personality'].getAttribute('aria-selected'), 'true');
  assert.equal(byId(page, 'pfilter').value, '');
  assert.equal(page.all((n) => n.tagName === 'DETAILS')[0].hidden, false);
  assert.equal(closest(field(page, 'architect', 'user', 'talk'), 'DETAILS').open, true);
  assert.equal(page.document.activeElement, field(page, 'architect', 'user', 'talk'));
});

test('layout: a server line that maps to no field is plain text in the summary', async () => {
  const lines = ['revision is stale', "user roles.qa.personality.talk: must be one line of letters, digits, single spaces and , . ' - ! ?; each word starts with a letter or digit"];
  const page = loadPage(namedState(), { saveReply: { status: 400, body: { refused: lines } } });
  await settle();
  await type(field(page, 'qa', 'user', 'talk'), 'fine');
  await page.ids.save.fire('click');
  await settle();
  const items = walkAll(page.ids.status, (n) => n.tagName === 'LI');
  assert.equal(items.length, 2);
  assert.equal(walkAll(page.ids.status, (n) => n.tagName === 'A').length, 1);
  assert.ok(items.some((li) => li.textContent === 'revision is stale' && walkAll(li, (n) => n.tagName === 'A').length === 0));
  assert.equal(walk(page.ids.status, (n) => n.id === 'status-heading').textContent, 'Nothing was saved. Fix 2 fields:');
});

test('layout: after a successful Save focus is not on body: the same control when it still works, else the status message', async () => {
  const page = loadPage(namedState(), { saveReply: { status: 200, body: { state: namedState() } } });
  await settle();
  await type(field(page, 'qa', 'user', 'talk'), 'calm');
  page.document.activeElement = page.ids.save;
  await page.ids.save.fire('click');
  await settle();
  const message = walk(page.ids.status, (n) => n.id === 'status-message');
  assert.equal(message.getAttribute('tabindex'), '-1');
  assert.equal(page.document.activeElement, message, 'the Save button is disabled after a reload');
  const card = page.all((n) => n.tagName === 'DETAILS')[1];
  card.open = true;
  await card.fire('toggle');
  await type(field(page, 'qa', 'user', 'topic'), 'tea');
  page.document.activeElement = field(page, 'qa', 'user', 'topic');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(page.document.activeElement, field(page, 'qa', 'user', 'topic'), 'the rebuilt control with the same id');
});

test('layout: a stale-revision reload and Done also keep focus on a real element', async () => {
  const stale = loadPage(namedState(), { saveReply: { status: 409, body: { state: namedState() } } });
  await settle();
  await type(field(stale, 'qa', 'user', 'talk'), 'calm');
  stale.document.activeElement = stale.ids.save;
  await stale.ids.save.fire('click');
  await settle();
  assert.equal(stale.document.activeElement.id, 'status-message');
  assert.match(stale.ids.status.textContent, /Your view was stale/);
  const page = loadPage(namedState());
  await settle();
  page.document.activeElement = page.ids.done;
  await page.ids.done.fire('click');
  await settle();
  assert.equal(page.document.activeElement.id, 'stopped');
  assert.equal(page.document.activeElement.textContent, 'Settings server stopped. You can close this tab.');
});

test('layout: Clear on the Personality tab clears only personality, and on the Roles tab everything but personality', async () => {
  const st = namedState();
  st.user = { version: 1, roles: { qa: { model: 'haiku', personality: { talk: 'dry' } } } };
  st.personalities.roles.qa.user = { talk: 'dry' };
  const page = loadPage(st, { saveReply: { status: 200, body: { state: st } } });
  await settle();
  await page.ids['tab-personality'].fire('click');
  await page.ids['clear-user'].fire('click');
  assert.equal(page.ids.count.textContent, '1 unsaved change');
  await page.ids.save.fire('click');
  await settle();
  assert.deepEqual(page.calls.find((c) => c.url === '/api/save').body.user, { version: 1, roles: { qa: { model: 'haiku' } } });
  const other = loadPage(st);
  await settle();
  await other.ids['clear-user'].fire('click');
  await other.ids.save.fire('click');
  await settle();
  assert.deepEqual(other.calls.find((c) => c.url === '/api/save').body.user, { version: 1, roles: { qa: { personality: { talk: 'dry' } } } });
});

const planHintText = () => {
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = /the hint "(Plan check lists[^"]*)"/.exec(contract);
  assert.ok(m, 'Contract hint not found');
  return m[1];
};

test('state carries plan_check defaults; save round-trips policy and runs, refuses bad values and writes nothing', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.deepEqual(before.plugin.plan_check, { policy: 'warn', runs: 5 });
  assert.deepEqual(before.resolved.plan_check, { policy: 'warn', runs: 5 });
  for (const bad of [{ policy: 'strict' }, { runs: 2 }, { runs: 51 }, { runs: '10' }]) {
    const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, plan_check: bad } });
    assert.equal(res.status, 400);
    const { refused } = await res.json();
    assert.ok(refused.some((r) => /^user plan_check\.(policy|runs) /.test(r)), refused.join(' | '));
  }
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, plan_check: { policy: 'off', runs: 3 } }, project: { version: 1, plan_check: { policy: 'block', runs: 50 } } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).state.resolved.plan_check, { policy: 'block', runs: 50 });
});

test('Plan check hint equals the Contract text and the table sits after the Reprompt hint and before Brainstorm', () => {
  const html = pageHtml();
  const hintCall = `el('p', { class: 'hint', id: 'plan-check-hint' }, '${planHintText()}')`;
  assert.equal(html.split(hintCall).length - 1, 1, 'hint must match the Contract exactly, once');
  const reprompt = html.indexOf("id: 'reprompt-hint'");
  const h2 = html.indexOf("el('h2', {}, 'Plan check')");
  const brainstorm = html.indexOf("el('h2', {}, 'Brainstorm')");
  assert.ok(reprompt > 0 && reprompt < h2 && h2 < html.indexOf(hintCall) && html.indexOf(hintCall) < brainstorm);
  assert.ok(!/tabIndex: [1-9]|tabindex="[1-9]/.test(html), 'no positive tabindex');
  assert.ok(!/innerHTML/.test(html));
});

const planField = (page, key, level) => byId(page, `pc-${key}-${level}`);

test('Plan check controls have a visible label tied by for, no aria-label, and the hint in aria-describedby', async () => {
  const page = loadPage(pageState());
  await settle();
  assert.equal(byId(page, 'plan-check-hint').textContent, planHintText());
  for (const [key, word] of [['policy', 'Policy'], ['runs', 'Verdict runs']]) {
    for (const level of ['user', 'project']) {
      const control = planField(page, key, level);
      assert.ok(control, `${key} ${level}`);
      assert.equal(control.getAttribute('aria-label'), null);
      const label = page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id);
      assert.ok(label.textContent.startsWith(word), label.textContent);
      assert.ok(label.textContent.includes(`${level} level`));
      assert.ok(control.getAttribute('aria-describedby').split(' ').includes('plan-check-hint'));
    }
  }
  assert.deepEqual(planField(page, 'policy', 'user').options.map((o) => o.textContent), ['—', 'off', 'warn', 'block']);
});

test('choosing a policy and a run count sends them in the Save body', async () => {
  const page = loadPage(pageState());
  await settle();
  const policy = planField(page, 'policy', 'user');
  policy.value = 'block';
  await policy.fire('change');
  await type(planField(page, 'runs', 'project'), '12');
  assert.equal(page.ids.count.textContent, '2 unsaved changes');
  await page.ids.save.fire('click');
  await settle();
  const sent = page.calls.find((c) => c.url === '/api/save').body;
  assert.deepEqual(sent.user.plan_check, { policy: 'block' });
  assert.deepEqual(sent.project.plan_check, { runs: 12 });
});

test('a bad run count gets an error tied to the field with the hint kept, and Save names and links the field', async () => {
  const page = loadPage(pageState());
  await settle();
  const runs = planField(page, 'runs', 'user');
  await type(runs, '2');
  assert.equal(runs.getAttribute('aria-invalid'), 'true');
  const ids = runs.getAttribute('aria-describedby').split(' ');
  assert.ok(ids.includes('plan-check-hint'));
  const err = byId(page, ids.find((i) => i !== 'plan-check-hint'));
  assert.equal(err.textContent, 'Error: Verdict runs is out of range. Use a whole number from 3 to 50.');
  await type(runs, 'x');
  assert.equal(err.textContent, 'Error: Verdict runs must be a whole number from 3 to 50.');
  await page.ids.save.fire('click');
  assert.equal(page.calls.filter((c) => c.url === '/api/save').length, 0);
  assert.equal(page.document.activeElement, walk(page.ids.status, (n) => n.id === 'status-heading'));
  const link = walk(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(link.getAttribute('href'), '#pc-runs-user');
  assert.match(link.textContent, /^Plan check, Verdict runs, user level: /);
  await page.ids['tab-roles'].fire('click');
  await link.fire('click');
  assert.equal(page.document.activeElement, runs);
  assert.equal(page.ids['panel-pipeline'].hidden, false);
});

test('a server refusal of a Plan check value marks and links that field; the text comes from the page', async () => {
  const refused = ['project plan_check.policy must be off, warn or block', 'stale thing'];
  const page = loadPage(pageState(), { saveReply: { status: 400, body: { refused } } });
  await settle();
  const policy = planField(page, 'policy', 'project');
  policy.value = 'warn';
  await policy.fire('change');
  await page.ids.save.fire('click');
  await settle();
  const heading = walk(page.ids.status, (n) => n.id === 'status-heading');
  assert.equal(page.document.activeElement, heading);
  assert.equal(heading.textContent, 'Nothing was saved. Fix 2 fields:');
  const links = walkAll(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), '#pc-policy-project');
  assert.equal(policy.getAttribute('aria-invalid'), 'true');
  assert.ok(page.ids.status.textContent.includes('stale thing'));
  await links[0].fire('click');
  assert.equal(page.document.activeElement, policy);
});

test('Clear on the Pipeline tab also clears Plan check', async () => {
  const st = pageState();
  st.user = { version: 1, plan_check: { policy: 'off' } };
  const page = loadPage(st);
  await settle();
  await page.ids['tab-pipeline'].fire('click');
  await page.ids['clear-user'].fire('click');
  assert.equal(planField(page, 'policy', 'user').value, '');
  assert.equal(page.ids.count.textContent, '1 unsaved change');
});
