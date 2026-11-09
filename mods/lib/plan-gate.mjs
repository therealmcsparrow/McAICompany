// Pure logic for the plan Gate mod: which commands and files it judges, and what a `plan-check verify --json` answer means.
// Nothing here runs a process or touches a file. Allow-lists only: anything not matched exactly is not judged.
import { isRunSlug, isProjectId, workParts, isLegacySlug } from './work-folder.mjs';

const MAX_COMMAND = 4096;
const MAX_PATH = 4096;
const MAX_STDOUT = 65536;
const MAX_COUNT = 1000000;
const SCRIPT_PATH = /^[A-Za-z0-9_.:/\\+@-]+$/;
const POLICIES = ['off', 'warn', 'block'];
const STATES = ['pass', 'open', 'error'];
// A run-state record file under a run folder. Trailing dots, spaces and a stream suffix reach the same file on Windows.
const RECORD_PATH = /(?:(?:^|\/)\.company\/|^)work\/([^/]*(?:\/[^/]*)?)\/run-state\.jsonl[. ]*(?::.*)?$/i;

// A path that has a segment after the `work` folder.
const WORK_ROOT = /(?:(?:^|\/)\.company\/|^)work\/./i;

export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

export const TEXT = {
  error: 'plan-check error',
  denyError: 'aico plan gate: plan-check error; fix the plan check, then retry',
  denyOpenUnknown: 'aico plan gate: open decisions; answer or settle them in the plan',
  denyRecord: 'aico plan gate: the run record is written by the run-state script only',
  failed: 'aico plan gate failed; refused'
};

export function isSlug(value) {
  return isLegacySlug(value);
}

function isScript(file, name) {
  if (typeof file !== 'string' || file.startsWith('-') || !SCRIPT_PATH.test(file)) return false;
  const path = file.replaceAll('\\', '/');
  return path === `scripts/${name}` || path.endsWith(`/scripts/${name}`);
}

const GATE_TAIL = ' plan passed';

// The run name when `rest` (the text after `gate `) is one single-quoted work folder name or one unquoted legacy
// slug, then exactly ` plan passed`; else null.
function gateName(rest) {
  if (rest.startsWith("'")) {
    const close = rest.indexOf("'", 1);
    if (close < 0 || rest.slice(close + 1) !== GATE_TAIL) return null;
    const name = rest.slice(1, close);
    return workParts(name) !== null ? name : null;
  }
  if (!rest.endsWith(GATE_TAIL)) return null;
  const name = rest.slice(0, -GATE_TAIL.length);
  return isSlug(name) ? name : null;
}

// The run name when the command is, character for character, one of the two recorded forms of the plan Gate; else null.
//   node <path>/scripts/run-state.mjs gate '<name>' plan passed
//   node <path>/scripts/run.mjs run-state gate '<name>' plan passed
// The name is one single-quoted token with no quote inside and passes workParts; the old unquoted form with a legacy
// slug is still judged. Single spaces only: a double quote, a chain, an env prefix, a redirect, a newline, a second
// quoted token or any other character is not judged.
export function parseGateCommand(command) {
  if (typeof command !== 'string' || command.length > MAX_COMMAND || !command.startsWith('node ')) return null;
  const end = command.indexOf(' ', 5);
  if (end < 0) return null;
  const script = command.slice(5, end);
  const rest = command.slice(end + 1);
  if (isScript(script, 'run-state.mjs') && rest.startsWith('gate ')) return gateName(rest.slice(5));
  if (isScript(script, 'run.mjs') && rest.startsWith('run-state gate ')) return gateName(rest.slice(15));
  return null;
}

