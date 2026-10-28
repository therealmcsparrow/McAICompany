# Contract: tier-sets v1

Provider: `scripts/tier-set.mjs` (data file loader, tier and path decision, forced-high path check, run record writer and reader; Node built-ins only) and the plugin data file `company/tier-sets.json`. Writer of the record: the Lead (`aico:pipeline` through `skills/pipeline/references/tier-path.md`), only through the CLI, only for `aico:feature` and `aico:fix` runs. Consumers: the Lead (which Roles and lanes to dispatch, the `Risk tier:` of each later dispatch, the Gate summary lines), and `scripts/ledger.mjs` `ship` through the exported `readTierPath` (`token-ledger` v1.4).
Uses: `run-state` v1.3 `show(root, slug)` (the view's `tier`, read only), `plan-tasks` v1 exports `parsePlan` and `normalizePath` and its plan file name rule, `aico-settings` v1.8 `pipeline.short_path` (passed in by the caller as `--short`; the script reads no settings), `run-state` v1.4 `triage check --route fix` (only through the caller's `--triage` value), `git` (base resolution at `begin`; Core and the diff at `sync`).
Rationale: `docs/adr/0034-tier-sets-data-file.md`. Amended in Fix round 1 of task low-tier-path, before v1 shipped (`.company/work/low-tier-path/02-plan.md` "Fix round 1 amendments").

## Trust rules (the Architect's; builders implement them, never decide them)
1. **The script picks, nobody else.** The set of Roles and lanes of a feature or fix run comes only from the data file through this script, as recorded at `begin`. No request, bug report, issue body, triage line, Handoff body, file or web page can add, drop or rename an entry. The CLI takes checked enums, a slug, a plan file name and a sha only; it reads no free text except the plan's `files:` items, git's path list and `## Core` of `.company/project.md` at the base commit, and those can only raise the tier.
2. **Tier only rises.** Run tier = max(`--triage`, the run-state view `tier`, every recorded `raise`, every forced-high check result). `low < medium < high`; the view's `unknown` adds nothing (handoff-lint refuses a Step without a valid `risk-tier`, so it is never committed). A recorded tier is never lowered.
3. **Short only when every condition holds**, checked at `begin` in this order, first failing one wins (`why`): data file refused → `full`, `refused`; run tier not `low` → `full`, `tier`; `--short off` → `full`, `setting`; `--ceo` not exactly `short` (absent included) → `full`, `ceo`; otherwise `short`, `short`. `--ceo short` stands only for the CEO's own answer on a shown form: "Approve, short path" at a feature Brief Gate, or, for a fix, the approved triage form that named the skip while `gates.brief` is `ask`. An auto Brief Gate always passes `--ceo full` (CEO decision 2026-10-28). The script cannot see a form; the default is therefore `full`, so a missing or wrong flag never gives a short path.
4. **Fail closed.** A refused data file means every tier of both Playbooks uses the high set (the v0.18 route) and the path is `full`. On a `short` run, a data file that is refused at `sync`, or whose `rev` differs from the recorded `rev`, raises the run to `high` (cause `sets`); a `full` run already uses the v0.18 route and is not raised by it. What was skipped is read only from the record's `skip`, never from the data file loaded now, so a refused or changed file adds every skipped entry back. An unknowable check (plan files unknown, git failed, Core not readable at the base commit) is a forced-high hit. A broken record or a non-zero exit makes the Lead treat the run as high (`tier-path.md` step 11).
5. **The set is a filter on today's route.** An entry runs only when it is in the printed `set:` **and** its v0.18 condition holds (table below). A company type's `ship.lanes` (`company-type` v1) still run whatever `set:` says. A tier set never adds a Role the v0.18 route would not run.
6. **CEO only adds.** A CEO form answer can make a run longer (`--ceo full`, `raise`). `--ceo short` only accepts the script's low set; nothing can make a run shorter than that set.

## Data file `company/tier-sets.json`
Plugin file, shipped with the plugin; a project cannot change it (Brief Gate Q3; `aico-settings` v1.8 can only switch the short path off). At most 16 KiB, UTF-8, a regular file and not a link (`lstat`). Exactly these keys:

