# Contract: skill-recommendation v1

Provider: the `skill-researcher` Role (`agents/skill-researcher.md`), in its Handoff. Lint: `scripts/skill-picks.mjs`. Consumers: the Lead (`skills/lead/references/skill-picks.md`: the approve form, the Install / Skip form, the project record), the CEO.
Uses: `skillspector-scan` v1 (every scan), `design-skills-section` v1 (field allow-list and the `design` record), `skills-section` v1 (the record for the other areas; proposed, Plan Gate P1), `research-report` v1 "Researcher Handoff extension" (`fetches`, `depth`, `## Findings`, `## Sources`).
`design-skills-section` v1 is **not** changed: a recommended line is a different, richer line, and the Lead writes the v1 line from it after approval.

## Input
- The dispatch carries the line `Area: stack | product-type | company-type | design`, written in the Goal block (Role-specific input; `dispatch-prompt` v3.1 is not changed). Absent or another value → the Role writes `status: blocked` with `missing area` under `## Blocking` and recommends nothing.
- `design` also reads `## Personas`, `## Art direction` and `## Design skills`; every area reads `stack` and `product_type`. `company-type` reads `audience` and `goal` (no company-type picker yet).

## Handoff (on top of `aico:handoff` and the researcher extension)
- Frontmatter adds `area: <area>` and `scan-mode: no-llm | claude_cli | static-fallback | none` (the mode the `skillspector-scan` output reported; `none` only with `status: blocked`).
- Sections, in this order, headings exactly: `## Candidates`, `## Recommended set`, `## Rejected`, then the usual `## Findings`, `## Sources`. Lists only; no table carries anything alone (proj.S2, Persona P3).
- `## Candidates`, one line each: `- <name> — source <source> — license <id> — last commit <YYYY-MM-DD> — installs/stars <as found> — key <y|n> — vetted <y|n> — scan <verdict> c<n> h<n> m<n> l<n> | scan not run — fit <high|medium|low> — <recommended|rejected>`. Installs and stars are shown as found, never used to rank (research-report v1).
- Every candidate is in `## Recommended set` or in `## Rejected`, never only in `## Candidates` (AC1).

## Recommended line (`## Recommended set`, at most 5, ranked by fit, then vetting evidence)
```
- area: <area>; name: <name>; source: <source>; license: <license>; vetted: <YYYY-MM-DD>; commit: <commit>; scan: <scan>; why: <why>; approved: pending
```
The whole line matches `^- area: (stack|product-type|company-type|design); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); scan: ([^;]+); why: ([^;]+); approved: pending$` (anchored, no nested quantifiers), each line ≤ 500 characters, then each field:
| Field | Allowed |
|---|---|
| `name`, `source`, `license`, `vetted`, `why` | exactly the `design-skills-section` v1 field allow-list (repo, command or plugin source; same name rules per source kind). The lint checks them by building the v1 line and passing it to `install-skills.mjs`'s exported `parseDesignSkills` (`skills-manifest` v2), so there is one implementation. |
| `commit` | repo source: `^[0-9a-f]{40}$`, the `fetch` output's `commit` (agentsec.S2); command or plugin source: `-` |
| `scan` | `^(no-llm\|claude_cli\|static-fallback) (\d+\.\d+\.\d+\|\?)(@[0-9a-f]{7,40})? c0 h0 m(\d{1,4}) l(\d{1,4})$`, copied from the `skillspector-scan` output of that skill; plugin source: `-` |
- `c0 h0` is part of the pattern: a skill with any critical or high issue, `blocking: true`, verdict `error` or a timeout cannot be recommended (AC2).
- Repo source: scanned in a quarantine (`fetch`, then `scan --quarantine`). Command source: scanned as installed (`scan --scope global|project --skill`); not installed → Rejected `scan-not-possible`. Plugin source: not scanned, never installed by the Lead.
- `static-fallback` is allowed and is shown to the CEO as "static fallback, not an LLM scan".

## Rejected line
`- <name> — <code>: <one line, no backtick, no ;>` with `<code>` one of `scan-findings` (critical/high or blocking), `scan-error`, `scan-not-possible`, `license`, `api-key`, `stale` (no commit in 12 months), `no-fit`, `fork`, `not-vetted-in-budget`, `instructions-in-files` (noted, never followed, agentsec.M-SEC1), `too-large`.

## Lint (`scripts/skill-picks.mjs`, Node built-ins, cwd = product repo)
| Command | stdout (exit 0) |
|---|---|
| `lint <handoff>` | `{ "v":1, "area", "lines":[{ "n", "ok", "field"?, "reason"? }], "record":[<v1 line>…] }`. `<handoff>` must match `^\.company/work/[a-z0-9][a-z0-9-]{0,63}/\d{2}-skill-researcher\.md$` and be a regular file ≤ 256 KiB. `n` is the line number; offending text is never echoed. `record` holds the lines the Lead writes after approval: the `design-skills-section` v1 line for `design`, the `skills-section` v1 line otherwise, each with `approved: <today>`. |
Refusals `refused: <reason>`, exit 2. More than 5 lines → lines 6+ fail with `too many entries`.

## The Lead's side (`skill-picks.md`)
1. `lint` the Handoff; a failing line is dropped and named by number, never repaired.
2. **Approve form** first (never auto, like the design-skill set approval): the passing lines, each scan shown as words (`no-llm scan, 0 critical, 0 high, 1 medium`). Then the **Install / Skip form** with the exact commands (`skills-manifest` v2 builders only). Nothing installs unless both are yes (AC5); `gates.installs: auto` skips only the second form (`aico:pipeline`, unchanged).
3. Record: write the approved `record` lines into `## Design skills` or `## Skills` (P1). Without P1 the other areas stop after the approve form and the picks go into the Gate summary only.
4. **Post-install scan:** each newly installed skill → `scan --scope project --skill <name>`. The installed copy may differ from the scanned commit; a `findings` (blocking) or `error` result is reported with the removal command, which the Lead suggests but never runs (AC14).

## Error cases
- `skillspector-scan` `detect` says not installed → `status: blocked`, `## Blocking` `[spec] skillspector missing`, no recommendation; the Lead offers the AC10 form (AC3).
- No candidate passes → `## Recommended set` holds the single line `- (none: no candidate passed vetting and scan)`.
- A line that fails the lint, an over-long line or a sixth line → dropped, its number in the Gate summary.
