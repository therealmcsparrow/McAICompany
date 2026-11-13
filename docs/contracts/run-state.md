# Contract: run-state v2.0

Provider: `scripts/run-state.mjs` (Node built-ins only). Writer: the Lead (`aico:pipeline`, through `skills/pipeline/references/run-state.md`; from v1.1 also `aico:reprompt`, `reprompt` v1; from v1.2 also `aico:triage` and `aico:lead` for the triage record). Consumers: the `aico-mods` v2.0 mods (Savvy, Reflect, Cache Tax), through `show` and `active` only; `aico:lead` through `triage check` (v1.2) and, from v1.4, `aico:fix` through `triage check <nonce> --route fix`; from v1.3 `scripts/ledger.mjs` `ship` (`token-ledger` v1.1), through the exported `show(root, slug, { now })`, which returns the same run view as `show <slug> --json`; from v1.8 the `dashboard` v1 Modules, through the exported `list`, `active` and `show` only.
Why it exists: Handoff frontmatter gives Steps, Roles, status and Fix round, but nothing on disk says which wave a run is in, which Gates passed, when it started or how it ended (`docs/adr/0016-run-state-record.md`).
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`; rationale `docs/adr/0024-reprompt-playbook-owns-the-flow.md`): it adds the `pick` event and the view's `picks` list, so the CEO's answer to the reprompt form can be counted (success metric), and it bounds the view's `round` to what the mods accept. Every v1 file is a valid v1.1 file and gives the same view plus `"picks": []`. A v1 reader skips a `pick` line with its usual `line <n> skipped` warning; `reflect.mjs` ignores it.
v1.2 is additive (rationale `docs/adr/0027-triage-record.md`): it adds the triage record ("Triage record"), the commands `triage issue` and `triage check <nonce>`, and the folder `.company/triage/`. Run files, records, the run view, `show` and `active` are unchanged; `active` never reads `.company/triage/`.
v1.3 is additive (rationale `docs/adr/0028-run-timing-from-run-state.md`): it adds the `ask` event (a Gate form shown to the CEO), the command `ask`, and a `wait` key on each entry of the view's `gates`, so the CEO's wait at Gates can be shown apart from run time. Every v1.2 file is a valid v1.3 file and gives the same view with `"wait": null` on each Gate entry. A v1.2 reader skips an `ask` line with its usual `line <n> skipped` warning.
v1.5 is additive (task plan-gate-enforce, task run-state-ceo-sub): it adds the `ceo` event (a bundled CEO form), the `sub` event (a subagent start or stop, optional `session`), the optional `aico` key on `start`, the commands `ceo` and `sub`, and the view keys `ceo`, `subs` and `sessions`. Every v1.4 file is a valid v1.5 file and gives the same view plus `"ceo": [], "subs": [], "sessions": []`. A v1.4 reader skips a `ceo` or `sub` line, and a `start` line that carries `aico`, with its usual `line <n> skipped` warning. Under `plan_check.policy` `block`, `gate <slug> plan passed` is refused unless every plan in the run folder passes the scan. Under `warn` and `off`, and for every other command, v1.4 behaviour is unchanged.
v1.4 is additive (task low-tier-path): the triage record also proves an approved low-risk fix route, and `triage check` takes `--route fix`. Every v1.3 call behaves as before.

v1.6 is additive (task idea-20261030-2242-build-draft): `<slug>` also accepts a work folder name of `work-folder-name` v1 (`<YYYY-MM-DD HH.MM> - <Topic>`, with the Build or Draft suffix and a Draft number), through its `isWorkFolder`; the legacy slug shape stays valid and a legacy folder is never renamed. Every other name is `refused: bad slug`, without the name echoed. A run folder is used only when its real path is the folder of that name inside the real `.company/work`. Every v1.5 call and file behaves as before.

v1.7 is additive (task draft-input-folder-case-draft): every command that takes `<slug>` (and `show`, and the `gate <slug> plan passed` scan) checks the letter case of `.company`, `work` and `<slug>` against the folder entries on disk (`work-folder-name` v1.1, `exactWorkPath`), after the `bad slug` shape check. A spelling that matches a folder only in another ASCII letter case is `refused: wrong letter case` (exit 2), with no run folder, line or file written. The case-fold in the run folder real-path compare is removed. A folder missing in every case behaves as before (`start` makes it). Every v1.6 call with the exact spelling behaves as before.

v1.8 is additive (task 2026-11-04 01.19 - Skillset Dashboard Draft; rationale `docs/adr/0057-dashboard-reads-script-json-only.md`): it adds the command `list --json` and the exported `list` ("Run list"), exports `active` beside `show`, and adds the view keys `waves` and `open_ask` and the step keys `verdict` and `gate`. Records, storage, writes and every v1.7 command are unchanged; no new event is written. A v1.7 reader of the view ignores the new keys. Every v1.7 file gives the same view plus `"waves": [...]`, `"open_ask": ...` and, on each step, `"verdict": null, "gate": null` unless the Handoff frontmatter carries them.

v1.9 is additive (task role-skills-file): a Step file name in the view's `steps` takes 2 or 3 digits, so a run past Step 99 keeps its Steps; past 200 Step files the newest 200 are kept, with the warning `only 200 Step files read`. Records, commands and every v1.8 name stay valid.

v1.10 is additive (one project one folder, run 1): `<slug>` also accepts the v3 run slug `<ProjectID>/<NN>-<playbook>` (`isRunSlug` and `workParts` of `work-folder-name` v2.1; `NN` 01-999), and the command `projects --json` with the exported `projects` ("Project list") is added. A v3 run keeps its state in `.company/work/<ProjectID>/<NN>-<playbook>/run-state.jsonl`; `start` on a v3 slug never makes the project folder (`refused: project folder is missing`). A run folder is used only when its real path is `<ID>/<NN>-<playbook>` inside the real `.company/work`, not by its last name. `list` and `active` read top-level runs only, as before. Every v1.9 call, file and output is unchanged.

v2.0 is a major (one project one folder, run 2): `list`, `active` and `projects` walk runs with the exported `runSlugs(root, { max = 200 })` ("Run walk"), so a v3 run is listed and can be active, and `list.runs[].slug` and `active.slug` may hold one `/` (`<ProjectID>/<NN>-<playbook>`). A consumer that uses the slug as one path part or file name breaks: it takes the folder from `workParts(slug)` and a file name from `runKey(slug)` (`work-folder-name`). `show`, `append` and `projects` output are unchanged. v2, v1.1 and legacy names give byte-identical output to v1.10.

## Storage
- `.company/work/<parts>/run-state.jsonl`, append-only, one JSON object per line, LF. `<slug>` is a run slug (`isRunSlug` of `mods/lib/work-folder.mjs`, `work-folder-name` v3.0): a v3 run slug `<ProjectID>/<NN>-<playbook>`, or a top-level v2, v1.1 or legacy name (`isWorkFolder`). `<parts>` is `workParts(slug)` (`<ProjectID>/<NN>-<playbook>` for a v3 slug, the name itself otherwise). The name holds spaces and dots, so a shell line quotes it in single quotes.
- Counts, enums and times only. No prompt, reply, Handoff or CEO text (GDPR Art. 5(1)(c)).
- Limits: a line ≤ 256 bytes, a file ≤ 64 KiB, at most 1000 lines. The file and the run folder are opened with `lstat`; a symlink is refused.
- Committed with the run's Handoffs (it sits in the run folder). A reprompt run folder is not committed: it carries its own `.gitignore` (`reprompt` v1).

## Record (allow-list; unknown keys refused)
| Key | Value |
|---|---|
| `v` | `1` |
| `at` | UTC time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script, never typed by the Lead |
| `ev` | `start \| wave \| gate \| ask \| pick \| ceo \| sub \| end` (`pick` v1.1, `ask` v1.3, `ceo` and `sub` v1.5) |
| `wave` | `wave` only: integer 1–99 (the plan's wave number; a Fix round keeps the wave it belongs to) |
| `gate` | `gate` and `ask`: `brief \| plan \| ship`; `ceo` (v1.5) also `none` |
| `result` | `gate` only: `passed \| changed \| stopped` |
| `pick` | `pick` only: `use \| edit \| keep \| stop` (the reprompt form answer, v1.1) |
| `asked` | `pick` only: integer 0–3, question rounds held before this answer (v1.1) |
| `outcome` | `end` only: `ship \| abort` |
| `n` | `ceo` only (v1.5): integer 1-20, the questions bundled in one form |
| `role` | `sub` only (v1.5): an `agents/` file slug, or `other`. The CLI checks the slug against `agents/`; a reader accepts the shape `^[a-z][a-z0-9-]{0,40}$` |
| `id` | `sub` only (v1.5): exactly 12 lowercase hex, the first 12 characters of the SHA-256 of the agent id; the raw agent id is never stored |
| `phase` | `sub` only (v1.5): `start \| stop` |
| `session` | `sub` only, optional (v1.5): `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (lowercase), the hook payload's `session_id` |
| `aico` | `start` only, optional (v1.5): `^\d{1,3}\.\d{1,3}\.\d{1,3}$`, the plugin version from `plugin.json`; not shown in the view |

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2)
| Command | Effect |
|---|---|
| `start <slug> [<aico>]` | appends `start` (v1.5: with `aico` when given; a value outside the pattern is `refused: aico must be a version like 0.19.1`). Refused when the file already has a `start` and no `end` (`refused: run <slug> already started`). A new `start` after an `end` begins a new segment (a resumed or reopened run). |
| `wave <slug> <n>` | appends `wave`. Refused without an open segment. |
| `ask <slug> <brief\|plan\|ship>` | (v1.3) appends `ask`: the Gate form is about to be shown. Refused without an open segment, or for an unknown Gate. |
| `gate <slug> <brief\|plan\|ship> <passed\|changed\|stopped>` | appends `gate`. Refused without an open segment. (v1.5) `gate <slug> plan passed` first resolves `plan_check.policy` (`aico-settings` v1.9); under `block` it calls `verifyPlans` (`plan-check` v1.2) in the readdir form, trusts no record, and refuses with nothing written: `refused: plan gate: <n> open decisions in <plan>` or `refused: plan gate: <reason>` (`no plan`, `unreadable`, `too large`, `patterns`). An exception in the check is a refusal (`refused: plan gate: check failed`). `plan changed\|stopped`, other Gates, `warn` and `off` are unchanged. The settings and plan-check scripts load only on this path. |
| `ceo <slug> <brief\|plan\|ship\|none> <n>` | (v1.5) appends `ceo`: one CEO form was shown with `<n>` (1-20) questions. `none` counts a prompt outside any form. Refused without an open segment, for another gate or for `<n>` outside 1-20. |
| `sub <slug> <start\|stop> <role> <id> [<session>]` | (v1.5) appends `sub`. Refused without an open segment, for another phase, a role that is neither an `agents/` slug nor `other`, an `<id>` that is not 12 lowercase hex, or a `<session>` outside the pattern (upper case included); nothing written. The time is the receipt time. No prompt text, agent id or message is ever an argument. |
| `pick <slug> <use\|edit\|keep\|stop> <asked>` | (v1.1) appends `pick`. Refused without an open segment, or when `<asked>` is not a whole number 0–3 (`refused: asked must be 0 to 3`) or the answer is not in the list (`refused: pick must be use, edit, keep or stop`). |
| `end <slug> <ship\|abort>` | appends `end`, closing the segment. Refused without an open segment. |
| `show <slug> --json` | prints the run view (below), exit 0 even for a missing or damaged file |
| `active --json` | prints `{ "slug": <slug or null>, "view": <run view or null> }` for the active run, exit 0 |
| `list --json` | (v1.8; v2.0 nested runs) prints the run list (below), exit 0; reads only, writes nothing |
| `triage issue` | (v1.2) reads and deletes `request.txt`, appends an `issue` record, prints `{"nonce":"<32 hex>","type":"<type>"}` (Triage record) |
| `triage check <nonce> [--route fix]` | (v1.2; `--route fix` v1.4) reads and deletes `request.txt`, prints `{"trusted":true,"type":"<type>"}` and appends `used`, or `{"trusted":false,"reason":"<reason>"}`; exit 0 both (Triage record) |

