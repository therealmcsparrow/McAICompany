# Structured Handoff Fields + targeted cuts — design

Date: 2026-11-25. Status: draft for CEO approval. Plain work (no aico run).

## Intent

Handoffs are the biggest text the Lead and later Steps read. Machines read only the frontmatter plus `## Blocking` tags, yet a Lead still reads the prose of `## Next` to route, and builders repeat facts the frontmatter already holds. The goal is smaller Handoffs that machines can read directly, so Steps run faster, use less context, and don't add lint redo rounds.

Survey (1390 Handoffs, 22 runs):
- Median size is 2317 B and p90 is 5261 B. Share by section: Did 36.2%, Decisions 12.8%, Rules per task 10.0% (16 files only), frontmatter 9.9%, Blocking 9.4%, Nits 9.1%, Next 7.4%.
- Recurring prose that could be fields: a test result line (1143 files), a next Role plus goal (1366 files), finding IDs closed or left open, and a Did that repeats `files-touched` (94%).
- Lint redos come mostly from a missing or wrong `contracts:` line. Once, a redo emptied Blocking just to pass the lint.
- The senior-engineer Handoff P20261114.000001/01-feature/22-senior-engineer.md is 58 KB, near the 64 KiB cap, and its Rules-per-task rows (1.7-2.1 KB each) repeat the same base rule list.

## Goals
- Add optional, machine-readable frontmatter fields: `tests:`, `closes:`, `open:`, `next-step:`.
- Have the Lead's resume and route paths read `next-step:` first and fall back to the prose; step-close shows lint warnings.
- Make targeted cuts: Did never repeats `files-touched`; Did and Decisions hold no commit or lint boilerplate; Rules-per-task rows name the shared base once instead of repeating it.
- Expected saving: about 8-12% of Handoff bytes, plus much more on senior-engineer Handoffs.

## Non-goals
- No required new keys and no new lint errors for a missing field.
- No change to finding states. These stay lint-derived (handoff v1.2 part 4 and v2.0 part 5): `closes:`/`open:` never set or change a state.
- No new script that derives fields from git or test logs.
- No rewrite of existing Handoffs: old Handoffs stay valid as they are.

## Anti-goals (a failure even if it works)
- More lint redo rounds than today.
- A Lead routing off a `next-step:` field that disagrees with `## Next` with no one noticing.
- Any security Must dropped from a builder's rule slice because of the base shortening.

## Constraints
- `handoff-lint.mjs` rejects unknown frontmatter keys (`KEYS`, line 20), so the new keys must be added there.
- `## Next` is a required heading (`REQUIRED_HEADINGS`) and stays required.
- `rule-check.mjs slices` demands that every Rules-per-task row list every security Must (rule-check contract, AC23). The cut must keep that guarantee.
- Contracts: handoff v3.0 → **v3.1** (minor, additive). rule-check v2.0 → **v2.1** (minor, additive).
- Prefer slim designs; add no plugin dependencies; one task per agent when building.

## Approaches (CEO picked A)
- **A. Optional fields, warnings only (picked).** New keys are optional. The lint checks their shape only when present, and a bad shape is a `warning`, never an `ERROR`. Readers try the field first, then the prose. The cuts are handoff SKILL rules. Low risk, no new redos, minor bumps.
- B. Required fields, handoff v4.0. A missing field is a lint error and machines read fields only. Saves more (~15-20%), but it adds redo rounds (anti-goal 1) and a major bump that touches every Role.
- C. A script fills the fields from the git diff and test log. Roles make fewer mistakes, but it is a new tool, and IDs in prose findings are hard to derive reliably.

## Design

### 1. New frontmatter keys (handoff v3.1)
All are optional. A well-formed Handoff without them is a valid v3.0 Handoff.

| Key | Shape | Meaning |
|---|---|---|
| `tests:` | `<scope> pass <p> fail <f>[ skip <s>][ log <path>]` | The test run this Step did. `<scope>` is one token (e.g. `unit`, `scripts/x.test.mjs`, `suite`). Counts are integers. |
| `closes:` | `[R-2, C-1]` | Finding IDs this Step says it fixed (builders) or accepts as fixed (reviewers). Informational. |
| `open:` | `[R-3]` | Finding IDs still open after this Step, as the writer sees it. Informational. |
| `next-step:` | `<role id> — <goal, 1-160 chars>` or `none` | The next Step the writer asks for. `<role id>` is a Role id as in `role:`, or `ceo`. |

Lint (`handoff-lint.mjs`):
- Add the four keys to `KEYS`, and `closes`/`open` to `LIST_KEYS`.
- A bad shape gives `warning line <n>: <key> shape` and the exit code is unchanged. IDs in `closes`/`open` must match `ID_RE`; others are dropped with a warning.
- The parsed object (line ~357-365) exposes the new keys (`tests` as `{scope, pass, fail, skip, log}` or null), so downstream readers can use the parsed form.
- `next-step:` vs `## Next`: when both name a Role and the Roles differ, print `warning: next-step: names <a>, ## Next names <b>` (anti-goal 2). Matching is a plain search for a Role id in the first `## Next` bullet; no match, no warning.

