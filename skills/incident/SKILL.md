---
name: incident
description: Playbook. Handle a production incident fast. Mitigate, check EU reporting duties, fix, then write the postmortem. Urgency allowed; the Ship Gate stays.
disable-model-invocation: true
argument-hint: <what happened>
---

# Playbook: incident

Run with `aico:pipeline`. No Brief or Plan Gate: urgency is allowed, the Ship Gate is kept.

1. `aico:devops`: triage (impact, scope, timeline) and propose a mitigation, ∥ `aico:security` if it is security-related.
2. **→ Ship Gate (mitigation only):** rollback or feature flag. The CEO can approve it in one line.
3. `aico:legal`: reporting check per `aico:eu-compliance` (CRA: ENISA early warning within 24 h; GDPR breach: authority within 72 h). Drafts only.
4. Fix via the `aico:fix` route (follow `skills/fix/SKILL.md` in place).
5. `aico:devops`: postmortem (timeline, root cause, what changes) and a Lesson for `.company/lessons.md`.
   **→ Ship Gate** before any report is sent or the fix is deployed.
