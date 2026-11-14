// Stub guard for the engine tests. The command text picks the behaviour, so one rule row covers every case.
const cmd = (e) => (e && e.tool && typeof e.tool.command === 'string' ? e.tool.command : '');
export function judge(event) {
  const c = cmd(event);
  if (c.includes('g:crash')) throw new Error('boom');
  if (c.includes('g:loop')) { for (;;) { /* synchronous endless loop */ } }
  if (c.includes('g:extra')) return { v: 'allow', extra: 1 };
  if (c.includes('g:bad')) return { v: 'maybe' };
  if (c.includes('g:promise')) return Promise.resolve({ v: 'allow' });
  if (c.includes('g:mutate')) { event.tool.command = 'changed'; event.session = 'lead'; return { v: 'allow' }; }
  if (c.includes('g:deny')) return { v: 'deny', rule: 'stub-guard.M1', message: 'stub guard says no' };
  if (c.includes('g:note')) return { v: 'note', rule: 'stub-guard.M1', message: 'stub guard note' };
  return { v: 'allow' };
}

// Second rule, for the first-deny-per-rule toast test.
export function judge2(event) {
  return cmd(event).includes('t:deny') ? { v: 'deny', rule: 'stub-two.M1', message: 'stub two says no' } : { v: 'allow' };
}
