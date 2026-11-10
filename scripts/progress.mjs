// Progress lines for long commands: one helper, plain text on stderr, never stdout.
// A worker thread prints a heartbeat while the main thread is blocked in a
// synchronous call such as spawnSync.
// node:worker_threads, SharedArrayBuffer and Atomics are Stability 2 (stable).
import fs from 'node:fs';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const DEFAULT_BEAT_MS = 10000;
const MAX_ITEM = 120;
const ITEM_OFFSET = 32;
const ITEM_BYTES = 512;
// Int32 slots: 0 stop flag (0 idle, 1 stopped, 2 worker writing), 1 last line ms,
// 2 item length, 3 item start ms (-1 none), 4 sequence (odd while main writes).
const STOP = 0;
const LAST = 1;
const ILEN = 2;
const ISTART = 3;
const SEQ = 4;

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

function clean(value) {
  const text = String(value ?? '').replace(UNSAFE, '?');
  return Array.from(text).slice(0, MAX_ITEM).join('');
}

function beatMs(raw) {
  if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) return DEFAULT_BEAT_MS;
  const n = Number(raw);
  return n >= 50 && n <= 60000 ? n : DEFAULT_BEAT_MS;
}

function write(line) {
  try {
    fs.writeSync(2, line + '\n');
  } catch {
    // a lost progress line must never change output or exit code
  }
}

function secs(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

if (!isMainThread && workerData && workerData.aicoProgress) {
  const { sab, base, interval, command } = workerData;
  const state = new Int32Array(sab, 0, 8);
  const bytes = new Uint8Array(sab, ITEM_OFFSET, ITEM_BYTES);
  const decoder = new TextDecoder();
  const readItem = () => {
    for (let i = 0; i < 5; i++) {
      const s1 = Atomics.load(state, SEQ);
      if (s1 % 2) continue;
      const len = Atomics.load(state, ILEN);
      const since = Atomics.load(state, ISTART);
      const name = decoder.decode(bytes.slice(0, Math.min(len, ITEM_BYTES)));
      if (Atomics.load(state, SEQ) === s1) return { name, since };
    }
    return { name: '', since: -1 };
  };
  while (Atomics.load(state, STOP) === 0) {
    const now = Date.now() - base;
    const due = Atomics.load(state, LAST) + interval;
    if (now < due) {
      Atomics.wait(state, STOP, 0, due - now);
      continue;
    }
    if (Atomics.compareExchange(state, STOP, 0, 2) !== 0) break;
    const { name, since } = readItem();
    const t = Date.now() - base;
    write(name ? `${command}: still running ${name}, ${secs(t - since)}` : `${command}: still running, ${secs(t)}`);
    Atomics.store(state, LAST, t);
    Atomics.store(state, STOP, 0);
    Atomics.notify(state, STOP);
  }
}

export function createProgress({ command, total, unit } = {}) {
  const cmd = clean(command);
  const sab = new SharedArrayBuffer(ITEM_OFFSET + ITEM_BYTES);
  const state = new Int32Array(sab, 0, 8);
  const bytes = new Uint8Array(sab, ITEM_OFFSET, ITEM_BYTES);
  const encoder = new TextEncoder();
  const running = [];
  let base = Date.now();
  let ok = 0;
  let fail = 0;
  let count = 0;
  let ended = false;
  let worker = null;

  const rel = () => Date.now() - base;

  function publish() {
    const first = running[0];
    Atomics.add(state, SEQ, 1);
    if (first) {
      const enc = encoder.encode(first.name);
      const len = Math.min(enc.length, ITEM_BYTES);
      bytes.set(enc.subarray(0, len));
      Atomics.store(state, ILEN, len);
      Atomics.store(state, ISTART, first.at);
    } else {
      Atomics.store(state, ILEN, 0);
      Atomics.store(state, ISTART, -1);
    }
    Atomics.add(state, SEQ, 1);
  }

  function line(text) {
    if (ended) return;
    write(`${cmd}: ${text}`);
    Atomics.store(state, LAST, rel());
  }

  return {
    start() {
      base = Date.now();
      Atomics.store(state, LAST, 0);
      Atomics.store(state, ISTART, -1);
      line(`start, ${total} ${clean(unit)}`);
      try {
        worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: {
            aicoProgress: true,
            sab,
            base,
            interval: beatMs(process.env.AICO_PROGRESS_HEARTBEAT_MS),
            command: cmd
          }
        });
        worker.on('error', () => {});
        worker.unref();
      } catch {
        worker = null;
      }
    },
    begin(item) {
      running.push({ name: clean(item), at: rel() });
      publish();
    },
    done(item, passed) {
      const name = clean(item);
      const i = running.findIndex((r) => r.name === name);
      if (i >= 0) running.splice(i, 1);
      publish();
      count += 1;
      if (passed) ok += 1;
      else fail += 1;
      line(`${count}/${total} ${name} ${passed ? 'ok' : 'fail'}`);
    },
    end() {
      if (ended) return;
      for (;;) {
        const prev = Atomics.compareExchange(state, STOP, 0, 1);
        if (prev === 0 || prev === 1) break;
        Atomics.wait(state, STOP, 2, 50);
      }
      Atomics.notify(state, STOP);
      write(`${cmd}: end, ${ok} ok, ${fail} fail, ${secs(rel())}`);
      ended = true;
    }
  };
}
