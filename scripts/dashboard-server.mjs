// Read-only local HTTP server behind /aico:dashboard. Binds 127.0.0.1, or 0.0.0.0 with --lan, never IPv6.
// Every request needs the Host allow-list and the per-start token as the first path part; nothing is written.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { board as buildBoard, refreshActive as buildActive } from './dashboard-data.mjs';
import { resolveRunSlug as resolveSlug, run as buildRun } from './dashboard-run.mjs';
import { lookup as lookupLinks } from './pr-links.mjs';

const PAGE_DIR = path.join(import.meta.dirname, 'dashboard-page');
const ASSETS = new Map([
  ['', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['board.js', { file: 'board.js', type: 'text/javascript; charset=utf-8' }],
  ['drawer.js', { file: 'drawer.js', type: 'text/javascript; charset=utf-8' }],
  ['live.js', { file: 'live.js', type: 'text/javascript; charset=utf-8' }]
]);
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
};
const FIXED = {
  404: 'not_found',
  405: 'method_not_allowed',
  421: 'misdirected_request',
  500: 'server_error'
};
const MESSAGES = {
  not_found: 'Not found',
  method_not_allowed: 'Method not allowed',
  misdirected_request: 'Misdirected request',
  server_error: 'Server error'
};
const TOKEN_LENGTH = 43;
const PREFIX = '/t/';
const FULL_MS = 30000;
const ACTIVE_MS = 1500;
const MEMO_MS = 1500;
const LINKS_MS = 60000;
const ACTIVITY_MS = 60000;
const IDLE_MS = 60 * 60 * 1000;
const USAGE = 'usage: node scripts/dashboard-server.mjs serve [--lan] [--port <1024-65535>]';
const LAN_WARNING = 'WARNING: LAN mode has no login beyond this link. Anyone on your network who gets the link can read these runs, including names in Handoffs. The link travels unencrypted. Stop the server to end access.';

const etagOf = (text) => `"${createHash('sha256').update(text).digest('base64url').slice(0, 22)}"`;

function lanAddresses(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces() ?? {})) {
    for (const a of list ?? []) {
      if (!a.internal && (a.family === 'IPv4' || a.family === 4) && !out.includes(a.address)) out.push(a.address);
    }
  }
  return out;
}

