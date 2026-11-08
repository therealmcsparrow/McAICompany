# Contract: afk-run v1

Status: draft until plan task T37 (run 2026-11-08 20.27 - Pocock Large Items) builds the loop; T37 removes this line and puts the provider paths in backticks.

Providers: scripts/afk-journal.mjs (journal writer and reader), scripts/afk-preflight.mjs, scripts/afk-github.mjs, scripts/afk-proxy.mjs, scripts/afk-gate.mjs, scripts/afk-ship.mjs, scripts/afk-pick.mjs, scripts/afk.mjs (CLI and loop). Uses: `afk-policy` v1, `sandbox-runner` v1, `afk-eligibility` v1, `plan-tasks` v1.8. Rationale: docs/adr/0067-afk-wsl2-runner.md. Branch push only: AFK never merges, publishes, releases or tags; the Ship Gate stays.

## CLI `afk.mjs <run|dry-run|status> <slug> <plan>`
`run`: real sandbox and push. `dry-run`: fake runner, no proxy, no push, no licence or GitHub check. `status`: prints the journal view. Exit 0 done; 1 a task failed or the record is broken; 3 refused (`refused: <cause>`; a WSL cause adds ` — see documentation/afk-runbook.md`).

## Order of a run
1. `loadPolicy` (kill switch first). 2. Preflight, causes in this order: `unsupported-host`, `wsl-missing`, `distro-missing`, `wslconf-drift`, `licence-unchecked` (run only), `token-missing`, `token-too-wide`, `token-workflows`, `ruleset-missing`, `github-unreachable` (run only). 3. Crash resume: a run id in the journal with `task-start` and no `stop` gets `stop crash-resume`, its sandbox destroyed and its token revoked. 4. Pick. 5. Proxy up with a fresh run token. 6. Per task: kill switch, `start` (probe inside), `exec`, `probe` again (drift → failure), `exportBundle`, gate, ship, `destroy`. 7. Stop at `max_tasks` or the first failure. 8. Revoke the run token (always, also after a failure), write the Handoff and the summary.

## Picker `pick(planText, { done, policy })`
Takes, in visit order, tasks that `afk-eligibility` v1 marks `afk`, whose `tier` is in `policy.tiers`, that are not done, whose files overlap no protected path, and whose dependencies are done or picked earlier in the list; at most `max_tasks`. Others are skipped with a code: the eligibility code, `tier-not-allowed`, `protected-files`, `deps-not-done`, `done`.

## Proxy
Host HTTP server bound to the WSL virtual interface on `proxy_port`. Accepts only `POST /v1/messages` and `POST /v1/messages/count_tokens` with `Authorization: Bearer <run token>` (32 random bytes, hex); forwards to the model API with the key from `model_key_env`; refuses everything else (403). Revoking the token closes the server; a later request is refused. Logs request and byte counts only.

## Host gate (per task bundle)
Fresh clone of the host repo at the base into a temp folder with `core.hooksPath` set to an empty folder and `core.fsmonitor=false`; `git bundle verify`; fetch the bundle head. Refusal causes, first that applies: `bundle-invalid`, `not-descendant`, `merge-commit`, `too-many-commits` (over 20), `gitlink`, `symlink`, `alias-path` (a segment with `~<digit>` or `:`), `protected-path` (path key of `plan-tasks` overlaps `protected_paths`), `out-of-scope` (outside the task's `files:`), `qa-test-changed` (a file of the task's QA task changed), `unlabelled-commit` (author not `aico-afk <afk@invalid>` or no trailer `AI-Generated: aico-afk`), `tests-red` (the task's QA files, unchanged from base, run with `node --test` in the clone). Tests changed in the diff never count as proof.

## Ship
From the gate's clean clone only. One refspec, built inside the module: candidate to `refs/heads/aico/afk-<run>`. No force; the first push of a run refuses an existing branch (`branch-exists`); later pushes must fast-forward. Token through `GIT_ASKPASS` from `push_token_env`, `credential.helper` emptied, `GIT_TERMINAL_PROMPT=0`; never in argv, journal or log. Causes: `bad-run-id`, `token-missing`, `branch-exists`, `push-refused`.

## Journal `.company/work/<slug>/afk-run.jsonl`
Written by the host only; same file rules as `plan-tasks` `parallel.jsonl` (append-only, O_EXCL first create, `lstat`, one link, line at most 8 KiB, file at most 1 MiB and 5000 lines). Every line: `v` 1, `at` UTC, `ev`, `run` (`^\d{8}-\d{4}-[0-9a-f]{6}$`). Events and their keys:
- `preflight` `ok` (bool), `cause` (when not ok) · `pick` `task`, `code` · `skip` `task`, `code`
- `task-start` `task` · `probe` `task`, `pass`, `reasons` · `exec` `task`, `code` · `bundle` `task`, `sha` (40 hex)
- `gate` `task`, `ok`, `cause` (when not ok), `paths` (count) · `push` `task`, `branch`, `sha`
- `proxy` `requests`, `bytes` · `stop` `reason` (`done`, `cap`, `failure`, `kill-switch`, `probe`, `preflight`, `crash-resume`) · `token-revoked` `ok` · `summary` `done` (count), `failed` (task ID or null), `branch` (or null)
No prompt text, no output text, no author name, no path but the branch name. The reader fails loud on a bad line, as `readParallel`.

## Handoff and summary
At the end the loop writes `.company/work/<slug>/afk-<run>.md` in the `handoff` v2.4 shape (`By: afk-loop`, status `done` or `blocked`, `## Did` per task, `## Next`: the branch and the Ship Gate) and prints `afk: <done> done, failed <id|none>, branch <name|none>`. The CEO's Ship Gate decides every merge.

## Compatibility
New Contract. A new event, key or cause is a minor bump; a removed one or a wider ship right is a major and a Plan Gate item.
