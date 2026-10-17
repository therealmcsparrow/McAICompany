---
name: incident
description: Playbook. Handle a production incident fast. Mitigate, check EU reporting duties, fix, then write the postmortem. Urgency allowed; the Ship Gate stays.
disable-model-invocation: true
argument-hint: <what happened>
---

# Playbook: incident

Run with `aico:pipeline`. No Brief or Plan Gate: urgency is allowed, the Ship Gate is kept.

1. `aico:devops`: triage (impact, scope, timeline) and propose a mitigation, ∥ `aico:security` if it is security-related.
2. **→ Ship Gate (mitigation only):** rollback or feature flag. The CEO can approve it in one line. Then `aico:devops` applies it.
3. `aico:legal`: reporting check per `aico:eu-compliance` (CRA: ENISA early warning within 24 h; GDPR breach: authority within 72 h). Drafts only.
   **→ Ship Gate (reports only):** the CEO approves sending each draft; the CRA early warning goes out within 24 h.
4. Fix via the `aico:fix` route (follow `aico:fix` steps 1–3; its Ship Gate and release are the final Ship Gate below).
5. `aico:devops`: postmortem (timeline, root cause, what changes) and a Lesson in its Handoff; the Lead appends it per `aico:pipeline`.
   **→ Ship Gate** before any report is sent or the fix is deployed, covering later and final reports too. The pipeline wrap-up (summary, Lessons) runs only after the final Ship Gate.
