# `/aico:usability-test`

`/aico:usability-test <what to test> [real-users]`

## In short
**What it does.** Every Persona tests a design, URL or app in parallel — walkthrough, hands-on and accessibility — and you get one combined report.

**When to use it.** Before or after building, to see whether real users of each Persona can actually complete the key tasks.

**Help:** `/aico:usability-test help` (or `--help`) explains the command without running it.

## How it works
1. If the project has no Personas yet, the **Product Manager** proposes 2–4. **→ Brief Gate** (you approve them).
2. In parallel, one per Persona: **Persona Tester** (designs/prototype), **Hands-on Tester** (running app), and the **Accessibility Tester** (WCAG, once).
3. The Lead merges a report: a verdict per Persona, S1/S2/S3 findings de-duplicated with "n of N Personas hit this", and the top 5 changes with owners.
4. With `real-users`: the **UX Researcher** writes a test plan, screener, script and consent; **Legal** checks the consent. **→ Ship Gate** before any outreach.
5. S1 findings are Blocking and fixed before Ship; you pick which S2/S3 to fix (as a new `/aico:feature` or `/aico:fix` run).

## Technical details
**You get.** `.company/work/<slug>/usability-report.md`. No code changes in the test itself.

**Example.** `/aico:usability-test ./designs/checkout-flow.png`
