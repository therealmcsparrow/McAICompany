# Contract: review-loop v2.0

Provider: `scripts/review-loop.mjs` (Node built-ins only; `main(args, { root, now })`, `readReviewLoop(root, slug)` exported). Writer of the record: the script, for the Lead. Consumers: the Lead (pipeline reference `review-loop`), the Ship Gate list. Uses: `work-folder-name` v3.0 (`isRunSlug`, `workParts`, `exactWorkPath`).
v2.0 (major, task P20261120.000001, T21): `mark` and `churn` are removed (an unknown command → `refused: usage: …`, exit 3, nothing written). `gate` takes the slug only (`--base` is refused) and drops the second-reviewer check: it prints no `single` line and reads no Handoff. The `mark` event is no longer valid in the record. `bothReviewersRan` is no longer exported. The script runs no git. The second reviewer and the Fix-round churn check are retired with `pipeline.second_reviewer` (`aico-settings` v4.0).
v1.3: the slug is accepted with `isRunSlug` (`work-folder-name` v3.0), so a v3 run slug `<ProjectID>/<NN>-<playbook>` is valid; its folder is `exactWorkPath(io, root, workParts(slug))`.
v1.2: `attempt` and `gate` check the spelling of `.company`, `work` and the slug against the directory entries before any read or write. A slug that exists only in another ASCII letter case → `refused: wrong letter case` (exit 3), nothing written.
A reviewer that did not run is never a clean pass. A forged record can only add Gate items; it can never mark a review clean.

## Record
`.company/work/<slug>/review-loop.jsonl` (slug a run slug or work folder name; any other value is refused, never echoed; `readReviewLoop` throws `TypeError`): append-only, LF, a line at most 512 bytes, the file at most 64 KiB and 500 lines. Run folder and file checked with `lstat` (a plain folder; a regular file with one hard link; a link refused); the first line is written with `O_CREAT|O_EXCL`, every append re-checks the opened handle against `lstat` (regular, one link, same device and inode), as `plan-tasks` v1.

| Key | Value |
|---|---|
| `v` | `1` |
| `at` | UTC time `YYYY-MM-DDTHH:MM:SSZ` |
| `ev` | `attempt` or `notrun` |
| `role` | a review Role (below) |
| `round` | integer 0-5 |
| `step` | string `NN`, the Step number of the first dispatch (`^\d{2,3}$`) |
| `reason` | `crash`, `no-handoff` or `lint` |

Each line has exactly these keys. `readReviewLoop` is fail-loud: it throws `ReviewLoopRecordError` on a bad line, a size or line limit, a link, a non-UTF-8 file or a missing final LF. A missing file reads as no events. A record from before v2.0 that holds a `mark` line is unreadable (exit 1).
Review Roles: `code-reviewer`, `fresh-reviewer`, `qa`, `security`, `pentester`, `vuln-scanner`, `senior-engineer`, `accessibility-tester`, `hands-on-tester`, `persona-tester`, `legal`.

## Commands
Exit 0 done, 1 unreadable record, 3 refused (`refused: <reason>`, nothing written). An argument with a control character or over 4096 characters → exit 3.

- `attempt <slug> <step> <role> <round> <reason>`: the first failure of (role, round, step) appends `attempt` and prints `retry <role>`; the second appends `notrun` and prints `not run <role> round <round>`. A further call for a (role, round, step) that is already `notrun` → refused.
- `gate <slug>`: the Ship Gate lines. Every `notrun` prints `not run <role> round <n>`; for `security`, `pentester` and `vuln-scanner` it prints `blocking: not run <role> round <n>`. Nothing to report → `review-loop: nothing to report`. Exit 0.

## Lead flow
Pipeline reference `review-loop`. A review Role's Step that crashes, writes no Handoff or fails the lint → `attempt`; `retry` → re-dispatch once; `not run` → no further dispatch, the round is not clean and the line goes on the Ship Gate list (Plan Gate for the plan reviewer). A `blocking:` line is a Blocking Ship Gate line the CEO must answer (re-run that lane or block the ship), never only a list line.