Writes are append with `O_APPEND`; the script checks the size limit before writing.

## Run view (`show`, `active`)
```json
{ "v": 1, "slug": "x", "state": "running|ended|stale|none", "started": "<at>", "ended": "<at>|null",
  "outcome": "ship|abort|null", "wave": 2, "gates": [{ "gate": "brief", "result": "passed", "at": "<at>", "wait": 120 }],
  "picks": [{ "pick": "keep", "asked": 0, "at": "<at>" }],
  "ceo": [{ "gate": "ship", "n": 3, "at": "<at>" }],
  "subs": [{ "role": "qa", "id": "<12 hex>", "start": "<at>", "stop": "<at>|null", "ms": 5000 }],
  "sessions": ["<uuid>"],
  "waves": [{ "wave": 1, "at": "<at>" }],
  "open_ask": { "gate": "plan", "at": "<at>" },
  "round": 1, "tier": "low|medium|high|unknown",
  "steps": [{ "step": "05", "role": "backend-engineer", "status": "done", "round": 0, "file": "05-backend-engineer.md", "mtime": "<at>", "verdict": null, "gate": null }],
  "warnings": ["line 7 skipped"] }
```
- `picks` (v1.1): every `pick` of the last segment, in file order; `[]` when none. Placed directly after `gates`.
- `wait` (v1.3): whole seconds from the latest `ask` for the same Gate that comes after the previous `gate` entry for that Gate (or after the segment `start`) to this entry's `at`; `null` when there is no such `ask` (an `auto` Gate, or a v1.2 file) or the result would be negative. `ask` lines appear nowhere else in the view, except in `open_ask` (v1.8).
- `ceo`, `subs`, `sessions` (v1.5): of the last segment; `[]` when none. `ceo`: every `ceo` in file order. `subs`: a `start` opens an entry; a `stop` closes the latest open entry with the same `id` (`stop`, and `ms` = whole milliseconds, never negative); a `stop` with no open entry is its own entry with `start` and `ms` `null`; a `start` never stopped has `stop` and `ms` `null`. `sessions`: the distinct `session` values, first-seen order. `report`, `scorecard`, `receipt` and the Gate Report never print a session.
- `waves` (v1.8): every `wave` record of the last segment, in file order, as `{ "wave", "at" }`; `[]` when none. The older `wave` key (the latest wave) is unchanged.
- `open_ask` (v1.8): `{ "gate": "brief|plan|ship", "at": "<at>" }` for the latest `ask` of the last segment that has no `gate` record for the same Gate after it in file order; `null` when there is none. It says a Gate form is shown and not yet answered. A v1.7 reader ignores the key.
- `steps`: every `^\d{2,3}-[a-z0-9-]+\.md$` file in the run folder (no recursion, at most 200 and past that the newest 200, each read only to the end of its frontmatter and at most 8 KiB, frontmatter parsed with the `handoff-lint.mjs` parser). Files without a valid `step` and `role` are left out with a warning. `status`, `round` and `risk-tier` outside their allowed values read as `unknown`; a step's `round` is allowed as a whole number 0–99 (v1.1; a reprompt run's edits have no cap, so its rounds can pass 99).
- Step keys `verdict` and `gate` (v1.8): `verdict` is the frontmatter `verdict:` when it is `approve`, `changes` or `blocked`; `gate` is the frontmatter `gate:` when it is `pass` or `fail`. Absent, or any other value → `null`. Both are read inside the same 8 KiB frontmatter limit; nothing else of the Handoff is read.
- `round` = highest numeric `round:` among `steps` (so 0–99), else `0`; `tier` = highest `risk-tier:` among `steps` (`low < medium < high`), else `unknown`.
- Times and order come from the file; the view uses only the last segment (from the last `start`).

