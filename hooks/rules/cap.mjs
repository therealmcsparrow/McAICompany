// cap.M1: the context cap. The only home of the cap constants and formulas.
// Pure: reads the event and the snapshot it is given and returns a verdict; the engine applies the named effect.
const RULE = 'cap.M1';
export const DEFAULT_THRESHOLD = 180000;
export const MIN_THRESHOLD = 60000;
export const MAX_THRESHOLD = 250000;
const FREEZE_NUM = 9;
const FREEZE_DEN = 10;
const MCP_TOOL = 'mcp__plugin_aico_lead-session__lead_new_session';
const FEEDBACK_TOOL = 'SendFeedback';
const HANDOFF_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.md$/;
const LEDGER_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.findings\.md$/;
const MAX_NAMED = 35;

const STEP_REASON = 'aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.';
const STOP_REASON = 'aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.';
const FREEZE_REASON = 'aico context cap: the Lead Handoff is written and this session is frozen. Call lead_new_session, or show the CEO the new session command.';
const FROZEN_REASON = 'aico context cap: this session is frozen. Start a new session in the product folder with:';
const WAIT_REASON = 'aico context cap: no new Step from this session. Wait for the running Step; the Lead Handoff is written after it.';
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

function judgeLead(event, run) {
  const name = event.tool.name;
  if (run.frozen === true) return name === MCP_TOOL || name === FEEDBACK_TOOL ? { v: 'allow' } : deny(FROZEN_REASON, 'cap-lead-frozen');
  if (run.stepRunning === true) return name === 'Agent' || name === 'Task' ? deny(WAIT_REASON) : { v: 'allow' };
  return name === MCP_TOOL ? { v: 'allow' } : deny(FREEZE_REASON, 'cap-lead-freeze');
}

export function judge(event, snapshot) {
  if (!isObj(event) || !isObj(event.run)) return { v: 'allow' };
  const tokens = isObj(event.tokens) ? event.tokens : {};
  if (tokens.state === 'error') return deny(UNREADABLE);
  if (!isObj(snapshot) || !Number.isInteger(snapshot.threshold) || snapshot.threshold <= 0) return deny(`${RULE}: snapshot-invalid`);
  const total = tokens.state === 'none' || !Number.isFinite(tokens.total) ? 0 : tokens.total;
  if (total < freezeAt(snapshot.threshold)) return { v: 'allow' };
  if (!isObj(event.tool)) return deny(UNREADABLE);
  if (event.run.error === true) return deny(RUN_UNREADABLE);
  return event.session === 'step' ? judgeStep(event, event.run) : judgeLead(event, event.run);
}

// SubagentStop: block once when this Step was refused tools and has no Handoff on record.
export function judgeStop(event) {
  const run = isObj(event) ? event.run : null;
  if (!isObj(run) || !isObj(run.agent) || typeof event.agentKey !== 'string') return { v: 'allow' };
  if (run.agent.deny === true && run.agent.handoff !== true) return deny(STOP_REASON);
  return { v: 'allow' };
}
