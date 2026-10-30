# `/aico:audit`

`/aico:audit [path or scope]`

## In short
**What it does.** A prioritized report on an existing codebase across quality, tests, security, licenses, performance and architecture. It changes no code.

**When to use it.** You've inherited or neglected code and want to know where it stands before investing — or as the groundwork for a [refactor](refactor.md).

**Help:** `/aico:audit help` (or `--help`) explains the command without running it.

## How it works
1. In parallel: **Code Reviewer** (quality, Core/Module/Contract conformance), **QA** (coverage, runs the suite, performance vs budget), **Security** (vulnerabilities, dependency audit), **Legal** (licenses, GDPR exposure), and the **Senior Engineer** (ruleset compliance of the whole codebase — findings are Debt, not blocking).
2. The Lead merges the lanes into one report: Critical / Important / Minor with file:line, owner and fix size; performance vs budget; ruleset violations; how far the code is from Core/Modules/Contracts; and the top 5 next actions.
3. Presented to you, with an offer to start `/aico:fix` or `/aico:feature` runs for what you pick.

## Technical details
**You get.** `.company/work/<slug>/report.md` — a ranked, actionable assessment. No code changes.

**Example.** `/aico:audit src/payments`