## Active run
`active` picks, among the `run-state.jsonl` of the runs of `runSlugs` (at most 200 runs, v2.0), the one whose last segment has no `end` and whose newest activity (last record, or newest Step file mtime) is the most recent. A segment with no activity for 12 hours is `stale` and never active. No candidate → `{ "slug": null, "view": null }`. (v1.8) `active(root, { now })` exported by `scripts/run-state.mjs` returns the same object as `active --json`.

## Project list (v1.10)
`projects --json` / `projects(root, { now })` returns `{ "v": 1, "projects": [{ "id", "activity" }], "warnings": [] }`: IDs and UTC activity times only, newest first, at most 3, each project once. A project (a v3 folder `<ProjectID>` or a v2 `<ProjectID>-HH.MM.SS` run) is active when one of its runs has an open segment whose newest record or Step file is at most 12 h old, or has no `run-state.jsonl` and its newest direct file (links skipped) is at most 12 h old. An unreadable or oversize state file never lists a project. At most 200 runs are read (newest names first; then the warning `over 200 runs`). Read-only. Other arguments: `refused: usage`.

## Run walk (v2.0)
`runSlugs(root, { max = 200 })` returns `{ slugs, capped }`: every v2, v1.1 and legacy top-level folder (`isWorkFolder`) and every v3 run `<ProjectID>/<NN>-<playbook>` (project folder `isProjectId`, sub folder `^(0[1-9]|[1-9]\d|[1-9]\d\d)-[a-z0-9]+(-[a-z0-9]+)*$` and `workParts`). Order: reverse name order of the top-level entries; a v3 project folder expands in place to its runs, `NN` descending. At most `max` runs (runs, not top folders), then `capped` is `true`. A link, a file, a folder whose real path is not inside the real `.company/work`, or a `.company/work` that is a link is skipped; no name is echoed. It does not read `run-state.jsonl`.

