# Contract: dispatch-prompt v3.1

Provider: `aico:pipeline` (and the Playbooks that skip pipeline setup: `aico:brainstorm`, `aico:cooler`, `aico:research`). Consumer: every Role, through `aico:handoff`.
v1 = the prompt in `skills/pipeline/SKILL.md` at 0.8.1. v2 and v3 are additive: a Role that gets an older prompt behaves as before. v3.1 is additive too (minor bump, `docs/adr/0007-contract-minor-versions.md`): a Role that gets a v3 prompt behaves as before.

## Lines added in v2
| Line | When | Value |
|---|---|---|
| `Language: <tag>` | every dispatch, every Playbook, directly after `Company profile:` (brainstorm/cooler: after `Company profile:` too) | effective `aico_language` from `aico-language` v1 `resolve`, resolved **once** per run in pipeline Setup §1.6 |
| `Design skills: <name>, <name> \| none` | only for `ui-ux-designer`, `frontend-engineer`, `desktop-engineer`, `game-engineer`, `brand-artist` | names from `.company/project.md` `## Design skills` (`design-skills-section` v1); `none` when empty |

## Lines added in v3
| Line | When | Value |
|---|---|---|
| `Name: <name>` | every dispatch, every Playbook, directly after `Language:` | the Role's effective name, `roles.<role>.name` from `aico-settings` v1 `get`, resolved **once** per run in pipeline Setup §1.7 (`role-names` v1 defaults) |
| `Settings: model=<m> effort=<e>` | only when the Lead passes `model` and/or `effort` on the Agent call, directly after `Name:`; omitted when nothing is overridden | exactly the values passed: `model=<m>`, `effort=<e>` or both. Passed only when the resolved value differs from the agent frontmatter. A resolved `inherit` is passed as the Lead's session model family (`opus | sonnet | haiku | fable`), never as the literal `inherit` and never by omitting `model`; `<m>` is that concrete family |

## Lines added in v3.1
| Line | When | Value |
|---|---|---|
| `Context cap: <cap> handover <n>` | every dispatch whose Output is a Handoff under `.company/work/`: every pipeline Step, and the `aico:research` researcher and product-manager Steps. Directly after `Settings:` (or after `Name:` when `Settings:` is omitted). Not in brainstorm or cooler Role prompts: their Output is a reply, with no Handoff and no handover | `<cap>` = `roles.<role>.context_cap` from `aico-settings` v1.1 `get`; when the Risk tier is `high`, `<cap>` = max(that value, 150000). `<n>` = floor(`<cap>` × 0.8). Both computed **only** in pipeline Core (Setup §1.7, item 8), once per run per Role. `aico:research` runs that same item, with no formula of its own. Integers, 5 to 7 digits |
| `Review depth: full \| standard` | only for `code-reviewer`, directly after `Round:` | output of `review-depth` v1 over the Step's diff; never taken from a builder's label. Risk tier `high` is always `full` |
| `Rule slice: <path>[, <path>]` | (Fix round 4) only for builders (`backend-engineer`, `frontend-engineer`, `desktop-engineer`, `ai-data-engineer`, `game-engineer`) and `devops`, when the product has a ruleset; directly after `Input Handoffs:` | 1 to 3 repo-relative paths `.company/work/<slug>/rules/<task>.md` (`rule-check` v1, "Slice files"): the slice of the plan task the Step builds, or for a Fix round the slices of the tasks whose files it fixes. The senior-engineer Handoff is then **not** in `Input Handoffs:`. The Lead takes `<task>` from the plan, never from Role output, and runs `rule-check slices` first |

**Enforcement:** `scripts/check.mjs` reports an `ERROR` for any fenced dispatch block that has an `Output: .company/work/` line and no `Context cap:` line. No Playbook is exempt.

## Canonical line order (v3.1)
One fixed order, so a Role always finds a line in the same place and the drift test can compare prompts. The order alone gives **no cache saving** across dispatches: the host puts the prompt before the Role block, with no cache breakpoint after the prompt (Spike S2, `docs/adr/0011-token-counts-from-transcripts.md`). Token savings come from shorter prompts and fewer reads, never from this order. A drift test (`scripts/prompt-order.test.mjs`) compares the dispatch blocks in `skills/pipeline/SKILL.md` and `skills/brainstorm/SKILL.md` with these lists.
- **Pipeline Step:** `Project profile:`, `Company profile:`, `Language:`, `Name:`, `Settings:` (optional), `Context cap:`, `Design skills:` (UI Roles only), `Risk tier:`, `Base commit:`, `Round:`, `Review depth:` (code-reviewer only), `Input Handoffs:`, `Rule slice:` (builders and devops only, Fix round 4), `Output:`, `Goal:`, then the closing `Follow aico:handoff.`
- **Brainstorm (every round, pass and re-ask):** `Project profile:`, `Company profile:`, `Language:`, `Name:`, `Settings:` (optional), `Input:`, `Output:`, `Goal:`. In format 2, `Input:` is the Role's round input file (`brainstorm-file` v2, "Round input") and `Goal:` is the one constant Goal of `skills/brainstorm/references/format-2.md`; in format 1, `Input:` is the brainstorm file.
- **Brainstorm byte-identity (format 2):** a Role's prompt is the same bytes in every dispatch of the run. The Lead builds it once per Role at kickoff from values resolved once (§1.6, §1.7) and never adds round content to it. This is the one place where a prompt gives a cache saving: an identical prompt lets the dispatch's first request reuse the cached Role block (Spike S2: 100% read, 0 written), while any change rewrites about 13k tokens. A different Role never shares that cache (its Role block differs), so byte-identity across Roles is not required.
- Cooler prompts keep their v3 order. Research prompts keep their v3 order and add one line: `Context cap:` directly after `Settings:` (after `Name:` when `Settings:` is omitted), just before the closing `Follow aico:handoff.`