```json
{ "v": 1, "rev": 1,
  "playbooks": {
    "feature": {
      "low": ["product-manager", "design-researcher", "architect", "ui-ux-designer", "brand-artist", "spikes", "senior-engineer-map", "ruleset-sign-off", "builders", "asset-artists", "code-reviewer", "qa", "legal", "accessibility-tester", "writer", "localizer", "devops"],
      "medium": ["<the 22 feature route entries, route order>"],
      "high": ["<the 22 feature route entries, route order>"] },
    "fix": {
      "low": ["qa-reproduce", "owning-engineer", "code-reviewer", "qa-rerun", "devops"],
      "medium": ["qa-reproduce", "owning-engineer", "code-reviewer", "qa-rerun", "security", "devops"],
      "high": ["qa-reproduce", "owning-engineer", "code-reviewer", "qa-rerun", "security", "devops"] } },
  "forced_high": ["<tokens, below>"] }
```
The shipped file writes the medium and high lists out in full (no placeholders). `rev` is the version key the ledger stores: an integer 1-999, raised by one for every change to the file (a tune is a data-file change and a new `rev`).

### Route entries (frozen in the script as `ROUTE_V018`, route order)
| Playbook | Entry | Step today | v0.18 condition (unchanged; the Lead applies it) | Required in every tier |
|---|---|---|---|---|
| feature | `product-manager` | 1 | always | yes |
| feature | `design-researcher` | 1a | UI work and `## Design skills` stale | |
| feature | `architect` | 2 | always | |
| feature | `ui-ux-designer` | 2 | UI work | |
| feature | `brand-artist` | 2 | `## Art direction` empty or new Assets needed | |
| feature | `spikes` | 2a | the Architect listed Spikes | |
| feature | `persona-tester` | 2b | UI work and `lanes.persona` on | |
| feature | `senior-engineer-research` | 2c | a pack missing, stale or new | |
| feature | `senior-engineer-map` | 2c | otherwise | |
| feature | `ruleset-sign-off` | 2d | Must rules added or changed | |
| feature | `builders` | 3 | always | yes |
| feature | `asset-artists` | 3b | the build needs Assets | |
| feature | `code-reviewer` | 4 | always | yes |
| feature | `qa` | 4 | always | yes |
| feature | `security` | 4 | `lanes.security` on | |
| feature | `senior-engineer-compliance` | 4 | `lanes.compliance` on | |
| feature | `legal` | 4 | `lanes.legal` on, or `auto` and AI, payments or personal data | yes |
| feature | `hands-on-tester` | 4 | UI work and `lanes.hands_on` on | |
| feature | `accessibility-tester` | 4 | UI work and `lanes.accessibility` on | yes |
| feature | `writer` | 5 | user-facing | |
| feature | `localizer` | 5 | `languages:` lists more than one | |
| feature | `devops` | 6 | as approved | |
| fix | `qa-reproduce` | 1 | always | yes |
| fix | `owning-engineer` | 2 | always | yes |
| fix | `code-reviewer` | 3 | always | yes |
| fix | `qa-rerun` | 3 | always | yes |
| fix | `security` | 3 | touches auth, input handling or data, and `lanes.security` on | |
| fix | `devops` | 4 | a release is needed | |

Gates, the Core/Contract Plan Gate exception of fix, the test per AC, the fix regression test, the full suite before the Ship Gate, the rule-check pre-filter and handoff-lint are not entries: no data file can touch them.
`senior-engineer-map` when `senior-engineer-research` is due but not in the set: the Senior Engineer runs map and writes one `## Debt` line per missing, stale or new pack (`tier-path.md` step 7).
`legal` and `accessibility-tester` are required by the Architect beyond AC2 (EU law: GDPR/AI Act advice and EAA/EN 301 549 stay at every tier).

### Forced-high tokens (`forced_high`, v1 content)
`auth authn authz authentication authorization authorize oauth oauth2 oidc saml sso jwt login logout signin signup session sessions password passwords passwd credential credentials mfa 2fa totp rbac acl permission permissions secret secrets keystore crypto payment payments billing checkout invoice invoices stripe paypal mollie subscription subscriptions refund refunds pii gdpr consent personal privacy migration migrations migrate alembic flyway liquibase` (58 tokens; the file holds them as a JSON array in this order; the script freezes the same list as `FORCED_HIGH_V1`). A later `rev` may add tokens, never drop one: the loader refuses a file that lacks any `FORCED_HIGH_V1` token.

