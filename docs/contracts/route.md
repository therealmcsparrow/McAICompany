# Contract: route v1.0

Provider: `scripts/route.mjs` (Node built-ins only; plan task P20261116.000003-T10). Data: `company/step-budgets.json`, `company/role-when.json`. Consumers: the Lead through `aico:pipeline` (`write`, `tasks`, `next`, `fix`), `aico:triage` (the route draft), `scripts/check.mjs` (`--route <file>` and the data lint; it calls `lintRoute` and `lintData` only, no route logic in Core). Uses: `diff-facts` v1.0 (`readLatest`), `work-folder-name` v3.0 (`isRunSlug`, `workParts`), `handoff` v2.8 (frontmatter `status` only).
Rationale: the Steps a run takes are data in one ledger, so skips and merges have reasons, the Step budget is a lint, and the pipeline runs that list and nothing else. v1.0 covers the `feature` and `fix` Playbooks; others keep their prose order.

## Data files (tracked, plain files of at most 16 KiB, keys read with `Object.hasOwn`)
- `company/step-budgets.json`: `{ "v": 1, "budgets": { "feature": <n>, "fix": <n> }, "source": "<one line, at most 200 characters>" }`. Each budget is a whole number 1-200: the most Steps a route of that Playbook may plan (round 0). `source` says how the numbers were measured.
- `company/role-when.json`: `{ "v": 1, "when": { "<agents/ slug>": ["<cond>", ...] } }`. Conditions (all must hold for the Role to run): `ui_changed`, `strings_changed`, `contract_changed` (the diff-facts flag is `true`), `languages>1` (the `languages:` line of `.company/project.md` lists two or more tags). v1.0 lists `accessibility-tester`, `ui-ux-designer`, `hands-on-tester`, `persona-tester` with `["ui_changed"]` and `localizer` with `["strings_changed", "languages>1"]`.
- Never skippable: `qa`, `security` and every protected Role. `lintData(root, protectedRoles)` takes the list as an argument (check.mjs passes its own; the CLI passes `PROTECTED_ROLES` exported by `scripts/settings.mjs`), so `scripts/route.mjs` never imports Core. It refuses a `when` entry for these Roles and for a slug with no `agents/` file.

## Route ledger
`.company/work/<parts>/route.jsonl`, append-only, LF, one JSON object per line, a line at most 4096 bytes, a file at most 64 KiB, opened with `lstat` (a link is refused). Every `why` is 1-120 characters with no control character. Events:
- `{"v":1,"ev":"route","playbook":"feature|fix","size":"XS|S|M|L","steps":[{"role":"<slug>","why":"..."},{"role":"code-reviewer","merge":"qa","why":"..."}],"skips":[{"role":"<slug>","why":"..."}]}` — once, first line.
- `{"v":1,"ev":"tasks","n":<1-200>}` — the plan's task count, once, after the Plan Gate or plan-tasks `begin`.
- `{"v":1,"ev":"step","i":<index>,"role":"<slug>","do":"run|skip|split|tasks","why":"...","facts":"<NN-role>|none"}` — one per `next`.
- `{"v":1,"ev":"fix","role":"<slug>","why":"..."}` — a Fix-round or nit Fix Step; never counted toward the budget.

## Lint (`lintRoute(route, data)`; one line per error, all errors listed)
- `ERROR route: <playbook> over budget: budget <b>, count <c>` — count = `steps` entries (a merged pair counts once) + `tasks.n`.
- `ERROR route: no budget for <playbook>`; `ERROR route: unknown role <slug>`; `ERROR route: <slug> may not be skipped`; `ERROR route: step <i> has no why`.
- `ERROR route: merge needs size S` and `ERROR route: merge must be code-reviewer with qa` — the only merge is the S QA verify plus the review checklist, dispatched as one `code-reviewer` Step. A QA test-first Step is never merged.
- A Role may appear in `steps` more than once (`fix`: `qa` reproduces, then verifies; `feature`: `architect` designs, then signs off the ruleset). A repeated Role is never a lint error.

## CLI (`node scripts/route.mjs <cmd>`, cwd = product repo; refusals `refused: <reason>` on stdout, exit 2; nothing written on a refusal)
| Command | Does |
|---|---|
| `write <slug> <draft.json>` | Lints the draft (the `route` event without `v` and `ev`), appends it. Refused on any lint error (the lines are printed), a second `route`, or a bad slug. |
| `tasks <slug> <n>` | Appends `tasks`, refused when the new count is over budget or `tasks` exists. |
| `next <slug>` | Decides the next entry, appends a `step` event and prints it as one JSON line; prints `{"do":"end"}` when the list is done. |
| `fix <slug> <role> <why>` | Appends `fix`. |
| `dry <draft.json> --base <commit> [--head <commit>]` | Prints one line per entry, `<i> <role> <run|skip|split> <why>`, for the diff given (`diff-facts show`), writes nothing. |
| `check <file>` | Lints a draft or a route ledger, prints the lines and `<n> error(s)`, exit 1 on any error. |

## `next` decision (fail-open)
1. A `tasks` placeholder entry → `do: tasks` (the Lead runs the plan's tasks through plan-tasks, then calls `next` again).
2. A Role in `role-when.json` → read `readLatest` of the run. `skip` only when facts exist, `v` is 1, no path has kind `unknown`, and a listed condition is `false`; `why` names the condition and the facts file. No facts, a bad file, an unknown path or an unreadable `languages:` line → `run`.
3. A merged entry → `run` as one Step only when the route size is `S`, the newest facts give `contract_changed: false`, and no earlier Handoff in the run folder has `status: needs-ceo`; else `split` (`qa`, then `code-reviewer`, two Steps, `why` names the failed test).
4. Anything else → `run`. `AICO_COLD` does not change Role decisions (it governs caches, `step-key` v1.0).
A merged pair (not the wave "Merge Step" of `skills/pipeline/references/parallel.md`) is one Step: one Goal, one Handoff, the run's Context cap and forced hand-over, counted once.

## Compatibility
v1.0. A new condition, event, data key or Playbook budget is a minor bump. A rule that skips more (a new skip reason, a removed never-skippable Role, fail-closed turned fail-open) is a major bump and needs the CEO.
