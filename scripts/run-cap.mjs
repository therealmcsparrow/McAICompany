// The cap a run works to: the cap its `start` record froze, else the current setting, else the default (contract: docs/contracts/run-state.md v2.1).
import { createRequire } from 'node:module';
import { CONTEXT_CAP_DEFAULT, handoverOf } from '../mods/lib/context-cap.mjs';
import { recordedCap, validCap } from './run-state.mjs';

function settingsCap(root, home) {
  try {
    const { resolveSettings } = createRequire(import.meta.url)('./settings.mjs');
    const cap = resolveSettings({ home, cwd: root }).pipeline.context_cap;
    return validCap(cap) ? cap : null;
  } catch { return null; }
}

// Never throws: every failure falls to the next source.
export function runCap(root, slug, { home } = {}) {
  let cap = null;
  try { cap = recordedCap(root, slug); } catch { cap = null; }
  if (validCap(cap)) return { cap, handover: handoverOf(cap), from: 'run' };
  cap = settingsCap(root, home);
  if (cap !== null) return { cap, handover: handoverOf(cap), from: 'settings' };
  return { cap: CONTEXT_CAP_DEFAULT, handover: handoverOf(CONTEXT_CAP_DEFAULT), from: 'default' };
}
