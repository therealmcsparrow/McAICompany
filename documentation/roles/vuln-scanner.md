# vuln-scanner

## In short
Viktor, the vulnerability scanner, checks which of your actual dependencies and code are flagged in published vulnerability databases. He runs only when you call him, never in the default build, audit or maintain flows. He never changes your dependency tree.

## How it works
1. You run [`/aico:vulnscan`](../commands/vulnscan.md) or ask for him directly.
2. The Lead dispatches Viktor.
3. He matches each advisory to your installed version and range, and records a source URL for every finding.
4. Critical, High and known-exploited hits are reported for you to act on. Medium and Low hits become an upgrade set.

## Technical details
- Agent file: `agents/vuln-scanner.md`
- Default name: Viktor
- Model: sonnet. Effort: low. Protected Role: it never runs below its floor. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash, WebSearch, WebFetch
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.

### What it reports
Reports which of your actual dependencies and code are flagged on **published vulnerability databases** — NVD/CVE, OSV, GitHub Advisories, the ecosystem's advisory DB, vendor advisories and CISA KEV. It uses primary sources only (never blogs or AI summaries), matches each advisory to your installed version and range, and records a source URL for every finding. It never changes your dependency tree.

- **Critical/High, or known-exploited (KEV):** reported for you to act on; a KEV/exploited hit is Blocking and suggests `/aico:incident`.
- **Medium/Low:** collected into a ready **upgrade set** of safe fixed-in bumps you can apply in one `/aico:maintain` run.

Back to [all Roles](README.md).
