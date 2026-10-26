# Handoff v1.1 (pilot Roles)
Contract: `docs/contracts/handoff.md`. The Lead runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff-lint.mjs" <file>` after each Step (`--require-top` for code-reviewer and senior-engineer compliance Handoffs); a lint error re-dispatches you, no Fix round.

**Top block**, directly after `By:`: one `aico-top` fence, these keys in order, one line each: `status`, `files`, `ac_ids` (same as frontmatter `status`, `files-touched`, `acceptance-ids`; `[]` if absent; a mismatch is malformed), `rule_ids` (applied or checked), `risks` (finding IDs that carry a risk), `read_next` (at most 5 pointers `path`, `path#heading`, `R-n`; no copied text), `tokens_used` (integer or `unknown`). One block, lines under 1000 characters.

**Finding rows** in `## Blocking` and `## Nits`:
- Blocking: `- [contract|spec|security|test] <ID> | <file>[:<line>[-<line>]] | <problem> | <why> | <fix>`
- Nit: `- <ID> | <file>[:<line>] | <problem> | <why> | <fix>`
- `<ID>`: `R-<n>` review, `C-<n>` compliance, `T-<n>` tool check; stable across Fix rounds, never reused. `why` never empty; no `|` in a field.

**Findings ledger** `<NN>-<role>.findings.md` beside your Handoff, only near a handover: start it when your context passes 75% of `<n>` (60% of `<cap>`; 90000 without a valid `Context cap:`), when you can't tell and have read over 15 files, or when you decide on `status: handover`; then keep it current. Continue your review chain's ledger if it has one. A review that ends `done`, `blocked` or `needs-ceo` before that writes none; a `handover` Handoff always has it.
- Frontmatter `step`, `role`, `base-commit`; `## Checked` file list; `## Findings` rows `- R-1 | open | [spec] | file:line | problem | why | fix` (`open|fixed|withdrawn`; a Nit is tagged `[nit]`, its Handoff row drops the tag). Rows are appended or change status, never deleted.
- A handover or Fix-round reviewer continues the same file and re-checks only open rows plus the new diff. Check: `handoff-lint.mjs --findings <file>`.
- No ledger: keep the IDs of rows you re-report, list closed ones in `## Did` (`fixed R-2`, `withdrawn R-5`), number new findings from 1 + the highest `R-<n>`/`C-<n>` in any earlier Handoff of the task.
