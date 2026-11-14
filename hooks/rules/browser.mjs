// Saver browser.Y1: a Lead browser screenshot call gets a one-line note for the CEO.
// judge(event, snapshot) is pure and synchronous; it never rewrites input and adds no model text.

const RULE = 'browser.Y1';
const SAVER = 'efficient-browser-use';
const MESSAGE = 'aico saver browser.Y1: a browser screenshot costs image tokens; read the page as text where that is enough.';

function allow() {
  return { v: 'allow' };
}

export function judge(event, snapshot) {
  if (!event || typeof event !== 'object' || event.event !== 'PreToolUse' || event.session !== 'lead') return allow();
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.savers || snapshot.savers[SAVER] !== true) return allow();
  const type = typeof event.agentType === 'string' ? event.agentType.toLowerCase() : '';
  if (type === 'hands-on-tester' || type.endsWith(':hands-on-tester')) return allow();
  const name = event.tool && typeof event.tool.name === 'string' ? event.tool.name : '';
  if (!/^mcp__[^_].*screenshot$/i.test(name)) return allow();
  return { v: 'note', rule: RULE, message: MESSAGE };
}
