# Contract: plan-check v1.7

Provider: `scripts/plan-check.mjs` (scanner, pattern file loader, record writer and reader; Node built-ins only) with the pattern file `scripts/plan-check-patterns.json`, and `scripts/plan-check-verdict.mjs` (verdict and history scan; Node built-ins and `git` through `execFile`). Writer of the record: the Lead (`aico:pipeline` Plan Gate and Finish, through `skills/pipeline/references/plan-check.md`), only through the CLI. Consumers: the Plan Gate summary (the `gate` block), `aico:feedback` (the `verdict` line), `scripts/plan-check-verdict.mjs` through the exported `readRecord` and `scanText`, and the later hook-run Gate (block, exit 2), which will reuse `scanText` and `loadPatterns`.
Uses: `run-state` v1.3 (the exported `show(root, slug)`, for each run's Step Handoffs, their `mtime` and the Gate entries), `token-ledger` v1.1 read-only (the exported `validateRecord` of `scripts/ledger.mjs`, for each run's recorded `fix_rounds`; nothing is written to the ledger), `aico-settings` v1.5 (`plan_check.policy` and `plan_check.runs`, passed in by the caller as arguments; neither script reads settings itself).
Rationale: `docs/adr/0030-plan-check-own-record.md`. Ledger records (`token-ledger` v1.1) and Handoff frontmatter (`handoff` v1.1) are not changed by this Contract.
Step 05 (Architect, after Spike S1 `03-spike-ai-data-engineer.md`; v1 is unshipped, no version change): the Fix-round measure is the recorded ledger value, cross-checked against the Handoffs up to the first Ship Gate answer; the `--runs` default is 5.
Step 12 (Architect, after T3 `08-ai-data-engineer.md`; v1 is unshipped, no version change): `.company/work/` can be git-ignored (it is in this repo), so a Step's time falls back to its file mtime, and `history` scans the plans in the working tree as well as any in git history.
v1.7 is additive (task One Project One Id, T23): a `<slug>` is accepted with `isRunSlug` of `work-folder-name`, so a v3 run slug `<ProjectID>/<NN>-<playbook>` works for `gate`, `off`, `wave`, `verify`, `read`, `readRecord` and `verifyPlans`. The run folder is `exactWorkPath` over `workParts(slug)` and the record lives in that folder (`slug` in the `read` view is the slug as written). `plan-check-verdict.mjs` walks runs with `runSlugs` of `run-state` v2.0, reads a run's ledger file as `.company/ledger/<runKey(slug)>.jsonl`, and takes a plan path `.company/work/<slug>/<plan name>` with a slug of one or two parts. v2, v1.1 and legacy names give byte-identical output to v1.6.
v1.6 is additive (task Project Id Naming, T4): a heading also opens a section when `isTicketHeading` of `work-folder-name` v2.0 holds, so `<ProjectID>-T<n>[a-z]?` (and the bare `T<n>[a-z]?`) heads a task section; the heading is read from its first 200 characters. The word titles, `T`/`M` plus digit and the result shape are unchanged. `plan-check-verdict` skips a v2 run folder (`projectIdOf`) that has no valid ship record in its ledger, with no warning; a legacy and a v1.1 run warn as before.
v1.5 is wording only (task skill-audit-bugs): the exit 2 line states that under `block` the refusal is real (`run-state gate plan passed` and `plan-tasks begin`, `next`, `start` refuse a plan with open decisions) and that `warn` and `off` never block. No field, check or exit code changes.
v1.4 is additive (task Draft Input Folder Case Draft, T8): a `<slug>`, and for `gate` and `verify` a `<plan-name>`, typed in another letter case than the folder or file on disk is refused: `refused: wrong letter case`, exit 3, nothing written (no record line). The check runs after the `bad slug` shape check and before any read or write, through `exactWorkPath` of `work-folder-name` v1.1. A slug or plan missing in every case keeps its earlier refusal or error. The exported functions take names the caller read from disk and are unchanged; `scripts/plan-check-verdict.mjs` takes no typed name and is unchanged. Uses `work-folder-name` v1.1 (`exactWorkPath`).
v1.3 is additive (task build-draft): `<slug>` and the labels-file plan path take the shared work folder name rule of `work-folder-name` v1 (legacy slug or new name `YYYY-MM-DD HH.MM - Topic`, with a `Build` or `Draft [n]` helper suffix); a legacy slug behaves exactly as before. A name that is not a work folder name is refused (`refused: bad slug`, exit 3, never echoed; a throw for the exported functions). Uses `work-folder-name` v1 (`isWorkFolder`).
v1.2 is additive (task plan-gate-enforce): the `verify` command and the exported `verifyPlans`, the check the hook-run Gate needs. `gate`, `read`, `off` and `wave` are unchanged; every v1.1 call behaves as before, except that an `off` record has no effect on a Gate under `plan_check.policy` `block` (the Gate scripts never read the record).
v1.1 is additive (task low-tier-path, AC12): the verdict leaves out a run whose last valid ledger ship record has path short (token-ledger v1.4). Results for v0.18 and older runs are unchanged.