### Validation (`loadTierSets(pluginRoot)` → `{ ok, rev, sets, forced_high, reason }`)
First failing rule wins; the reason goes into the one refused line. `<x>` is echoed only when it matches `^[a-z0-9-]{1,40}$`, else `?`.
`missing` · `unreadable` (not a regular file, a link, a read error, not UTF-8) · `too large` · `invalid json` · `shape` (top-level keys not exactly `v`, `rev`, `playbooks`, `forced_high`; `v` not `1`; `rev` not an integer 1-999) · `unknown playbook <x>` (a `playbooks` key other than `feature` and `fix`) · `missing playbook <x>` · `unknown tier <x>` / `missing tier <pb> <x>` (tier keys exactly `low`, `medium`, `high`) · `<pb> <tier> not a list` · `unknown entry <x>` (not in `ROUTE_V018[<pb>]`) · `<pb> <tier> order` (a duplicate, or not in route order) · `<pb> <tier> lacks <entry>` (a required entry) · `<pb> <tier> differs from the v0.18 route` (medium or high not equal to `ROUTE_V018[<pb>]`) · `forced_high` (not an array of 1-200 unique strings matching `^[a-z0-9]{2,32}$`) · `forced_high lacks <x>` (the first `FORCED_HIGH_V1` token, in v1 order, that the array lacks).
Refused → `sets` = `ROUTE_V018` for every tier of both Playbooks, `rev` = 0, `forced_high` = `FORCED_HIGH_V1`.