function sameToken(given, token) {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function matches(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((part) => {
    const v = part.trim().replace(/^W\//, '');
    return v === '*' || v === etag;
  });
}

// Starts the server for the product at `root`. Resolves to { server, port, token, urls, warning, close }.
export async function startServer({
  root = process.cwd(), lan = false, port = 0, idleMs = IDLE_MS, fullMs = FULL_MS, activeMs = ACTIVE_MS,
  interfaces = () => os.networkInterfaces(), onIdle, deps: given = {}, boardDeps
} = {}) {
  const deps = {
    board: buildBoard, refreshActive: buildActive, run: buildRun, lookup: lookupLinks, resolveRunSlug: resolveSlug, ...given
  };
  const token = randomBytes(32).toString('base64url');
  const ips = lan ? lanAddresses(interfaces) : [];
  const state = { board: null, json: '', etag: '', at: 0, last: 0, timers: [], chain: Promise.resolve() };
  const runs = new Map();
  const links = new Map();
  const options = boardDeps === undefined ? {} : { deps: boardDeps };
  let hosts = new Set();
  let idle;

  const logFailure = (err) => process.stderr.write(`dashboard: request failed (${err?.code ?? err?.name ?? 'error'})\n`);
  const queue = (job) => {
    const next = state.chain.then(job, job);
    state.chain = next.catch(() => {});
    return next;
  };
  const publish = (data) => {
    const payload = { ...data, lan };
    state.board = data;
    state.json = JSON.stringify(payload);
    state.etag = etagOf(JSON.stringify({ ...payload, generated: undefined }));
    state.at = Date.now();
  };
  const fullRefresh = () => queue(async () => publish(await deps.board(root, options)));
  const activeRefresh = () => queue(async () => {
    if (state.board !== null) publish(await deps.refreshActive(root, state.board, options));
  });
  const stopTimers = () => {
    for (const t of state.timers) clearInterval(t);
    state.timers = [];
  };
  const startTimers = () => {
    if (state.timers.length > 0) return;
    const guard = (job) => () => {
      if (Date.now() - state.last > ACTIVITY_MS) return stopTimers();
      job().catch(logFailure);
    };
    state.timers = [setInterval(guard(fullRefresh), fullMs), setInterval(guard(activeRefresh), activeMs)];
    for (const t of state.timers) t.unref();
  };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      close().then(() => onIdle?.());
    }, idleMs);
    idle.unref();
  };

  const send = (req, res, status, body, extra = {}) => {
    res.writeHead(status, { ...HEADERS, ...extra, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const fail = (req, res, status, extra) => {
    const code = FIXED[status];
    send(req, res, status, JSON.stringify({ error: code, message: MESSAGES[code] }), { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  };
  const sendJson = (req, res, json, etag) => {
    if (matches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { ...HEADERS, ETag: etag });
      return res.end();
    }
    send(req, res, 200, json, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag });
  };
  const memo = async (map, slug, ms, load) => {
    const hit = map.get(slug);
    if (hit !== undefined && Date.now() - hit.at < ms) return hit.value;
    const json = JSON.stringify(await load(slug));
    const value = { json, etag: etagOf(json) };
    for (const [k, v] of map) if (Date.now() - v.at >= ms) map.delete(k);
    map.set(slug, { at: Date.now(), value });
    return value;
  };

  async function route(req, res, rest) {
    if (ASSETS.has(rest)) {
      const asset = ASSETS.get(rest);
      return send(req, res, 200, fs.readFileSync(path.join(PAGE_DIR, asset.file)), { 'Content-Type': asset.type });
    }
    if (rest === 'api/board') {
      if (state.board === null || Date.now() - state.at > fullMs + activeMs) await fullRefresh();
      startTimers();
      return sendJson(req, res, state.json, state.etag);
    }
    const m = /^api\/run\/([^/]+)(\/links)?$/.exec(rest);
    if (m === null) return fail(req, res, 404);
    const slug = deps.resolveRunSlug(root, m[1]);
    if (slug === null) return fail(req, res, 404);
    const hit = m[2] === undefined
      ? await memo(runs, slug, MEMO_MS, (s) => deps.run(root, s))
      : await memo(links, slug, LINKS_MS, (s) => deps.lookup(root, s));
    return sendJson(req, res, hit.json, hit.etag);
  }

  const server = http.createServer((req, res) => {
    if (!hosts.has(req.headers.host)) return fail(req, res, 421);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(req, res, 405, { Allow: 'GET, HEAD' });
    const target = req.url ?? '';
    if (!target.startsWith('/') || target.includes('?') || target.includes('#')) return fail(req, res, 404);
    const head = target.slice(0, PREFIX.length + TOKEN_LENGTH + 1);
    if (!head.startsWith(PREFIX) || head.length !== PREFIX.length + TOKEN_LENGTH + 1 || head.endsWith('/') === false) return fail(req, res, 404);
    if (!sameToken(head.slice(PREFIX.length, -1), token)) return fail(req, res, 404);
    state.last = Date.now();
    resetIdle();
    route(req, res, target.slice(head.length)).catch((err) => {
      logFailure(err);
      if (!res.headersSent) fail(req, res, 500);
      else res.destroy();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', resolve);
  });
  const bound = server.address().port;
  hosts = new Set([`127.0.0.1:${bound}`, `localhost:${bound}`, ...ips.map((ip) => `${ip}:${bound}`)]);
  resetIdle();

  const urls = [`aico dashboard: http://127.0.0.1:${bound}${PREFIX}${token}/`];
  for (const ip of ips) urls.push(`aico dashboard (LAN): http://${ip}:${bound}${PREFIX}${token}/`);
  const warning = lan ? LAN_WARNING : null;

  function close() {
    clearTimeout(idle);
    stopTimers();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  return { server, port: bound, token, urls, warning, close };
}

function parseArgs(argv) {
  if (argv[0] !== 'serve') return null;
  const out = { lan: false, port: 0 };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--lan' && !out.lan) out.lan = true;
    else if (argv[i] === '--port' && i + 1 < argv.length) {
      const text = argv[i + 1];
      i += 1;
      if (!/^\d{4,5}$/.test(text) || Number(text) < 1024 || Number(text) > 65535) return null;
      out.port = Number(text);
    } else return null;
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args === null) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let handle;
  try {
    handle = await startServer({ root: process.cwd(), ...args, onIdle: () => process.exit(0) });
  } catch (err) {
    process.stderr.write(`dashboard: cannot start (${err?.code ?? 'error'})\n`);
    return 1;
  }
  for (const line of handle.urls) process.stdout.write(`${line}\n`);
  if (handle.warning !== null) process.stdout.write(`${handle.warning}\n`);
  const stop = () => handle.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== null) process.exit(code);
  });
}
