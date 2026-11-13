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
  fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor: Object.fromEntries(Object.entries(AGENTS).map(([r, a]) => [r, a.model])), protected: ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'] }));
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
  assert.deepEqual(Object.keys(st).sort(), ['catalog', 'hasProject', 'language', 'personalities', 'plugin', 'project', 'resolved', 'user']);
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
  assert.equal(before.plugin.pipeline.context_cap, 95000);
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
  assert.equal(after.resolved.roles.qa.context_cap, 95000);
  assert.equal(after.resolved.roles.architect.context_cap, 95000);
  assert.equal(after.resolved.pipeline.context_cap, 95000);
});

test('page has the fixed cap text, film-script and debate rows built from the existing controls', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["['pipeline', 'context_cap']", "['brainstorm', 'film_script']", "['brainstorm', 'debate']", "'crossfire'", "'full_pass'", 'contextCapRow']) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(!html.includes("['roles', role, 'context_cap']"), 'no editable Role cap');
  assert.ok(!html.includes('innerHTML'), 'fixed text is set with textContent');
  assert.ok(!/<input[^>]*type="range"/i.test(html) && !/<script[^>]*\ssrc=/i.test(html));
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

test('page has a Reprompt table with a Question rounds row, 0 to 3, hint tied to the field', async () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ["sectionHead('Reprompt')", "label: 'Question rounds'", "['reprompt', 'question_rounds']", 'options: [0, 1, 2, 3]', "id: 'reprompt-hint'", 'state.plugin.reprompt']) {
    assert.ok(html.includes(needle), needle);
  }
  const page = loadPage(pageState());
  await settle();
  const group = page.find((n) => n.id === 'f-reprompt-question_rounds-user');
  assert.ok(group, 'Question rounds group');
  const box = closest(group, 'FIELDSET');
  assert.ok(box.children.some((n) => n.tagName === 'LEGEND' && n.textContent.startsWith('Question rounds')), 'legend is the row header');
  assert.ok(box.getAttribute('aria-describedby').split(' ').includes('reprompt-hint'), 'hint tied to the field');
  assert.equal(JSON.stringify(Array.from(group.radios, (r) => r.value)), '["","0","1","2","3"]');
});

test('Reprompt hint equals the Contract text byte for byte and sits between the context-cap hint and Brainstorm', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = /the hint "(How often \/aico:reprompt[^"]*)"/.exec(contract);
  assert.ok(m, 'Contract hint not found');
  const hintCall = `{ id: 'reprompt-hint', text: '${m[1]}' }`;
  assert.equal(html.split(hintCall).length - 1, 1, 'hint must match the Contract exactly, once');
  const body = html.slice(html.indexOf('function renderPipeline'));
  const cap = body.indexOf('contextCapRow(rack');
  const h2 = body.indexOf("sectionHead('Reprompt')");
  const hint = body.indexOf(hintCall);
  const brainstorm = body.indexOf("sectionHead('Brainstorm')");
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
  assert.deepEqual(Object.keys(before.plugin.mods), ['savvy', 'cache_tax', 'reflect']);
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
    user: { version: 1, mods: { savvy: { enabled: false, pane: 'command' } } },
    project: { version: 1, mods: { reflect: { mode: 'model' } } }
  });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.deepEqual(after.resolved.mods.savvy, { enabled: false, pane: 'command' });
  assert.deepEqual(Object.keys(after.resolved.mods), ['savvy', 'cache_tax', 'reflect']);
  assert.equal(after.resolved.mods.reflect.mode, 'deterministic');
  for (const key of ['mods.reflect.mode']) {
    assert.ok(after.resolved.ignored.some((i) => i.startsWith(key)), key);
  }
});

test('page has a Mods section built from the existing controls, shows lock reasons, and never uses innerHTML', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ['id="tab-mods"', 'id="panel-mods"', 'function renderMods', "['mods', mod, 'enabled']", "['mods', 'reflect', 'mode']",
    "'step_check'", "'retrospective'", 'switchRow(', 'selectFor(']) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(!html.includes('keep_warm') && !html.includes('keep-warm'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
  assert.ok(/mods:\s*renderMods/.test(html) && /TAB_NAMES = \[[^\]]*'mods'\]/.test(html));
});

