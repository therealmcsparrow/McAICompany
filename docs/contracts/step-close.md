# Contract: step-close v1.0

Provider: `scripts/step-close.mjs` (Node built-ins only; plan tasks P20261120.000001-T25, -T26). Consumer: the Lead through `aico:pipeline` (one call after every Step). Uses: `handoff` v3.0 (lint, frontmatter `files-touched`), `plan-tasks` v1.11 (`scope`, `done`, `next`, the record's running task sets, read-only), `tier-sets` v2.0 (`sync`), `route` v2.0 (`next`), `token-ledger` v1.15 (hook-row lookup; `add` only with `--usage`), `work-folder-name` v3.0 (`isRunSlug`, `exactWorkPath`).
Rationale: the Lead closed each Step with 6-9 separate calls (lint, ledger, scope, commit, done, next, tier sync, route); each call filled the Lead's context and caused a Lead hand-over every ~2.5 Steps in run P20261117.000001. One command runs the same checks in the same order and prints one block. No check is dropped.

## CLI
`node <plugin root>/scripts/step-close.mjs <slug> <NN> <role> --handoff <path> --msg '<type>: <summary>' [--task <id>] [--usage <ctx_end>,<tool_uses>,<ms>]`
- `<slug>`: a run slug (`isRunSlug`). `<NN>`: 2-3 digits, not all zero. `<role>`: the slug of an `agents/` file in the plugin root. `--handoff`: `.company/work/<slug>/<NN>-<role>.md`, exact path, plain file, no link.
- `--msg`: `^(feat|fix|test|docs|refactor|chore): [\p{L}\p{N} .,:;/_()+#-]{1,72}$` (Unicode flag; letters of any language, so a subject in the run's `Language:` passes). It goes to git as one argv item, never through a shell. The Lead writes it; it is never copied from Role text.
- `--task`: a plan-task Step; the id is the one `plan-tasks next` printed.
- `--usage`: three integers from the notification `<usage>` block. Given only when no hook row exists for this Step (`ledger: missing` in an earlier close, the hook is off, or the C10 spike failed).
- Every argument is untrusted: output holds fixed words, the slug, `<NN>`, `<role>`, digits and paths that passed the path rule.

## Commit candidates
Candidates = the Handoff path + every item of the Handoff's frontmatter `files-touched` list (parsed as `handoff-lint` parses it). Prose under `## Did` or elsewhere is never read for paths.

## Order (stops at the first failing stage; a stage that did not run prints nothing)
1. **Lint** the Handoff (`handoff-lint` rules, plain mode). Errors → print them, `step-close: lint failed`, exit 1. Nothing is committed. The Lead redoes the Step as a fresh Step (`aico:pipeline`).
2. **Scope.**
   - With `--task`: `plan-tasks scope <slug> <id> -- <candidates>`. A refusal prints its lines, `step-close: scope failed`, exit 1; nothing committed. `sibling` paths are dropped (`dropped: <path> (task <other id>)`); `extra` paths stay and their lines are printed for the Lead.
   - Without `--task`, when the run has a plan-tasks record: a candidate that overlaps the set of a running task (same overlap rule as `scope`) is dropped, `dropped: <path> (task <id>)`. An unreadable record → `step-close: scope failed`, exit 1, nothing committed (fail-closed).
3. **Commit.** Keep a candidate only if it is relative, has no `..` segment, does not start with `-` or `:`, has no quote, backtick, `$`, `\`, `*`, `?`, `[` or control character, is not `.env*`, and is listed as changed or untracked by `git status --porcelain=v1 -z`. Each other candidate prints `dropped: <path>` when it passed the character rule, else `dropped: ?`. Then `git --literal-pathspecs add -- <paths>` and `git commit -m <msg> -- <paths>` (argv, no shell). Git failure → `step-close: commit failed`, exit 3.
4. **Ledger.** A hook row exists when the run's token ledger holds a row with `step` `<NN>`, `role` `<role>` and `source` `hook` (`token-ledger` v1.15) → `ledger: hook`. Else with `--usage` → `ledger add … step <NN> <role>` → `ledger: added`; ledger exit 4 prints its `over cap` line and the close goes on. Else → `ledger: missing` (never blocks). Runs after the commit, so a lint or scope failure never leaves a row.
5. **Done and next** (only with `--task`): `plan-tasks done`, then `plan-tasks next`; their start lines are printed as is.
6. **Tier sync** (feature and fix runs with a tier-path record): `tier-set sync <slug>`; its lines are printed.
7. **Route next** (only without `--task` and when the run has `route.jsonl`): `route next <slug>`; printed as `next: <json>`.

## Output
First line: `step-close: <NN> <role> lint ok, commit <short sha>, <k> paths, <d> dropped, ledger <hook|added|missing>`. Then the lines of stages 2 and 4-7 in order. Exit 0 when every stage that ran succeeded.

## Exit codes
0 done; 1 lint or scope failed (nothing committed); 2 refused argument (nothing run); 3 git failed.

## Compatibility
v1.0. A new optional flag or a new printed line after the first is a minor bump. Dropping a stage, changing the order, reading commit paths from anything but `files-touched`, or committing on a lint or scope failure is a major bump and needs the CEO.