// The path with every `.` and empty segment dropped and every `..` applied to the segment before it.
function resolveSegments(text) {
  const out = [];
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

// Judged when the last segment of a path under `work/` is a short (8.3) alias, or a record name with trailing dots or spaces.
function aliasName(path) {
  if (!WORK_ROOT.test(path)) return false;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('~') || (/^run-st/i.test(last) && /[. ]$/.test(last));
}

function matchRecord(path) {
  const found = RECORD_PATH.exec(path);
  if (found === null) return null;
  // A second segment under a valid work folder (not a project folder) is a sub folder, not a record. Any other
  // one- or two-segment match that is not a run slug is judged with a null slug, since Windows may open the record.
  const first = found[1].slice(0, found[1].indexOf('/') < 0 ? undefined : found[1].indexOf('/'));
  if (found[1].includes('/') && workParts(first) !== null && !isProjectId(first.toUpperCase())) return null;
  return { slug: isRunSlug(found[1]) ? found[1] : null };
}

// For a path to a run-state record under `work/`: { slug } (slug is null when it is not a valid slug); else null.
// The raw text and the path with its `.`, `..` and empty segments resolved are both tested, so neither form hides a record.
export function recordPath(path) {
  if (typeof path !== 'string' || path.length > MAX_PATH) return null;
  const raw = path.replaceAll('\\', '/');
  const resolved = resolveSegments(raw);
  return matchRecord(raw) ?? matchRecord(resolved) ?? (aliasName(resolved) ? { slug: null } : null);
}

export function writeTarget(input) {
  if (input === null || typeof input !== 'object') return null;
  const own = (key) => (Object.hasOwn(input, key) && typeof input[key] === 'string' ? input[key] : null);
  return own('file_path') ?? own('notebook_path') ?? own('path');
}

function parseVerify(stdout) {
  if (typeof stdout !== 'string' || stdout.length > MAX_STDOUT) return null;
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { v, policy, state, count } = value;
  if (v !== 1 || !POLICIES.includes(policy) || !STATES.includes(state)) return null;
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) return null;
  return { policy, state, count };
}

function openText(count) {
  return `aico plan gate: ${count} open decision${count === 1 ? '' : 's'}; answer or settle them in the plan`;
}

// What to do with one `plan-check verify <slug> --json` run.
//   result: { exitCode, stdout } as `$.process.run` gives it, or null when the call itself failed
//   last: the policy of the last answer this session, or null
// Returns { policy, action: 'next' | 'deny' | 'toast', text }. `policy` is what the answer printed, else null.
// Only a policy of `block` refuses a failure. The mod is the early explanation; the scripts refuse a Gate that is not met.
export function decideVerify(result, last) {
  const answer = result !== null && typeof result === 'object' && result.isStdoutTruncated !== true ? parseVerify(result.stdout) : null;
  const exitCode = result !== null && typeof result === 'object' ? result.exitCode : null;
  const policy = answer === null ? null : answer.policy;
  const effective = policy ?? last;
  const failure = () => {
    if (effective === 'block') return { policy, action: 'deny', text: TEXT.denyError };
    return { policy, action: 'toast', text: TEXT.error };
  };
  if (result === null || typeof result !== 'object') return failure();
  if (exitCode === 2) {
    if (answer === null) return { policy: 'block', action: 'deny', text: TEXT.denyOpenUnknown };
    return { policy: answer.policy, action: 'deny', text: answer.state === 'open' ? openText(answer.count) : TEXT.denyError };
  }
  if (exitCode === 1) return failure();
  if (exitCode !== 0 || answer === null) return failure();
  if (answer.state === 'error') return failure();
  if (answer.state === 'open') {
    if (answer.policy === 'block') return { policy, action: 'deny', text: openText(answer.count) };
    if (answer.policy === 'warn' && answer.count > 0) return { policy, action: 'toast', text: `aico plan gate: ${answer.count} open decision${answer.count === 1 ? '' : 's'} (warn)` };
  }
  return { policy, action: 'next', text: '' };
}

// The answer to the mod's own failure: refused only under a `block` policy.
export function ownFailure(last) {
  return last === 'block' ? 'deny' : 'next';
}
