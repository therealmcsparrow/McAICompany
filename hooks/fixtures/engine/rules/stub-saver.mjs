// Stub saver for the engine tests; same marker idea as the stub guard, tokens start with `s:`.
const cmd = (e) => (e && e.tool && typeof e.tool.command === 'string' ? e.tool.command : '');
export function judge(event) {
  const c = cmd(event);
  if (c.includes('s:crash')) throw new Error('boom');
  if (c.includes('s:loop')) { for (;;) { /* synchronous endless loop */ } }
  if (c.includes('s:bad')) return { v: 'maybe' };
  if (c.includes('s:promise')) return Promise.resolve({ v: 'allow' });
  if (c.includes('s:note')) return { v: 'note', rule: 'cache-tax.Y1', message: 'stub saver note' };
  return { v: 'allow' };
}
