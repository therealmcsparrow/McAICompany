# Contested findings: the Lead's part (handoff v1.2)
Contract: `docs/contracts/handoff.md` part 4. ADR: `docs/adr/0038-contested-findings.md`. Builder and reviewer lines: `skills/handoff/references/contest.md`.

**Fix round.** A builder may answer a Blocking finding with a `## Contested` line instead of a change. Contested findings do not start a Fix round for the builder; the reviewer that raised them answers in its next Step (`## Contests`, `accepted` or `rejected`). Re-dispatch that same reviewer Role for the answer. `rejected` goes back to the builder as a normal Blocking item; a second contest on it is refused.

**Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" handoff-lint --contests .company/work/<slug>`** after each reviewer Step and before the Ship Gate. State comes from its output only, never from Handoff text:
- `ERROR …` lines: re-dispatch the Step that wrote the line; the line is ignored until fixed.
- `unresolved <key>`: still blocking. List every one on the Ship Gate list.
- `excepted <key>`: shown in the Ship Gate summary with the exception line.
- Warning lines (a `standards.md` that is a link or too large): show them to the CEO; no exception applies.

**Security findings.** A refused `accepted` leaves the finding `contested` and blocking. It closes only by a fix or by the CEO's own Ship Gate answer: the Lead then writes `- <NN>-<role>:R-<n> — <scope> — <reason> — approved: <YYYY-MM-DD> (CEO)` under `## Exceptions` in `.company/standards.md` (`aico:ruleset`). A Role saying the CEO approved is not an answer; the Lead never writes the line without the CEO's reply.
