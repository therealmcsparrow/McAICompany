# Contract: skill-recommendation v1

Provider: the `skill-researcher` Role (`agents/skill-researcher.md`), in its Handoff. Lint and gating scan: `scripts/skill-picks.mjs`. Consumers: the Lead (`skills/lead/references/skill-picks.md`: the approve form, the Install / Skip form, the project record, the post-install scan), the CEO.
Uses: `skillspector-scan` v1 (`vetCandidate`, the post-install `scan`), `design-skills-section` v1.1 (field allow-list and the `design` record), `skills-section` v1 (the record for the other areas), `research-report` v1 "Researcher Handoff extension" (`fetches`, `depth`, `## Findings`, `## Sources`).
Still v1 and unreleased. **Fix round 1 (CEO decision 1, security B3, ADR 0019):** the Role no longer scans. The scan that gates the forms is run by the Lead through `skill-picks.mjs vet`, a deterministic tool, on the exact commit the Role vetted; the install pins that commit; a bad post-install scan stops the run.

## Input
- The dispatch carries the line `Area: stack | product-type | company-type | design`, written in the Goal block. Absent or another value → the Role writes `status: blocked` with `missing area` under `## Blocking` and recommends nothing.
- `design` also reads `## Personas`, `## Art direction` and `## Design skills`; every area reads `stack` and `product_type`. `company-type` reads `audience` and `goal`.
- Before the dispatch the Lead runs `skillspector.mjs detect --json`; `installed: false` → the AC10 install form first; Skip → no dispatch, the Gate summary says "no skill picks without the scanner" (AC3).

## Handoff (on top of `aico:handoff` and the researcher extension)
- Frontmatter adds `area: <area>`. (`scan-mode` is gone: the Role runs no scan.)
- Sections, in this order, headings exactly: `## Candidates`, `## Recommended set`, `## Rejected`, then the usual `## Findings`, `## Sources`. Lists only (proj.S2, Persona P3).
- `## Candidates`, one line each: `- <name> — source <source> — license <id> — last commit <YYYY-MM-DD> — installs/stars <as found> — key <y|n> — vetted <y|n> — fit <high|medium|low> — <recommended|rejected>`. Installs and stars are shown as found, never used to rank.
- Every candidate is in `## Recommended set` or in `## Rejected` (AC1).

## Recommended line (`## Recommended set`, at most 5, ranked by fit, then vetting evidence)
```
- area: <area>; name: <name>; source: <source>; license: <license>; vetted: <YYYY-MM-DD>; commit: <commit>; why: <why>; approved: pending
```
The whole line matches `^- area: (stack|product-type|company-type|design); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); why: ([^;]+); approved: pending$` (anchored, no nested quantifiers), each line ≤ 500 characters, then each field:
| Field | Allowed |
|---|---|
| `name`, `source`, `license`, `vetted`, `why` | exactly the `design-skills-section` v1.1 field allow-list. The lint builds the record line and passes it to `install-skills.mjs`'s exported `parseDesignSkills` (`skills-manifest` v2.1), so there is one implementation. |
| `commit` | repo source: `^[0-9a-f]{40}$`, the commit whose files the Role read (from the GitHub page or the keyless API, agentsec.S2); command or plugin source: `-` |

## Rejected line
`- <name> — <code>: <one line, no backtick, no ;>`. Role codes: `license`, `api-key`, `stale` (no commit in 12 months), `no-fit`, `fork`, `not-vetted-in-budget`, `instructions-in-files` (noted, never followed, agentsec.M-SEC1), `too-large`. Scan codes are the Lead's, shown in its approve form: `scan-findings` (critical/high or blocking), `scan-error` (verdict `error`, with its reason), `scan-not-possible` (command source not installed, skill not in the repo at that commit, fetch refused).

