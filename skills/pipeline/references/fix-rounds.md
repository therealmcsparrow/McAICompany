# Fix rounds

Limit and escalation for blocking findings (`aico:pipeline` §5; `ship-check` v1.0).

## Past the last round
The count is the `round:` field of the Handoffs. The limit is `pipeline.fix_rounds`. Still blocking after the last allowed round → no new round: escalate to the CEO in one form (`references/ceo-pack.md`) with the reviewer Handoff paths. At 0, the first blocking review goes straight to the form.

## Escalation form
Single-select, options in this order:
1. Ship with Debt (Recommended): the open findings go to `## Debt` and the Gate goes on.
2. Cut scope: drop the failing part and its ACs; re-plan through the Plan Gate.
3. Extra round: one more Fix round, then the form again if it still blocks.

A fail whose only cause is a stale test expectation (the test pins old behaviour the change made wrong) goes to `## Debt`, not Blocking, so it costs no round.

## At the Ship Gate after the last round
Run `ship-check` (`references/gates.md`). A `tier` block is cleared by `tier-set ran '<slug>' <entry>` or `route fix '<slug>' security '<why>'` after the owed Step ran, not by a Fix round. Nits never trigger a round.
