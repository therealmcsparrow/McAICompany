# Contract: ship-check v1.0

Provider: `scripts/ship-check.mjs` (Node built-ins only; plan task P20261120.000001-T27). Consumer: the Lead through `aico:pipeline` (Finish, before every Ship Gate form). Uses, each as a child process of a sibling script with fixed arguments: `handoff` v3.0 (`handoff-lint --contests`), `rule-check` v1.7 (`drift`), `token-ledger` v1.15 (`reconcile`, `report`), `worktree` (`leftovers`, `protocheck`), `run-guard` v1.3 (`gate`), `lead-handoff` v3.0 (`lead-handover read`), `review-loop` v2.0 (`gate`), `tier-sets` v2.0 (`sync --diff`), `route` v2.0 (`owed`), `aico-settings` v4.0 (`pipeline.worktrees`).
Rationale: the Ship Gate cost ~12 Lead calls per attempt, and run P20261117.000001 had many attempts. One command runs every check and prints one block; each check keeps its own Contract and its own blocking rule.

## CLI
`node <plugin root>/scripts/ship-check.mjs <slug> --base <full id> --branch <branch> [--acs <n>] [--baseline <run>,<run>,<run>]`
- `<slug>` a run slug; `--base` 40 or 64 hex; `--branch` the printed `branch:` value (`aico/...`); `--acs` 1-999; `--baseline` passed through to `ledger report` unchanged after the same check `ledger` does.
- The full test suite is not run here; the Lead runs it once, after this command, as `aico:pipeline` Finish says.

## Checks (always all, in this order; one failing check never stops the others)
| # | Name | Runs | Blocks the Gate when |
|---|---|---|---|
| 1 | `tree` | `git symbolic-ref -q HEAD` equals `refs/heads/<branch>`; `git -c core.fsmonitor=false status --porcelain=v1 -z --untracked-files=no --ignore-submodules=none` empty; then `git ls-files --others --exclude-standard -z` | HEAD or tracked changes differ. Untracked paths never block: `tree: info — <n> untracked` plus up to 5 paths that pass the `step-close` character rule |
| 2 | `contests` | `handoff-lint --contests` on the run folder | it prints `unresolved` or `escalated` |
| 3 | `drift` | `rule-check drift` | exit 1 |
| 4 | `ledger` | `ledger reconcile`, then `ledger report --acs` | never (cost line only) |
| 5 | `review-loop` | `review-loop gate` | its own blocking lines |
| 6 | `tier` | `tier-set sync <slug> --diff --base <id>`, then `route owed <slug>` (in this order, so a raise found by the sync counts) | the sync prints `add before ship:` (entries owed after a raise and not yet marked `ran`), the sync exits non-zero, or `route owed` prints `owed: security` or exits non-zero (it prints `owed: none` when nothing is owed or the run has no `route.jsonl`). Else `tier: info — <tier line>` |
| 7 | `lead` | `lead-handover read` | never (`lead peak` line) |
| 8 | `worktrees` | `worktree leftovers`, `run-guard gate`, `worktree protocheck`; only when `pipeline.worktrees` is `on`, else one line `worktrees: off` | their own blocking lines |

Clearing a `tier` block: the Lead dispatches each owed Step, then records it: `tier-set ran <slug> <entry>` for an `add before ship:` entry, `route fix <slug> security <why>` for an owed `security`. Nothing else clears it.

## Output
One line per check: `<name>: ok`, `<name>: block — <first line of the cause>` or `<name>: info — <line>`, with at most 5 extra lines per check, indented by two spaces. Last line: `ship-check: <b> blocking, <i> info`. Exit 0 with no block, 1 with one or more blocks, 2 on a refused argument (nothing run). A child that cannot start or times out (60 s each) counts as `block — could not run`.

## Compatibility
v1.0. A new check or a new info line is a minor bump. Removing a check, or turning a block into info, is a major bump and needs the CEO.
