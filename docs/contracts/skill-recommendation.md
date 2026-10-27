# Contract: skill-recommendation v1

Provider: the `skill-researcher` Role (`agents/skill-researcher.md`), in its Handoff. Lint, gating scan and install check: `scripts/skill-picks.mjs`. Consumers: the Lead (`skills/lead/references/skill-picks.md`: the approve form, the Install / Skip form, the project record, the post-install checks), the CEO.
Uses: `skillspector-scan` v1 (`vetCandidate`, the post-install `scan`), `design-skills-section` v1.1 (field allow-list and the `design` record), `skills-section` v1 (the record for the other areas), `research-report` v1 "Researcher Handoff extension" (`fetches`, `depth`, `## Findings`, `## Sources`).
Still v1 and unreleased. **Fix round 1 (CEO decision 1, security B3, ADR 0019):** the Role no longer scans. The scan that gates the forms is run by the Lead through `skill-picks.mjs vet`, a deterministic tool, on the exact commit the Role vetted; the install pins that commit; a bad post-install scan stops the run. **Fix round 2 (ADR 0020):** the verdict is bound to the installed bytes. `vet` scans only the folder the skills CLI will install, only for a commit on a branch or tag of the named repo, and records that folder's hash; after install, `check-install` compares it with `skills-lock.json`. Command-source picks are no longer approvable, because aico cannot pin what their command fetches.

## Input
- The dispatch carries the line `Area: stack | product-type | company-type | design`, written in the Goal block. Absent or another value → the Role writes `status: blocked` with `missing area` under `## Blocking` and recommends nothing.
- `design` also reads `## Personas`, `## Art direction` and `## Design skills`; every area reads `stack` and `product_type`. `company-type` reads `audience` and `goal`.
- Before the dispatch the Lead runs `skillspector.mjs detect --json`; `installed: false` → the AC10 install form first; Skip → no dispatch, the Gate summary says "no skill picks without the scanner" (AC3).

