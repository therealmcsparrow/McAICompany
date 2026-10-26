// Local HTTP server behind /aico:settings. Binds 127.0.0.1 only, and every request needs the
// per-run token. Host and Origin must name this server, so other websites (including through
// DNS rebinding) and other local processes without the token can neither read nor change settings.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { clearLanguage, setLanguage, validate as validateLanguage } from './language.mjs';
import {
  Refusal, checkLayers, layerFileProblem, pluginDefaults, readLayer, resolveSettings, writeLayer, writeProfile
} from './settings.mjs';

const MAX_BODY = 65536;
const MAX_DRAIN = 1024 * 1024; // past the cap we read on (and drop) this much so the client sees the 413
const PAGE = path.join(import.meta.dirname, 'settings-page.html');
const SAVE_KEYS = ['revision', 'user', 'project', 'profile', 'language'];
const SCOPES = ['user', 'project'];
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class HttpError extends Error {
  constructor(status, refused) {
    super(refused.join('; '));
    this.status = status;
    this.refused = refused;
  }
}

function hasCompany(cwd) {
  try {
    return fs.statSync(path.join(cwd ?? process.cwd(), '.company')).isDirectory();
  } catch {
    return false;
  }
}

function state(ctx) {
  return {
    plugin: pluginDefaults(ctx.pluginRoot),
    user: readLayer('user', ctx).layer,
    project: readLayer('project', ctx).layer,
    resolved: resolveSettings(ctx),
    hasProject: hasCompany(ctx.cwd)
  };
}

function shapeProblems(body) {
  if (!isObject(body)) return ['body must be a JSON object'];
  const reasons = [];
  for (const k of Object.keys(body)) if (!SAVE_KEYS.includes(k)) reasons.push(`${/^[\w-]{1,40}$/.test(k) ? k : '<key>'}: unknown key`);
  if (typeof body.revision !== 'string') reasons.push('revision: must be text');
  if (Object.hasOwn(body, 'profile') && !isObject(body.profile)) reasons.push('profile: must be an object');
  if (Object.hasOwn(body, 'language')) {
    const lang = body.language;
    if (!isObject(lang)) reasons.push('language: must be an object');
    else {
      for (const k of Object.keys(lang)) {
        if (!SCOPES.includes(k)) reasons.push('language: only user and project');
        else if (lang[k] !== null && typeof lang[k] !== 'string') reasons.push(`language.${k}: must be a language tag or null`);
      }
    }
  }
  return reasons;
}

const splitRefusal = (prefix, error) => error.message.split('; ').map((r) => `${prefix}: ${r}`);

// Validates every part of a save, then writes. Nothing is written when any part is refused.
function save(ctx, body) {
  const shape = shapeProblems(body);
  if (shape.length) throw new HttpError(400, shape);
  const current = resolveSettings(ctx);
  if (body.revision !== current.revision) return { status: 409, body: { state: state(ctx) } };

  const has = (k) => Object.hasOwn(body, k);
  const company = hasCompany(ctx.cwd);
  const projectMd = current.profile.hasProject;
  const language = body.language ?? {};
  const reasons = [];

  if (has('user') || has('project')) {
    if (has('project') && !company) reasons.push('project: no .company/ folder');
    const user = has('user') ? body.user : readLayer('user', ctx).layer;
    const project = has('project') ? body.project : readLayer('project', ctx).layer;
    reasons.push(...checkLayers(user, project, ctx));
  }
  if (has('user') || Object.hasOwn(language, 'user')) {
    const problem = layerFileProblem('user', ctx);
    if (problem) reasons.push(`user: ${problem}`);
  }
  if (has('project') && company) {
    const problem = layerFileProblem('project', ctx);
    if (problem) reasons.push(`project: ${problem}`);
  }
  if (has('profile')) {
    if (!projectMd) reasons.push('profile: no .company/project.md');
    else {
      try {
        writeProfile(body.profile, { ...ctx, dryRun: true });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        reasons.push(...splitRefusal('profile', error));
      }
    }
  }
  for (const scope of SCOPES) {
    if (!Object.hasOwn(language, scope)) continue;
    if (scope === 'project' && !projectMd) reasons.push('language.project: no .company/project.md');
    else if (language[scope] !== null && !validateLanguage(language[scope]).ok) reasons.push(`language.${scope}: not a known BCP 47 language tag`);
  }
  if (reasons.length) throw new HttpError(400, reasons);

  if (has('user')) writeLayer('user', body.user, { ...ctx, other: has('project') ? body.project : undefined });
  if (has('project')) writeLayer('project', body.project, { ...ctx, other: has('user') ? body.user : undefined });
  if (has('profile')) writeProfile(body.profile, ctx);
  for (const scope of SCOPES) {
    if (!Object.hasOwn(language, scope)) continue;
    if (language[scope] === null) clearLanguage(scope, ctx);
    else setLanguage(language[scope], scope, ctx);
  }
  return { status: 200, body: { state: state(ctx) } };
}

function tokenMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isJson(contentType) {
  return typeof contentType === 'string' && contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Reads the body with a running byte count. Past MAX_BODY it rejects with 413 and drops the
// rest; past MAX_DRAIN it destroys the request.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, ['body is larger than 65536 bytes']);
    const chunks = [];
    let size = 0;
    let over = Number(req.headers['content-length']) > MAX_BODY;
    if (over) reject(tooLarge());
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_DRAIN) req.destroy();
      if (over) return;
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function openBrowser(url) {
  const [cmd, args, extra] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url], { windowsVerbatimArguments: true }]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {}];
  try {
    const child = spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true, ...extra });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The printed URL is still there.
  }
}

export async function startServer({
  home, cwd, pluginRoot, port = 0, idleMs = 1_800_000, open = true,
  log = (line) => process.stdout.write(`${line}\n`)
} = {}) {
  const ctx = { home, cwd, pluginRoot };
  const token = randomBytes(32).toString('hex');
  let hosts = new Set();
  let origins = new Set();
  let idle;
  let closing = false;
  const server = http.createServer();
  const closed = new Promise((resolve) => server.once('close', resolve));

  function close() {
    if (closing) return closed;
    closing = true;
    clearTimeout(idle);
    server.close();
    server.closeAllConnections();
    return closed;
  }
  const resetIdle = () => {
    clearTimeout(idle);
    if (!closing) idle = setTimeout(close, idleMs);
  };

  async function handle(req, res) {
    const host = String(req.headers.host ?? '').toLowerCase();
    const origin = req.headers.origin;
    if (!hosts.has(host)) throw new HttpError(403, ['forbidden']);
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) throw new HttpError(403, ['forbidden']);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!tokenMatches(req.headers['x-aico-token'] ?? url.searchParams.get('token'), token)) throw new HttpError(403, ['forbidden']);

    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /') {
      const html = fs.readFileSync(PAGE, 'utf8').replace(
        '<meta name="aico-token" content="__AICO_TOKEN__">', `<meta name="aico-token" content="${token}">`);
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (route === 'GET /api/state') return send(res, 200, state(ctx));
    if (route !== 'POST /api/save' && route !== 'POST /api/done') {
      const known = ['/', '/api/state', '/api/save', '/api/done'].includes(url.pathname);
      throw new HttpError(known ? 405 : 404, [known ? 'method not allowed' : 'not found']);
    }
    if (origin === undefined) throw new HttpError(403, ['forbidden']);
    if (!isJson(req.headers['content-type'])) throw new HttpError(415, ['Content-Type must be application/json']);
    const text = await readBody(req);
    if (route === 'POST /api/done') {
      res.once('finish', close);
      return send(res, 200, { done: true });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, ['body is not valid JSON']);
    }
    const result = save(ctx, body);
    return send(res, result.status, result.body);
  }

  server.on('request', (req, res) => {
    resetIdle();
    handle(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) {
        if (error.status === 413) res.setHeader('Connection', 'close');
        return send(res, error.status, { refused: error.refused });
      }
      process.stderr.write(`aico settings: ${error?.message ?? error}\n`);
      send(res, 500, { refused: ['internal error, see the terminal'] });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  origins = new Set([...hosts].map((h) => `http://${h}`));
  const url = `http://127.0.0.1:${actual}/?token=${token}`;
  resetIdle();
  log(`aico settings: ${url}`);
  if (open) openBrowser(url);
  return { url, port: actual, token, closed, close };
}