## Run list (v1.8)
`list --json`, and `list(root, { now })` exported by `scripts/run-state.mjs`, give every run of the product as one object:
```json
{ "v": 1, "runs": [{ "slug": "x", "state": "running|ended|stale|none|unreadable", "started": "<at>|null",
  "ended": "<at>|null", "outcome": "ship|abort|null", "tier": "low|medium|high|unknown|null", "round": 0 }],
  "warnings": [] }
```
- Entries: every run of `runSlugs` (v2.0; v1.8 to v1.10 top-level folders only) that holds `run-state.jsonl`, at most 200 runs, checked like `show` (`isRunSlug` and `workParts`, exact letter case of every part (`exactWorkPath`), `lstat` folder, real path inside the real `.company/work`); a folder that fails is left out with no name in any warning. Order: newest `started` first; entries with a `null` `started` last, then by slug.
- Fields come from the run view of that folder (`show`): `slug`, `state`, `started`, `ended`, `outcome`, `tier`, `round`.
- `state` is the view `state`, or `unreadable` when `show` gives `state: none` with the warning `run-state unreadable` (the file is a link, not a regular file, or over 64 KiB). An `unreadable` entry has every other field but `slug` set to `null` and is its own entry; it never makes the whole list fail. Bad lines alone are skipped as in `show` and do not make an entry `unreadable`.
- `warnings`: `over 200 runs` when runs were left out by the cap; nothing else. No CEO text, Handoff text or step list is in the list.