## Handoff (on top of `aico:handoff` and the researcher extension)
- Frontmatter adds `area: <area>`. (`scan-mode` is gone: the Role runs no scan.)
- Sections, in this order, headings exactly: `## Candidates`, `## Recommended set`, `## Rejected`, then the usual `## Findings`, `## Sources`. Lists only (proj.S2, Persona P3).
- `## Candidates`, one line each: `- <name> — source <source> — license <id> — last commit <YYYY-MM-DD> — installs/stars <as found> — key <y|n> — vetted <y|n> — fit <high|medium|low> — <recommended|rejected>`. Installs and stars are shown as found, never used to rank.
- Every candidate is in `## Recommended set` or in `## Rejected` (AC1).
- When a skill has both a repo source and a command source, the Role recommends the repo source (only a repo source can be approved).

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
`- <name> — <code>: <one line, no backtick, no ;>`. Role codes: `license`, `api-key`, `stale` (no commit in 12 months), `no-fit`, `fork`, `not-vetted-in-budget`, `instructions-in-files` (noted, never followed, agentsec.M-SEC1), `too-large`. Scan codes are the Lead's, shown in its approve form:
- `scan-findings`: critical/high, or blocking.
- `scan-error`: verdict `error`, with its reason.
- `commit-not-in-repo`: the commit is on no branch or tag of the named repo (for example a fork's commit served under the upstream name).
- `scan-not-possible`: a command source (cannot be pinned), the skill not in the repo at that commit, the skill not bound to one folder (root `SKILL.md`, name differs from folder, same name twice, unreadable name), a link or submodule in the repo, or the fetch refused.

## `scripts/skill-picks.mjs` (Node built-ins, cwd = product repo; refusals `refused: <reason>` on **stdout**, exit 2, like `skillspector-scan`)
| Command | stdout (exit 0) |
|---|---|
| `lint <handoff>` | `{ "v":1, "area", "lines":[{ "n", "ok", "field"?, "reason"? }], "picks":[{ "n", "kind":"repo\|command\|plugin", "name", "source", "commit", "record" }] }`. One `picks` entry per passing line. `record` is the line the Lead writes after approval: the `design-skills-section` v1.1 line for `design`, the `skills-section` v1 line otherwise, each with `commit` and `approved: <today>`. `n` is the line number; offending text is never echoed. |
| `vet <handoff> --json` | runs `lint`, then scans each pick, then prints `{ "v":1, "area", "mode", "lines":[…as lint], "picks":[{ …as lint, "scan": <skillspector-scan results[] entry> \| null, "scan_refused": <reason> \| null, "hash": <64 hex> \| null, "approvable": bool, "reject_code": <code> \| null }] }`. Progress lines go to stderr (`vet: <i>/<k> <name> <verdict>`). |
| `check-install --name <n> --hash <h> --json` (Fix round 2) | `{ "v":1, "name", "bound": bool, "reason": null \| "no-lock" \| "no-entry" \| "hash-mismatch" }`. `<n>` = the skill name allow-list, `<h>` = `^[0-9a-f]{64}$`, both taken from `vet` output; else `refused: usage …`. Reads `<cwd>/skills-lock.json` only: `lstat` a regular file ≤ 1 MiB that parses as a JSON object with an object `skills` → else `no-lock`; `Object.hasOwn(skills, <n>)` with an object entry whose `computedHash` is a string → else `no-entry`; `computedHash === <h>` → `bound: true`, else `hash-mismatch`. Nothing from the file is echoed. |

- `<handoff>` must match `^\.company/work/[a-z0-9][a-z0-9-]{0,63}/\d{2}-skill-researcher\.md$` and be a regular file ≤ 256 KiB. More than 5 lines → lines 6+ fail with `too many entries`.
- **Scan per pick in `vet`** (mode from settings; `vet` never passes `--mode`):
  - repo: `vetCandidate({ source, commit, name })` (`skillspector-scan` v1): reachability, fetch at that commit into a quarantine, the link check, the bound folder, its hash, the scan of that one folder, clean. One fetch per distinct `(source, commit)`. `hash` = the returned `hash`.
  - command: not scanned. `scan: null`, `hash: null`, `scan_refused: "command source cannot be pinned"`, `approvable: false`, `reject_code: scan-not-possible`. (A name match against an installed copy proves nothing about what the command fetches, proj.M-SEC3.)
  - plugin: not scanned, never installed by the Lead; `scan: null`, `hash: null`, `approvable: true`, shown as "plugin skill, not scanned; installed only by you with /plugin".
- `approvable` (repo) = `scan.verdict` is `pass`, or `findings` with `blocking: false`, `counts.critical === 0` and `counts.high === 0` (AC2), **and** `hash` is set. Otherwise `reject_code`: `scan-findings` (findings), `scan-error` (error), `commit-not-in-repo` (refusal `commit not in repo`), `scan-not-possible` (any other refusal). `static-fallback` is allowed and shown as "static fallback, not an LLM scan". A skill with `refs_not_bundled > 0` is allowed; the form says so.
- `refused: skillspector missing` (exit 3) or `refused: git missing` (exit 2) → nothing is approvable; the Lead offers the AC10 form or says git is needed.
- The `## Recommended set` line `- (none: no candidate passed vetting)` (Error cases) is accepted by the lint as an empty set, byte for byte; any other text there is a lint line.

## The Lead's side (`skill-picks.md`)
1. `vet` the Handoff (the path from the dispatch, never typed from Role text). A failing lint line is dropped and named by number, never repaired. Commands use tokens from `vet` output only.
2. **Approve form** (never auto): the approvable picks, each with the Lead's scan in words (`no-llm scan of commit abc1234, 0 critical, 0 high, 1 medium`), and the not-approvable ones with their `reject_code` and reason. Approve the set (Recommended) / Change / Skip. Skip writes nothing.
3. Record: the approved picks' `record` lines into `## Design skills` (design) or `## Skills` (other areas).
4. **Install / Skip form**: the exact commands from `install-skills.mjs … --dry-run`, which install the recorded `commit` (`skills-manifest` v2.1). The form also says that `npx skills update` would move a skill off the scanned commit. Nothing installs unless the approve form says yes and the Install form says yes; only a user-level `gates.installs: auto` (`aico-settings` v1.2 lock) answers the Install form, never the approve form (AC5).
5. **Post-install checks**, for each approved repo pick, after the install commands ran (whatever their exit code):
   1. `skill-picks.mjs check-install --name <name> --hash <hash> --json`, both from `vet` output.
   2. `skillspector.mjs scan --scope project --skill <name> --json`.
   Go on only when `check-install` printed `bound: true` **and** the scan printed one JSON document whose `results` hold at least one entry, each `pass` or `findings` with `blocking: false`. **Every other outcome stops the run** (fail closed): `bound: false`, a `refused: …` line (including `refused: skill not found`, which means the CLI installed another folder or nothing), any non-zero exit, output that is not one JSON document, an empty `results`, `findings` with `blocking: true`, or `error`. The stop is a CEO form (never auto, whatever the Gate settings): the skill, what failed (for `bound: false`: "the installed files are not the files aico scanned before you approved"; for a scan: the verdict with its Why and Next; else the refusal or "the check gave no usable result"), and the removal command (`npx -y skills@1.7.4 remove <name> -a claude-code`, run in the product root). Options: Stop the run (Recommended) / Keep it and go on. The Lead runs no removal command (AC14); Keep is recorded in the Gate summary with what failed.

## Error cases
- The Lead's `detect` says not installed → the AC10 form before any dispatch (AC3); the Role never checks the tool.
- No candidate passes the Role's vetting → `## Recommended set` holds the single line `- (none: no candidate passed vetting)`.
- No pick is approvable after `vet` → no approve form; the Gate summary lists each pick with its `reject_code`.
- A line that fails the lint, an over-long line or a sixth line → dropped, its number in the Gate summary.
- An install that writes no lock entry, a different hash, or a post-install scan that finds no skill → the stop form of The Lead's side 5.
