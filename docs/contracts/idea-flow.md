# Contract: idea-flow v2.0

v2.0 (task 2026-11-06 06.51 - Skill Audit Bugs; major v2.0, a rename that is not additive; the CEO asked for the rename and approved the major on 2026-11-06 (`aico:contracts` rule 4, `docs/adr/0007-contract-minor-versions.md`); the skill `grilling` is renamed `grill`): the step and grill form option 1 `grilling` are now `grill`. A record line written before this version with step `grilling` is read as `grill`, so an old run still replays. Every other step, route, reason and exit code is unchanged.
v1.3 (task input-fix, T10; additive): after the `bad slug` shape check and before any read or write, every command that takes `<slug>` checks the exact letter case of `.company`, `work` and `<slug>` with `exactWorkPath` of `work-folder-name` v1.1 (`mods/lib/work-folder.mjs`). A folder listed only in another letter case → `refused: wrong letter case`, exit 3, nothing written or created (`start` included). A folder missing in every case keeps the old behaviour. New refusal word `wrong letter case` in the Refusals list.

v1.2 (task idea-20261030-2242-build-draft, T7; additive): `<slug>` is any work folder name of `work-folder-name` v1 (`isWorkFolder`): a new name `YYYY-MM-DD HH.MM - Topic[ Suffix[ n]]` or a legacy slug. The Lead makes a new-name folder with `work-folder new --playbook idea|bug --topic file` and passes the printed name, single-quoted, to `start`; `start` never creates a new-name folder (missing folder or missing `.company/work` → exit 1 `unknown slug`, nothing created) and still creates a legacy slug folder as in v1.1. A legacy record resumes unchanged. A name that is not a work folder → `refused: bad slug`, exit 3. The name is checked by the shared module `mods/lib/work-folder.mjs`; this file holds no copy of the pattern. A `--out` path may hold the spaces, dots and hyphens of a new name (the `--out` allow-list is unchanged).