const pageHtml = () => fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
// OKLCH colour tokens (light, and dark laid over light) to relative luminance.
const oklchLum = (L, C, h) => {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const colourTokens = (html) => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const block = (from, to) => { const s = css.indexOf(from); return css.slice(s, css.indexOf(to, s + 1)); };
  const read = (b) => Object.fromEntries([...b.matchAll(/--color-([a-z0-9-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)].map((m) => [m[1], oklchLum(Number(m[2]) / 100, Number(m[3]), Number(m[4]))]));
  const light = read(block(':root {', '@media (prefers-color-scheme: dark)'));
  return { light, dark: { ...light, ...read(block('@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]')) } };
};
const contrast = (lumA, lumB) => (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
const contractText = () => fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');

test('the Skill scan tab sits between Gates and Mods and holds the Scan mode row', () => {
  const html = pageHtml();
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('id="tab-gates"') < at('id="tab-scan"') && at('id="tab-scan"') < at('id="tab-mods"'));
  assert.ok(at('id="panel-gates"') < at('id="panel-scan"') && at('id="panel-scan"') < at('id="panel-mods"'));
  assert.ok(/scan:\s*renderScan/.test(html) && /TAB_NAMES = \['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'\]/.test(html));
  const mods = html.slice(at('function renderMods'), at('const SCAN_NOTE'));
  assert.ok(!mods.includes('skillspector') && !mods.includes('SkillSpector'));
  const scan = html.slice(at('const SCAN_NOTE'), at('// ---------- page'));
  for (const needle of ["panelHead('Skill scan'", "'Scan mode'", "['skillspector', 'mode']", 'aria-describedby']) assert.ok(scan.includes(needle), needle);
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
  assert.ok(/@media \(max-width: 600px\), \(max-height: 500px\) \{[^@]*\.transport \{[^}]*position: static/.test(html));
});

test('select and text-input borders have 3:1 contrast in light and dark', () => {
  const tokens = colourTokens(pageHtml());
  for (const scheme of ['light', 'dark']) {
    for (const ground of ['scribble', 'panel', 'panel-2']) assert.ok(contrast(tokens[scheme].edge, tokens[scheme][ground]) >= 3, `${scheme} edge on ${ground}`);
  }
  assert.ok(/\.ctl select, [^{]*\.ctl input\[type="text"\][^{]*\{[^}]*border: 1px solid var\(--color-edge\)/.test(pageHtml()));
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
      add: (name) => self.classList.toggle(name, true),
      remove: (name) => self.classList.toggle(name, false),
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
  scrollIntoView(options) { (this.ownerDoc.scrolled ??= []).push({ node: this, options }); }
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
  for (const id of ['notices', 'field-live', 'status', 'count', 'clear-user', 'clear-project', 'save', 'done', 'unlock', 'unlock-title', 'unlock-text', 'unlock-cancel', 'unlock-ok']) ids[id] = make('div', { id });
  ids.save.setAttribute('aria-disabled', 'true');
  const names = ['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'];
  const tabs = names.map((name) => {
    ids[`panel-${name}`] = make('section', { id: `panel-${name}`, role: 'tabpanel' });
    ids[`tab-${name}`] = make('button', { role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}` });
    return ids[`tab-${name}`];
  });
  // The header level switch, the lamps and the per-tab dirty lamps the console shell adds.
  const radios = ['user', 'project'].map((v) => { const r = make('input', { id: `lvl-${v}`, name: 'lvl' }); r.value = v; r.checked = v === 'user'; ids[`lvl-${v}`] = r; return r; });
  for (const name of names) ids[`dirty-${name}`] = make('span');
  ids.lamps = make('div', { id: 'lamps' });
  ids['annun-list'] = make('div', { id: 'annun-list' });
  doc.body = { dataset: {} };
  const footer = make('footer');
  const main = make('main');
  const calls = [];
  Object.assign(doc, {
    createElement: (tag) => make(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => ids[id] ?? names.map((n) => walk(ids[`panel-${n}`], (x) => x.id === id)).find(Boolean) ?? walk(ids.status, (x) => x.id === id),
    querySelector: (sel) => (sel === 'meta[name="aico-token"]' ? { content: 'tok' } : sel === 'main' ? main : sel === 'footer' ? footer : sel === 'input[name="lvl"]:checked' ? radios.find((r) => r.checked) : null),
    querySelectorAll: (sel) => (sel === '[role="tab"]' ? tabs : sel === 'input[name="lvl"]' ? radios : [])
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
  const levelNow = () => radios.find((r) => r.checked).value;
  const findHere = (pred) => panels.map((p) => walk(p, pred)).find(Boolean) ?? null;
  const useLevel = (level) => {
    if (levelNow() === level) return;
    for (const r of radios) r.checked = r.value === level;
    ids[`lvl-${level}`].fire('change');
  };
  return {
    setLevel: async (level) => { for (const r of radios) r.checked = r.value === level; await ids[`lvl-${level}`].fire('change'); await new Promise((resolve) => setImmediate(resolve)); },
    document: doc, ids, calls,
    // The page builds controls for one level at a time; find() looks at the shown level first, then at the other one.
    useLevel,
    find: (pred) => {
      const first = levelNow();
      let hit = findHere(pred);
      if (hit) return hit;
      useLevel(first === 'user' ? 'project' : 'user');
      hit = findHere(pred);
      if (!hit) useLevel(first);
      return hit;
    },
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
      revision: 'r1', roles: Object.fromEntries(roles.map((r) => [r, { name: r, model: 'sonnet', effort: 'medium', context_cap: 95000, source: {} }])),
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

test('the page builds one labelled personality card per Role, with plain rows and key-cap level choices from the payload', async () => {
  const page = loadPage(pageState());
  await settle();
  assert.equal(page.all((n) => n.tagName === 'DETAILS').length, 2);
  for (const [key, label] of [['temperament', 'Temperament'], ['talk', 'Way of talking'], ['topic', 'Pet topic'], ['intelligence', 'Intelligence'], ['creativity', 'Creativity']]) {
    const control = field(page, 'qa', 'user', key);
    assert.ok(control, key);
    if (['intelligence', 'creativity'].includes(key)) {
      const name = control.parentNode.getAttribute('aria-labelledby');
      assert.equal(control.parentNode.getAttribute('role'), 'group', key);
      assert.equal(page.find((n) => n.id === name).textContent, label);
    } else {
      assert.equal(page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id).textContent, label);
    }
  }
  const seg = field(page, 'qa', 'user', 'intelligence');
  assert.ok(seg.classList.contains('seg') && seg.classList.contains('small'));
  assert.deepEqual([...seg.radios.map((r) => r.value)], ['', 'low', 'medium', 'high']);
  assert.equal(seg.value, '', 'no stored user value: the group sits on not set');
  assert.equal(byId(page, 'pf-qa-user-talk-count'), null, 'the preview has no character counter');
  assert.equal(page.all((n) => n.tagName === 'FIELDSET' || n.tagName === 'LEGEND' || n.tagName === 'SELECT').length, 0, 'no fieldset, legend or select');
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

test('a too long value gets an error text tied to the field, measured in code points, on blur', async () => {
  const page = loadPage(pageState());
  await settle();
  const talk = field(page, 'qa', 'user', 'talk');
  await type(talk, '\u{10400}'.repeat(80));
  await talk.fire('change');
  assert.equal(talk.getAttribute('aria-invalid'), null);
  assert.equal(byId(page, 'pf-qa-user-talk-err').hidden, true, '80 code points is within the limit');
  await type(talk, 'a'.repeat(96));
  await talk.fire('change');
  assert.equal(talk.getAttribute('aria-invalid'), 'true');
  const err = byId(page, 'pf-qa-user-talk-err');
  assert.equal(err.textContent, 'Error: Way of talking is 96 characters. The limit is 80. Remove 16.');
  assert.ok(talk.getAttribute('aria-describedby').split(' ').includes(err.id));
  assert.equal(byId(page, 'pf-qa-user-talk-count'), null, 'no counter, the error text carries the number');
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

test('the name input never cuts input off; an over-long entry gets a field-linked error', async () => {
  const html = pageHtml();
  assert.ok(!/maxLength: (7|30)/.test(html));
  const page = loadPage(pageState());
  await settle();
  const name = page.allRoles((n) => n.tagName === 'INPUT' && n.id === 'rf-qa-user-name')[0];
  assert.equal(name.maxLength, undefined);
  await type(name, 'n'.repeat(35));
  assert.equal(name.value.length, 35);
  assert.equal(page.allRoles((n) => n.id === name.getAttribute('aria-describedby').split(' ')[0])[0].textContent, 'Error: Name is 35 characters. The limit is 30. Remove 5.');
  await type(name, 'Quinn');
  assert.equal(name.getAttribute('aria-invalid'), null);
});

test('the context cap shows as fixed read-only text with a row header and no cap input', async () => {
  const page = loadPage(pageState());
  await settle();
  assert.equal(page.allRoles((n) => n.tagName === 'INPUT' && /-cap$/.test(n.id ?? '')).length, 0, 'no Role cap input');
  await page.ids['tab-pipeline'].fire('click');
  const cell = walk(page.ids['panel-pipeline'], (n) => n.id === 'context-cap-fixed');
  assert.ok(cell, 'fixed cap cell exists');
  assert.equal(cell.tagName, 'P');
  const box = cell.parentNode;
  const head = box.children.find((n) => n.className === 'ctl-label');
  assert.ok(head && head.textContent.startsWith('Context cap'), 'the row label names the setting');
  assert.ok(head.textContent.includes('fixed'), 'the label carries the fixed tag');
  assert.ok(cell.textContent.includes('95000'), cell.textContent);
  assert.ok(cell.textContent.startsWith('In effect'), cell.textContent);
  assert.equal(walkAll(box, (n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)).length, 0, 'no control in the cap row');
  assert.equal(page.allRoles((n) => n.tagName === 'INPUT' && n.getAttribute('aria-label') === 'Context cap, user').length, 0);
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
  assert.equal(page.ids.save.getAttribute('aria-disabled'), 'true');
  assert.match(page.ids['annun-list'].textContent, /user roles\.qa\.personality\.creativity: must be low, medium or high/);
  assert.match(page.ids.notices.textContent, /0 warnings, 2 ignored/);
  const select = field(page, 'qa', 'user', 'creativity');
  assert.ok(select.classList.contains('ignored'), 'an untouched ignored value marks the key-cap group');
  assert.equal(select.radios.some((r) => r.checked), false, 'no key is lit for an ignored value');
  assert.match(byId(page, 'pf-qa-user-creativity-hint').textContent, /^Ignored: this stored value is not Low, Medium or High/);
  select.value = '';
  await select.fire('change');
  assert.equal(page.ids.count.textContent, '1 unsaved change');
  assert.equal(select.classList.contains('ignored'), false, 'clearing drops the ignored mark');
  // Switching the level rebuilds the controls, so the user select is not read after this line.
  assert.match(byId(page, 'pf-qa-project-topic-hint').textContent, /^Ignored: this stored value breaks the rule/);
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
  page.useLevel('project');
  assert.equal(page.find((n) => n.textContent === 'Use plugin default for qa, project').disabled, true);
  page.useLevel('user');
  await page.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Use plugin default for qa, user').fire('click');
  assert.equal(field(page, 'qa', 'user', 'talk').value, '');
  assert.equal(field(page, 'qa', 'user', 'intelligence').value, '');
  assert.equal(page.ids.count.textContent, '2 unsaved changes');
  assert.equal(page.document.activeElement, field(page, 'qa', 'user', 'temperament'));
});

test('without a .company folder the Project personality controls are off and say why', async () => {
  const page = loadPage(pageState({ hasProject: false }));
  await settle();
  assert.equal(page.ids['lvl-project'].disabled, true, 'the Project level cannot be chosen');
  assert.equal(page.ids['lvl-user'].disabled, false);
  assert.equal(field(page, 'qa', 'user', 'talk').disabled, false);
  assert.match(page.ids.notices.textContent, /No \.company\/ folder here, so the Project column is off/);
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
  assert.ok(page.all((n) => n.className === 'gist')[1].textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(page.all((n) => n.tagName === 'IMG').length, 0);
});

test('the page keeps the layout fixes: the console grids fit, and the footer sits above the content', () => {
  const html = pageHtml();
  assert.ok(/\.bay-row \{[^}]*display: grid/.test(html));
  assert.ok(/\.transport \{[^}]*position: fixed[^}]*z-index: 5/.test(html));
  assert.ok(!html.includes('1F512'), 'the lock emoji is gone');
  assert.ok(!html.includes('content: "needs unlock"'), 'the lock reason is real text, not generated content');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(html));
  assert.ok(/@media \(forced-colors: active\)/.test(html));
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/.test(html));
});

test('every colour pair the visual spec names passes its contrast floor in both schemes', () => {
  const tokens = colourTokens(pageHtml());
  for (const scheme of ['light', 'dark']) {
    const c = tokens[scheme];
    for (const [fg, bg] of [['ink', 'panel'], ['ink', 'panel-2'], ['ink-2', 'panel'], ['ink-2', 'panel-2'], ['silk', 'well'], ['scribble-ink', 'scribble'], ['text-user', 'panel'], ['text-project', 'panel'], ['text-ok', 'panel'], ['text-lock', 'panel'], ['text-lock', 'panel-2']]) {
      assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${scheme} ${fg} on ${bg}: ${contrast(c[fg], c[bg]).toFixed(2)}`);
    }
    for (const bg of ['panel', 'room']) assert.ok(contrast(c.focus, c[bg]) >= 3, `${scheme} focus on ${bg}`);
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
  assert.deepEqual(tabs.map(([a]) => a), ['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods']);
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
  assert.ok(!/position:\s*sticky/.test(css));
  assert.ok(/html, body \{[^}]*overflow-x: clip/.test(css), 'a stray wide child is clipped, never scrolled');
  assert.ok(/\.select-bank \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, [\d.]+rem\), 1fr\)\)/.test(css), 'the tab bank wraps');
  assert.ok(/\.bay-row \{[^}]*min-width: 0/.test(css));
  assert.ok(/overflow-wrap: anywhere/.test(css));
});

test('layout: the personality section is on the Personality tab, not on the Roles tab', async () => {
  const page = loadPage(namedState());
  await settle();
  assert.equal(page.all((n) => n.tagName === 'DETAILS').length, 2);
  assert.equal(page.allRoles((n) => n.tagName === 'DETAILS').length, 0);
  assert.equal(page.allRoles((n) => n.tagName === 'ARTICLE' && n.className === 'strip').length, 2, 'one channel strip per Role on the Roles tab');
  assert.equal(page.all((n) => n.tagName === 'H3' && n.className === 'dept-label').length, 0, 'flat list, no department labels');
  const buttons = () => page.all((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  assert.ok(page.all((n) => n.className === 'who').map((n) => n.textContent).includes('Ava (architect)'), 'the card names the Role');
  assert.equal(page.all((n) => n.tagName === 'LEGEND').length, 0, 'no legend');
  assert.ok(buttons().includes('Use plugin default for architect, user'));
  assert.ok(!buttons().includes('Use plugin default for qa, project'), 'the editing level shows one level at a time');
  await page.setLevel('project');
  assert.ok(buttons().includes('Use plugin default for qa, project'));
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

test('layout: every Roles control has a visible label that starts with its field word, and no aria-label', async () => {
  const page = loadPage(namedState());
  await settle();
  const controls = page.allRoles((n) => /^rf-/.test(idOf(n)) && n.tagName === 'INPUT');
  const named = controls.filter((n) => /-(name|effort)$/.test(n.id));
  assert.equal(named.length, 2 * 2, 'two Roles, the shown level only, a Name and an Effort control each');
  assert.ok(controls.every((n) => /^rf-[a-z-]+?-user-/.test(n.id)), 'only the shown level is built');
  for (const control of controls) {
    assert.equal(control.getAttribute('aria-label'), null, control.id);
    assert.ok(page.allRoles((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id)[0], control.id);
  }
  for (const control of named) {
    const label = page.allRoles((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id)[0];
    const [, role, level, key] = /^rf-([a-z-]+?)-(user|project)-(name|effort)$/.exec(control.id);
    const word = { name: 'Name', effort: 'Effort' }[key];
    assert.equal(label.textContent, `${word}, ${role === 'architect' ? 'Ava (architect)' : role}, ${level} level`);
    assert.ok(label.textContent.startsWith(word), 'the visible text is the field word');
    assert.ok(label.children.at(-1).className.split(' ').includes('vh'), 'the context is visually hidden');
  }
  for (const role of ['architect', 'qa']) {
    const bank = closest(page.find((n) => n.id === `rf-${role}-user-model`), 'FIELDSET');
    const legend = bank.children.find((n) => n.tagName === 'LEGEND');
    assert.equal(legend.textContent, `Model, ${role === 'architect' ? 'Ava (architect)' : role}, user level`);
    assert.ok(legend.children.at(-1).className.split(' ').includes('vh'));
  }
});

test('layout: the Bulk bar controls are named by their wrapping labels only', async () => {
  const page = loadPage(namedState());
  await settle();
  const bulk = page.allRoles((n) => n.tagName === 'DIV' && n.className === 'bulk')[0];
  const selects = walkAll(bulk, (n) => n.tagName === 'SELECT');
  assert.equal(selects.length, 3);
  for (const s of selects) {
    assert.equal(s.getAttribute('aria-label'), null);
    assert.equal(closest(s, 'LABEL').parentNode, bulk);
  }
  assert.deepEqual(walkAll(bulk, (n) => n.tagName === 'LABEL').map((l) => l.children[0].textContent), ['Apply to', 'model', 'effort']);
});

test('layout: the Roles tab holds no table; each strip is named by its Role heading', async () => {
  const page = loadPage(namedState());
  await settle();
  assert.equal(page.allRoles((n) => n.tagName === 'TD' || n.tagName === 'TABLE').length, 0);
  const strips = page.allRoles((n) => n.tagName === 'ARTICLE' && n.className === 'strip');
  assert.equal(strips.length, 2);
  for (const strip of strips) assert.ok(page.allRoles((n) => n.id === strip.getAttribute('aria-labelledby')).length === 1, 'the strip names itself by its heading');
});

test('layout: a refused Save puts an error summary in the status and focuses its heading', async () => {
  const page = loadPage(namedState());
  await settle();
  await type(field(page, 'architect', 'user', 'talk'), 'bad: value');
  await page.setLevel('project');
  await type(field(page, 'qa', 'project', 'topic'), 'x<y');
  await page.setLevel('user');
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
  assert.ok(links[0].textContent.startsWith('Ava (architect), user level, Way of talking: can'));
  assert.ok(links[1].textContent.startsWith('qa, project level, Pet topic: can'));
  // The project field is hidden while User is shown; following its link must reveal it.
  for (const link of links) {
    for (const fn of link.listeners.click) fn({ preventDefault() {} });
    const target = link.getAttribute('href').slice(1);
    assert.ok(byId(page, target), `href ${link.getAttribute('href')} names an existing field after following it`);
  }
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

// R-3 / R-7: the server refuses a field of the level that is NOT shown. Each summary link needs text, and following it must
// switch the level (lvl-project checked) and focus the live field. page.find() switches level silently, so the level is
// read from the radio before any find() and the focus check compares with the node that find() returns afterwards.
const TOPIC_REFUSAL = "project roles.qa.personality.topic: must be one line of letters, digits, single spaces and , . ' - ! ?; each word starts with a letter or digit";
const HIDDEN_CASES = [
  { name: 'personality text', line: TOPIC_REFUSAL, id: 'pf-qa-project-topic', text: /^qa, project level, Pet topic: \S/ },
  { name: 'personality select', line: 'project roles.qa.personality.intelligence: must be low, medium or high', id: 'pf-qa-project-intelligence', text: /^qa, project level, Intelligence: \S/ },
  { name: 'plan_check.policy', line: 'project plan_check.policy must be off, warn or block', id: 'pc-policy-project', text: /^Plan check, Policy, project level: \S/ },
  { name: 'plan_check.runs', line: 'project plan_check.runs must be a whole number from 3 to 50', id: 'pc-runs-project', text: /^Plan check, Verdict runs, project level: \S/ },
  { name: 'pipeline.parallel_cap', line: 'project pipeline.parallel_cap must be 3, 4 or 5', id: 'parallel-cap-project', text: /^Parallel cap, project level: \S/ }
];
async function refusedAtHiddenLevel(lines) {
  const page = loadPage(namedState(), { saveReply: { status: 400, body: { refused: lines } } });
  await settle();
  assert.equal(page.ids['lvl-user'].checked, true, 'User is the shown level');
  await type(field(page, 'qa', 'user', 'talk'), 'fine value');
  assert.equal(page.ids['lvl-user'].checked, true, 'typing at User keeps User shown');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(page.ids['lvl-user'].checked, true, 'the refusal does not switch the level by itself');
  return page;
}

for (const c of HIDDEN_CASES) {
  test(`layout: a server refusal of ${c.name} at the hidden level is one summary link with text that switches the level and focuses the field`, async () => {
    const page = await refusedAtHiddenLevel([c.line]);
    const heading = walk(page.ids.status, (n) => n.id === 'status-heading');
    assert.equal(heading.textContent, 'Nothing was saved. Fix 1 field:');
    const links = walkAll(page.ids.status, (n) => n.tagName === 'A');
    assert.equal(links.length, 1, 'one link for the one refused field');
    assert.equal(links[0].getAttribute('href'), `#${c.id}`);
    assert.ok(links[0].textContent.trim() !== '', 'the link has text');
    assert.match(links[0].textContent, c.text);
    await links[0].fire('click');
    await settle();
    assert.equal(page.ids['lvl-project'].checked, true, 'following the link switches to Project');
    assert.equal(page.ids['lvl-user'].checked, false);
    const live = page.find((n) => n.id === c.id);
    assert.ok(live, 'the field exists at the shown level');
    assert.equal(page.ids['lvl-project'].checked, true, 'find() did not need to switch the level');
    // Key-cap radio groups (console layout) carry the id on the group; focus() lands on a radio inside it.
    // ok() on a boolean: assert.equal on two DOM nodes builds a huge diff and hangs the run for minutes.
    const active = page.document.activeElement;
    assert.ok(active === live || walk(live, (n) => n === active) !== null,'the field (or a radio inside its group) has focus');
  });
}

test('layout: refusals at the hidden level for personality, plan check, parallel cap and skills are all counted, none has an empty link', async () => {
  const lines = [...HIDDEN_CASES.map((c) => c.line), 'project roles.qa.skills: at most 5 skills'];
  const page = await refusedAtHiddenLevel(lines);
  assert.equal(walk(page.ids.status, (n) => n.id === 'status-heading').textContent, 'Nothing was saved. Fix 6 fields:');
  const links = walkAll(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(links.length, 5);
  for (const link of links) assert.ok(link.textContent.trim() !== '', `link ${link.getAttribute('href')} has text`);
  assert.deepEqual(links.map((l) => l.getAttribute('href')).sort(), HIDDEN_CASES.map((c) => `#${c.id}`).sort());
  const items = walkAll(page.ids.status, (n) => n.tagName === 'LI');
  assert.equal(items.length, 6);
  assert.ok(items.some((li) => li.textContent === 'qa, project level, Skills: the server refused the list: a Role can have 5 skills.' && walkAll(li, (n) => n.tagName === 'A').length === 0), 'the skills line is plain text');
});

test('layout: a link that does nothing fails the check: a refused user-level field is already shown, so only a hidden one proves the switch', async () => {
  const page = await refusedAtHiddenLevel([TOPIC_REFUSAL]);
  const link = walk(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(page.ids['lvl-project'].checked, false, 'before the click Project is hidden');
  await link.fire('click');
  await settle();
  assert.equal(page.ids['lvl-project'].checked, true);
});

test('layout: after a successful Save focus is not on body: the same control when it still works, else the status message', async () => {
  const page = loadPage(namedState(), { saveReply: { status: 200, body: { state: namedState() } } });
  await settle();
  await type(field(page, 'qa', 'user', 'talk'), 'calm');
  page.document.activeElement = page.ids.save;
  await page.ids.save.fire('click');
  await settle();
  assert.ok(walk(page.ids.status, (n) => n.id === 'status-message'));
  assert.equal(page.document.activeElement, page.ids.save, 'Save stays focusable after a reload');
  const card = page.all((n) => n.tagName === 'DETAILS')[1];
  card.open = true;
  await card.fire('toggle');
  await type(field(page, 'qa', 'user', 'topic'), 'tea');
  page.document.activeElement = field(page, 'qa', 'user', 'topic');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(page.document.activeElement, field(page, 'qa', 'user', 'topic'), 'the rebuilt control with the same id');
});

test('layout: a focused control that is gone after the reload hands focus to the status message, after 200 and after 409', async () => {
  for (const status of [200, 409]) {
    const gone = { ...namedState(), hasProject: false };
    const page = loadPage(namedState(), { saveReply: { status, body: { state: gone } } });
    await settle();
    await type(field(page, 'qa', 'user', 'talk'), 'calm');
    page.document.activeElement = page.ids['clear-project'];
    await page.ids.save.fire('click');
    await settle();
    assert.equal(page.ids['clear-project'].disabled, true, `status ${status}`);
    const active = page.document.activeElement;
    assert.equal(active.id, 'status-message', `status ${status}`);
    assert.equal(active.getAttribute('tabindex'), '-1', `status ${status}`);
  }
});

test('layout: after Save and after a stale reload the status message is scrolled into view, and focus does not move', async () => {
  for (const status of [200, 409]) {
    const page = loadPage(namedState(), { saveReply: { status, body: { state: namedState() } } });
    await settle();
    await type(field(page, 'qa', 'user', 'talk'), 'calm');
    page.document.activeElement = page.ids.save;
    await page.ids.save.fire('click');
    await settle();
    assert.equal(page.document.activeElement, page.ids.save, `status ${status}`);
    const hit = (page.document.scrolled ?? []).find((s) => s.node.id === 'status-message');
    assert.ok(hit, `status ${status}`);
    assert.equal(hit.options.block, 'nearest', `status ${status}`);
  }
});

test('layout: a stale-revision reload and Done also keep focus on a real element', async () => {
  const stale = loadPage(namedState(), { saveReply: { status: 409, body: { state: namedState() } } });
  await settle();
  await type(field(stale, 'qa', 'user', 'talk'), 'calm');
  stale.document.activeElement = stale.ids.save;
  await stale.ids.save.fire('click');
  await settle();
  assert.equal(stale.document.activeElement.id, 'save');
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
  const hintCall = `el('p', { class: 'hint', id: 'plan-check-hint', style: 'margin-bottom: 12px' }, '${planHintText()}')`;
  assert.equal(html.split(hintCall).length - 1, 1, 'hint must match the Contract exactly, once');
  const reprompt = html.indexOf("id: 'reprompt-hint'");
  const h2 = html.indexOf("sectionHead('Plan check')");
  const brainstorm = html.indexOf("sectionHead('Brainstorm')");
  assert.ok(reprompt > 0 && reprompt < h2 && h2 < html.indexOf(hintCall) && html.indexOf(hintCall) < brainstorm);
  assert.ok(!/tabIndex: [1-9]|tabindex="[1-9]/.test(html), 'no positive tabindex');
  assert.ok(!/innerHTML/.test(html));
});

const planField = (page, key, level) => byId(page, `pc-${key}-${level}`);

test('Plan check controls have a visible label tied by for, no aria-label, and the hint in aria-describedby', async () => {
  const page = loadPage(pageState());
  await settle();
  assert.equal(byId(page, 'plan-check-hint').textContent, planHintText());
  for (const level of ['user', 'project']) {
    // Policy: a key-cap group inside a fieldset; the legend is the visible label.
    const group = planField(page, 'policy', level);
    assert.ok(group, `policy ${level}`);
    assert.ok(group.getAttribute('aria-label') === null, 'no aria-label');
    const box = closest(group, 'FIELDSET');
    const legend = box.children.find((n) => n.tagName === 'LEGEND');
    assert.ok(legend.textContent.startsWith('Policy'), legend.textContent);
    assert.ok(legend.textContent.includes(`${level} level`));
    assert.ok(box.getAttribute('aria-describedby').split(' ').includes('plan-check-hint'));
    assert.ok(group.radios.every((r) => page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === r.id)), 'every key has a label');
    // Verdict runs: a text input with a label tied by for.
    const control = planField(page, 'runs', level);
    assert.ok(control, `runs ${level}`);
    assert.ok(control.getAttribute('aria-label') === null, 'no aria-label');
    const label = page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id);
    assert.ok(label.textContent.startsWith('Verdict runs'), label.textContent);
    assert.ok(label.textContent.includes(`${level} level`));
    assert.ok(control.getAttribute('aria-describedby').split(' ').includes('plan-check-hint'));
  }
  const keys = planField(page, 'policy', 'user').radios.map((r) => r.value);
  assert.equal(JSON.stringify(Array.from(keys)), '["","off","warn","block"]');
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
  const err = byId(page, ids.find((i) => i === 'pc-runs-user-err'));
  assert.ok(err, 'the error text is tied to the field');
  assert.equal(err.textContent, 'Error: Verdict runs is out of range. Use a whole number from 3 to 50.');
  await type(runs, 'x');
  assert.equal(err.textContent, 'Error: Verdict runs must be a whole number from 3 to 50.');
  await page.ids.save.fire('click');
  assert.equal(page.calls.filter((c) => c.url === '/api/save').length, 0);
  assert.ok(page.document.activeElement === walk(page.ids.status, (n) => n.id === 'status-heading'), 'focus goes to the summary heading');
  const link = walk(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(link.getAttribute('href'), '#pc-runs-user');
  assert.match(link.textContent, /^Plan check, Verdict runs, user level: /);
  await page.ids['tab-roles'].fire('click');
  await link.fire('click');
  assert.ok(page.document.activeElement === runs, 'the link focuses the field');
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
  assert.ok(page.document.activeElement === heading, 'focus goes to the summary heading');
  assert.equal(heading.textContent, 'Nothing was saved. Fix 2 fields:');
  const links = walkAll(page.ids.status, (n) => n.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), '#pc-policy-project');
  assert.equal(closest(policy, 'FIELDSET').getAttribute('aria-invalid'), 'true', 'the field box is marked');
  assert.ok(page.ids.status.textContent.includes('stale thing'));
  await links[0].fire('click');
  const active = page.document.activeElement;
  assert.ok(active === policy || walk(policy, (n) => n === active) !== null, 'the link focuses the group (a radio inside it)');
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

function floorState() {
  const st = pageState();
  st.resolved.roles.architect = { name: 'architect', model: 'opus', effort: 'medium', context_cap: 95000, floor: 'opus', protected: true, source: { model: 'floor' } };
  st.resolved.roles.qa = { ...st.resolved.roles.qa, floor: 'sonnet', protected: false };
  return st;
}
const modelControl = (page, role, level) => page.find((n) => n.id === `rf-${role}-${level}-model`);

test('a protected Role gets the floor hint on the Model group at both levels, tied with aria-describedby, and the label stays', async () => {
  const page = loadPage(floorState());
  await settle();
  for (const level of ['user', 'project']) {
    await page.setLevel(level);
    const control = modelControl(page, 'architect', level);
    const bank = closest(control, 'FIELDSET');
    const hint = byId(page, `rf-architect-${level}-model-hint`);
    assert.equal(hint.textContent, 'Protected: runs at opus or higher at every risk tier.');
    assert.ok(bank.getAttribute('aria-describedby').split(' ').includes(hint.id));
    assert.equal(hint.hidden, false);
    assert.ok(page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === control.id));
    const qa = modelControl(page, 'qa', level);
    assert.equal(byId(page, `rf-qa-${level}-model-hint`), null);
    assert.equal(closest(qa, 'FIELDSET').getAttribute('aria-describedby'), null);
  }
});

const modelReadout = (page, role) => {
  const strip = closest(modelControl(page, role, 'user'), 'ARTICLE');
  const readout = strip.children.find((n) => n.className === 'readout');
  return { value: readout.children[3].textContent, source: readout.children[4].getAttribute('data-src') };
};

test('a model that came from the floor reads floor in the In effect cell', async () => {
  const page = loadPage(floorState());
  await settle();
  assert.deepEqual(modelReadout(page, 'architect'), { value: 'opus', source: 'floor' });
});

test('a protected pick below the floor shows the floor in effect before saving', async () => {
  const page = loadPage(floorState());
  await settle();
  const haiku = page.find((n) => n.tagName === 'INPUT' && n.name === 'rf-architect-user-model' && n.value === 'haiku');
  haiku.checked = true;
  await haiku.fire('change');
  assert.deepEqual(modelReadout(page, 'architect'), { value: 'opus', source: 'floor' });
});

test('a field error on the Roles tab is announced through a live region', async () => {
  const page = loadPage(floorState());
  await settle();
  const name = page.find((n) => n.id === 'rf-qa-user-name');
  await type(name, 'x'.repeat(31));
  await name.fire('input');
  assert.match(page.ids['field-live'].textContent, /^Error: Name is 31 characters/);
  await type(name, 'ok');
  assert.equal(page.ids['field-live'].textContent, '');
});

test('the page has the live region, no positive tabindex and builds the hint without innerHTML', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  assert.match(html, /<div id="field-live"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.ok(!/tabindex="[1-9]/i.test(html));
  assert.ok(!html.includes('innerHTML'));
  assert.ok(html.includes('Protected: runs at '));
});

test('state carries the parallel_cap default; save round-trips 3 to 5 and refuses other values with nothing written', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.equal(before.plugin.pipeline.parallel_cap, 4);
  assert.equal(before.resolved.pipeline.parallel_cap, 4);
  for (const bad of [2, 6, 4.5, '4', null, 1e9]) {
    const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, pipeline: { parallel_cap: bad } } });
    assert.equal(res.status, 400);
    const { refused } = await res.json();
    assert.ok(refused.some((r) => r.includes('pipeline.parallel_cap must be a whole number from 3 to 5')), refused.join(' | '));
  }
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, pipeline: { parallel_cap: 3 } }, project: { version: 1, pipeline: { parallel_cap: 5 } } });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.equal(after.resolved.pipeline.parallel_cap, 5);
});

// Hint paragraph ids of the Pipeline panel in document order, at the level the page shows.
const pipelineHintIds = (page) => walkAll(page.ids['panel-pipeline'], (n) => n.tagName === 'P' && /-hint$/.test(n.id ?? '')).map((n) => n.id);

test('page has a Parallel cap row after Dispatch with label-for selects tied to the hint, and a refusal path', async () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ['parallelCapRow(rack, defaults.parallel_cap)', "['pipeline', 'parallel_cap']", 'options: [3, 4, 5]',
    "id: 'parallel-cap-hint'", "refusal: 'parallel_cap'", 'REFUSED_PARALLEL_CAP', "getElementById('field-live')"]) {
    assert.ok(html.includes(needle), needle);
  }
  const body = html.slice(html.indexOf('function renderPipeline'));
  const dispatch = body.indexOf("label: 'Dispatch'");
  const row = body.indexOf('parallelCapRow(rack, defaults.parallel_cap)');
  const review = body.indexOf("label: 'Review format'");
  assert.ok(dispatch > 0 && dispatch < row && row < review, `order ${dispatch} ${row} ${review}`);
  assert.ok(!/tabindex/i.test(html.slice(html.indexOf('function parallelCapRow'), html.indexOf('const REFUSED_SHORT_PATH'))));
  // Rendered: the key-cap group sits in a fieldset whose legend is the label and whose description is the hint.
  const page = loadPage(pageState());
  await settle();
  for (const level of ['user', 'project']) {
    const group = byId(page, `parallel-cap-${level}`);
    assert.ok(group, level);
    assert.equal(JSON.stringify(Array.from(group.radios, (r) => r.value)), '["","3","4","5"]');
    const box = closest(group, 'FIELDSET');
    assert.ok(box.children.some((n) => n.tagName === 'LEGEND' && n.textContent.startsWith('Parallel cap')), 'legend is the label');
    assert.ok(box.getAttribute('aria-describedby').split(' ').includes('parallel-cap-hint'), 'hint tied to the field');
    assert.ok(group.radios.every((r) => page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === r.id)), 'every key has a label');
  }
});

test('Parallel cap hint equals the Contract text once and, in the v2.1 order, comes first: parallel cap, short path, user-only rows, review format, context cap, reprompt, plan check', async () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = /exactly: "(At most this many Steps run at once[^"]*)"/.exec(contract);
  assert.ok(m, 'Contract hint not found');
  assert.equal(html.split("id: 'parallel-cap-hint', text: PARALLEL_CAP_HINT").length - 1, 1, 'the row uses that text, once');
  const page = loadPage(pageState());
  await settle();
  // Contract v2.1 render order: parallel cap, short path, second reviewer, model, worktrees, review format, context cap (closes the rack), reprompt, plan check.
  const ids = pipelineHintIds(page);
  const at = (id) => ids.indexOf(id);
  const order = ['parallel-cap-hint', 'short-path-hint', 'second-reviewer-hint', 'second-reviewer-model-hint', 'worktrees-hint', 'context-cap-hint', 'reprompt-hint'];
  assert.ok(order.every((id) => at(id) >= 0), ids.join(' '));
  assert.ok(order.every((id, i) => i === 0 || at(order[i - 1]) < at(id)), ids.join(' '));
  assert.ok(at('parallel-cap-hint') === Math.min(...ids.map((_, i) => i).filter((i) => ids[i] !== undefined)), 'the Parallel cap hint is the first hint in the pipeline panel');
  // The Contract text, byte for byte: the page text and the constant must both equal it.
  assert.equal(html.split(`const PARALLEL_CAP_HINT = '${m[1]}';`).length - 1, 1, 'hint must match the Contract exactly, once');
  assert.ok(byId(page, 'parallel-cap-hint').textContent === m[1], 'rendered hint equals the Contract text');
});

test('state carries the short_path default; save round-trips on/off and refuses other values with nothing written', async (t) => {
  const s = sandbox(t);
  const { post, state } = await start(t, s);
  const before = await state();
  assert.equal(before.plugin.pipeline.short_path, 'on');
  assert.equal(before.resolved.pipeline.short_path, 'on');
  for (const bad of ['maybe', true, 1, null, 'ON']) {
    const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, pipeline: { short_path: bad } } });
    assert.equal(res.status, 400);
    const { refused } = await res.json();
    assert.ok(refused.some((r) => r.includes('pipeline.short_path must be on or off')), refused.join(' | '));
  }
  assert.equal(read(s.config), null);
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, pipeline: { short_path: 'on' } }, project: { version: 1, pipeline: { short_path: 'off' } } });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  assert.equal(after.resolved.pipeline.short_path, 'off');
});

