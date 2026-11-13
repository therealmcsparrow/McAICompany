// Local HTTP server behind /aico:settings. Binds 127.0.0.1 only, and every request needs the
// per-run token. Host and Origin must name this server, so other websites (including through
// DNS rebinding) and other local processes without the token can neither read nor change settings.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as check from './check.mjs';
import { clearLanguage, setLanguage, stored as storedLanguage, validate as validateLanguage } from './language.mjs';
import { eligibleRoles, readBaseline, readCatalog, selectable, skillStatus, vettedText } from './skill-catalog.mjs';
import {
  Refusal, checkLayers, layerFileProblem, pluginDefaults, readLayer, resolvePersonalities, resolveSettings, writeLayer, writeProfile
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
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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

const ownObject = (o, k) => (isObject(o) && Object.hasOwn(o, k) && isObject(o[k]) ? o[k] : undefined);

// The valid keys of one personality object, as plain strings. A value that fails its rule is left out.
function validPersonality(source) {
  const out = {};
  if (!isObject(source)) return out;
  for (const key of check.PERSONALITY_KEYS) {
    if (Object.hasOwn(source, key) && typeof source[key] === 'string' && !check.personalityProblem(key, source[key])) out[key] = source[key];
  }
  return out;
}

function pluginPersonalities(ctx) {
  try {
    const root = ctx.pluginRoot ?? path.join(import.meta.dirname, '..');
    const data = JSON.parse(fs.readFileSync(path.join(root, 'company', 'personalities.json'), 'utf8'));
    return isObject(data) ? data : {};
  } catch {
    return {};
  }
}

// What the page needs for the Personality section (aico-settings v1.3). Stored values that fail their rule are
// not in the layers; they come back as `ignored` entries (level, path, reason), never with the value.
function personalitiesState(ctx, plugin, user, project) {
  const resolved = resolvePersonalities(ctx);
  const defaults = pluginPersonalities(ctx);
  const roles = {};
  for (const role of Object.keys(plugin.roles)) {
    const own = (layer) => validPersonality(ownObject(ownObject(layer.roles, role), 'personality'));
    const effective = {};
    for (const key of check.PERSONALITY_KEYS) {
      const hit = Object.hasOwn(resolved.roles, role) && Object.hasOwn(resolved.roles[role], key) ? resolved.roles[role][key] : undefined;
      if (hit) effective[key] = { value: hit.value, source: hit.source };
    }
    roles[role] = { plugin: validPersonality(ownObject(defaults, role)), user: own(user), project: own(project), effective };
  }
  return {
    rule: {
      text_re: check.PERSONALITY_TEXT_RE.source,
      flags: check.PERSONALITY_TEXT_RE.flags,
      max: check.PERSONALITY_MAX,
      levels: [...check.PERSONALITY_LEVELS],
      phrases: check.PERSONALITY_PHRASES
    },
    roles,
    ignored: resolved.ignored.map(({ level, path: at, reason }) => ({ level, path: at, reason }))
  };
}

const sourceKind = (e) => (e.skillrepo !== undefined ? 'repo' : e.skillplugin !== undefined ? 'plugin' : 'command');

// The catalog for the Skills tab: each entry with the Roles that may select it, and its status, license and
// vetted texts from skillStatus. Entry texts are validated by the catalog module; no path, hash or home folder
// leaves here. An unreadable catalog gives no entries and a fixed error line.
function catalogState(ctx, resolved) {
  try {
    const { entries, errors, clashes } = readCatalog({ home: ctx.home });
    const { categories } = readBaseline();
    // An entry any Role selects at user level is read from the user home only, as the installer reads it.
    const userLevel = new Set();
    for (const r of Object.values(resolved.roles)) {
      if (r.source?.skills === 'user') for (const x of r.skills ?? []) userLevel.add(x.name);
    }
    const out = entries.map((e) => {
      const pick = selectable(e);
      const status = skillStatus(e, { home: ctx.home, productRoot: ctx.cwd ?? process.cwd(), scope: userLevel.has(e.skillname) ? 'user' : undefined });
      const row = {
        name: e.skillname,
        category: e.skillcategory,
        kind: sourceKind(e),
        layer: e.layer,
        roles: eligibleRoles(e, categories),
        selectable: pick.ok,
        status: status.status,
        place: status.place,
        license: status.license,
        vetted: status.vetted,
        vetted_text: vettedText(e, status.vetted)
      };
      if (e.skillrepo !== undefined) row.skillrepo = e.skillrepo;
      if (!pick.ok) row.reason = pick.reason;
      if (e.skillcommit !== undefined) row.commit = e.skillcommit;
      return row;
    });
    return { entries: out, errors, clashes: clashes.map((c) => ({ name: c.skillname, pinned: c.pinned })) };
  } catch {
    return { entries: [], errors: ['ERROR baseline catalog'], clashes: [] };
  }
}

function state(ctx) {
  const plugin = pluginDefaults(ctx.pluginRoot);
  const user = readLayer('user', ctx).layer;
  const project = readLayer('project', ctx).layer;
  const resolved = resolveSettings(ctx);
  return {
    plugin,
    user,
    project,
    resolved,
    catalog: catalogState(ctx, resolved),
    language: storedLanguage(ctx),
    hasProject: hasCompany(ctx.cwd),
    personalities: personalitiesState(ctx, plugin, user, project)
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
    const levels = ['user', 'project'].filter(has);
    reasons.push(...checkLayers(user, project, { ...ctx, levels }));
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

const FONT_DIR = path.join(import.meta.dirname, 'fonts');
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
  home, cwd = process.cwd(), pluginRoot, port = 0, idleMs = 1_800_000, open = true,
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
    // Fonts are public files: a stylesheet font request cannot send the token header. Host and Origin are already checked.
    const font = req.method === 'GET' ? /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname) : null;
    if (font) {
      let bytes;
      try { bytes = fs.readFileSync(path.join(FONT_DIR, font[1])); } catch { throw new HttpError(404, ['not found']); }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'font/woff2', 'Content-Length': bytes.length });
      return res.end(bytes);
    }
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
