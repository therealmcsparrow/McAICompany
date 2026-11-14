// The cap a run works to: the threshold of the project's Lead snapshot, else the default (contract: docs/contracts/run-state.md v3.0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONTEXT_CAP_DEFAULT, CONTEXT_CAP_MAX, CONTEXT_CAP_MIN, handoverOf } from '../mods/lib/context-cap.mjs';
import { leadFile } from '../hooks/lib/snapshot.mjs';

export { CONTEXT_CAP_DEFAULT, handoverOf };
const MAX_SNAPSHOT_BYTES = 4096;
const validCap = (n) => Number.isSafeInteger(n) && n >= CONTEXT_CAP_MIN && n <= CONTEXT_CAP_MAX;

function mcsHome(home) {
  if (typeof home === 'string' && home !== '') return home;
  const env = process.env.MCSPARROW_HOME;
  return typeof env === 'string' && env !== '' ? env : path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.mcsparrow');
}

function snapshotCap(root, home) {
  try {
    const file = leadFile(mcsHome(home), fs.realpathSync(root));
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_SNAPSHOT_BYTES) return null;
    const threshold = JSON.parse(fs.readFileSync(file, 'utf8'))?.threshold;
    return validCap(threshold) ? threshold : null;
  } catch { return null; }
}

// Never throws: every failure falls to the default. `slug` is kept for callers; the cap no longer depends on the run.
export function runCap(root, slug, { home } = {}) {
  const cap = snapshotCap(root, home);
  if (cap !== null) return { cap, handover: handoverOf(cap), from: 'snapshot' };
  return { cap: CONTEXT_CAP_DEFAULT, handover: handoverOf(CONTEXT_CAP_DEFAULT), from: 'default' };
}