test('page has a Short path row after Parallel cap with label-for selects tied to the hint, project offers only off, and a refusal path', async () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  for (const needle of ['shortPathRow(rack, defaults.short_path)', "['pipeline', 'short_path']", "level === 'user' ? ['on', 'off']", "['off']",
    "id: 'short-path-hint'", "refusal: 'short_path'", 'REFUSED_SHORT_PATH', "getElementById('field-live')"]) {
    assert.ok(html.includes(needle), needle);
  }
  const body = html.slice(html.indexOf('function renderPipeline'));
  const cap = body.indexOf('parallelCapRow(rack, defaults.parallel_cap)');
  const row = body.indexOf('shortPathRow(rack, defaults.short_path)');
  const review = body.indexOf("label: 'Review format'");
  assert.ok(cap > 0 && cap < row && row < review, `order ${cap} ${row} ${review}`);
  assert.ok(!/tabindex/i.test(html.slice(html.indexOf('function shortPathRow'), html.indexOf('const REFUSED_PLAN_CHECK'))));
  assert.ok(!html.includes('innerHTML'));
  const page = loadPage(pageState());
  await settle();
  const user = byId(page, 'short-path-user');
  const project = byId(page, 'short-path-project');
  assert.ok(user && project);
  assert.equal(JSON.stringify(Array.from(user.radios, (r) => r.value)), '["","on","off"]');
  assert.equal(JSON.stringify(Array.from(project.radios, (r) => r.value)), '["","off"]', 'project offers only off');
  for (const group of [user, project]) {
    const box = closest(group, 'FIELDSET');
    assert.ok(box.children.some((n) => n.tagName === 'LEGEND' && n.textContent.startsWith('Short path')), 'legend is the label');
    assert.ok(box.getAttribute('aria-describedby').split(' ').includes('short-path-hint'), 'hint tied to the field');
  }
});