## How the pipeline uses it (`aico:pipeline`, Core)
- Setup, once the slug is known: `start <slug> <aico>` (v1.5, `<aico>` read from `plugin.json`; omitted when unreadable).
- Each wave start in the plan: `wave <slug> <n>`.
- (v1.3) Directly before showing each Brief, Plan and Ship Gate form: `ask <slug> <gate>`. An `auto` Gate shows no form and gets no `ask`.
- Each Brief, Plan and Ship Gate answer (an `auto` Gate counts as `passed`): `gate <slug> <gate> <result>`.
- Ship done, or the CEO stops the run: `end <slug> ship|abort`.
- A run resumed with "resume <slug>" after an `end` runs `start <slug>` again.
- (v1.5) Needs-ceo questions from Steps of one wave are held until the wave ends and shown as one form; at a Gate they join that Gate's form (`skills/pipeline/references/ceo-pack.md`). After each form: `ceo <slug> <gate> <n>`. A prompt outside any form is recorded as `ceo <slug> none <n>`. The older "ask each `needs-ceo` at once" rule no longer applies.
- (v1.5) The pipeline never writes `sub`; the `step-times` hook does.
- (v1.8) The pipeline never runs `list`; it adds no write. The dashboard derives a waiting Gate from `open_ask`, so no new Lead record is needed.
- The Lead never edits the file by hand; a refused command is reported in the next Gate summary and the run goes on (run-state never blocks a Step or a Gate, except `gate <slug> plan passed` under `plan_check.policy` `block`; the Lead then stops the run at the Plan Gate and does not report and skip that refusal).
- (v1.1) The pipeline never writes `pick`; only `aico:reprompt` does (`reprompt` v1, Lead flow step 7).
- (v1.2) The pipeline never runs `triage`; only `aico:triage` (`issue`) and `aico:lead` (`check`) do (`company-type` v1.3 "Trust rule").

