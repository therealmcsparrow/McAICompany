---
name: debugging
description: Use when an aico Role hits a bug, failing test or unexpected behavior, before proposing a fix.
---

# Debugging

**Use** `superpowers:systematic-debugging` if available; the phases below apply either way. No fix without a confirmed root cause. Skip a phase only with the reason in the Handoff.

**Redact.** Every command, output or captured artifact you show or write to a Handoff has secrets replaced by `<REDACTED>`. Keep credentials in env vars, never in the loop's text; quote only the log lines that carry the signal.

1. **Feedback loop first.** Build one command that goes red on this bug: a failing test at the seam that reaches it, a curl against the dev server, a CLI run diffed against a known-good snapshot, a headless browser script, a replayed captured request, a throwaway harness, a fuzz loop, `git bisect run` between a good and a bad state, or the same input through two versions. Done when you have run it at least once and it is red-capable (asserts the reported symptom, not "didn't crash"), deterministic (pin time, seed randomness, isolate the file system), fast and runs unattended. Flaky bug → raise the reproduction rate (loop it, add stress) until it is debuggable. No loop possible → stop, list what you tried, and return `needs-ceo` asking for an environment, a redacted artifact or permission for temporary instrumentation. Never theorize from code before the loop exists.
2. **Reproduce and minimise.** Confirm the loop shows the failure that was reported, not a nearby one. Cut inputs, callers, config and steps one at a time, re-running after each, until every remaining part is needed to go red.
3. **Hypothesise.** Write 3–5 ranked hypotheses before testing any. Each is falsifiable: "if X is the cause, then changing Y makes it go green". One you cannot phrase that way is dropped. Put the list in the Handoff.
4. **Instrument.** Each probe tests one prediction and changes one variable. Prefer a debugger, then targeted logs at the boundaries that tell hypotheses apart; never log everything. Tag every debug log with one prefix, e.g. `[DEBUG-a4f2]`. Performance: measure a baseline first (timer, profiler, query plan), then bisect.
5. **Regression test, then fix.** Turn the minimised repro into a failing test at a seam where the real bug pattern occurs (`aico:tdd`), watch it fail, fix, watch it pass, re-run the original loop. Only a seam too shallow to catch the bug exists → no test there; record it under `## Decisions` as an architecture finding.
6. **Clean up.** Grep the debug prefix to zero, delete throwaway harnesses, re-run the loop, `aico:verify`, and state the confirmed root cause in the Handoff and the commit message.