## `scripts/skill-picks.mjs` (Node built-ins, cwd = product repo; refusals `refused: <reason>` on **stdout**, exit 2, like `skillspector-scan`)
| Command | stdout (exit 0) |
|---|---|
| `lint <handoff>` | `{ "v":1, "area", "lines":[{ "n", "ok", "field"?, "reason"? }], "picks":[{ "n", "kind":"repo\|command\|plugin", "name", "source", "commit", "record" }] }`. One `picks` entry per passing line. `record` is the line the Lead writes after approval: the `design-skills-section` v1.1 line for `design`, the `skills-section` v1 line otherwise, each with `commit` and `approved: <today>`. `n` is the line number; offending text is never echoed. |
| `vet <handoff> --json` | runs `lint`, then scans each pick, then prints `{ "v":1, "area", "mode", "lines":[…as lint], "picks":[{ …as lint, "scan": <skillspector-scan results[] entry> \| null, "scan_refused": <reason> \| null, "approvable": bool, "reject_code": <code> \| null }] }`. Progress lines go to stderr (`vet: <i>/<k> <name> <verdict>`). |

- `<handoff>` must match `^\.company/work/[a-z0-9][a-z0-9-]{0,63}/\d{2}-skill-researcher\.md$` and be a regular file ≤ 256 KiB. More than 5 lines → lines 6+ fail with `too many entries`.
- **Scan per pick in `vet`** (mode from settings; `vet` never passes `--mode`):
  - repo: `vetCandidate({ source, commit, name })` (`skillspector-scan` v1): fetch at that commit into a quarantine, scan that one skill, clean. One fetch per distinct `(source, commit)`.
  - command: the skill is scanned as installed (`scan --scope all --skill <name>`) when `list` shows it; else `scan: null`, `reject_code: scan-not-possible`.
  - plugin: not scanned, never installed by the Lead; `scan: null`, `approvable: true`, shown as "plugin skill, not scanned; installed only by you with /plugin".
- `approvable` (repo and command) = `scan.verdict` is `pass`, or `findings` with `blocking: false`, `counts.critical === 0` and `counts.high === 0` (AC2). Otherwise `reject_code` `scan-findings` (findings) or `scan-error` (error) or `scan-not-possible` (refused). `static-fallback` is allowed and shown as "static fallback, not an LLM scan". A skill with `refs_not_bundled > 0` is allowed; the form says so.
- `refused: skillspector missing` (exit 3) or `refused: git missing` (exit 2) → nothing is approvable; the Lead offers the AC10 form or says git is needed.

## The Lead's side (`skill-picks.md`)
1. `vet` the Handoff (the path from the dispatch, never typed from Role text). A failing lint line is dropped and named by number, never repaired. Commands use tokens from `vet` output only.
2. **Approve form** (never auto): the approvable picks, each with the Lead's scan in words (`no-llm scan of commit abc1234, 0 critical, 0 high, 1 medium`), and the not-approvable ones with their `reject_code` and reason. Approve the set (Recommended) / Change / Skip. Skip writes nothing.
3. Record: the approved picks' `record` lines into `## Design skills` (design) or `## Skills` (other areas).
4. **Install / Skip form**: the exact commands from `install-skills.mjs … --dry-run`, which install the recorded `commit` (`skills-manifest` v2.1). The form also says that `npx skills update` would move a skill off the scanned commit. Nothing installs unless the approve form says yes and the Install form says yes; only a user-level `gates.installs: auto` (`aico-settings` v1.2 lock) answers the Install form, never the approve form (AC5).
5. **Post-install scan:** each newly installed skill → `skillspector.mjs scan --scope project --skill <name> --json`, `<name>` from `vet` output. `pass` or non-blocking `findings` → report and go on. **`findings` with `blocking: true`, or `error` → the run stops** with a CEO form (never auto, whatever the Gate settings): the skill, the verdict with its Why and Next, and the removal command (`npx -y skills@1.7.4 remove <name> -a claude-code`, run in the product root). Options: Stop the run (Recommended) / Keep it and go on. The Lead runs no removal command (AC14); Keep is recorded in the Gate summary with the verdict.

## Error cases
- The Lead's `detect` says not installed → the AC10 form before any dispatch (AC3); the Role never checks the tool.
- No candidate passes the Role's vetting → `## Recommended set` holds the single line `- (none: no candidate passed vetting)`.
- No pick is approvable after `vet` → no approve form; the Gate summary lists each pick with its `reject_code`.
- A line that fails the lint, an over-long line or a sixth line → dropped, its number in the Gate summary.
