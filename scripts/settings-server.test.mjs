import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
  assert.deepEqual(Object.keys(st).sort(), ['hasProject', 'language', 'plugin', 'project', 'resolved', 'user']);
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

test('page has the four tabs, a lock dialog, and no external resources', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const tab of ['Roles', 'Language &amp; profile', 'Pipeline', 'Gates']) assert.ok(html.includes(`>${tab}<`), `tab ${tab}`);
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

test('page has a Review format row built like the Dispatch row, with the Contract sentence', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["'Review format'", "['pipeline', 'review_format']", "['plain', 'pilot']",
    'Pilot: the Code Reviewer and the compliance pass write a top block, finding rows and a findings ledger. Costs about 10% more tokens per review (T15d).']) {
    assert.ok(html.includes(needle), needle);
  }
});