test('Short path hint equals the Contract text once and, in the v2.1 order, is the second hint (right after Parallel cap, before the user-only rows), before Reprompt', async () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = /exactly: "(A feature you approve as low risk[^"]*)"/.exec(contract);
  assert.ok(m, 'Contract hint not found');
  assert.equal(html.split("id: 'short-path-hint', text: SHORT_PATH_HINT").length - 1, 1, 'the row uses that text, once');
  const page = loadPage(pageState());
  await settle();
  const ids = pipelineHintIds(page);
  assert.ok(ids.indexOf('parallel-cap-hint') === 0 && ids.indexOf('short-path-hint') === 1 && ids.indexOf('short-path-hint') < ids.indexOf('second-reviewer-hint') && ids.indexOf('short-path-hint') < ids.indexOf('reprompt-hint'), ids.join(' '));
  assert.equal(html.split(`const SHORT_PATH_HINT = '${m[1]}';`).length - 1, 1, 'hint must match the Contract exactly, once');
  assert.ok(byId(page, 'short-path-hint').textContent === m[1], 'rendered hint equals the Contract text');
});

const pageSource = () => fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const contractHint = (start) => {
  const contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const m = new RegExp(`exactly: "(${start}[^"]*)"`).exec(contract);
  assert.ok(m, `Contract hint ${start} not found`);
  return m[1];
};

