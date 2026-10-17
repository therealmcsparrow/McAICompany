---
name: usability-test
description: Playbook. Test a design or running product with every Persona in parallel (persona, hands-on, accessibility), merge the findings, optionally plan real-user tests, and route fixes.
disable-model-invocation: true
argument-hint: <what to test: design path, URL or app> [real-users]
---

# Playbook: usability-test

Run with `aico:pipeline`. It's read-only like an audit: no builders until the CEO picks fixes.

1. **Personas:** if `## Personas` in `.company/project.md` is empty, dispatch `aico:product-manager` to propose 2–4 → **Brief Gate** (the CEO approves the Personas).
2. **Parallel, in one message**, one dispatch per Persona per tester (`Persona: <name>` in each Goal):
   - designs or prototype only → `aico:persona-tester`
   - running app → `aico:hands-on-tester` (pass the URL or start command and test accounts)
   - always → `aico:accessibility-tester` (once, all checks)
3. **Merge:** you (the Lead) write `.company/work/<slug>/usability-report.md`:
   - a verdict per Persona (yes / with difficulty / no)
   - S1 / S2 / S3 findings, de-duplicated across Personas, with "n of N Personas hit this"
   - top 5 changes, each with an owner Role
4. **`real-users` argument:** dispatch `aico:ux-researcher` for a plan, screener, script and consent → `aico:legal` checks the consent → **Ship Gate** before any outreach.
5. **Present** the report. S1 findings (Blocking) are fixed before Ship; the CEO picks which S2/S3 to fix. The fixes then run as a new `aico:feature` or `aico:fix` run, which the CEO starts.
