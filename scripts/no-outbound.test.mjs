// No outbound call in savers or the engine; the cache clock never pings.
// Static scan of production code: mods/, hooks/ (rules, lib, register), scripts/hook-host.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = /\.(mjs|js|ts|tsx|html)$/;
const TESTISH = /(\.test\.|[\\/]test[\\/]|[\\/]tests[\\/]|[\\/]fixtures[\\/])/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SRC.test(e.name) && !TESTISH.test(p)) out.push(p);
  }
  return out;
}
const files = () => [...walk(path.join(root, 'mods')), ...walk(path.join(root, 'hooks')), path.join(root, 'scripts', 'hook-host.mjs')]
  .filter((f) => fs.existsSync(f));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');

const OUTBOUND = [
  [/\bfetch\s*\(/, 'fetch('],
  [/(from\s+|import\s*\(\s*|require\s*\(\s*)['"](node:)?(https?|net|tls|dgram|dns|http2)['"]/, 'network module import'],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/, 'network object'],
  [/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/, 'download command']
];

test('AC22: the scan finds production files (guards against an empty scan)', () => {
  const f = files().map(rel);
  assert.ok(f.includes('mods/cache-tax.tsx'));
  assert.ok(f.includes('mods/lib/cache-clock.mjs'));
  assert.ok(f.some((x) => x.startsWith('hooks/rules/')));
  assert.ok(f.includes('scripts/hook-host.mjs'));
});

test('AC22: the scan patterns catch an outbound call (self-check)', () => {
  const hit = (s) => OUTBOUND.some(([re]) => re.test(s));
  assert.ok(hit("await fetch('https://x.example/a')"));
  assert.ok(hit("import http from 'node:http'"));
  assert.ok(hit("const n = require('net')"));
  assert.ok(hit('new WebSocket(u)'));
  assert.ok(!hit("const x = 'hello'; fetchRows(1)"));
});

test('AC22: no fetch, http, https or net use in mods/, hooks/ or the hook host', () => {
  const found = [];
  for (const f of files()) {
    const text = strip(fs.readFileSync(f, 'utf8'));
    for (const [re, name] of OUTBOUND) if (re.test(text)) found.push(`${rel(f)}: ${name}`);
  }
  assert.deepEqual(found, []);
});

test('AC22: every release 1 saver has production source in the scan set and none calls out', () => {
  const savers = ['cache-tax', 'savvy', 'reflect', 'switchboard', 'savings'];
  const missing = [];
  for (const id of savers) {
    const f = ['ts', 'tsx'].map((x) => path.join(root, 'mods', `${id}.${x}`)).find((p) => fs.existsSync(p));
    if (!f) { missing.push(`mods/${id}.ts(x)`); continue; }
    const text = strip(fs.readFileSync(f, 'utf8'));
    for (const [re, name] of OUTBOUND) assert.ok(!re.test(text), `${rel(f)}: ${name}`);
  }
  assert.deepEqual(missing, []);
});

test('AC22: the browser saver rule makes no call and spawns nothing', () => {
  const text = strip(fs.readFileSync(path.join(root, 'hooks', 'rules', 'browser.mjs'), 'utf8'));
  assert.ok(!/child_process|spawn|exec\w*\s*\(/.test(text));
  for (const [re, name] of OUTBOUND) assert.ok(!re.test(text), name);
});

test('AC22: cache clock sends no ping: no model call, no process, one tick timer', () => {
  const clock = strip(fs.readFileSync(path.join(root, 'mods', 'lib', 'cache-clock.mjs'), 'utf8'));
  assert.ok(!/\bping\b/i.test(clock.replace(/no ping/gi, '')), 'cache-clock.mjs names a ping');
  assert.ok(!/child_process|spawn|exec\w*\s*\(|setInterval|setTimeout/.test(clock));
  const tsx = strip(fs.readFileSync(path.join(root, 'mods', 'cache-tax.tsx'), 'utf8'));
  assert.ok(!/\bping\b/i.test(tsx.replace(/no ping/gi, '')), 'cache-tax.tsx names a ping');
  assert.ok(!/\b(sendMessage|\$\.model|\$\.ask)\b/.test(tsx), 'cache-tax.tsx sends a prompt');
  assert.equal((tsx.match(/\$\.clock\.every\(/g) ?? []).length, 1, 'exactly one clock timer');
});

test('AC22: the cache clock manifest exists and is a view-only saver (no rule, no event)', () => {
  const f = path.join(root, 'hooks', 'manifests', 'cache-tax.json');
  assert.ok(fs.existsSync(f), 'missing hooks/manifests/cache-tax.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(m.kind, 'saver');
  assert.deepEqual(m.rules, []);
  assert.deepEqual(m.events, []);
});
