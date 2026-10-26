# Contract: handoff v1.1

Provider: every Role, through `aico:handoff` (Core, `skills/handoff/SKILL.md`). Validator: `scripts/handoff-lint.mjs`. Consumers: the Lead (`aico:pipeline`), later Steps, reviewers.
v1.0 = the Handoff shape in `skills/handoff/SKILL.md` at 0.10.0 (frontmatter, By line, `## Did`, `## Decisions`, `## Blocking`, `## Nits`, `## Next`, optional `## Standards`, `## Debt`). v1.1 is additive: a Handoff without the v1.1 parts is a valid v1.0 Handoff, and a reader that does not know v1.1 reads the frontmatter and body as before.
Fix round 4 (still unshipped, so no version change): the v1.1 rules for pilot Roles live in `skills/handoff/references/pilot.md`, which only pilot Roles load; `skills/handoff/SKILL.md` keeps one pointer to it, so non-pilot Roles stop paying for pilot text. The findings ledger is written only when a handover is near (part 3).

## v1.1 part 1: the top block
A fenced block with info string `aico-top`, directly after the `By:` line and before `## Did`. Exactly these seven keys, in this order, one `key: value` line each, no other lines:

| Key | Value |
|---|---|
| `status` | `done \| blocked \| needs-ceo \| handover`; must equal the frontmatter `status` |
| `files` | `[path, …]`; same set as frontmatter `files-touched` (`[]` when that is absent) |
| `ac_ids` | `[AC1, …]`; same set as frontmatter `acceptance-ids` (`[]` when absent) |
| `rule_ids` | `[proj.M3, …]` rule IDs this Step applied or checked; each matches `^[a-z][a-z0-9-]{0,30}\.(M\|S\|Y)(-SEC)?\d{1,3}$`; `[]` allowed |
| `risks` | `[R-1, …]` finding IDs (part 2) that carry a risk, or `[]` |
| `read_next` | `[path, path#heading, R-2, …]` at most 5 pointers the next Step should read; pointers, never copied text; `path#heading` keeps the heading text as written (spaces allowed after `#`, no commas); `path` and `R-n` have no spaces |
| `tokens_used` | integer (the Role's own count, if it has one) or `unknown`; the token ledger (`token-ledger` v1) is the authoritative count |

- The frontmatter stays the routing source. The block repeats `status`, `files` and `ac_ids` so a reader can stop after it; a mismatch is malformed.
- **Malformed** = missing or extra key, wrong order, bad value, a mismatch with the frontmatter, a line over 1000 characters, or a second `aico-top` block. A malformed block **blocks the Step**: the Lead re-dispatches the same Step with the lint errors; it does not consume a Fix round.
- **Pilot scope (CEO, Brief Gate Q5):** the block is **required** for `code-reviewer` Handoffs and for `senior-engineer` compliance-pass Handoffs (the Lead runs `handoff-lint.mjs <file> --require-top` for those). Every other Role may omit it; when present it is validated. Widening to all Roles is a later minor bump after the AC26 numbers.

## v1.1 part 2: finding rows
Pilot Roles write each finding in `## Blocking` and `## Nits` as one row:
- Blocking: `- [contract|spec|security|test] <ID> | <file>[:<line>[-<line>]] | <problem> | <why> | <fix>`
- Nit: `- <ID> | <file>[:<line>] | <problem> | <why> | <fix>`
- `<ID>`: `R-<n>` (code review), `C-<n>` (compliance pass), `T-<n>` (tool check confirmed from `rule-check` v1). IDs are **stable**: a Fix round keeps the ID of a finding it re-reports and never reuses an ID for a different finding. Builders cite IDs in `## Did` (`fixed R-2`), never copy the text.
- `why` is never empty: a rule ID plus a few words, or a plain reason.
- Plain English (no rows) stays for the body prose, Gate summaries, Must exception requests, `## Debt` and security risks; the `security` Role stays outside the pilot.

## v1.1 part 3: the findings ledger
A pilot reviewer writes `.company/work/<slug>/<NN>-<role>.findings.md` **when a handover is near**, so a handover mid-review loses nothing (AC23):
```markdown
---
step: 07
role: code-reviewer
base-commit: <sha>
---
## Checked
- scripts/x.mjs
## Findings
- R-1 | open | [spec] | scripts/x.mjs:12 | <problem> | <why> | <fix>
```
- **When (Fix round 4).** The Role starts the ledger at the first of: (a) its context passes 75% of the `Context cap:` handover point `<n>` (that is 60% of `<cap>`; with no or a malformed `Context cap:`, 90000 tokens), or it can't tell and has read more than 15 files; (b) it decides to return `status: handover`. From then on it keeps the ledger up to date until the Step ends. It also continues an existing ledger of the same review chain (a handover link or a Fix-round reviewer after one): once a chain has a ledger, every later link keeps it. A review that ends `done`, `blocked` or `needs-ceo` without reaching (a) writes no ledger. Reason: T15b measured the always-written ledger as part of a +16% spend on a re-review that never handed over (`48-ai-data-engineer.md`).
- **Guarantee.** A pilot Handoff with `status: handover` always has its ledger next to it, holding every finding so far and every checked file. `handoff-lint.mjs <file> --require-top` checks it (Validator).
- Status: `open | fixed | withdrawn`. Rows are appended or have their status changed, never deleted. A handover link and a Fix-round reviewer continue the same file (same IDs). `## Checked` lists every file already reviewed.
- Tag: one of the four Blocking tags (part 2), or `[nit]` for a Nit (`- R-3 | open | [nit] | scripts/x.mjs:3 | <problem> | <why> | <fix>`). The Nit's Handoff row (part 2) drops the tag.
- The final Handoff's rows are the `open` ledger rows when a ledger exists; the Lead commits the ledger with the Step when it exists.
- **IDs without a ledger.** A Fix-round reviewer with no ledger in its chain keeps the IDs of the rows it re-reports from the earlier reviewer Handoffs of the task, lists closed ones in `## Did` (`fixed R-2`, `withdrawn R-5`), and numbers a new finding from 1 + the highest `R-<n>` (or `C-<n>`) in any earlier Handoff or ledger of the task, so no ID is reused.
A continuation appends every new finding to the chain's ledger before it writes its Handoff.

## Validator (`scripts/handoff-lint.mjs`)
- `node handoff-lint.mjs <handoff.md> [--require-top]`: exit 0 and the routing JSON on stdout (v1.1 adds `"top": {…} | null` and `"findings": [IDs]`); exit 1 and `ERROR <reason>` lines otherwise.
- With `--require-top` and frontmatter `status: handover` (Fix round 4): the sibling ledger `<NN>-<role>.findings.md` (same folder, same `NN` and `role` as the Handoff's file name) must exist and pass `--findings`, and every finding ID in the Handoff's rows must be in it; else `ERROR handover without findings ledger` or `ERROR finding <ID> missing from ledger`. A Handoff file name that does not match `^\d{2,3}-[a-z][a-z0-9-]{0,40}\.md$` → `ERROR cannot locate ledger`. The Lead treats this like a malformed top block: same Step re-dispatched with the errors, no Fix round.
- `node handoff-lint.mjs --findings <ledger.md>`: validates a findings ledger.
- Input is LLM-written: size cap 64 KiB, anchored linear patterns, no `eval`, no YAML library (proj.M1 to M4). The ledger path is built from the checked file name only, inside the Handoff's folder; a symlink there → `ERROR cannot locate ledger`.

## Error cases
- No `aico-top` block, Role outside the pilot → valid (v1.0 behaviour).
- No `aico-top` block with `--require-top` → `ERROR missing aico-top block`.
- Row without `why`, or a Blocking row without a tag → `ERROR line <n>: …`.
- Unknown ID prefix → `ERROR line <n>: finding ID must be R-, C- or T-<n>`.
- Pilot Handoff `status: done` with no ledger → valid (Fix round 4).
