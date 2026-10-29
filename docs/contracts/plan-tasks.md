# Contract: plan-tasks v1.1

v1.1 is additive (task goldfish-roles): the `brief` command. The record format is unchanged; a v1 caller that never runs `brief` behaves as before.

v1.1 fix (re-begin after a Fix round): a `begin` resets the round to 0 and drops the round's task sets, so plan tasks left pending when a Fix round started are offered again; a `round` event starts its round with an empty done list, because a round number can repeat after a re-begin. The record format is unchanged.

Provider: `scripts/plan-tasks.mjs` (plan task parser, scheduler, run record writer and reader; Node built-ins only). Writer of the record: the Lead (`aico:pipeline` through `skills/pipeline/references/parallel.md`), only through the CLI. Consumers: the Plan Gate summary (the `check` block), the Lead's dispatch of plan-task Steps (`next`, `lines`, `brief`), the commit step (`scope`), Fix rounds (`round`), and `scripts/ledger.mjs` `ship` through the exported `readParallel` (`token-ledger` v1.3 `par` record).
Uses: `aico-settings` v1.7 (`pipeline.parallel_cap`, `pipeline.dispatch`, passed in by the caller as `--cap` and `--mode`; the script reads no settings itself), the plan file name rule of `plan-check` v1 (same regex, same file checks).
Rationale: `docs/adr/0033-plan-tasks-scheduler.md`. The plan-check scan (`plan-check` v1) is not changed: task fields are plain list lines inside the plan's `## Tasks` section.

## Plan task syntax (written by the Architect, `aico:planning`)
A task is an ATX heading of level 2, 3 or 4, outside a code fence, whose text starts with a task ID: `^(T\d{1,3}[a-z]?)(?=$|[\s:.)-])`. Its block runs to the next ATX heading of the same or a lower level number. Inside the block, outside fences, these list lines are its fields (keys lowercase, exact):

```markdown
### T3 ledger par record and parallel verdict
- role: ai-data-engineer
- files: scripts/ledger.mjs, scripts/ledger-par.test.mjs, docs/contracts/token-ledger.md
- depends-on: T1
- parallel: yes
```

- Field line: `^\s{0,3}[-*]\s+(role|files|depends-on|parallel):[ \t]*(.*)$`. Any other line in the block is prose and ignored. A line ends at CRLF, LF or a lone CR, as in `plan-check` v1. Fence rule: the `plan-check` v1 fence rule (3+ backticks or tildes after up to 3 spaces; closes at a run of the same character at least as long). Fences and headings are read by one module, `scripts/plan-markdown.mjs`, shared with `plan-check`: a line over 4000 characters outside a fence is never read as a fence, heading or field.
- `role:` an `agents/<role>.md` slug of the plugin, `^[a-z][a-z0-9-]{1,40}$`.
- `files:` items split on `,`, each trimmed; one pair of wrapping backticks is removed. Every item must pass the **path rule** below. 1 to 40 items.
- `depends-on:` `none`, or task IDs split on `,` (wrapping backticks removed).
- `parallel:` exactly `yes` or `no`.
- Limits: plan file as `plan-check` v1 (name regex, `lstat` regular file with one hard link, at most 256 KiB, UTF-8); at most 100 tasks.

