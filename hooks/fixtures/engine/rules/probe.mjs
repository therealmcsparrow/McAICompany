// Probe guard: reports the normalized event as a compact JSON note, so a test sees what a rule sees.
export function judge(event) {
  const t = event.tool;
  const msg = JSON.stringify({
    e: event.event, s: event.session, sk: event.sessionKey, ak: event.agentKey, at: event.agentType,
    t: t ? t.name : null, m: t ? t.model : null, st: t ? t.subagentType : null,
    tk: `${event.tokens.state}:${event.tokens.total}`, mm: event.mainModel,
    g: event.env.guardsOff, sm: event.env.subagentModel, sf: event.env.subagentModelForce,
    d: event.drift, sh: event.stopHookActive, f: Object.isFrozen(event), kn: Object.keys(event).length, tn: t ? Object.keys(t).length : 0
  });
  return { v: 'note', rule: 'probe.M1', message: msg };
}
