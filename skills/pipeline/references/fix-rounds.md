# Fix rounds

Limit and escalation for blocking findings (`aico:pipeline` §5; `ship-check`).

## Running a round
When the Reviewer, QA, Security or the Senior Engineer (compliance) returns `## Blocking` items:
1. One Fix round = dispatch the builder with *all* blocking reviewer Handoffs as input, then re-dispatch *every* reviewer that blocked (in parallel), `Round: N` in each. With a parallel record the builders sent back are the tasks `plan-tasks.mjs round` names, started through `next` (`references/parallel.md` step 8).
2. Each blocker is tagged `contract|spec|security|test`: send `security`/`contract` blockers to the owning builder first; a `contract` blocker needing a Contract change goes to the Architect (a Plan Gate, not a Fix round).
3. Nits never trigger a round; they go in the Ship Gate summary. A nit on a Contract or Core path gets one builder Fix Step (`route fix`, `references/route.md`): not a Fix round.
4. A builder's Must exception (`needs-ceo`, `aico:ruleset`) is a CEO question, not a Fix round. Debt never triggers a round; an exploitable security Must is Blocking, not Debt.

## Past the last round
The count is the `round:` field of the Handoffs. The limit is `pipeline.fix_rounds`. Still blocking after the last allowed round → no new round: escalate to the CEO in one form (`references/ceo-pack.md`) with the reviewer Handoff paths. At 0, the first blocking review goes straight to the form.

## Escalation form
Single-select, options in this order. While an open `[security]` Blocking row is on file, option 1 is not offered (an exploitable security Must is never Debt, only a CEO exception under `aico:ruleset` closes it) and option 2 is the Recommended one:
1. Ship with Debt (Recommended): the open findings go to `## Debt` and the Gate goes on. Not offered for an open `[security]` row.
2. Cut scope: drop the failing part and its ACs; re-plan through the Plan Gate.
3. Extra round: one more Fix round, then the form again if it still blocks.

A fail whose only cause is a stale test expectation (the test pins old behaviour the change made wrong) goes to `## Debt`, not Blocking, so it costs no round.

## At the Ship Gate after the last round
Run `ship-check` (`references/gates.md`). A `tier` block is cleared by `tier-set ran '<slug>' <entry>` or `route fix '<slug>' security '<why>'` after the owed Step ran, not by a Fix round. Nits never trigger a round.
