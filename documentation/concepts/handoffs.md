# Handoffs

## In short
A Role never keeps work in its head for the next Role. It writes a file, the **Handoff**, and the next Role reads it. The files are the memory, not the chat. That is why a run survives a Role failing or restarting.

## How it works
1. A Role finishes its job and writes one Handoff file under `.company/work/<task>/`.
2. The Lead reads the fields at the top of the file to decide what happens next.
3. The next Role reads the Handoff and starts from there.
4. A blocker carries a tag, so the Lead can send the work back to the right Role.

## Technical details
A Role never keeps work in its head for the next Role. Each one writes a **Handoff** file — frontmatter plus `## Did`, `## Next`, `## Blocking` sections — that the following Role reads. Handoffs live under `.company/work/<task>/` as `NN-<role>.md`. This is why a run survives a Role failing or restarting: the files are the memory, not the conversation.

### The Handoff Contract
Handoffs aren't just prose — each carries machine-readable frontmatter the Lead and later Roles read as fields: `status`, `round`, `base-commit` (what reviewers diff against), `risk-tier`, `acceptance-ids` (which of the brief's criteria this Step delivers) and `files-touched`. Blockers are tagged `contract`, `spec`, `security` or `test` so the Lead routes a Fix round precisely. Because the fields are structured, independent Steps run **in parallel by default**, reviewers scope to `base-commit` instead of re-reading history, and a run can resume from any Step after a restart. The Lead records the run's `base-commit` once in its own hand-over record, so it survives a context compaction and never comes from a Role's file.

**v1.1 (pilot, off by default).** With the setting `pipeline.review_format: pilot` (default `plain`, see [Settings](settings-and-locks.md)), the code-reviewer and the compliance Step of the senior-engineer also write a short `aico-top` block right under the By line, with `status`, `files`, `ac_ids`, `rule_ids`, `risks`, `read_next` and `tokens_used`. Their findings are rows: `ID | file:line | problem | why | fix`. The IDs are stable, so a Fix round cites `R-3` instead of retyping the finding, and "why" is never empty. A malformed block blocks that Step. With `plain`, they write ordinary findings and no block. Other Roles write Handoffs as before; the body stays plain English for Gate summaries, exceptions, Debt and security risks. The block is widened to more Roles only after the token numbers support it.
