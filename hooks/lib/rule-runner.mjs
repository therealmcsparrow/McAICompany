// Runs rule modules in one worker thread per hook call. The main thread keeps every timer and ends the
// worker on expiry, so a synchronous loop times out too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { RULE_ID } from './rule-id.mjs';

export const CALL_DEADLINE_MS = 3500;
export const ROW_TIMEOUT_MAX_MS = 1000;
export const EFFECTS = Object.freeze(['cap-step-record', 'cap-lead-freeze', 'cap-lead-frozen', 'cap-warn']);
const CAP_RULE = 'cap.M1';
const MODULE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/;
const MESSAGE_RE = /^[^\u0000-\u001f\u007f]{1,300}$/u;

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// The verdict allow-list: returns a clean copy, or null for anything else.
export function checkVerdict(v) {
  if (!plain(v) || typeof v.v !== 'string') return null;
  const keys = Object.keys(v);
  const only = (allowed) => keys.every((k) => allowed.includes(k));
  const effectOk = (rule) => v.effect === undefined || (rule === CAP_RULE && EFFECTS.includes(v.effect));
  if (v.v === 'allow') {
    if (!only(['v', 'rule', 'effect']) || !effectOk(v.rule) || (v.rule !== undefined && !RULE_ID.test(v.rule))) return null;
    return v.effect === undefined ? { v: 'allow' } : { v: 'allow', rule: v.rule, effect: v.effect };
  }
  if (v.v === 'deny' || v.v === 'note') {
    if (!only(['v', 'rule', 'message', 'effect']) || typeof v.rule !== 'string' || !RULE_ID.test(v.rule)) return null;
    if (typeof v.message !== 'string' || !MESSAGE_RE.test(v.message) || !effectOk(v.rule)) return null;
    return v.effect === undefined ? { v: v.v, rule: v.rule, message: v.message } : { v: v.v, rule: v.rule, message: v.message, effect: v.effect };
  }
  return null;
}

function deepFreeze(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const x of Object.values(o)) deepFreeze(x); }
  return o;
}

if (!isMainThread && workerData && workerData.aicoRunner === true) {
  parentPort.on('message', async (m) => {
    const reply = (r) => parentPort.postMessage({ id: m.id, ...r });
    try {
      let mod;
      try { mod = await import(m.url); } catch { reply({ ok: false, word: 'unreadable' }); return; }
      const fn = mod[m.exportName];
      if (typeof fn !== 'function') { reply({ ok: false, word: 'missing' }); return; }
      const out = fn(deepFreeze(m.event), deepFreeze(m.snapshot));
      if (out !== null && typeof out === 'object' && typeof out.then === 'function') { reply({ ok: false, word: 'invalid' }); return; }
      const verdict = checkVerdict(out);
      reply(verdict ? { ok: true, verdict } : { ok: false, word: 'invalid' });
    } catch { reply({ ok: false, word: 'crash' }); }
  });
}

// Absolute path of a rule module under hooks/rules, or { word } when it cannot be loaded.
export function resolveModule(pluginRoot, name) {
  if (typeof name !== 'string' || !MODULE_RE.test(name)) return { word: 'unreadable' };
  const dir = path.join(pluginRoot, 'hooks', 'rules');
  try {
    const real = fs.realpathSync.native(path.join(dir, name));
    const rel = path.relative(fs.realpathSync.native(dir), real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { word: 'unreadable' };
    return { file: real };
  } catch (e) { return { word: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
}

export function createRunner(pluginRoot, { deadlineMs = CALL_DEADLINE_MS, now = Date.now } = {}) {
  const end = now() + deadlineMs;
  let worker = null;
  let current = null;

  const kill = () => { const w = worker; worker = null; if (w) w.terminate().catch(() => {}); };
  const spawn = () => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { aicoRunner: true }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    w.on('message', (m) => { if (current && m.id === current.id) current.finish(m.ok ? { ok: true, verdict: m.verdict } : { ok: false, word: m.word }); });
    w.on('error', () => { if (current) current.finish({ ok: false, word: 'crash' }); kill(); });
    w.on('exit', () => { if (worker === w) worker = null; if (current) current.finish({ ok: false, word: 'crash' }); });
    return w;
  };

  let seq = 0;
  return {
    // job: { module, export, event, snapshot, timeoutMs }. Resolves { ok: true, verdict } or { ok: false, word }.
    run(job) {
      return new Promise((resolve) => {
        const remaining = end - now();
        const target = resolveModule(pluginRoot, job.module);
        if (!target.file) { resolve({ ok: false, word: target.word }); return; }
        if (remaining <= 0) { resolve({ ok: false, word: 'timeout' }); return; }
        const limit = Math.min(Number.isInteger(job.timeoutMs) && job.timeoutMs > 0 ? job.timeoutMs : ROW_TIMEOUT_MAX_MS, ROW_TIMEOUT_MAX_MS, remaining);
        let timer = null;
        const id = ++seq;
        const finish = (r) => {
          if (!current || current.id !== id) return;
          clearTimeout(timer);
          current = null;
          resolve(r);
        };
        current = { id, finish };
        timer = setTimeout(() => { finish({ ok: false, word: 'timeout' }); kill(); }, limit);
        try {
          if (!worker) worker = spawn();
          worker.postMessage({ id, url: pathToFileURL(target.file).href, exportName: job.export, event: job.event, snapshot: job.snapshot });
        } catch { finish({ ok: false, word: 'crash' }); kill(); }
      });
    },
    close() { kill(); }
  };
}