### 2. Readers use fields first
- Route order for the Lead: the `route next` JSON that `step-close` prints wins when the run has `route.jsonl`; else `next-step:`; else the first `## Next` bullet. This order goes in the wording of `skills/pipeline/references/lead-resume.md` (steps 7 and 12), `lead-handover.md:21` and `dispatch.md:53`. The key is named `next-step:`, not `next:`, so it can't be confused with step-close's `next: <json>` output line.
- `step-close` passes lint `warning` lines through to its printed block, even when the lint passes. That is a step-close minor bump (v1.2 → v1.3, additive), so the Lead sees the mismatch and shape warnings (anti-goal 2).
- Out of scope: `reflect.mjs` and the dashboard keep their current contracts (reflect v1.4, dashboard v1.1). Showing `tests:` there is a later, separate item (slim scope).

### 3. Targeted cuts (handoff SKILL rules)
Added to `skills/handoff/SKILL.md` "Finishing a Step", replacing nothing:
- `## Did` never repeats a path list already in `files-touched`. It says what changed and why it matters, and cites paths only to pin a specific line or change.
- Did and Decisions never hold process boilerplate: "committed by the Lead", "lint passes", "ran the handoff lint", "no commit made". When a test run happened, it goes in `tests:` and is not repeated as a Did bullet.
- `## Next` may be `- see next-step:` when `next-step:` says everything.
- The template block shows the four new keys as optional, in comments.

### 4. Rules-per-task base (rule-check v2.1)
- The senior-engineer Handoff may hold one `## Base rules` section: a single line `- base: <rule ID>, <rule ID>, …`. Its content is the rule IDs every row shares, mainly the full security-Must list (the `agentsec`, `cc`, `cch`, `ccmod`, `ccotel` … pack IDs). The row-specific `proj.*` and pack rules stay on each row. Since the base holds the security Musts, a row passes AC23 through `base`; the check runs on the expanded list, so a base missing a security Must fails every row that uses it.
- A Rules-per-task row may then start its rule list with the token `base`, which stands for every ID on that line.
- `rule-check.mjs slices` expands `base` before its security-Must check, so the AC23 guarantee is unchanged. If a row uses `base` and there is no `## Base rules` section, the row fails as `base used without ## Base rules` (exit 1).
- Slice files (`rules/<task>.md`) are written fully expanded. A builder without a `Rule slice:` line still reads its raw row (`dispatch-prompt.md:178`, `ruleset/SKILL.md:28`); one sentence there says `base` means every ID on the `## Base rules` line, and that the builder must read that line.
- `skills/ruleset/SKILL.md` line 33 and the senior-engineer agent text explain the token.

### 5. Contracts, docs, versions
- `docs/contracts/handoff.md`: a v3.1 note plus a "v3.1 part 6: optional fields" section with the table above and the warning rules.
- `docs/contracts/rule-check.md`: a v2.1 note and the `base` expansion rule.
- `docs/contracts/step-close.md`: a v1.3 note (warning lines are passed through).
- `docs/contracts/dispatch-prompt.md:178`: the `base` sentence (wording, no version change unless that contract's rules require one).
- `contract-index` entries are bumped, along with any `contracts: [handoff v3.0]` defaults that Role or skill text writes.
- CHANGELOG `[Unreleased]` gets an entry. The release follows the normal release flow.

### 6. Tests
- New `scripts/handoff-fields.test.mjs` checks: each key accepted, each bad shape gives a warning with exit 0, the parsed output, the `next-step:` / `## Next` mismatch warning, and that a v3.0 Handoff is unchanged.
- `scripts/rule-check.test.mjs` gets new cases: `base` expands, a missing security Must after expansion still fails, `base` without the section fails, and slice files come out expanded.
- A step-close test: a Handoff that passes lint with a warning shows the warning line in the block, and the exit code is unchanged.
- A reader test checks that the lead-resume wording names the route order and `next-step:` (a doc-text test like the existing reference-text tests).
- Measurement: rerun the survey stats script on the next real run's Handoffs. This is a check, not a gate.

## Left to the builder
- Exact warning text beyond the shapes above, and where the parsed fields sit in the lint's JSON output.
- Which doc-text tests already exist for lead-resume and dispatch and how to extend them.
- Whether the `## Base rules` line may wrap (my call: one line, no wrap; the 64 KiB cap still applies).

## Calls I made (not CEO-decided)
- Field name `next-step:` (not `next:`), to avoid a clash with step-close's `next:` line.
- Route order: route JSON first, then `next-step:`, then `## Next`.
- step-close v1.3 passes warnings through, so the mismatch warning is seen.
- reflect and dashboard readers are out of scope (slim).
- `## Base rules` holds the shared security Musts.
- `next-step:` allows `ceo` as a target, for `needs-ceo` routing.
- `closes:`/`open:` are purely informational, to keep the state machine single-sourced.
- The `base` token sits in rule-check rather than the Handoff lint, because only `slices` reads those rows.
