# Handoff v1.1 (pilot Roles)
Contract: `docs/contracts/handoff.md`. Lint: `handoff-lint.mjs --require-top`; an error re-dispatches you, no Fix round.

**Top block**, directly after `By:`: one `aico-top` fence, these keys in order, one line each: `status`, `files`, `ac_ids` (same as frontmatter `status`, `files-touched`, `acceptance-ids`; `[]` if absent; a mismatch is malformed), `rule_ids` (applied or checked), `risks` (finding IDs that carry a risk), `read_next` (at most 5 pointers `path`, `path#heading` (heading text may hold spaces), `R-n`; no copied text), `tokens_used` (integer or `unknown`). One block, lines under 1000 characters.

**Finding rows** in `## Blocking` and `## Nits`:
- Blocking: `- [contract|spec|security|test] <ID> | <file>[:<line>[-<line>]] | <problem> | <why> | <fix>`
- Nit: `- <ID> | <file>[:<line>] | <problem> | <why> | <fix>`
- `<ID>`: `R-<n>` review, `C-<n>` compliance, `T-<n>` tool check; stable across Fix rounds, never reused. `why` never empty; no `|` in a field.

**Findings ledger** `<NN>-<role>.findings.md` beside your Handoff, only with `status: handover`: once your context passes three quarters of `<n>` (the handover point of your `Context cap:` line), or you can't tell and have read over 15 files, decide whether you will finish; if not, start it, keep it current and return `handover`. A `done`, `blocked` or `needs-ceo` Handoff writes none; a `handover` Handoff always has it.
- Layout: the Handover line of your agent; statuses `open|fixed|withdrawn`; no `|` inside a field; a Nit's Handoff row drops `[nit]`. Rows are appended or change status, never deleted.
- A handover or Fix-round reviewer continues the same file, appends every new finding before its Handoff, and re-checks only open rows plus the new diff. Check: `handoff-lint.mjs --findings <file>`.
- No ledger: keep the IDs of rows you re-report, list closed ones in `## Did` (`fixed R-2`), number new findings from 1 + the highest `R-<n>`/`C-<n>` in any earlier Handoff of the task.
- Handoff v1.2: a pilot row's `R-<n>` is keyed `<NN>-<role>:R-<n>` by the file name; the ledger statuses above (`open|fixed|withdrawn`) are ledger rows only. Contests and their states: `references/contest.md`.
