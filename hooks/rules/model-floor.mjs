// Guard model-floor.M1: a Role never runs on a model below its floor.
// judge(event, snapshot) is pure and synchronous: it reads the normalized event and returns a verdict object.

const RULE = 'model-floor.M1';
const RANK = { haiku: 0, sonnet: 1, opus: 2 };
const FAMILIES = Object.keys(RANK);
const MAX_MODEL_CHARS = 256;
const ROLE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function allow() {
  return { v: 'allow' };
}

function deny(message) {
  return { v: 'deny', rule: RULE, message: `aico guard ${RULE}: ${message}` };
}

function present(value) {
  return typeof value === 'string' ? value : null;
}

function roleOf(tool) {
  const raw = present(tool.subagentType) ?? present(tool.outputRole);
  if (raw === null) return null;
  const role = raw.trim().replace(/^aico:/, '');
  return ROLE_PATTERN.test(role) ? role : null;
}

function floorOf(snapshot, role) {
  const floor = snapshot && snapshot.floor;
  if (!floor || typeof floor !== 'object' || !Object.hasOwn(floor, role)) return null;
  const rank = RANK[floor[role]];
  return rank === undefined ? null : { name: floor[role], rank };
}

// Lowest family named in the model string; null when none is named.
function rankOf(model) {
  if (model.length > MAX_MODEL_CHARS) return null;
  const lower = model.toLowerCase();
  let rank = null;
  for (const family of FAMILIES) {
    if (lower.includes(family) && (rank === null || RANK[family] < rank)) rank = RANK[family];
  }
  return rank;
}

function isInherit(model) {
  return model.trim().toLowerCase() === 'inherit';
}

function forceOn(env) {
  const force = present(env && env.subagentModelForce);
  return force !== null && force.trim() !== '' && force.trim() !== '0';
}

// The model that runs, or { unknown: true } when it cannot be named, or null when the agent file decides.
function modelThatRuns(event) {
  const env = event.env || {};
  const mainModel = present(event.mainModel);
  const fromMain = () => (mainModel !== null && mainModel.trim() !== '' ? mainModel : { unknown: true });
  if (forceOn(env)) {
    const forced = present(env.subagentModel);
    if (forced === null || forced.trim() === '' || isInherit(forced)) return fromMain();
    return forced;
  }
  const dispatch = present(event.tool.model);
  if (dispatch === null) return null;
  return isInherit(dispatch) ? fromMain() : dispatch;
}

export function judge(event, snapshot) {
  const tool = event && event.tool;
  if (!tool || (tool.name !== 'Agent' && tool.name !== 'Task')) return allow();
  const role = roleOf(tool);
  if (role === null) return allow();
  const floor = floorOf(snapshot, role);
  if (floor === null) return allow();
  const model = modelThatRuns(event);
  if (model === null) return allow();
  if (typeof model === 'object') return deny(`forced model unknown; ${role} needs ${floor.name} or above.`);
  const rank = rankOf(model);
  if (rank === null) return deny(`model family unknown; ${role} needs ${floor.name} or above.`);
  if (rank < floor.rank) return deny(`model below the floor; ${role} needs ${floor.name} or above.`);
  return allow();
}
