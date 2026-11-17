// cap.M1: the context cap. The only home of the cap constants and formulas.
// Pure: reads the event and the snapshot it is given and returns a verdict; the engine applies the named effect.
const RULE = 'cap.M1';
export const DEFAULT_THRESHOLD = 180000;
export const MIN_THRESHOLD = 60000;
export const MAX_THRESHOLD = 250000;
const FREEZE_NUM = 9;
const FREEZE_DEN = 10;
const HANDOFF_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.md$/;
const LEDGER_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.findings\.md$/;
const MAX_NAMED = 35;

const STEP_REASON = 'aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.';
const STOP_REASON = 'aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.';
const FREEZE_REASON = 'aico context cap: the Lead agent reached the hand-over point and the Lead Handoff is written. End your turn now with these lines, and call no tool: STATUS: handover; handoff: <path of the Lead Handoff>; next: <what the next Lead session does first>. Every tool is refused.';
const FROZEN_REASON = 'aico context cap: this Lead agent is frozen. Every tool is refused. End your turn now with these lines: STATUS: handover; handoff: <path of the Lead Handoff>; next: <what the next Lead session does first>.';
const UNREADABLE = `${RULE}: unreadable`;
const RUN_UNREADABLE = `${RULE}: unreadable. The run state of the active run cannot be read at the hand-over point. Fix or remove the malformed lead-handover.jsonl in the run folder, or check the run state with run-state show, then retry.`;

const isObj = (v) => v !== null && typeof v === 'object';

// The freeze point: floor(threshold x 0.9), in integers.
export function freezeAt(threshold) {
  return Math.floor((threshold * FREEZE_NUM) / FREEZE_DEN);
}

// A cap value from settings: an integer in range passes; anything else gives the default and one warning.
export function resolveThreshold(raw) {
  if (Number.isInteger(raw) && raw >= MIN_THRESHOLD && raw <= MAX_THRESHOLD) return { threshold: raw, warning: null };
  let named = '';
  if (raw !== null && raw !== undefined) {
    // eslint-disable-next-line no-control-regex
    named = ` ${String(raw).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NAMED)}`;
  }
  return {
    threshold: DEFAULT_THRESHOLD,
    warning: `aico cap: ignoring context cap${named || ' (not a number)'}, valid is ${MIN_THRESHOLD}-${MAX_THRESHOLD}; using ${DEFAULT_THRESHOLD}`,
  };
}

const deny = (message, effect) => (effect ? { v: 'deny', rule: RULE, message, effect } : { v: 'deny', rule: RULE, message });

function dirOf(normalized) {
  const i = normalized.lastIndexOf('/');
  return i === -1 ? '' : normalized.slice(0, i);
}

// 'handoff' or 'ledger' when the call is one Write of a new Handoff or findings ledger directly in the run folder.
function writeKind(event, run) {
  const tool = event.tool;
  if (tool.name !== 'Write' || !Array.isArray(tool.paths) || tool.paths.length !== 1) return null;
  const p = tool.paths[0];
  if (!isObj(p) || p.exists === true || typeof p.real !== 'string' || typeof run.folder !== 'string') return null;
  const real = p.real.replaceAll('\\', '/');
  if (real.split('/').includes('..')) return null;
  const base = real.slice(real.lastIndexOf('/') + 1);
  const kind = HANDOFF_NAME.test(base) ? 'handoff' : LEDGER_NAME.test(base) ? 'ledger' : null;
  if (!kind) return null;
  if (dirOf(real).toLowerCase() !== run.folder.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()) return null;
  return kind;
}

function judgeStep(event, run) {
  const kind = writeKind(event, run);
  const agent = isObj(run.agent) ? run.agent : {};
  if (kind === 'handoff' || (kind === 'ledger' && agent.ledger !== true)) return { v: 'allow', rule: RULE, effect: 'cap-step-record' };
  return deny(STEP_REASON, 'cap-step-record');
}

// The Lead agent at its hand-over point: every tool is denied, the first time with the freeze effect. Main never reaches here.
function judgeLead(run) {
  return run.frozen === true ? deny(FROZEN_REASON, 'cap-lead-frozen') : deny(FREEZE_REASON, 'cap-lead-freeze');
}

export function judge(event, snapshot) {
  if (!isObj(event) || !isObj(event.run)) return { v: 'allow' };
  // main (session lead, no agent) is never capped, at any token level.
  if (event.session === 'lead' && !event.agentKey) return { v: 'allow' };
  const tokens = isObj(event.tokens) ? event.tokens : {};
  if (tokens.state === 'error') return deny(UNREADABLE);
  if (!isObj(snapshot) || !Number.isInteger(snapshot.threshold) || snapshot.threshold <= 0) return deny(`${RULE}: snapshot-invalid`);
  const total = tokens.state === 'none' || !Number.isFinite(tokens.total) ? 0 : tokens.total;
  if (total < freezeAt(snapshot.threshold)) return { v: 'allow' };
  if (!isObj(event.tool)) return deny(UNREADABLE);
  if (event.run.error === true) return deny(RUN_UNREADABLE);
  return event.session === 'step' ? judgeStep(event, event.run) : judgeLead(event.run);
}

// SubagentStop: block once when this Step was refused tools and has no Handoff on record.
export function judgeStop(event) {
  const run = isObj(event) ? event.run : null;
  if (!isObj(run) || !isObj(run.agent) || typeof event.agentKey !== 'string') return { v: 'allow' };
  if (run.agent.deny === true && run.agent.handoff !== true) return deny(STOP_REASON);
  return { v: 'allow' };
}
