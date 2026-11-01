// Pure logic for the Fresh Step mod: which events it judges, the fixed refusal text and what a `run-state active --json` answer means.
// Nothing here runs a process or touches a file. Allow-lists only: anything not matched exactly is not judged.
import { guardRunActive, interpretRun } from './guard.mjs';

export const REASON = 'aico: Steps are never resumed; dispatch a fresh Step (next NN) with the old Handoff as input (pipeline §2)';
export const UNREADABLE = ' (run state unreadable)';

const isObject = (v) => v !== null && typeof v === 'object';

// A send the model made through its own SendMessage tool.
export function isModelSend(e) {
  return isObject(e) && isObject(e.origin) && e.origin.kind === 'model';
}

// A spawn that resumes an agent.
export function isResumeSpawn(e) {
  return isObject(e) && isObject(e.resume);
}

export function refusalReason(unreadable) {
  return unreadable ? `${REASON}${UNREADABLE}` : REASON;
}

// 'idle' = the run view names no run; 'active' = it names one; 'unreadable' = anything else.
export function judgeRun(result) {
  try {
    const read = interpretRun(result, guardRunActive);
    if (!read.ok) return 'unreadable';
    return read.value.slug === null ? 'idle' : 'active';
  } catch {
    return 'unreadable';
  }
}