Lead-only Playbooks that dispatch no Role (`aico:triage`, `aico:help`, `aico:version`, `aico:language`, `aico:settings`) resolve the language the same way and use it for their own forms and replies.

## Lead-side rule for `status: handover`
Any Step that carries `Context cap:` can return `status: handover`. The Lead then dispatches a fresh Step of the same Role (next `NN`) with the same Round, Base commit and Risk tier. Its Input is the original Input plus the handover Handoff, and its Goal is "continue from `<handover path>` `## Next`". It never counts as `blocked` or as a Fix round. In `aico:research`, the synthesis Step gets **every** link of a researcher's chain as Input, because the sources of the earlier links stay in their own Handoffs.

## Role-side rules (written into `aico:handoff`)
- **Prose in `<tag>`:** Handoff prose, forms, Gate summaries, digests, reports, lessons, cooler lines, brainstorm replies.
- **Always English** (machine-read): frontmatter keys and values, `##` section headings, `status:` values, blocking tags `contract|spec|security|test`, AC IDs, file/folder names, slugs, branches, command names, Role names, Contract names, report `## ` headings.
- **Commit subjects:** `<type>: <summary in tag>`; `<type>` stays from the English list in `aico:pipeline`.
- **New code comments:** in `<tag>` unless the product's Ruleset or the existing comments in that codebase use another language; then follow the codebase. Identifiers, code, log keys, API names stay code. Product UI and user docs follow `languages:`, never `Language:`.
- **Rule packs** in `~/.mcsparrow/standards/` use the user default (`language.mjs --default`), not this line. Source quotes stay in their original language.
- `Design skills:` → load each named skill (Skill tool). A named skill that is not available → list it under `## Next` as `missing design skill: <name>`; never skip silently.
- `Name:` is display only (bylines, cues, digests). Never route, file or name anything machine-read by it; `aico:<role>` stays the ID.
- `Settings:` is a record for the Handoff; the Role does nothing with it.
- `Context cap:` → the Role hands over (`status: handover`) at the next clean point once its context nears `<n>`. The Role never computes the 80% or the high-risk floor itself.
- `Review depth:` → `full`: every touched line plus its callers and Contracts; `standard`: the diff scope as in `aico:review`. The reviewer may raise `standard` to `full`, never lower it.
- `Rule slice:` (Fix round 4, written into `aico:ruleset`) → the rules this Step follows are the listed slice files; the builder reads them instead of the senior-engineer Handoff and the whole ruleset, and opens a rule's source file only for a rule whose text the slice cuts or a security Must its change touches. `## Standards` cites the slice's IDs as before.

## Error cases
- `Language:` absent (v1 prompt, old resume state) → treat as `en`.
- `Language:` value not a valid tag → treat as `en` and add a Nit `invalid Language <value>`.
- `en` → output is identical to 0.8.1 behaviour (no translation step, no extra text).
- `Design skills:` absent for a UI Role → behave as `none`.
- `Name:` absent (v1/v2 prompt, old resume state) → the Role uses its Role title.
- `Settings:` absent → nothing was overridden.
- `Context cap:` absent (v3 prompt, old resume state, a research prompt from before v3.1) → cap 150000, handover at 120000.
- `Context cap:` malformed (not two integers, `<n>` > `<cap>`, or `<cap>` < 60000) → cap 150000, handover at 120000, and a Nit `invalid Context cap` (at most 35 characters of the value echoed).
- `Review depth:` absent or not `full | standard` → `full`.
- `Rule slice:` absent → the builder follows its row in the senior-engineer Handoff's `## Rules per task`, as before (Fix round 3 behaviour; also when the product has no ruleset).
- `Rule slice:` path not matching `^\.company/work/[a-z0-9][a-z0-9-]{0,63}/rules/[A-Za-z0-9][A-Za-z0-9-]{0,15}\.md$`, or the file missing → the builder stops with `blocked — missing rule slice` and writes nothing else; the Lead routes it to the Senior Engineer (no Fix round).
- Brainstorm format 2 `Input:` file missing (not staged for this dispatch) → the Role replies `Skip` alone and nothing else; the Lead sees a skip from a Role it did not stage, which only happens on a Lead error.