## Forced-high check
Paths come from `--plan` (every task's `files:` items, `plan-tasks` v1 `parsePlan`) or `--diff` (git, below). Each path gets a **check key**: `\` → `/`, every segment loses trailing dots and spaces, lowercase, trailing `/` removed. Per path, first match wins:
1. `contract`: the key starts with `docs/contracts/`.
2. `core`: the key equals a Core key or starts with it followed by `/`. Core keys = the approved Core paths (below) plus the three governance files frozen in the script as `CORE_FIXED`: `.company/project.md`, `.company/settings.json`, `.company/standards.md`. `CORE_FIXED` holds even when `## Core` lists nothing.
3. `pattern <token>`: the key does not start with `.company/`, and a **token** of any segment equals a `forced_high` token. Tokens of a segment = the union, in this order without repeats, of two splits of the original-case segment (trailing dots and spaces removed):
   - **A (word split):** insert a break between a lower-case letter or digit and a following upper-case letter (`([a-z0-9])([A-Z])`), lowercase, split on `[^a-z0-9]+`, drop empty parts.
   - **B (acronym split):** first insert a break between a run of upper-case letters and an upper-case letter followed by a lower-case letter (`([A-Z]+)([A-Z][a-z])`), then apply A to the result.
   A alone keeps `OAuth2Client.ts` → `oauth2`; B adds the acronym in front of a word: `JWTValidator` → `jwt`, `validator`; `SSOCallback` → `sso`; `PIIRedactor` → `pii`; `MFAService` → `mfa`; `RBACPolicy` → `rbac`; `SAMLProvider` → `saml`; `getJWTToken` → `get`, `jwt`, `token`. B only adds tokens, so nothing that hit before stops hitting. Whole tokens only, never substrings: on this repo substring matching would flag `scripts/lessons.mjs` (`sso`) and `scripts/personality.mjs` (`personal`).
Unknowable → one hit with no path: `plan files unknown` (no task, or any task whose `files:` is missing or not valid), `diff unknown` (any `--diff` git call fails, times out, exceeds 8 MiB, or the recorded base is not a full-length commit id), `core unknown` (the Core read below fails, its output is over 64 KiB or not UTF-8, or it has no `## Core` heading). A product that does not commit `.company/project.md` therefore never keeps a short path past its first check.
**Core paths:** read from the **base commit**, never the working copy: `git cat-file blob --end-of-options <base>:.company/project.md` (`<base>` = the recorded full id). The list lines (`- `) between `## Core` and the next `## ` heading, outside HTML comments. Item = the text before the first `: ` (whole line when none), trimmed, one pair of wrapping backticks removed. A whole item in parentheses is the template placeholder and is ignored. An item that passes the `plan-tasks` v1 path rule and holds `/` or `.` is a Core path; any other item is counted in `warning: <k> core items are not paths, not checked`. A change to `## Core` during the run reaches the check through `CORE_FIXED` (`.company/project.md` itself is a hit), not by re-reading it.
**Git:** `execFile`, no shell, cwd = product root, 30 s and 8 MiB per call, stderr ignored. Every call is `git --no-optional-locks -c core.fsmonitor=false <subcommand> …` with the environment of the process plus `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0`. Every revision argument comes after `--end-of-options`. The calls, exactly:
- `begin`, base of 40 or 64 hex: `cat-file -t --end-of-options <base>` must print `commit`.
- `begin`, shorter base: `rev-parse --disambiguate=<base>` (objects only, refs are never consulted; the hex prefix is an option value, so no separator applies) gives at most 16 lines, each 40 or 64 hex; for each, `cat-file -t --end-of-options <id>`. Exactly one `commit` → its id is recorded. Zero, more than one, more than 16 lines, or any failure → `begin` is refused (exit 3, `base is not one commit`).
- `sync` with `--plan` or `--diff`, Core: `cat-file blob --end-of-options <base>:.company/project.md`.
- `sync --diff`: `cat-file -e --end-of-options <base>^{commit}`, `diff --name-only -z --no-renames --no-ext-diff --no-textconv --end-of-options <base> HEAD --`, `diff --name-only -z --no-renames --no-ext-diff --no-textconv --end-of-options HEAD --`, `ls-files --others --exclude-standard -z`. The paths are the union of the last three lists.
Any hit → the check result is `high`. Echo: a hit path is printed only when it passes the `plan-tasks` v1 path rule, else `?`. Paths are printed, never recorded.

## Record `.company/work/<slug>/tier-path.jsonl`
Append-only (`O_APPEND`), LF; a line at most 512 bytes, the file at most 16 KiB and 100 lines; run folder and file checked with `lstat` (a plain folder; a regular file with one hard link; a link refused) and re-checked on the open handle (regular, one link, same device and inode), as `plan-tasks` v1. Enums, integers, entry names, a commit id and a time only.

| Key | Value | On |
|---|---|---|
| `v` | `1` | all |
| `at` | UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script | all |
| `ev` | `begin \| raise` | all |
| `pb` | `feature \| fix` | begin |
| `tier` | `low \| medium \| high` (begin: the start tier; raise: the new tier) | all |
| `path` | `short \| full` | begin |
| `why` | `short \| refused \| tier \| setting \| ceo` | begin |
| `rev` | integer 0-999 (0 when refused) | begin |
| `base` | the resolved full commit id, `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$` | begin |
| `skip` | array: the entries of `ROUTE_V018[pb]` not in the data-file set for (`pb`, start tier) at `begin`, route order, no repeats, none in `REQUIRED[pb]`; `[]` when `path` is `full` | begin |
| `cause` | `step \| plan \| diff \| sets \| ceo` | raise |

Every key listed for an `ev` is required; every other key is refused. A first line that is not `begin`, a second `begin`, a `raise` whose tier is not above the current tier, a `base` of another length, or a `skip` that breaks its rule is a bad line.

## Reader `readTierPath(root, slug)` (fail-loud; never loads the data file)
- No file → `{ v: 1, slug, state: "none" }`.
- A bad line throws `TierPathRecordError` `tier-path record <slug> line <n>: <reason>`.
- View: `{ v: 1, slug, state: "on", pb, start_tier, tier, path, why, rev, base, raised, cause, skipped, set, add }`, built from the record alone.
  - `tier` = the last `raise` tier, else the start tier. `raised` = true when any `raise` exists. `cause` = the first `raise` cause, else `null`.
  - `skipped` = the record's `skip`.
  - `set` = `ROUTE_V018[pb]` minus `skipped` when not raised; `ROUTE_V018[pb]` when raised (medium and high always equal the v0.18 route, whatever the cause).
  - `add` = `skipped` when raised, else empty. They never ran, so all of them run before the Ship Gate.
- A legacy second argument (`{ pluginRoot }`) is accepted and ignored.

## CLI `scripts/tier-set.mjs` (cwd = product root; `main(args, { now, root, pluginRoot, git })` exported; `git` injectable for tests)
Exit codes: **0** done (a refused data file included: it prints its refused line and fails closed); **1** the record is broken; **3** refused (bad arguments, bad slug, a base that is not one commit, a refused state change). Arguments are checked values only: slug `^[a-z0-9][a-z0-9-]{0,63}$`, plan name (`plan-check` v1 rule), `feature|fix`, `low|medium|high`, `on|off`, `short|full`, a sha `^[0-9a-f]{7,64}$`. An argument holding a control character (Cc, Cf, Zl, Zp) or longer than 4096 characters → exit 3 before any command runs.

| Command | Effect |
|---|---|
| `sets` | read-only. Line 1 `tier-sets: rev <n>` or `tier-sets: refused <reason>`; then six lines `<pb> <tier>: <entries joined by ", ">` (feature low, medium, high, then fix) (AC1, AC2) |
| `preview <slug> --playbook <pb> --triage <t> --short <on\|off> [--ceo <short\|full>]` | read-only, no git. Prints the status block `begin` would print with the same flags; with no `--ceo` it prints what `--ceo short` would give (the offer the form shows) |
| `begin <slug> --playbook <pb> --triage <t> --short <on\|off> --base <sha> [--ceo <short\|full>]` | resolves `--base` to one full commit id (git, above; refused → exit 3, no record), then appends `begin` with `skip` (trust rules 2-3; no `--ceo` → `full`, `ceo`); refused when a `begin` exists. Prints the status block |
| `sync <slug> [--plan <plan>] [--diff]` | computes the run tier (trust rule 2, plus the check when asked, plus trust rule 4); appends one `raise` when it is above the recorded tier (cause, first that applies: `sets`, `diff`, `plan`, `step`); prints the status block, then the check lines. No record → `tier-path: none`, exit 0 |
| `raise <slug> <medium\|high>` | only after a CEO form answer asks for it; appends `raise` with cause `ceo` when above the current tier, else changes nothing; prints the status block. Does not load the data file |
| `read <slug>` | the reader view as JSON; broken record → the error line, exit 1 |

**Status block** (stdout, in this order; the Lead pastes lines 2-4 into Gate summaries):
1. `tier-path: <pb> tier <t> path <short|full> rev <n>`
2. `path: short (low)` (short, not raised) · `path: short, raised to <t> (<cause>)` (short, raised) · `path: full (<why>)` (full, start tier `low`) · nothing (full, start tier not low)
3. `skipped by tier: <entries joined by ", ">` when `skipped` is not empty and the run is not raised
4. `add before ship: <entries joined by ", ">` when `add` is not empty
5. `set: <entries of set joined by ", ">`
6. `preview` and `begin`: `tier-sets: refused <reason>` when the data file is refused. `sync` on a `short` run: `tier-sets: refused <reason>` or `tier-sets: changed since begin` when trust rule 4 applied
**Check lines** (only with `--plan` or `--diff`): `check: <n> paths, none forced high`, or `check: high: <reason> <path>` per hit (at most 5, then `check: +<k> more`), plus any `warning:` line.

## Error cases
- Data file refused → one refused line, high sets, run continues (AC2). Never a shorter set.
- Data file refused or changed after a short `begin` → raise to high (cause `sets`), `add before ship:` lists every recorded `skip` entry.
- Base not one commit at `begin` → exit 3, no record; the Lead runs the rest of the run as high (`tier-path.md` step 11).
- Broken record → exit 1; the Lead runs the rest of the run as high (`tier-path.md` step 11) and `ship` writes no `path`, `raised`, `pb` or `sets` (counted in its `warnings`).
- Nothing here ever blocks a Gate; it can only add Roles and lanes.

## Compatibility
New Contract. A run folder without `tier-path.jsonl` reads as state `none` (every Playbook other than feature and fix, and runs before v0.19). A reader that meets a `v` it does not know throws. An added key, event or entry needs a new version; a new `rev` of the data file does not. Fix round 1 changed v1 before it shipped (`skip`, full `base`, `--ceo short`, Core at the base commit, `CORE_FIXED`, split B, `forced_high` superset, git flags); no v1 record existed outside tests.