## Plan file
- One file in the run folder: `.company/work/<slug>/<name>`. `<slug>` is a work folder name (`work-folder-name` v1: a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$` or a new name, which may hold spaces); `<name>` matches `^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$` (covers `02-plan.md`, `02-architect-plan.md`, `55-architect-plan-m.md`, `plan.md`). Any other name → `error` record, reason `plan-name`.
- Opened with `lstat`: a regular file, not a link, at most 256 KiB, valid UTF-8. CR LF and a lone CR count as one line break; line numbers are 1-based.

## Scan rules (`scanText(text, patterns, { file })`)
Lines are read top to bottom with this state:
1. **Fences.** A line whose text after up to 3 leading spaces starts with 3 or more backticks or tildes opens a fence; it closes at the next line that holds only a run of the same character at least as long (plus spaces). Fence lines and the lines between them are never scanned and are never headings. A fence still open at the end of the file gives one finding at its opening line, id `unclosed-fence`, why `an unclosed code fence hides the rest of the plan from the check`, wherever it opened.
2. **Sections.** An ATX heading outside a fence (`^ {0,3}(#{1,6})[ \t]+(.*)$`) whose level is 2 or 3 and whose text, trimmed, starts with `Steps`, `Tasks`, `Wave`, `Phase`, `Fix round`, or `T` or `M` followed by a digit (`T1 checker`, `M3`), case-insensitive, or a ticket ID heading (`isTicketHeading`: `<ProjectID>-T<n>[a-z]?` or `T<n>[a-z]?`, then the end, a space, `:`, `.`, `)` or `-`), opens a section. Bold task lines such as `**T1 ...**` are not headings; they count only when they sit under such a heading. It runs to the next ATX heading of the same or a lower level number. Deeper headings inside it are content lines. Lines outside every section are never scanned (AC1). Setext headings are not section boundaries.
3. **Skipped lines** inside a section (AC2): a blockquote line (first non-space character `>`), and a **Decided line**: `^\s*(?:[-*+]\s+|\d+[.)]\s+)?Decided: (\S.*?) because (\S.*)$`, case-sensitive. Each Decided line adds 1 to `decided` (AC10). Only that full shape is skipped: `Decided: A or B?` is scanned like any other line.
4. **Inline code spans** are removed before matching: a run of n backticks opens a span that closes at the next run of exactly n backticks on the same line; the span becomes one space. A run with no closing run is plain text.
5. **Long lines.** A content line over 4000 characters gives one finding, id `long-line`, why `line too long to check`, and is not matched further.
6. **Patterns** are tried in file order on the remaining text; the first match gives exactly one finding for that line and the rest are skipped (AC3).
- Finding: `{ file: <name>, line: <n>, id: <pattern id>, phrase: <text>, why: <pattern why> }`. `phrase` = the matched text with control characters and backticks removed, `|` replaced by `/`, whitespace runs collapsed to one space, trimmed, and cut to 60 code points plus `…` when longer. Findings are sorted by line.
- Result: `{ findings: [...], decided: <n> }`. An empty plan, or one with no such section, gives `findings: []`, `decided: 0`.

## Pattern file `scripts/plan-check-patterns.json` (`loadPatterns(path?)`)
```json
{ "v": 1, "patterns": [
  { "id": "tbd", "re": "\\bTBD\\b", "flags": "", "why": "a placeholder: the plan does not say what to build here" },
  { "id": "todo", "re": "\\bTODO\\b", "flags": "", "why": "work the plan has not settled" },
  { "id": "decide-later", "re": "\\bdecide later\\b", "flags": "i", "why": "a choice put off past the Plan Gate" },
  { "id": "open-choice", "re": "^.* or .*\\?\\s*$", "flags": "", "why": "an open either-or question: the plan has not picked one" } ] }
```
- These four entries are the v0.16 defaults. TBD and TODO are whole words and case-sensitive; "decide later" is case-insensitive; `open-choice` needs a literal ` or ` and a final `?` (a line ending in `?` without ` or ` gives no finding).
- Limits (AC4): file at most 16 KiB; `v` exactly `1`; at most **10** entries; keys of an entry exactly `id`, `re`, `why`, optional `flags`; `id` matches `^[a-z][a-z0-9-]{0,31}$`, unique, and is not `unclosed-fence` or `long-line`; `re` a string of 1 to 200 characters that compiles with `new RegExp(re, flags)`; `flags` absent, `""` or `"i"`; `why` one line of 1 to 120 characters, not blank after trimming.
- Any problem rejects the whole file; nothing is scanned. The error names the entry: `patterns entry <index> (<id, or ? when the id is bad>): <problem>`, or `patterns: <n> entries, at most 10`, or `patterns: <problem>` for the file itself.
- `loadPatterns` returns `{ patterns, hash }`; `hash` = the first 12 lowercase hex characters of the SHA-256 of the file bytes.
- Each pattern must run in linear time on a 4000-character line (a test feeds every entry a 4000-character adversarial line and asserts under 50 ms).

## Record `.company/work/<slug>/plan-check.jsonl`
The per-run marker (AC11): its last scan, off or error record says whether the check ran for the run.
- Append-only (`O_APPEND`), LF, one JSON object per line; a line at most 256 bytes, the file at most 64 KiB and 1000 lines. The run folder and the file are opened with `lstat`; a link is refused. It stays with the run's Handoffs: committed only where the product tracks `.company/work/`, otherwise local (as in this repo).
- Counts, enums, a file name and times only. No plan text, no phrase, no CEO text (GDPR Art. 5(1)(c)).

| Key | Value | On |
|---|---|---|
| `v` | `1` | all |
| `at` | UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script | all |
| `ev` | `scan \| off \| wave \| error` | all |
| `policy` | `warn \| block` on `scan` and `error`; `off` on `off` | scan, off, error |
| `plan` | the plan `<name>` (Plan file rule) | scan; on `error` only when the name is valid |
| `patterns` | 12 lowercase hex (the `loadPatterns` hash) | scan |
| `findings` | integer 0-10000 | scan |
| `decided` | integer 0-10000 | scan |
| `waved` | integer 0-10000, at most the `findings` of the latest `scan` before it | wave |
| `reason` | `patterns \| plan-missing \| plan-unreadable \| plan-too-large \| plan-name` | error |

Every key listed for an `ev` is required (except `plan` on `error`); every other key is refused.

## Reader `readRecord(root, slug)` (fail-loud, AC6)
- No file → `{ v: 1, slug, state: "none" }`.
- Otherwise every line is checked. A line that is not JSON, a `v` other than `1`, an unknown key, a missing required key, a bad value, a `wave` with no `scan` before it, a `waved` above that scan's `findings`, a link, or a file over a limit throws `PlanCheckRecordError` with message `plan-check record <slug> line <n>: <reason>` (`line 0` for file-level problems). It never skips a line and never returns a partial view.
- View: `{ v: 1, slug, state: "on" | "off" | "error", policy, plan, patterns, findings, decided, waved, scans }` from the last `scan`, `off` or `error` record: `on` for `scan`, `off` for `off`, `error` for `error`. `waved` = the last `wave` after the last `scan`, else `0`. `scans` = the number of `scan` records. Keys a state lacks are `null`.

## Verify (v1.2)
`verifyPlans({ root, home, slug, plan })` (exported) and the CLI `verify <slug> [<plan>] [--json]` scan the plan files themselves. They read no `plan-check.jsonl`, `run-state` or `parallel.jsonl` record and write nothing.
- Policy: `resolveSettings({ home, cwd: root }).plan_check.policy` (`aico-settings` v1.9). `home` defaults as in `settings.mjs` (`MCSPARROW_HOME`, else the user's `.mcsparrow`).
- Plans: the named `<plan>` (its name must match the plan name rule), or, with none named (the readdir form), every entry of `.company/work/<slug>/` whose name matches the plan name rule (at most 50). The run folder follows the `plan-tasks` run folder rule: a link or non-folder at `.company`, `work` or the slug folder gives `error unreadable`; a missing folder, or no plan entry, gives `error no plan`.
- Every plan entry must be a regular file with one hard link, opened without following a link and checked as the same file, within 256 KiB and valid UTF-8. An entry that is a link, another type or has more than one hard link is `error unreadable`; over the cap is `error too large`. An entry is never skipped: a linked real plan cannot hide behind a clean decoy.
- A name that matches the plan pattern only when case is ignored (for example `02-PLAN.md`) is `error unreadable` in the readdir form: on a case-folding file system it can alias or hide a plan. `plan-tasks` reads a named plan only when its exact name is in the directory listing.
- Each plan is scanned with the same patterns, caps and `Decided:` rules as `gate`. The pattern file is the one beside the script (`import.meta.url`); a file that cannot be read or is invalid gives `error patterns`.
- Result `{ v: 1, policy, state: "pass" | "open" | "error", count, plan, reason }`: `count` is the open decisions in all plans, `plan` the first plan (sorted by name) with one, else `null`; `reason` (`no plan`, `unreadable`, `too large`, `patterns`) only for `error`. A bad slug throws.
- CLI: one line `plan-check (<policy>): <n> open decision(s), <d> decided` or `plan-check (<policy>): error <reason>`; `--json` prints the result object. Exit 2 when the policy is `block` and the state is `open`; exit 1 on `error` under any policy (also when the check itself fails); exit 3 for a refused argument; else 0.

## CLI `scripts/plan-check.mjs` (cwd = product root; `main(args, { now, root, home })` exported)
Exit codes: **0** done; **1** the scan could not run, or `read` met a broken record; **2** `block` policy with at least one finding (AC8); **3** refused (bad arguments, bad slug, write refused). Refusals print `refused: <reason>` and write nothing.

| Command | Effect |
|---|---|
| `gate <slug> <plan-name> --policy <warn\|block> [--json]` | loads the pattern file, reads and scans the plan, appends a `scan` record (also with 0 findings, AC5), prints the Gate block. Pattern or plan problem → appends an `error` record and prints one line `plan-check (<policy>): error <reason>: <detail>`, exit 1. `--json` prints `{ "v": 1, "policy", "count", "decided", "findings": [ ... ] }` with every finding instead of the block |
| `off <slug>` | appends an `off` record, prints `plan-check: off` (AC8: no scan runs) |
| `wave <slug> <n>` | appends a `wave` record, prints `plan-check: waved <n> of <findings>`; refused with no `scan` record or `<n>` above its `findings` |
| `read <slug>` | prints the reader view as JSON, exit 0; broken record → `plan-check record <slug> line <n>: <reason>`, exit 1 |

**Gate block** (stdout, nothing else):
1. `plan-check (<policy>): <n> open decision[s], <d> decided`
2. Up to 5 rows `<file>:<line> | <phrase> | <why>`, in line order.
3. `+<k> more` when more than 5 findings exist (AC7).

## CLI `scripts/plan-check-verdict.mjs` (read-only; cwd = product root; `main(args, { root })` exported)
It writes nothing to the repo or `.company/` (AC12) and prints to stdout only. `git` runs through `execFile` with a fixed argument list, no shell, cwd = root, 30 s timeout, 8 MiB output cap. Every file it reads from the working tree is opened with `lstat` (a regular file, not a link, inside a plain run folder).

**Feature runs.** Every `.company/work/<slug>/` (valid slug, a plain folder, at most 200) that holds `00-summary.md` and a file matching the plan name rule. Order: newest first by the committer time of the last commit that touched its `00-summary.md` (`git log -1 --format=%ct -- <path>`); untracked → the file mtime.
**Side.** A run whose last valid `ship` record (checked with `validateRecord`) has `path: short` is on neither side, with no warning. `readRecord` state `on` → check-on. State `none` or `off` → baseline (the backfill: runs before v0.16 and runs with the check off). State `error` → left out, one warning. A broken record → the verdict prints `plan-check verdict: error (<reader message>)`, exit 1.

**Fix rounds of a run (frozen definition).** A Fix round is a re-dispatch of a builder for a Blocking review or QA finding after the Plan Gate is approved and before the first Ship Gate answer (`01-product-manager.md` Decisions; Step 05 adds the Ship Gate end: work after a changed Ship Gate follows a Gate reject and does not count). The same two values are read for every run, on both sides:
1. **Recorded:** `fix_rounds` of the last valid `ship` record in `.company/ledger/<slug>.jsonl`. Each line is parsed and checked with `validateRecord` from `scripts/ledger.mjs`; invalid lines are skipped, a file over 1 MiB or a line over 512 bytes gives no value. Absent key, no `ship` record or no file → no value.
2. **Cross-check:** the highest numeric `round:` among the run's Step Handoffs (`run-state` v1.3 `show(root, slug).steps`), counting only the Steps whose **Step time** is no later than the `at` of the first `ship` entry in the view's `gates` (both compared in whole UTC seconds). A view with no `ship` entry counts every Step. No Step with a numeric `round` → no value.
   - **Step time** (Step 12): when the Step file is tracked in git, the committer time of the commit that added it (one `git log --diff-filter=A --format=%ct --name-only -- .company/work/<slug>` call per run); otherwise the Step's `mtime` from the `show` view, floored to whole seconds. A Step with neither (git failed and no `mtime`) makes the run's cross-check give no value.
   - Limits of mtime: a Handoff edited after its Step gets a later time, so it can only drop out of the cross-check, never be added. The cross-check decides only whether a run counts; the value used is always the recorded one. A wrong mtime can therefore at worst leave a run out or let one in, never change a run's number.
- The run counts only when both values exist and are equal; its Fix rounds is that value. Otherwise it is left out with the warning `<slug>: fix rounds <recorded or none> vs handoffs <n or none>`.
- Backfill on this repo (Spike S1, T3 and Step 12): counted personalities-company-types 2, playbook-chain-handoff 2, skill-researcher-scan 3, speed-scorecard 2, triage-hardening 1 (by mtime its round-2 Steps 17-18 come after its changed Ship Gate). Left out: reprompter-role (recorded 1, Handoffs 3: a two-phase run with no Ship Gate entry), research-team and optimize-brainstorm (no recorded value). Baseline today: 5 runs, median 2.

| Command | Output |
|---|---|
| `verdict [--runs <N>]` | `N` integer 3-50, default 5. Each side = its newest `N` counted runs. Exactly one line, segments joined by ` \| `: `plan-check verdict: <pass\|fail\|insufficient (n=<k>)>` · `check on: median <m> (n=<a>)` · `baseline: median <b> (n=<c>)` · `waved off <p>%` plus ` retune` when the share is above 30% (AC14), or `waved off n/a` · `default should become off` (only on fail) · `warnings: <w>` (only when not 0) |
| `history [--labels <file>] [--limit <n>] [--json]` | the AC12 scan, below |

- **Verdict rule (AC13):** either side with fewer than `N` counted runs → `insufficient (n=<k>)`, `k` = the size of the smaller side. Otherwise `pass` when baseline median − check-on median ≥ 1 (unrounded medians), else `fail`. Fail means the check stays and its default should become off; the script changes no setting.
- Medians use the ledger rule (middle value; the mean of the two middle values for an even count); shown with one decimal; an empty side shows `?`.
- Waved-off share = the sum of `waved` ÷ the sum of `findings` over the check-on side's runs, rounded to a whole percent; `n/a` when the sum of `findings` is 0.

**History scan (AC12).** Past plans come from two sources, merged by path (Step 12):
1. **Working tree:** every `.company/work/<slug>/<plan name>` that exists now (valid slug, plain folder, at most 200 folders; the file a regular file, not a link). Its `rev` = the SHA-256 (lowercase hex) of its bytes.
2. **Git history:** every plan path ever added under `.company/work/` (`git log --diff-filter=A --format=%H%x09%ct --name-only -- .company/work`) that matches `.company/work/<slug>/<plan name>`, at its oldest adding commit (closest to what the Plan Gate saw), read with `git cat-file blob <sha>:<path>`. Its `rev` = that commit's sha.
- A path in both uses the git version; a path only in git (deleted since) is still scanned. Newest first: by commit time for git plans, by mtime for working-tree plans. At most `--limit` plans (default 50, at most 200); a plan over 256 KiB is skipped with one warning. Each is scanned with the current pattern file.
- Text: per plan `<path>@<rev7>: <n> findings`, with ` (working tree)` after `<rev7>` for a working-tree plan, then one row per finding `  <line> | <phrase> | <why> | <fp|tp|unlabeled>`; last line `history: <p> plans, <f> findings, labeled <l>, false positives <fp> (<rate>%)`, or `false-positive rate: no labels` when nothing is labeled. `--json`: the same data as one object, each plan with `source: "git" | "working-tree"` and `rev`.
- A plan path (labels file `path`) is `.company/work/<work folder name>/<plan file name>`, at most 200 characters, split on `/` and each part checked (no pattern is run on the whole text). A path that fails is a bad entry.
- Labels file (read-only, at most 64 KiB, given by the person running it): `{ "v": 1, "labels": [ { "path": "<plan path>", "sha": "<7-64 lowercase hex>", "line": <n>, "label": "fp" | "tp" } ] }`; unknown keys or a bad entry → `refused: labels entry <i>: <problem>`, exit 3. A label matches a finding with the same path and line whose plan `rev` starts with `sha`, so a working-tree plan edited after labeling no longer matches its old labels. Rate = fp ÷ (fp + tp), whole percent.

## Error cases
- Pattern file invalid → no scan; `gate` writes an `error` record (reason `patterns`) and exits 1; the Plan Gate shows the line and goes on.
- Plan missing, unreadable, too large or badly named → `error` record with that reason, exit 1.
- Record unwritable (a link, over a limit, run folder missing) → `refused: <reason>`, exit 3; the Gate shows the line and goes on.
- `verdict` with `git` missing or failing → runs are ordered by mtime and every Step time is its `mtime` (one warning). `history` with `git` missing or failing → only the working-tree source, one warning, exit 0; it exits 1 only when neither source can be read.
- A ledger file that is unreadable → no recorded value for that run (it is left out with the warning above); the ledger is never repaired or written.
- Under `warn` and `off` nothing here blocks a Gate. Under `block` exit 2 is real: `run-state gate plan passed` and `plan-tasks begin`, `next` and `start` refuse a plan with open decisions (`plan-check verify`, v1.2), and the pipeline text says so (`skills/pipeline/references/plan-check.md` step 7).

## Compatibility
- New Contract. A run folder without `plan-check.jsonl` reads as state `none`.
- A later reader that meets a `v` it does not know throws (fail-loud) rather than guessing. An added key or event needs a new version of this Contract and a reader that accepts it.
