# The Ruleset and Debt

## In short
The Ruleset is the list of engineering rules a product must follow. Each rule is Must, Should or May. Security rules are always Must. Old code that breaks a newer rule is recorded as Debt and does not block a run.

## How it works
1. Build or refresh the rules with [`/aico:standards`](../commands/standards.md).
2. Builders follow the rules before review.
3. Only you can approve not following a Must, for a stated scope and date.
4. Old violations go on the Debt list; you decide when to pay them down.

## Technical details
### The Ruleset
A product's binding engineering rules, kept by the **Senior Engineer** and signed off by the Architect. Built and maintained with [`/aico:standards`](../commands/standards.md).

- **Rule packs** hold the rules for one tool and major version (`<tool>@<major>.md`), each rule with its source URL. They live in a shared library on your machine (`~/.mcsparrow/standards/`) and are copied into each product under `.company/standards/`; the product's own rules and the pack list live in `.company/standards.md`.
- **Freshness.** `node scripts/check.mjs --packs <dir>` fails a library pack that is older than 90 days or has a new advisory in its `advisories.json` since its date. CI checks the committed copies and fails only after 180 days, so CI doesn't go red just because a copy aged. The checker never goes online.
- **Tiers:** **Must** (always followed; a break blocks a run — all security rules are Must), **Should** (followed, or a written reason) and **May** (advice).
- **Sources:** Must rules come only from primary sources — official docs, style guides, linter defaults, and security bodies (OWASP, CWE, CISA KEV, vendor advisories). Should/May may also cite well-known community guides. Blogs, forums and AI-generated content are never a source.
- **Exception:** only you (the CEO) can approve not following a Must, in a stated scope. It's recorded with its date.
- **Security is law:** builders follow the rules *before* review, so a Fix round caused by a rule break is treated as a process failure, not normal flow.

### Debt
Existing violations of a rule that arrived *after* the code was written. Debt is listed in the Ruleset and **never blocks** a run — you decide when to pay it down with a fix or refactor run. The one exception: an existing violation of a security Must that is actually exploitable is Blocking.