test('user-only rows come after Short path in the pipeline panel, in order, and are built through el() and textContent', () => {
  const html = pageSource();
  const body = html.slice(html.indexOf('function renderPipeline'));
  const short = body.indexOf('shortPathRow(rack, defaults.short_path)');
  const rev = body.indexOf('userOnlyRow(rack, USER_ONLY_ROWS.second_reviewer,');
  const model = body.indexOf('userOnlyRow(rack, USER_ONLY_ROWS.second_reviewer_model,');
  const wt = body.indexOf('userOnlyRow(rack, USER_ONLY_ROWS.worktrees,');
  const review = body.indexOf("label: 'Review format'");
  assert.ok(short > 0 && short < rev && rev < model && model < wt && wt < review, `order ${short} ${rev} ${model} ${wt} ${review}`);
  assert.ok(!html.includes('innerHTML'));
  const fn = html.slice(html.indexOf('function userOnlyRow'), html.indexOf('const REFUSED_PLAN_CHECK'));
  assert.ok(!/tabindex/i.test(fn));
  for (const needle of ["el('legend'", "'aria-describedby'", 'User level only', 'refusal: key', 'segFor(']) {
    assert.ok(fn.includes(needle), needle);
  }
  assert.ok(html.slice(html.indexOf('function finishCtl'), html.indexOf('function showFieldError')).includes("'aria-live'"), 'readout is a live region');
  assert.ok(html.slice(html.indexOf('function refusalRec'), html.indexOf('function planRec(')).includes("getElementById('field-live')"), 'refusal is announced');
});

