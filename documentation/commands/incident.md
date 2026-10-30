# `/aico:incident`

`/aico:incident <what happened>`

## In short
**What it does.** Handles a production incident fast: mitigate first, check EU reporting duties, then write the postmortem. The run ends there. It does not fix the bug; you start the fix. Urgency is allowed; the Ship Gate stays.

**When to use it.** An outage, data loss, or a security event in something already live.

**Help:** `/aico:incident help` (or `--help`) explains the command without running it.

## How it works
1. **DevOps** triages (impact, scope, timeline) and proposes a mitigation, ∥ **Security** if security-related, ∥ **Legal** (drafts reports early).
2. **→ Ship Gate (mitigation only)** — rollback or feature flag; you can approve in one line. DevOps applies it.
3. **Legal** checks reporting duties and drafts the reports that are due now (CRA 24 h early warning and 72 h notification, GDPR 72 h). **→ Ship Gate (reports)**, repeated per deadline — each draft comes to you with its clock time; you submit. Nothing is sent before you approve.
4. **DevOps** writes the postmortem: timeline, root cause as known, and what must change.
5. The run ends. It tells you to start the fix yourself with `/aico:fix "<root cause> (incident .company/work/<slug>/)"`. It also lists the open final-report deadlines as dates (CRA: 14 days after a fix is available, or 1 month after the notification). To draft those later, run [`/aico:lead`](lead.md).

## Technical details
**You get.** A mitigation, drafted regulatory notices with deadlines, a postmortem with root cause and follow-ups, and the exact `/aico:fix` command plus the final-report dates in the end message. The fix and the final report are separate runs that you start.

**Example.** `/aico:incident the login API is returning 500s for about half of requests since 14:00`
