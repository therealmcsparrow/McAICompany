# Fix rounds

Limit and escalation for blocking findings (`aico:pipeline` §5; `ship-check`).

## Running a round
When the Reviewer, QA, Security or the Senior Engineer (compliance) returns `## Blocking` items:
1. One Fix round = dispatch the builder with *all* blocking reviewer Handoffs as input, then re-dispatch *every* reviewer that blocked (in parallel), `Round: N` in each. With a parallel record the builders sent back are the tasks `plan-tasks.mjs round` names, started through `next` (`references/parallel.md` step 8).
2. Each blocker is tagged `contract|spec|security|test`: send `security`/`contract` blockers to the owning builder first; a `contract` blocker needing a Contract change goes to the Architect (a Plan Gate, not a Fix round).
3. Nits never trigger a round. Once the last review has no Blocking items, all open nits get **one** bounded builder nit Fix Step (`route fix`, `references/route.md` §6) before the Ship Gate: not a Fix round, no re-review round, and its own nits never loop. A nit it does not fix, or a new nit, goes to `.company/standards.md` `## Debt` at the After-approval writes with no form; the Ship Gate summary lists it as Debt. Never ask the CEO about nits.
4. A builder's Must exception (`needs-ceo`, `aico:ruleset`) is a CEO question, not a Fix round. Debt never triggers a round; an exploitable security Must is Blocking, not Debt.

## Past the last round
The count is the `round:` field of the Handoffs. The limit is `pipeline.fix_rounds`. Still blocking after the last allowed round → no new round, then by tag:
- **Only `[test]` Blocking items left** (test quality: a missing, weak or wrong test; no `security`, `contract` or `spec` item): one automatic extra Fix round, no form. Still only `[test]` items after it → they go to `## Debt` with no form and the Gate goes on.
- **Any `[security]`, `[contract]` or `[spec]` item open** (security or correctness): escalate to the CEO in one form (`references/ceo-pack.md`) with the reviewer Handoff paths.
At 0, the first blocking review goes straight to these rules (the automatic extra round included).

## Escalation form
Single-select, options in this order. While an open `[security]` Blocking row is on file, option 1 is not offered (an exploitable security Must is never Debt, only a CEO exception under `aico:ruleset` closes it) and option 2 is the Recommended one:
1. Ship with Debt (Recommended): the open findings go to `## Debt` and the Gate goes on. Not offered for an open `[security]` row.
2. Cut scope: drop the failing part and its ACs; re-plan through the Plan Gate.
3. Extra round: one more Fix round, then the form again if it still blocks.

A fail whose only cause is a stale test expectation (the test pins old behaviour the change made wrong) goes to `## Debt`, not Blocking, so it costs no round.

## At the Ship Gate after the last round
Run `ship-check` (`references/gates.md`). A `tier` block is cleared by `tier-set ran '<slug>' <entry>` or `route fix '<slug>' security '<why>'` after the owed Step ran, not by a Fix round. Nits never trigger a round.