test('Second reviewer, Second reviewer model and Worktrees hints equal the Contract text once, each tied by id', async () => {
  const html = pageSource();
  const cases = [
    ['SECOND_REVIEWER_HINT', 'second-reviewer-hint', 'At high risk, a fresh reviewer'],
    ['SECOND_REVIEWER_MODEL_HINT', 'second-reviewer-model-hint', 'The Claude model the second reviewer runs on'],
    ['WORKTREES_HINT', 'worktrees-hint', 'Parallel builder tasks each get'],
  ];
  const page = loadPage(pageState());
  await settle();
  const ids = pipelineHintIds(page);
  let last = ids.indexOf('short-path-hint');
  assert.ok(last >= 0, ids.join(' '));
  const differs = [];
  for (const [name, id, start] of cases) {
    const text = contractHint(start);
    if (html.split(`const ${name} = ${JSON.stringify(text)};`).length - 1 !== 1) differs.push(name);
    const hint = byId(page, id);
    assert.ok(hint, id);
    if (hint.textContent !== text) differs.push(`${id} (rendered)`);
    const box = closest(hint, 'FIELDSET');
    assert.ok(box.getAttribute('aria-describedby').split(' ').includes(id), `${id} tied to the field`);
    const at = ids.indexOf(id);
    assert.ok(at > last, `${id} hint order`);
    last = at;
  }
  assert.ok(last < ids.indexOf('reprompt-hint'));
  assert.deepEqual(differs, [], 'hint text must equal the Contract text, once');
});

test('Second reviewer model offers only the values the code-reviewer floor allows', () => {
  const html = pageSource();
  const fn = html.slice(html.indexOf('function reviewerModelOptions'), html.indexOf('function userOnlyRow'));
  assert.ok(fn.includes("protectedFloor('code-reviewer')"));
  assert.ok(fn.includes('MODEL_RANK'));
  // Run the page's own function against a floor of opus, sonnet and an unreadable floor.
  const run = (floor) => [...vm.runInNewContext(`${'const MODEL_RANK = { haiku: 1, sonnet: 2, opus: 3 };'}\nconst protectedFloor = () => ${JSON.stringify(floor)};\n${fn}\nreviewerModelOptions()`)];
  assert.deepEqual(run('opus'), ['default', 'opus']);
  assert.deepEqual(run('sonnet'), ['default', 'sonnet', 'opus']);
  assert.deepEqual(run(''), ['default', 'opus']);
});

test('user-only rows lock the Project column with a visible reason and have no project control', async () => {
  const html = pageSource();
  const fn = html.slice(html.indexOf('function userOnlyRow'), html.indexOf('const REFUSED_PLAN_CHECK'));
  assert.ok(fn.includes('User level only. A project value is ignored.'));
  assert.ok(!fn.includes("['user', 'project']"), 'no project select');
  for (const key of ['second_reviewer', 'second_reviewer_model', 'worktrees']) assert.ok(html.includes(`${key}:`), key);
  assert.ok(html.includes('REFUSED_USER_ONLY'));
  const page = loadPage(pageState());
  await settle();
  await page.setLevel('project');
  for (const slug of ['second-reviewer', 'second-reviewer-model', 'worktrees']) {
    const note = byId(page, `${slug}-lock`);
    assert.ok(note, `${slug} shows its reason at the project level`);
    assert.equal(note.textContent, 'User level only. A project value is ignored.');
    const box = closest(note, 'FIELDSET');
    assert.ok(box.getAttribute('aria-describedby').split(' ').includes(note.id), 'reason tied to the field');
    const inputs = walkAll(box, (n) => n.tagName === 'INPUT');
    assert.ok(inputs.length > 0 && inputs.every((n) => n.disabled === true), `${slug}: every project key is disabled`);
    assert.ok(byId(page, `${slug}-project`) === null, 'no editable project control');
  }
});

test('a stored project short_path on shows disabled and is described as ignored', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  assert.ok(html.includes("state.project.pipeline?.short_path === 'on'"));
  assert.ok(html.includes('a project can only turn the short path off'));
});

// Loads the page's own resolver functions into a vm with the given layers and runs them.
function loadEffective(draft) {
  const html = pageHtml();
  const grab = (name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n}\n', start) + 3);
  };
  const ctx = vm.createContext({ draft, LOCKED_GATES: [], LOCKED_LANES: [], userUnlocked: () => false });
  vm.runInContext(html.split('\n').find((l) => l.startsWith('const has = ')) + '\n' + ['getIn', 'pickSource', 'modsEffective', 'effective'].map(grab).join('\n'), ctx);
  return ctx.effective;
}

test('effective() on pipeline.short_path: a project on is held and the user value (or on) applies', () => {
  const p = ['pipeline', 'short_path'];
  const held = 'on from project is ignored: a project can only turn the short path off';
  const userOff = loadEffective({ user: { pipeline: { short_path: 'off' } }, project: { pipeline: { short_path: 'on' } } })(p, 'on');
  assert.deepEqual({ ...userOff }, { value: 'off', source: 'locked', held });
  const noUser = loadEffective({ user: {}, project: { pipeline: { short_path: 'on' } } })(p, 'on');
  assert.deepEqual({ ...noUser }, { value: 'on', source: 'locked', held });
  const projOff = loadEffective({ user: { pipeline: { short_path: 'on' } }, project: { pipeline: { short_path: 'off' } } })(p, 'on');
  assert.deepEqual({ ...projOff }, { value: 'off', source: 'project' });
  const none = loadEffective({ user: {}, project: {} })(p, 'on');
  assert.deepEqual({ ...none }, { value: 'on', source: 'plugin' });
});

test('a stored project short_path on is styled disabled and its select points at the effect cell', async () => {
  const html = pageHtml();
  const row = html.slice(html.indexOf('function shortPathRow'), html.indexOf('const REFUSED_PLAN_CHECK'));
  assert.ok(row.includes("fixed: ignored ? ['on'] : []"), 'the stored on key is fixed (disabled)');
  assert.ok(row.includes('effectId'));
  assert.ok(html.split('\n').some((ln) => ln.startsWith('.seg.ignored {')), 'a .seg.ignored rule');
  const st = pageState();
  st.project = { version: 1, pipeline: { short_path: 'on' } };
  const page = loadPage(st);
  await settle();
  await page.setLevel('project');
  const group = byId(page, 'short-path-project');
  assert.ok(group, 'project group');
  const on = group.radios.find((r) => r.value === 'on');
  assert.ok(on && on.disabled === true, 'the stored on key is disabled');
  assert.ok(group.className.split(' ').includes('ignored'), 'the group carries the ignored class');
  const box = closest(group, 'FIELDSET');
  assert.ok(box.getAttribute('aria-describedby').split(' ').includes('short-path-effect'), 'the group is described by the effect cell');
  assert.ok(byId(page, 'short-path-effect'), 'the effect cell exists');
});