## Triage record (v1.2)
The proof that the CEO approved a direct route at triage's Brief Gate for one exact request, in this session. Plugin-written; the Lead trusts a direct-route triage line only through `triage check` (`company-type` v1.3 trust rule).

**Folder `.company/triage/`**, never committed. Every `triage` call first checks that `.company` and `.company/triage` are plain folders (lstat; a link → refused `triage folder is a link`; see "Plain files only" for the `request.txt` behind a refusal), makes the folder when missing, and writes `.gitignore` = exactly `*` and LF when it is missing or differs. It is not a run folder: no slug, no Handoffs, and `active` and the `aico:pipeline` Setup never read it. The reprompt checker's watch set covers it as part of `.company/`; no `triage` command runs during a reprompt run (one Playbook at a time).

**Plain files only.** Every file a `triage` call opens (`.gitignore`, `request.txt`, `records.jsonl`) must, by lstat, be a regular file with exactly one hard link (`nlink` 1); writes add `O_NOFOLLOW` where the platform has it. After each of those files is opened (read, or the append open), the handle is checked again with fstat: a regular file, `nlink` 1 and, when the file existed, the same device and inode as the lstat; a swap between the lstat and the open is refused like the cases below. Otherwise: `.gitignore` → refused `triage folder is a link`; `records.jsonl` → refused `triage record unreadable`; `request.txt` → treated as missing, and its name is still deleted; `check` then ends with exit 0, `trusted:false`, reason `no request` (not a refusal).

