// The deny log: one row per guard deny or guard failure, written by the engine only.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_LINES = 1000;
const FILE = 'denies.jsonl';
const MAX_BYTES = 512 * 1024;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function readRows(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_BYTES) throw new Error('unreadable');
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
}

// Appends one row to <dir>/denies.jsonl. Returns { logged, first }: `first` is true when no row of this
// rule exists for this session. A write failure returns { logged: false, first: true }; it never throws.
export function appendDeny(dir, { rule, kind, session, agent }, now = Date.now()) {
  const file = path.join(dir, FILE);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let lines = [];
    try { lines = readRows(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let first = true;
    for (const l of lines) {
      try {
        const o = JSON.parse(l);
        if (o && o.rule === rule && o.session === session) { first = false; break; }
      } catch { /* ignore a bad line */ }
    }
    const line = `${JSON.stringify({ v: 1, at: iso(now), rule, kind, session, agent: agent ?? null })}\n`;
    if (lines.length >= MAX_LINES) {
      const kept = lines.slice(Math.floor(lines.length / 3));
      const tmp = path.join(dir, `.denies-${process.pid}.tmp`);
      fs.writeFileSync(tmp, `${kept.join('\n')}\n${line}`);
      fs.renameSync(tmp, file);
    } else {
      fs.appendFileSync(file, line);
    }
    return { logged: true, first };
  } catch { return { logged: false, first: true }; }
}