test('a stored project short_path on gets a style rule for the key-cap group, with a descendant label rule too', () => {
  const html = pageHtml();
  assert.ok(/^\.seg\.ignored\s*\{/m.test(html) && /^\.seg\.ignored label\s*\{/m.test(html), 'CSS rules for .seg.ignored and .seg.ignored label');
});

test('the muted ignored key-cap group keeps full-strength text, with a non-colour cue, in forced colors too', () => {
  const html = pageHtml();
  const rule = html.match(/^\.seg\.ignored \{([^}]*)\}/m);
  const lab = html.match(/^\.seg\.ignored label \{([^}]*)\}/m);
  assert.ok(rule && lab, '.seg.ignored and .seg.ignored label rules');
  assert.ok(!/opacity/.test(rule[1] + lab[1]), 'no opacity on the text or border');
  assert.ok(rule[1].includes('color: var(--color-ink-2)') && lab[1].includes('color: var(--color-ink-2)'));
  assert.ok(rule[1].includes('outline: 2px dashed'), 'a dashed outline is the non-colour cue');
  const forced = html.match(/@media \(forced-colors: active\) \{[^@]*?\.seg\.ignored \{([^}]*)\}/);
  assert.ok(forced, 'forced-colors override');
  assert.ok(forced[1].includes('outline: 2px dashed CanvasText') && !/GrayText|opacity/.test(forced[1]));
  const forcedText = html.match(/@media \(forced-colors: active\) \{[^@]*?\.seg\.ignored, \.seg\.ignored label \{([^}]*)\}/);
  assert.ok(forcedText && forcedText[1].includes('CanvasText') && !/GrayText|opacity/.test(forcedText[1]), 'forced-colors text stays CanvasText');
});

test('the ignored class follows the project select value, so picking off or blank removes it', () => {
  const html = pageHtml();
  const row = html.slice(html.indexOf('function shortPathRow'), html.indexOf('const REFUSED_PLAN_CHECK'));
  assert.ok(row.includes("control.classList.toggle('ignored', ignored && control.value === 'on')"));
});

// ---------- role skills ----------

function userCatalog(s, entries) {
  const dir = path.join(s.home, '.mcsparrow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries }));
}
const QA_PICK = { skillname: 'qa-helper', skillcategory: 'quality', skillrepo: 'someone/qa-helper', skillcommit: 'b'.repeat(40), license: 'MIT stated by me', vetted: '2026-01-02' };

test('GET /api/state carries the catalog with license, vetted, status and eligible Roles, and no home path', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK, { skillname: 'cmd-tool', skillcategory: 'quality', skillinstaller: 'npx tool@1.2.3', license: 'ISC', vetted: '2026-01-02' }]);
  const { state } = await start(t, s);
  const st = await state();
  assert.ok(Array.isArray(st.catalog.entries));
  const byName = Object.fromEntries(st.catalog.entries.map((e) => [e.name, e]));
  assert.deepEqual(byName['qa-helper'].roles, ['qa', 'code-reviewer', 'fresh-reviewer', 'hands-on-tester', 'persona-tester', 'accessibility-tester']);
  assert.equal(byName['qa-helper'].license, 'MIT stated by me, as stated, not checked');
  assert.equal(byName['qa-helper'].vetted, '2026-01-02');
  assert.equal(byName['qa-helper'].status, 'missing');
  assert.equal(byName['qa-helper'].selectable, true);
  assert.equal(byName['cmd-tool'].vetted, null);
  assert.equal(byName['golang-*'].selectable, false);
  assert.equal(byName['vercel-react-best-practices'].license, 'no license on record');
  assert.equal(byName['find-skills'].layer, 'baseline');
  assert.equal(JSON.stringify(st.catalog).includes(s.home), false);
  assert.equal(JSON.stringify(st.catalog).includes(os.homedir()), false);
  assert.equal(st.resolved.settings_folder_moved, false);
});

test('save round-trips a skills list, dates it by the server and refuses a bad one with nothing written', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  const { post, state } = await start(t, s);
  const before = await state();
  const bad = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'SECRET-NAME' }] } } } });
  assert.equal(bad.status, 400);
  const refused = (await bad.json()).refused.join(' ');
  assert.match(refused, /roles\.qa\.skills\[0\]\.name: not selectable for this Role/);
  assert.equal(refused.includes('SECRET-NAME'), false);
  assert.equal(read(s.config), null);
  const prot = await post('/api/save', { revision: before.resolved.revision, project: { version: 1, roles: { architect: { skills: [] } } } });
  assert.equal(prot.status, 400);
  assert.equal(read(s.projectFile), null);
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper', approved: '1999-01-01' }] } } } });
  assert.equal(ok.status, 200);
  const { state: after } = await ok.json();
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(after.resolved.roles.qa.skills, [{ name: 'qa-helper', approved: today }]);
  assert.equal(after.resolved.roles.qa.source.skills, 'user');
});

test('a sixth skill is refused by the server with the field named and nothing written, and the served page has the Skills tab', async (t) => {
  const s = sandbox(t);
  const picks = ['qa-one', 'qa-two', 'qa-three', 'qa-four', 'qa-five', 'qa-six'].map((skillname, n) => ({ ...QA_PICK, skillname, skillrepo: `someone/${skillname}`, skillcommit: String(n + 1).repeat(40) }));
  userCatalog(s, picks);
  const { post, state } = await start(t, s);
  const before = await state();
  const names = picks.map((p) => ({ name: p.skillname }));
  const six = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: names } } } });
  assert.equal(six.status, 400);
  assert.match((await six.json()).refused.join(' '), /roles\.qa\.skills: must be at most 5 skills/);
  assert.equal(read(s.config), null);
  const five = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: names.slice(0, 5) } } } });
  assert.equal(five.status, 200);
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  assert.match(html, /<button role="tab" id="tab-skills" aria-controls="panel-skills"/);
  assert.match(html, /<section role="tabpanel" id="panel-skills"/);
});

test('a skill selected at user level is read from the user home only, so a planted product folder does not count', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  const { post, state } = await start(t, s);
  const before = await state();
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }] } } } });
  assert.equal(ok.status, 200);
  fs.mkdirSync(path.join(s.cwd, '.claude', 'skills', 'qa-helper'), { recursive: true });
  fs.writeFileSync(path.join(s.cwd, '.claude', 'skills', 'qa-helper', 'SKILL.md'), '---\nname: qa-helper\n---\n');
  const row = (await state()).catalog.entries.find((e) => e.name === 'qa-helper');
  assert.equal(row.status, 'missing');
  assert.notEqual(row.place, 'project');
  fs.mkdirSync(path.join(s.home, '.claude', 'skills', 'qa-helper'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.claude', 'skills', 'qa-helper', 'SKILL.md'), '---\nname: qa-helper\n---\n');
  const home = (await state()).catalog.entries.find((e) => e.name === 'qa-helper');
  assert.notEqual(home.status, 'missing');
});

test('a user-only save is not refused for a stale or protected list in the stored project layer, and the mirror holds', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill' }] }, security: { skills: [{ name: 'security-review' }] } } } }));
  const { post, state } = await start(t, s);
  const before = await state();
  const ok = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }] } } } });
  assert.equal(ok.status, 200);
  fs.unlinkSync(s.projectFile);
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill' }] } } } }));
  const again = await state();
  const mirror = await post('/api/save', { revision: again.resolved.revision, project: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }] } } } });
  assert.equal(mirror.status, 200);
  const bad = await post('/api/save', { revision: (await state()).resolved.revision, project: { version: 1, roles: { security: { skills: [] } } } });
  assert.equal(bad.status, 400);
});

test('catalog rows carry the finished vetted text and the repo for a repo entry', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [
    QA_PICK,
    { ...QA_PICK, skillname: 'qa-scanned', skillrepo: 'someone/qa-scanned', hash: 'sha256:' + 'c'.repeat(64) },
    { skillname: 'cmd-tool', skillcategory: 'quality', skillinstaller: 'npx tool@1.2.3', license: 'ISC' }
  ]);
  const { state } = await start(t, s);
  const byName = Object.fromEntries((await state()).catalog.entries.map((e) => [e.name, e]));
  assert.equal(byName['qa-helper'].skillrepo, 'someone/qa-helper');
  assert.equal(byName['qa-helper'].vetted_text, 'vetted 2026-01-02, from the old list, not scanned here');
  assert.equal(byName['cmd-tool'].vetted_text, 'not vetted');
  assert.equal(byName['cmd-tool'].skillrepo, undefined);
  assert.equal(byName['find-skills'].skillrepo, 'vercel-labs/skills');
  assert.match(byName['find-skills'].vetted_text, /^(not vetted|vetted \d{4}-\d{2}-\d{2})/);
});