**`request.txt`**: written only by the main session (triage's Approve branch, or `aico:lead`) with the Write tool, never by a Role and never through a shell: the exact text the Playbook passes or received as its argument, the request followed by one space and the triage line. Every `triage` call reads it (plain file, at most 64 KiB, valid UTF-8) and then deletes it, on success, refusal or `trusted:false` alike; CEO text sits on disk only between that Write and that call. Missing or unreadable → `issue` refused `no request`; `check` → `trusted:false`, reason `no request`.

**Normalized request**: the text of `request.txt` after exactly these steps, in this order: Unicode NFC; CR LF and a lone CR → LF; spaces and tabs removed from the end of every line; leading and trailing whitespace of the whole text removed (`String.prototype.trim`); then, when the result is at least 2 characters long and both starts and ends with `"` (U+0022), those two characters are removed and the result is trimmed again (one pair only, never repeated). Nothing else changes. `issue` and `check` use the same steps. Why: the main session's Write of the argument does not keep trailing spaces, line endings or Unicode form byte for byte (spike, 10 requests: exact bytes matched 5, CRLF plus trim 7, this rule 10), and the CEO's `/aico:lead "<request> (triage: …)"` command, triage's fallback when the Skill tool refuses the hand-over, can pass its enclosing quotes on in the argument. The argument triage writes always ends in `)`, so the quote step never changes it at `issue`.

**Triage line** at the end of the normalized request, ASCII, byte-exact: `/ \(triage: XS, risk low, (feature|bug|refactor|launch|audit|incident|upkeep|content|research), route direct\)$/`. Only the direct route is recorded: every other route is started by triage itself and no Playbook but `aico:lead` checks a line. No match → `issue` refused `no direct triage line`; `check` → `trusted:false`, reason `no triage line`.

**Fix line (v1.4)**, same place and rules, byte-exact: `/ \(triage: (XS|S|M), risk low, bug, route fix\)$/`. `issue` accepts the direct line or the fix line (no match for either → the refusal above, text unchanged); it prints `type` `bug` for a fix line. The record does not hold the route: the line a `check` accepts is chosen by its arguments. A fix line with risk `medium` or `high`, size `L`, another type or another route is not recordable.

**Nonce**: 16 bytes from `crypto.randomBytes`, printed by `issue` as 32 lowercase hex characters, never written to disk by the script. The main session keeps the nonce in its own context. It is used only as the argument of `triage check`, run by the Lead, and is never put in a file, Handoff, dispatch, hand-over argument or command shown to the CEO.

**Keys.** `k` = SHA-256 (lowercase hex) of the 32-character nonce string; it finds the record. `h` = HMAC-SHA256 (lowercase hex) with key = the 32-character nonce string as ASCII bytes and message = the UTF-8 bytes of the normalized request; it binds the record to that request. Without the nonce no one can compute `h` for another request, so editing the file cannot point a record at another request.

**`records.jsonl`**: append-only (`O_APPEND`, `O_NOFOLLOW`), LF, one JSON object per line; a line ≤ 256 bytes, the file ≤ 64 KiB and at most 1000 lines. Allow-list, unknown keys refused, bad lines skipped:
| Key | Value |
|---|---|
| `v` | `1` |
| `at` | as in Record, written by the script |
| `ev` | `issue \| used` |
| `h` | `issue` only: 64 lowercase hex (HMAC, Keys) |
| `k` | 64 lowercase hex (SHA-256 of the nonce, Keys) |
No request text, no route or tier, no names: hashes, an event and a time only.

**Expiry**: an `issue` is live for 30 minutes (`TRIAGE_TTL_MS` = 1 800 000) from its `at`; `now − at` below 0 (dated in the future) or above the TTL → expired. Before it appends, every `triage` call drops each `issue` that is expired by that rule (future-dated ones included), each `used` whose `issue` is gone and each bad line, by writing the rest to a temporary file in the folder and renaming it over `records.jsonl` (GDPR Art. 5(1)(e)). Still at a limit after that → `issue` refused `triage record full`.

**`triage issue`** (no arguments; any argument → refused with the usage): read and delete `request.txt`, normalize it, match the line, make a nonce, append `{"v":1,"at":…,"ev":"issue","h":…,"k":…}`, print `{"nonce":"<32 hex>","type":"<type>"}`, exit 0. Only triage's Approve branch runs it; the Lead never does.

**`triage check <nonce> [--route fix]`**: without `--route` the request must end in the direct line; with `--route fix` (exactly these two arguments after the nonce, otherwise refused with the usage; nothing read or deleted), in the fix line. Any other end gives `no triage line` and the record is spent as below. `<nonce>` must match `^[0-9a-f]{32}$` (else refused `bad nonce`; nothing read or deleted). Read and delete `request.txt`. The first rule that holds gives `{"trusted":false,"reason":…}`, in this order: `no request`; `no triage line`; `no record` (no `issue` with this `k`); `used` (a `used` line with this `k`); `expired`; `request changed` (`h` is not the HMAC of the normalized request under this nonce). Whenever `check` finds a live record (an `issue` with this `k`, no `used` line, not expired), it appends `{"v":1,"at":…,"ev":"used","k":…}` whatever the result, so a failed check (`no request`, `no triage line`, `request changed`) spends the record too; it appends nothing for `no record`, `used` or `expired`. With no failing rule it prints `{"trusted":true,"type":"<type>"}`. A record is used once: a second check of the same nonce gets `used`. Exit 0 for both results; the Lead treats anything but exit 0 with `"trusted":true` as untrusted.

**What cannot forge it.**
- Text (a request, a reprompt body, a hand-over argument, a pasted line, a file, a web page) mints no record: only `issue` writes one, and only triage's Approve branch in the main session runs it.
- A real triage line copied onto another request fails `h`. So does a record line that a Role or a person edits or writes into `records.jsonl`: `h` is keyed by the nonce, which the file does not hold, so an old `k` cannot be pointed at another request, and a hand-made `k` has no nonce the Lead holds.
- What the file cannot protect: `used` lines and `at` sit in the same file, so a writer who edits it can drop a `used` line or refresh an `at` and re-enable the exact request the CEO approved, never another one. Single use against such a writer rests on the Lead's nonce rule (`company-type` v1.3 trust rule): the Lead checks only the nonce printed by the `triage issue` that triage ran for the request in front of it, checks it once, and never checks an earlier nonce.
- Residual: a process running as the CEO's user can do anything the script does. The nonce also appears in the session transcript under the Claude config folder, which an agent with Read can reach; with a nonce, a writer can compute `h` for any request, which is why a spent nonce is never checked again. The durable fix is a key no agent can read (a hook-held secret, ADR 0027). Two `check` calls at the same moment are not serialized (no lock between the read and the append or rename), so both could print `trusted:true`; only the main session runs `check`, one call at a time. A background agent could swap `request.txt` between the Lead's Write and its `check` while a record is live; the Lead then trusts only the text that check hashed, and no Role runs between `issue` and `check`.

## Error cases
- Missing file → `state: none`, empty `gates` and `picks`, `steps` still listed.
- Bad line (invalid JSON, unknown key, over 256 bytes, CR byte) → skipped, `warnings: ["line <n> skipped"]`.
- File over 64 KiB or a symlink → `state: none`, `warnings: ["run-state unreadable"]`; writes refused. (v1.8) In `list` that run is one entry with `state: unreadable`.
- (v1.8) `list`: no `.company/work` folder, or it is a link → `{ "v": 1, "runs": [], "warnings": [] }`, exit 0. A failure on one folder never ends the list.
- Bad `<slug>`, unknown gate (on `gate`, `ask` or `ceo`), result, pick or outcome, `wave` outside 1–99, `asked` outside 0–3, `n` outside 1–20, a bad `sub` role, id, phase or session, a bad `aico` → `refused`, nothing written.
- (v1.2) `triage`: a link in the path, or `.gitignore` or `records.jsonl` with more than one hard link ("Plain files only"; a hard-linked `request.txt` is not a refusal: it counts as missing, `check` exits 0 with `no request`), `records.jsonl` unreadable or over 64 KiB when read (checked before pruning), a bad nonce, or any other error → `refused: <reason>`, exit 2, nothing appended. `request.txt` is still deleted once read. After a refusal for a link at `.company` or `.company/triage`, the unlink of the name `request.txt` is resolved through that link and reaches the link target; it is never read, and it happens only when it is a regular file with one hard link whose mtime is within the last 10 minutes (the Write just made it), else it is left in place. A refusal for a hard-linked `.gitignore` follows the same rule. A refused `issue` means no direct route (`company-type` v1.3); a refused `check` means untrusted. The rest of run-state is unaffected.
