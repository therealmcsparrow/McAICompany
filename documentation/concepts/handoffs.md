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

**One format for every Role.** The pilot format is removed in Handoff v3.0, a breaking change: no `aico-top` block, no findings rows and no findings ledger, and the setting `pipeline.review_format` is gone. Every Role writes the same Handoff, and the body stays plain English for Gate summaries, exceptions, Debt and security risks. A reviewer's blocking finding still carries a stable ID such as `R-3`, so a Fix round cites it instead of retyping it.

### Closing a Step: `step-close`
After each Step the Lead runs one command, `step-close`, where it used to make six to nine separate calls. It runs the same checks in a fixed order and prints one block:
1. Lints the Handoff. A lint error stops the close and nothing is committed.
2. For a plan task, checks the files against the task's file list. Paths that belong to a sibling task are dropped; extra paths are reported.
3. Commits the Handoff and the paths in its `files-touched` list, and nothing else. Prose in the Handoff is never read for paths.
4. Records the Step's cost in the token ledger. A missing row never blocks.
5. Marks a plan task done and prints the next one, syncs the tier set, and prints the next Step of the route.

The Lead commits only paths it can name and never touches `.env` files. A close that stops leaves a clear reason: lint failed, scope failed or commit failed.
