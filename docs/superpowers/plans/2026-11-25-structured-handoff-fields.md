# Structured Handoff Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, machine-readable Handoff fields (`tests:`, `closes:`, `open:`, `next-step:`); have the Lead read `next-step:` first; let step-close show the field warnings; cut repeated prose; and let a Rules-per-task row write `base` instead of repeating the shared rule IDs.

**Architecture:** `handoff-lint.mjs` learns the four keys. A bad shape is a `warning`, never an `ERROR`. The parsed values go into the routing JSON. `step-close.mjs` passes through an allowlist of those warning lines. `rule-check.mjs` expands a `base` token from a `## Base rules` line before its security-Must check and before it renders slice files. The rest is wording in skills, references and contracts.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`), ESM `.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-25-structured-handoff-fields-design.md`

## Global Constraints
- Every new key is optional. A missing key is never an error, and a bad shape is a `warning` with the exit code unchanged.
- Finding states stay lint-derived: `closes:`/`open:` never set or change a state.
- Contract bumps: handoff v3.0 → **v3.1**, rule-check v2.0 → **v2.1**, step-close v1.2 → **v1.3**. All are minor and additive, so v3.0, v2.0 and v1.2 cites stay valid.
- Out of scope: `reflect.mjs` and `dashboard-run.mjs` stay unchanged.
- Warning lines carry fixed words, line numbers and key names only, never Handoff text (step-close prints only fixed words, slugs and checked paths).
- No new dependencies. After editing anything under `hooks/`, run `node scripts/hook-pins.mjs write` (likely not needed here).
- Commits: conventional (`feat:`, `docs:`, `test:`), no attribution lines.

## Review Focus
1. A v3.0 Handoff with none of the new keys: lint output byte-identical to today (Task 1 test `v3.0 Handoff unchanged`).
2. `next-step:` present while `## Next` names a different Role: the warning must reach the Lead through step-close (Task 1 mismatch test plus Task 2 pass-through test).
3. A `base` row whose `## Base rules` line lacks a security Must: `slices` still exits 1 naming the missing ID (Task 3 test).
4. `base` used as part of a longer word (e.g. `database`) or inside a rule ID: it must not expand. Only the standalone token counts (Task 3 test `base inside a word is not the token`).
5. A Handoff whose `## Next` is `- see next-step:` and that has no `next-step:` key: the lint still passes (the heading is required, not its content), and the Lead falls back to the prose (Task 1 test).

---

### Task 1: handoff-lint optional fields (handoff v3.1)

**Files:**
- Modify: `scripts/handoff-lint.mjs:20-21` (`KEYS`), `:42` (`LIST_KEYS`), `:281` (call the new check next to `checkModeKeys`), `:357-365` (`routing`)
- Modify: `docs/contracts/handoff.md` (header → `# Contract: handoff v3.1`, a v3.1 note under the header, new section `## v3.1 part 6: optional fields`)
- Create: `scripts/handoff-fields.test.mjs`

**Interfaces:**
- Produces: routing JSON gains `tests` (`{scope, pass, fail, skip, log}` or `null`), `closes` (string[]), `open` (string[]) and `next-step` (`{role, goal}`, the string `"none"`, or `null`).
- Produces exact warning lines, which Task 2 allowlists:
  - `warning line <n>: tests shape`
  - `warning line <n>: closes shape`, `warning line <n>: open shape` (not a list, or an item fails `ID_RE`; bad items are dropped from routing)
  - `warning line <n>: next-step shape`
  - `warning: next-step and ## Next name different Roles`

Shapes (regexes the implementer encodes):
- tests: `^(\S{1,120}) pass (\d{1,6}) fail (\d{1,6})(?: skip (\d{1,6}))?(?: log (\S{1,260}))?$`
- next-step: `^(?:none|([a-z][a-z0-9-]{0,40}|ceo) — (.{1,160}))$`
- Mismatch rule: take the first bullet of `## Next`. If it holds a whole word `w` that is a known Role id (`agents/<w>.md` exists in the plugin root) or `ceo`, and `w` ≠ the `next-step:` role → mismatch warning. No Role in the bullet → no warning.