**Path rule** (also used by `scope` and `round`): replace every `\` with `/`; then the item must be 1 to 200 characters and match `^[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*/?$`; no segment is `.` or `..`, starts with `-`, ends with `.` or a space (Windows reads `x.mjs.` as `x.mjs`), equals `.git` once its trailing dots and spaces are removed (any case, so `.git.` and `.GIT.` count) or starts with `.env` (any case), or is a Windows device name: after its trailing dots and spaces are removed, the part before the first `.` (trailing spaces removed) is `con`, `prn`, `aux`, `nul`, `com1` to `com9` or `lpt1` to `lpt9`, in any case, with or without an extension (so `NUL.txt` and `com1.tar.gz` count; `console.js` and `com0` do not). Reasons, first match wins: `absolute` (starts with `/` or `^[A-Za-z]:`), `glob` (holds `*`, `?`, `[`, `]`, `{` or `}`), `dot segment`, `git`, `env`, `device name`, `too long`, `bad character` (a segment ending in `.` or a space is one). A trailing `/` marks a directory the task owns whole; it is optional for the overlap rule.
**Key** of a path: every segment loses its trailing dots and spaces, then lowercase, trailing `/` removed (so `Scripts./X.MJS` and `scripts/x.mjs` have one key). **Overlap:** two paths overlap when their keys are equal or one key followed by `/` is a prefix of the other. Two tasks overlap when any of their paths overlap. A task whose `files:` is not valid overlaps every task.

**Alone.** A task runs alone, and `check` prints one warning line for it, when any of these holds (reason codes, all that apply, in this order): `no parallel mark`, `parallel: no`, `files: missing`, `files: empty`, `files item <i>: <path reason>`, `files: more than 40`, `role: missing`, `role: unknown`, `depends-on: unknown <id>` (a token is echoed as `<id>` only when it matches the task ID pattern `^T\d{1,3}[a-z]?$`, else `?`; a missing `depends-on` field counts as `unknown ?`), `depends-on: cycle` (printed for a task on a dependency cycle, a dependency on the task itself included; a dependency on a later task is not a cycle), `duplicate id`, `field repeated: <key>`. A `depends-on` that is unknown or part of a cycle is replaced by "every task before it in the visit order"; a duplicate ID keeps its first block and the later one becomes `<id>-dup<k>` (alone). Only `parallel: yes` with a valid `files:` list, a known `role`, valid `depends-on` and no repeated field is **marked**.

## Scheduling rule (`schedule(tasks, done, running, cap)`, pure)
Effective cap: `--mode sequential` → 1; else `--cap` (3-5). **Visit order:** plan order, except that a task comes after every task it depends on (a stable topological order: the first task in plan order whose dependencies are all placed goes next). A task that is flagged (unknown dependency or on a cycle) waits for every task before it in plan order and for its valid dependencies (a dependency on its own cycle excepted); if those edges close a loop, the first flagged task in plan order goes next. "Earlier" below and in `next`, `check` and `round` means earlier in the visit order, so every wait points backwards and nothing can deadlock. Tasks are visited in that order; each not done and not running gets exactly one outcome, the first that applies:
1. A running task is alone → `wait alone <running id>` for every task.
2. A `depends-on` task not done → `wait depends <first such id>`.
3. An earlier task (visit order) that is not done overlaps it → `wait overlap <first such id>`.
4. An earlier alone task already got `wait alone` or `start` in this visit → `wait barrier <that id>`.
5. The task is alone: no task running and none started in this visit → `start`; else `wait alone`.
6. Running plus started so far is at least the effective cap → `wait cap`.
7. Otherwise → `start`.
Rule 3 means overlapping tasks always run in visit order (dependency first, never together). The result depends only on the plan text, the done set, the running set and the cap (AC7).

## Record `.company/work/<slug>/parallel.jsonl`
Append-only (`O_APPEND`), LF, one JSON object per line; a line at most 8 KiB, the file at most 1 MiB and 5000 lines; the run folder and the file are opened with `lstat`, a link is refused, and so is a file with more than one hard link. After the open, the handle is checked again (regular file, one link, same device and inode as the `lstat`), for reads and appends of the plan and the record. It stays with the run's Handoffs (local where `.company/work/` is ignored). Task IDs and repo-relative paths only; no Handoff, plan or CEO text.

| Key | Value | On |
|---|---|---|
| `v` | `1` | all |
| `at` | UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script | all |
| `ev` | `begin \| start \| done \| out \| round` | all |
| `plan` | the plan file name | begin |
| `hash` | 12 lowercase hex, SHA-256 of the plan bytes | begin |
| `cap` | integer 3-5 | begin |
| `mode` | `parallel \| sequential` | begin |
| `tasks` | integer 0-100 | begin |
| `task` | a task ID, or `U1` (round only) | start, done, out |
| `round` | integer 0-5 | start, done, out, round |
| `extra`, `sibling` | arrays of at most 100 path keys | out |
| `sets` | object: task ID → array of at most 100 path keys (the round's added paths) | round |
| `loose` | integer 0-100 | round |
| `ow` | array of the task IDs whose outcome is `wait overlap` in the state after this event | begin, start, done, round |

Every key listed for an `ev` is required; every other key is refused.

## Reader `readParallel(root, slug)` (fail-loud)
- No file → `{ v: 1, slug, state: "none" }`.
- Every line is checked (as `plan-check` v1 `readRecord`); a bad line throws `ParallelRecordError` `parallel record <slug> line <n>: <reason>`. A `start` for a task already running, a `done` for a task not running, a `round` while a task runs, or a first line that is not `begin` is a bad line.
- View: `{ v: 1, slug, state: "on", plan, hash, cap, mode, effective_cap, round, running: [ids], done: { "<round>": [ids] }, peak, waits, out, sibling }` from the last `begin` on (an earlier segment's done tasks stay done; each `begin` puts `round` back to 0). `peak` = the most tasks running at once over the whole file. `waits` = the number of distinct (round, task) pairs in any `ow`. `out` = the total of `extra` plus `sibling` entries; `sibling` = the `sibling` entries alone.

## CLI `scripts/plan-tasks.mjs` (cwd = product root; `main(args, { now, root, pluginRoot })` exported)
Exit codes: **0** done; **1** the plan cannot be read, or the record is broken; **3** refused (bad arguments, bad slug, a refused state change, a plan changed since `begin`). Refusals print `refused: <reason>` and write nothing. Arguments are checked values only: slug `^[a-z0-9][a-z0-9-]{0,63}$`, plan name (plan-check rule), task ID, digits, the words `parallel`/`sequential`, paths that pass the path rule. An argument that holds a control character (Unicode categories Cc, Cf, Zl or Zp) or is longer than 4096 characters is refused with exit 3 before any command runs, so no printed line can be forged. `scope` is the one command that takes unchecked text (commit candidates); a candidate that fails the path rule is never echoed: it prints as `extra ?` and is recorded as `?`.

| Command | Effect |
|---|---|
| `check <slug> <plan> --cap <3-5> --mode <parallel\|sequential>` | read-only. Prints the Gate block (below). Exit 0 for any readable plan, warnings included (AC4: never blocks) |
| `begin <slug> <plan> --cap <3-5> --mode <parallel\|sequential>` | appends `begin`; prints the block's first line and `begun`. Refused while a task runs. Starts a new segment at round 0 with no round sets, so round-0 tasks not yet done are offered again after a Fix round |
| `next <slug> [--json]` | read-only. Re-hashes the plan (`refused: plan changed since begin` on a mismatch). Prints `next: round <r>, running <k> of cap <c>`, then one line per task in visit order that is not done: `start <id> <role or ?>`, `running <id>` or `wait <id> <reason> [<on id>]`, then `done <d> of <n>`, or `next: round <r> complete` when every task of the round is done. `--json`: `{ v: 1, round, cap, running, start: [{ task, role }], wait: [{ task, reason, on }], done, total, complete }` |
| `start <slug> <id>` | appends `start`; refused unless `<id>` is a `start` line of `next` right now |
| `done <slug> <id>` | appends `done` (after the Step's commit); refused unless `<id>` is running |
| `lines <slug> <id>` | prints exactly two lines: `Task: <id>` and `Files: <paths joined by ", ">` (the plan's items in their written form with `/`, plus the round's added paths; `none` when empty). Read-only |
| `brief <slug> <id>` | (v1.1) `<id>` must be a task of the round with a plan block (not `U1`). Reads the plan once and refuses it when its hash differs from `begin`; a plan with an unclosed fence is refused. Writes `.company/work/<slug>/tasks/<id>.md`: a fixed header, the task's own block, every other level 2-4 section whose heading names `<id>` as a whole token, every level 2-3 section whose heading holds the word `contract` or `contracts` and names no task, and every `Decided:` line (plan-check's prefix: optional `-`, `*`, `+` or `1.` list marker, any indent) outside task blocks and outside sections that name another task (under `## Decided (plan-wide)`). Fences and headings as in the task syntax. Plan text goes only to that file, never to stdout. The `tasks` folder and the file are checked with `lstat`; a link, a file with more than one hard link or a non-folder is refused. A new file is opened with `O_CREAT|O_EXCL|O_NOFOLLOW`; an existing one with `O_NOFOLLOW`, then the handle is checked (regular file, one link, same device and inode) before it is truncated and rewritten. Prints exactly one line: `Task brief: .company/work/<slug>/tasks/<id>.md` |
| `scope <slug> <id> -- <path>…` | `<id>` must be running. Each path (the Step's commit candidates): under `.company/work/<slug>/` → `in`; overlaps the task's own set (files, earlier `extra` of this task, the round's added paths) → `in`; overlaps the set of another running task → `sibling <other id> <path>`; otherwise (invalid paths included) → `extra <path>`. Appends one `out` event (also when both lists are empty) and prints the lines, then `scope: <e> extra, <s> sibling` |
| `round <slug> <n> [--loose <k>] -- <path>…` | starts Fix round `<n>` (last round + 1, at most 5; no task running; the round starts with an empty done list). Each blocker path goes to the first task in visit order whose `files:` overlap it, else the first whose recorded `extra` overlap it; the rest (and `--loose` > 0, the blocker items the Lead could not pass) form task `U1`, alone, last in order, role `?`. The round's tasks are the owners plus `U1` if it exists; dependencies are ignored inside a round. Appends `round`, prints `round <n>: <id> (+<k> paths), …` and `unowned <path>` lines |
| `read <slug>` | prints the reader view as JSON; broken record → the error line, exit 1 |

**Gate block** (`check`, stdout only):
1. `plan-tasks: <n> tasks, <m> marked, <a> alone, cap <c> (<mode>)`
2. `wave <k>: <entries>` per wave, where wave 1 = the `start` set of `schedule` with nothing done, and wave k+1 = the `start` set with every earlier wave done. Entries are `<id>`, joined by `, `; an entry not in wave 1 is `<id> <reason> <on id>` with the reason it had in the previous wave (`depends`, `overlap`, `alone`, `barrier`, `cap`).
3. One line per alone task: `warning <id>: runs alone: <reason codes joined by "; ">`.
A plan with no task → the single line `plan-tasks: 0 tasks; plan Steps run one at a time`. A plan that cannot be read → `plan-tasks: error <plan-missing|plan-unreadable|plan-too-large|plan-name>`, exit 1.

## Error cases
- Plan changed after `begin` → `next`, `start`, `lines`, `brief` refuse; the Lead dispatches no new plan Step and asks the CEO (run `check` and `begin` again after a Plan Gate, or stop).
- Broken record → exit 1 with the reader line; the Lead dispatches no new plan Step until the CEO decides, and `ship` writes no `par` record.
- Nothing here ever blocks a Gate.

## Compatibility
New Contract. A run folder without `parallel.jsonl` reads as state `none`; `ship` then writes no `par` record. A reader that meets a `v` it does not know throws. An added key or event needs a new version.
