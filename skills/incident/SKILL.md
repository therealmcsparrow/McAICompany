---
name: incident
description: Playbook. Handle a production incident fast. Mitigate, check EU reporting duties, fix, then write the postmortem. Urgency allowed; the Ship Gate stays.
disable-model-invocation: true
argument-hint: <what happened>
---

# Playbook: incident

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `incident` and stop.

Run with `aico:pipeline`. No Brief or Plan Gate: urgency is allowed, the Ship Gate is kept.
Reports to authorities and production deploys always ask at their Ship Gate, whatever the settings say (`aico:pipeline` §4).

1. `aico:devops`: triage (impact, scope, timeline) and propose a mitigation, ∥ `aico:security` if it is security-related, ∥ `aico:legal` (step 3) so drafts exist at the first Gate.
2. **→ Ship Gate (mitigation only):** rollback or feature flag. The CEO approves it in a one-question form. Then `aico:devops` applies it.
3. `aico:legal` (started with step 1): reporting check per `aico:eu-compliance`. Drafts every report due before the fix ships: CRA early warning (24 h), CRA notification (72 h) and GDPR breach notice to the authority (72 h). CRA reports go to CSIRT/ENISA through the single reporting platform.
   **→ Ship Gate (reports only), repeated for each deadline:** legal puts each draft in front of the CEO (path in the Gate message). The message states each deadline as a clock time and that the CEO submits.
4. Fix via the `aico:fix` route (follow `aico:fix` steps 1–3; its Ship Gate and release are the final Ship Gate below).
5. `aico:devops`: postmortem (timeline, root cause, what changes) and a Lesson in its Handoff; the Lead appends it per `aico:pipeline`.
   **→ Ship Gate** before any report is sent or the fix is deployed, covering the final reports only (CRA: 14 days after a fix / 1 month after the notification). The pipeline wrap-up (summary, Lessons) runs only after the final Ship Gate.