- [ ] **Step 1: Write the failing tests** in `scripts/handoff-fields.test.mjs`. Build each Handoff from a valid v3.0 fixture (copy one from `scripts/handoff-lint-v3.test.mjs`) and call `lint(text, {})`. Tests:
  - `accepts all four keys` — `tests: unit pass 12 fail 0 skip 1 log logs/u.txt`, `closes: [R-2, C-1]`, `open: [R-3]`, `next-step: code-reviewer — review the diff` → `errors` `[]`, `warnings` `[]`. Routing `tests` deep-equals `{scope:'unit',pass:12,fail:0,skip:1,log:'logs/u.txt'}`, `closes` `['R-2','C-1']`, `open` `['R-3']`, `next-step` `{role:'code-reviewer',goal:'review the diff'}`.
  - `bad tests shape warns` — `tests: all green` → errors `[]`, warnings contain `warning line <n>: tests shape` at the key's line; routing `tests` `null`.
  - `bad ID dropped with warning` — `closes: [R-2, fixed]` → warning `closes shape`; routing `closes` `['R-2']`.
  - `next-step none` — routing `next-step` `'none'`, no warning.
  - `next-step mismatch warns` — `next-step: qa — x` and Next bullet `- code-reviewer reviews the diff` → warning `warning: next-step and ## Next name different Roles`.
  - `no Role in Next, no warning` — Next `- see next-step:`.
  - `v3.0 Handoff unchanged` — the fixture without new keys gives the same `errors`/`warnings` as before, and routing has the four new keys as `null`/`[]`/`[]`/`null`.
  - CLI: `node scripts/handoff-lint.mjs <tmp file>` with a bad `tests:` exits 0 and prints the warning line before the JSON line.
- [ ] **Step 2: Run to see them fail.** Run: `node --test scripts/handoff-fields.test.mjs`. Expected: FAIL (unknown frontmatter key).
- [ ] **Step 3: Implement `checkFields(fm, at, nextBullet, warnings) -> {tests, closes, open, nextStep}`** in `scripts/handoff-lint.mjs`. Add the keys to `KEYS` and `closes`/`open` to `LIST_KEYS`, then merge the result into `routing`. Read Role ids from the plugin root `agents/` folder once (cached), or reuse the lint's existing Role list if there is one.
- [ ] **Step 4: Run the new tests and the lint suites.** Run: `node --test scripts/handoff-fields.test.mjs scripts/handoff-lint*.test.mjs scripts/handoff-v13-extra.test.mjs`. Expected: all pass. A test that pins the exact routing JSON may need the four new keys added; update only such expectations.
- [ ] **Step 5: Contract doc.** Bump the header to v3.1, add the v3.1 note, and add part 6 with the table from the spec, the shapes, the warning lines and "never an ERROR; states unchanged". Then run `node scripts/contract-drift.mjs` (or the test that checks the index) and confirm it passes.
- [ ] **Step 6: Commit** `feat: optional handoff fields tests, closes, open, next-step (handoff v3.1)`.

### Task 2: step-close passes field warnings through (step-close v1.3)

**Files:**
- Modify: `scripts/step-close.mjs:76-85` (`lint()` returns `warnings`) and `:157` (push them into `out` after the scope lines)
- Modify: `docs/contracts/step-close.md` (header v1.3, v1.3 note, `## Output` line, `Uses: handoff v3.1`)
- Test: `scripts/step-close.test.mjs`

**Interfaces:**
- Consumes: Task 1 warning lines.
- Produces: the step-close block lists those lines, unchanged, after the stage-2 lines. Exit codes are unchanged.