v1.1 (task reprompt-20261030-1309-draft-2-draft, CEO decision 2026-10-30; additive): outside the `software` company type the routes form never offers `D to-spec` (`to-spec` and `to-tickets` are software-only Playbooks) and the tickets form offers only `G park-roadmap` and `E park-idea`; `options` never prints those letters there and `pick` of one is refused (exit 3). Outside `software`, once Research is done the routes form would hold only `E park-idea`, and a form needs 2 to 4 options, so `options` adds `S stop` there: `pick S` ends the flow at once, nothing parked or built (the `pick` event records route `stop`; replay accepts it after Research in any type). Software never offers `S`. The type is read with `company-type` v1.7 `resolve` (the project's `company_type` line, default `software`), never from a Role or the CEO's text.

Provider: `scripts/idea-flow.mjs` (Node built-ins only; it imports `run` from `scripts/company-type.mjs` and `isWorkFolder`, `isLegacySlug` from `mods/lib/work-folder.mjs`). Writer of the record: the Lead of `aico:idea` and `aico:bug`, only through this CLI. Consumers: the same Leads (`options`, `state`, `read`) and `ticket-approval` v1 (reads nothing from it). The allowed picks of every form come from `options`, never from the Lead's text.

## Where it lives
- `.company/work/<slug>/idea-flow.jsonl`, `<slug>` a work folder name (see v1.2): a new name, or a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$`. No other path is accepted.
- Append-only, one JSON object per line, at most 2000 lines of at most 1024 bytes and 256 KiB in total. Created once with exclusive create (`O_CREAT|O_EXCL`); every later open is an append that checks the file is a regular file with one link and the same `dev` and `ino` as its `lstat`; `O_NOFOLLOW` is ORed in only where it exists (never on win32).

## Events
Keys are exactly those listed, in this order, plus `ts` (ISO 8601 UTC) last. Any other key, type or value breaks the record.
- `start`: `kind` (`idea` | `bug`).
- `pick`: `letter`, `route` (a letter from `options` and its route name).
- `done`: `step`, optional `size` (`XS|S|M|L`), `tier` (`low|medium|high`), `out` (see below).
- `park`: `name` (the final folder name).

## Transitions (the same for both kinds)
Forms and the picks they offer:
- grill form: `1 grill`, `2 grill-me`, `3 grill-with-docs`. Then `done <grill step>`, then `done reprompt`.
- routes form: `A cooler`, `B brainstorm`, `C research`, `D to-spec`, `E park-idea`. After A: B C D E. After B: C D E. After C: `done reprompt` first, then D E.
- D: `done to-spec`, then `done to-tickets`, then the tickets form: `F build`, `G park-roadmap`, `E park-idea`.
- Routes form by company type (v1.1): `software` offers the list above; every other type offers the same without `D to-spec` (After A: B C E. After B: C E. After C: `done reprompt`, then `E park-idea` and `S stop`). No other type reaches the tickets form.
- Tickets form by company type (v1.1): `software` offers `F build`, `G park-roadmap`, `E park-idea`; every other type offers `G park-roadmap`, `E park-idea` only (no build route there for now). The type is looked up when `options` or `pick` meets the routes or tickets form; the grill form does not depend on it, and replaying the record never does, so an old record stays valid.
- F: `done triage --size <s> --tier <t>`, then `done build`; the flow ends. G ends the flow at once, nothing built: the Lead has parked every ticket not yet parked in the roadmap through `ticket-approval` v1 `park-ticket`. E: `park-idea <slug> <name>` ends the flow. S (outside software, after Research only) ends the flow with nothing parked.
- While a step is pending `options` prints no option line; `pick` is refused.
- `state` prints `build: feature` for kind idea and `build: fix` for kind bug. Nothing else depends on the kind; both kinds offer identical letters at every form.

## CLI (cwd = product root)
Every argument is at most 4096 characters and holds no character of Unicode category Cc, Cf, Zl or Zp, else `refused: argument is not accepted`, exit 3, before any command runs.
- `start <slug> --kind idea|bug`: creates the record with the `start` event (and the work folder if missing, legacy slug only; a missing new-name folder is exit 1 `unknown slug`). Prints `started`. A record that exists → exit 1 `exists`.
- `options <slug>`: prints `option <letter> <route>` per allowed pick, or `pending <step>`, or `ended`.
- `pick <slug> <letter>`: letter must be a single character of the open form's options, else `refused: not an allowed pick`, exit 3, nothing written. Prints `picked <letter> <route>`.
- `done <slug> <step> [--size S] [--tier T] [--out P]`: step from the fixed list `grill, grill-me, grill-with-docs, reprompt, cooler, brainstorm, research, to-spec, to-tickets, triage, build`. `--size` and `--tier` are required for `triage` and refused for any other step. `--out` is a relative path of at most 200 characters from `[A-Za-z0-9._ /-]`, no leading `/`, no `.` or `..` segment, no empty segment; it is recorded, never opened. A step that is not the pending one → exit 1 `step out of order`.
- `park-idea <slug> <name>`: only while `park-idea` is pending. `<name>` matches `^[a-z0-9][a-z0-9-]{2,63}$` and is not a Windows device name (`con prn aux nul com1-9 lpt1-9`, with or without a `-` suffix part, case-folded); else exit 1 `name refused`. Copies the work folder (regular files only, no link followed or copied, depth 3, at most 200 files, 1 MiB each) to `.company/ideas/<name>/`; the directory is made without `recursive` so a collision is detected, then `<name>-2` to `<name>-9` are tried, then exit 1 `name taken`. Files are copied with exclusive create. The work folder is never changed or deleted. Prints `parked <final-name>`.
- `state <slug>`: prints `kind: <k>`, `form: <grill|routes|tickets|pending <step>|ended>`, `build: <feature|fix>`.
- `read <slug>`: prints `<n> <event> <fields>` per line, validated values only.
- Refusals `refused: <reason>` exit 3: `usage`, `argument is not accepted`, `bad slug`, `wrong letter case`, `bad kind`, `bad step`, `bad size`, `bad tier`, `bad out`, `not an allowed pick`, `size and tier only for triage`, `size and tier required`. Exit 1, fail loud: `company type` (v1.1: `company-type resolve` refused or printed no type, at the routes or tickets form only; nothing is written), `unknown slug`, `exists`, `step out of order`, `name refused`, `name taken`, `broken record`, `link`, `not a regular file`, `hard-linked`, `too large`.
- Output holds only fixed words, slugs, validated values and numbers; no argument or file text is echoed on a refusal.

## Personal data
The record holds the kind, step names, chosen routes, an optional artefact path and the parked folder name. A parked idea copy holds what the CEO typed, which can include personal data. Locations: `.company/work/<slug>/` and `.company/ideas/<name>/`, on the CEO's machine. aico never commits these files and writes no ignore rule for them: they are git-ignored only where the product ignores `.company/`, so the CEO should add `.company/` to the product's `.gitignore`. Recipients: the Claude model the CEO has configured reads the files in the Playbook runs; The web search tools (WebSearch, WebFetch) run in grill lookups and in research, and in the Water cooler and Brainstorm routes when a Role that holds them (market-researcher, tech-researcher, design-researcher, skill-researcher, senior-engineer or vuln-scanner) joins; those two routes do not forbid it, and a request can carry words from the idea. No other recipient. Archive rule: archived, never deleted early; an erasure request overrides it (CEO decides). Keep only what the decision needs (GDPR Art. 5(1)(c)).

## Error cases
- Broken record (bad JSON, unknown key, an event the transitions refuse, size caps) → exit 1 `broken record`; the Lead shows it and stops (fail closed).
- Script cannot run or prints nothing → the Lead stops.

## Compatibility
v1.2 is additive: every v1.1 behavior, reason and exit code holds for legacy slugs; new-name folders add no event, step, route or reason. v1.1 is additive: kinds, events, steps, routes and every reason of v1 are unchanged; `software` behaves byte for byte as v1; one new exit-1 reason `company type`. An added event, step, route or reason needs a new version.