test('save refuses a changed user skills list while the settings folder is moved, with nothing written', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  movedSettingsFolder(t, s);
  const { post, state } = await start(t, s, { home: undefined });
  const before = await state();
  assert.equal(before.resolved.settings_folder_moved, true);
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }] } }, gates: { ship: 'ask' } } });
  assert.equal(res.status, 400);
  const text = (await res.json()).refused.join(' ');
  assert.match(text, /roles\.qa\.skills/);
  assert.equal(text.includes('qa-helper'), false);
  assert.equal(fs.existsSync(path.join(s.home, 'config.json')), false);
});

test('save takes stored user names back unchanged while the user level is unread, dates kept', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  movedSettingsFolder(t, s);
  const stored = [{ name: 'ghost-skill', approved: '2025-01-01' }, { name: 'qa-helper', approved: '2025-02-02' }];
  const file = path.join(s.home, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: stored } } } }));
  const { post, state } = await start(t, s, { home: undefined });
  const before = await state();
  assert.equal(before.resolved.settings_folder_moved, true);
  const user = { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill' }, { name: 'qa-helper', approved: '2030-01-01' }] } }, gates: { ship: 'ask' } };
  const res = await post('/api/save', { revision: before.resolved.revision, user });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).aico_settings.roles.qa.skills, stored);
});

// ---------- skills lists while the user layer is unread, repeats, protected Roles ----------

// Moves the settings folder away from the (mocked) user home, so the real home is never read.
function movedSettingsFolder(t, s) {
  const old = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = s.home;
  t.after(() => { if (old === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = old; });
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-userhome-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  return t.mock.method(os, 'userInfo', () => ({ homedir: other }));
}

// The page's own skills filters in a vm, over the given state and catalog entries.
function loadSkillFilters(state, entries) {
  const html = pageHtml();
  const grab = (name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n}\n', start) + 3);
  };
  const lines = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
  const code = [
    html.split('\n').find((l) => l.startsWith('const SKILL_NAME_RE')),
    html.split('\n').find((l) => l.startsWith('const has = ')),
    grab('getIn'),
    lines('const isObj = ', 'const skillList = '),
    lines('function staleSkills', 'const skillEffective')
  ].join('\n');
  const ctx = vm.createContext({ state, skIndex: new Map() });
  const fns = vm.runInContext(`${code}\nskIndex = new Map(${JSON.stringify(entries)}.map((e) => [e.name, e]));\n[withoutStaleSkills, staleSkills]`, ctx);
  const json = (v) => JSON.parse(JSON.stringify(v));
  return { strip: (layer, level) => json(fns[0](json(layer), level)), stale: (level, role) => json(fns[1](level, role)) };
}
const PAGE_ENTRIES = [{ name: 'hallmark', roles: ['qa', 'architect'], selectable: true }];
const sk = (...names) => names.map((name) => ({ name }));

test('page: a stored project skills list of a protected Role is dropped even when empty, and listed as ignored', () => {
  const state = { resolved: { roles: { architect: { protected: true } } }, catalog: { errors: [] }, project: { roles: { architect: { skills: [] } } } };
  const f = loadSkillFilters(state, PAGE_ENTRIES);
  assert.deepEqual(f.strip(state.project, 'project'), {});
  assert.equal(f.stale('project', 'architect').length, 1);
});

test('page: while the user layer is unread, project names are kept and not listed as ignored', () => {
  for (const unread of [{ resolved: { settings_folder_moved: true }, catalog: { errors: [] } }, { resolved: {}, catalog: { errors: ['ERROR user catalog: invalid'] } }]) {
    const state = { ...unread, project: { roles: { qa: { skills: sk('my-own', 'hallmark') } } }, user: { roles: { qa: { skills: sk('my-own') } } } };
    const f = loadSkillFilters(state, PAGE_ENTRIES);
    assert.deepEqual(f.strip(state.project, 'project').roles.qa.skills, sk('my-own', 'hallmark'));
    assert.deepEqual(f.strip(state.user, 'user').roles.qa.skills, sk('my-own'));
    assert.deepEqual(f.stale('project', 'qa'), []);
  }
  const read = { resolved: {}, catalog: { errors: [] }, project: { roles: { qa: { skills: sk('my-own', 'hallmark') } } } };
  assert.deepEqual(loadSkillFilters(read, PAGE_ENTRIES).strip(read.project, 'project').roles.qa.skills, sk('hallmark'));
});

test('page: a repeated stored name is kept once and listed as ignored', () => {
  const state = { resolved: {}, catalog: { errors: [] }, user: { roles: { qa: { skills: sk('hallmark', 'hallmark') } } } };
  const f = loadSkillFilters(state, PAGE_ENTRIES);
  assert.deepEqual(f.strip(state.user, 'user').roles.qa.skills, sk('hallmark'));
  assert.deepEqual(f.stale('user', 'qa'), ['hallmark']);
});

test('save takes the stored user names back while the user catalog is unreadable, with only effort changed', async (t) => {
  const s = sandbox(t);
  const dir = path.join(s.home, '.mcsparrow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '3rdpartyskills.json'), '{ not json');
  const stored = [{ name: 'qa-helper', approved: '2025-02-02' }];
  const file = path.join(s.home, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: stored } } } }));
  const { post, state } = await start(t, s);
  const before = await state();
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { effort: 'high', skills: [{ name: 'qa-helper', approved: '2030-01-01' }] } }, gates: { ship: 'ask' } } });
  assert.equal(res.status, 200);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).aico_settings.roles.qa;
  assert.deepEqual(saved.skills, stored);
  assert.equal(saved.effort, 'high');
});

test('save takes the stored project names back while the settings folder is moved', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  movedSettingsFolder(t, s);
  const file = path.join(s.cwd, '.company', 'settings.json');
  const stored = [{ name: 'qa-helper', approved: '2025-02-02' }, { name: 'ghost-skill', approved: '2025-03-03' }];
  fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: stored } } } }));
  const { post, state } = await start(t, s, { home: undefined });
  const before = await state();
  assert.equal(before.resolved.settings_folder_moved, true);
  const res = await post('/api/save', { revision: before.resolved.revision, project: { version: 1, roles: { qa: { effort: 'high', skills: sk('qa-helper', 'ghost-skill') } } } });
  assert.equal(res.status, 200);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).aico_settings.roles.qa;
  assert.deepEqual(saved.skills, stored);
});

test('save refuses a repeated name over a stored single one while the settings folder is moved', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  movedSettingsFolder(t, s);
  const file = path.join(s.home, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper', approved: '2025-02-02' }] } } } }));
  const { post, state } = await start(t, s, { home: undefined });
  const before = await state();
  const body = fs.readFileSync(file, 'utf8');
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: sk('qa-helper', 'qa-helper') } }, gates: { ship: 'ask' } } });
  assert.equal(res.status, 400);
  assert.equal(fs.readFileSync(file, 'utf8'), body);
});

test('an effort-only save with no cwd given uses the process folder, with a moved settings folder', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  movedSettingsFolder(t, s);
  fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill', approved: '2025-01-01' }] } } } }));
  t.mock.method(process, 'cwd', () => s.cwd);
  const { post, state } = await start(t, s, { home: undefined, cwd: undefined });
  const before = await state();
  assert.equal(before.resolved.settings_folder_moved, true);
  const res = await post('/api/save', { revision: before.resolved.revision, project: { version: 1, roles: { qa: { effort: 'high', skills: [{ name: 'ghost-skill' }] } } } });
  assert.equal(res.status, 200);
  const res2 = await post('/api/save', { revision: (await state()).resolved.revision, project: { version: 1, roles: { qa: { effort: 'low', skills: [{ name: 'ghost-skill' }] } } } });
  assert.equal(res2.status, 200);
});

test('an effort-only save with no cwd given uses the process folder, with a bad stored user list', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [{ skillname: 'qa-helper' }]);
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill', approved: '2025-01-01' }] } } } }));
  fs.writeFileSync(s.projectFile, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'ghost-skill', approved: '2025-01-01' }] } } } }));
  t.mock.method(process, 'cwd', () => s.cwd);
  const { post, state } = await start(t, s, { cwd: undefined });
  const before = await state();
  const res = await post('/api/save', { revision: before.resolved.revision, project: { version: 1, roles: { qa: { effort: 'high', skills: [{ name: 'ghost-skill' }] } } } });
  assert.equal(res.status, 200);
});

test('a stored repeated name sent once keeps its date', async (t) => {
  const s = sandbox(t);
  userCatalog(s, [QA_PICK]);
  fs.writeFileSync(s.config, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper', approved: '2025-01-01' }, { name: 'qa-helper', approved: '2025-01-01' }] } } } }));
  const { post, state } = await start(t, s);
  const before = await state();
  const res = await post('/api/save', { revision: before.resolved.revision, user: { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }] } } } });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')).aico_settings.roles.qa.skills, [{ name: 'qa-helper', approved: '2025-01-01' }]);
});