- [ ] **Step 1: Write the failing test** `field warnings pass through` in `scripts/step-close.test.mjs`, using that file's existing repo fixture helper. The Handoff has `tests: all green`. Expect exit 0, a block that contains `warning line <n>: tests shape`, and an unchanged first line. Second test: `other lint warnings are not passed through`, where a warning not on the allowlist is absent from the block.
- [ ] **Step 2: Run** `node --test scripts/step-close.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `lint()`, keep `r.lines.filter(l => FIELD_WARN.test(l))` with `FIELD_WARN = /^warning (?:line \d{1,6}: (?:tests|closes|open|next-step) shape|: next-step and ## Next name different Roles)$/`, return them as `warnings`, and push them into `out` after `s.lines`.
- [ ] **Step 4: Run** `node --test scripts/step-close.test.mjs`. Expected: PASS.
- [ ] **Step 5: Contract doc** v1.3 (additive: new printed lines after the first, as its Compatibility section allows).
- [ ] **Step 6: Commit** `feat: step-close shows handoff field warnings (step-close v1.3)`.

### Task 3: rule-check `base` token (rule-check v2.1)

**Files:**
- Modify: `scripts/rule-check.mjs` near `taskRows` (~747) and `cmdSlices` (~880)
- Modify: `docs/contracts/rule-check.md` (header v2.1, v2.1 note, `base` rule in the `slices` row)
- Modify: `skills/ruleset/SKILL.md:28,33`, `docs/contracts/dispatch-prompt.md:178`, `agents/senior-engineer.md` (one sentence each)
- Test: `scripts/rule-check.test.mjs`

**Interfaces:**
- Produces: `baseIds(text) -> string[] | null`, the IDs on the single `- base: …` line of `## Base rules` (`RULE_ID_ANY` matches), or `null` when there is no section. It also produces `expandBase(rows, base) -> { rows, problems }`. That function replaces the standalone token `base` (`/(^|[\s,;|])base(?=$|[\s,;|])/`) in each `row.rest` with `base.join(', ')`. A row that uses `base` when `base === null` adds the problem `<cell0 cut 40>: base used without ## Base rules`.
- `cmdSlices` calls `expandBase` right after `taskRows`. Problems count as gaps (exit 1). The security check and `renderAll` see only the expanded rows, so slice files are fully expanded.

- [ ] **Step 1: Write the failing tests** in `scripts/rule-check.test.mjs`, using its existing ruleset fixture:
  - `base expands for the security check`: `## Base rules` lists every security Must, rows say `base, proj.M7` → exit 0, `slices ok`.
  - `base missing a security Must fails`: drop one security ID from the base line → exit 1, and the gap line names that ID.
  - `base without section fails`: exit 1 with `base used without ## Base rules`.
  - `base inside a word is not the token`: a row `database, <all security IDs>` with no Base section → exit 0.
  - `slice files are expanded`: with `--write`, `rules/<task>.md` holds the base IDs and never the word `base` as a token.
- [ ] **Step 2: Run** `node --test scripts/rule-check.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `baseIds` and `expandBase`** as in the Interfaces block; wire them into `cmdSlices`.
- [ ] **Step 4: Run** `node --test scripts/rule-check*.test.mjs scripts/shared-rules-parity.test.mjs`. Expected: PASS.
- [ ] **Step 5: Docs.** Write the rule-check contract v2.1. In ruleset SKILL line 33, add: "A row may write `base` for every ID on the `## Base rules` line (one line, `- base: <IDs>`); put the shared security Musts there." In ruleset SKILL line 28 and dispatch-prompt line 178, add: "A raw row's `base` means every ID on the senior-engineer Handoff's `## Base rules` line; read that line." In the senior-engineer agent, add one sentence: write `## Base rules` once, and rows use `base`.
- [ ] **Step 6: Commit** `feat: rule-check base token for Rules per task (rule-check v2.1)`.

### Task 4: handoff SKILL cuts and Lead routing wording

**Files:**
- Modify: `skills/handoff/SKILL.md` (template block lines 38-62, rules after line 64)
- Modify: `skills/pipeline/references/lead-resume.md:7,12`, `skills/pipeline/references/lead-handover.md:21`, `skills/pipeline/references/dispatch.md:53`
- Create: `scripts/handoff-fields-docs.test.mjs`
- Modify: `CHANGELOG.md` `[Unreleased]` (Added: the fields, step-close warnings, the `base` token; Changed: the Handoff writing rules)

**Interfaces:**
- Consumes: the key names from Task 1 and the token from Task 3.

- [ ] **Step 1: Write the failing doc-text tests** in `scripts/handoff-fields-docs.test.mjs`:
  - The handoff SKILL template contains `tests:`, `closes:`, `open:` and `next-step:` (marked optional).
  - The handoff SKILL contains `never repeats` together with `files-touched`, and the boilerplate rule `committed by the Lead`.
  - `lead-resume.md`, `lead-handover.md` and `dispatch.md` each contain `next-step:` and the order phrase `route next` … `next-step:` … `## Next` (one regex with lazy gaps).
- [ ] **Step 2: Run** `node --test scripts/handoff-fields-docs.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Edit the docs.**
  - In the template, add these optional keys, commented as optional: `tests: <scope> pass <p> fail <f>`, `closes: [R-2]`, `open: []` and `next-step: <role id> — <goal>`.
  - Add the rules from spec section 3.
  - Wording for the three references: "The next Step: the `route next` JSON from `step-close` when the run has `route.jsonl`; else the Handoff's `next-step:`; else the first `## Next` bullet."
  - Keep `skills/handoff/SKILL.md` under the size the existing skill-size tests allow. Run them.
- [ ] **Step 4: Run** `node --test scripts/handoff-fields-docs.test.mjs scripts/lead-*.test.mjs scripts/*skill*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: handoff field rules and Lead route order`.

### Task 5: Full verification
- [ ] Run `npm test`. Expected: 0 failures. A known load flake in `guard-self-protect-paths.test.mjs` passes when rerun alone. Report any other failure.
- [ ] Run `claude plugin validate --strict .`. Expected: `✔ Validation passed`.
- [ ] Run `node scripts/hook-pins.mjs check`. Expected: `pins ok`.
