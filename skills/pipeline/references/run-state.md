# Run state

The Lead records where a run is in `.company/work/<slug>/run-state.jsonl` through five commands (`run-state` v1.3, `docs/contracts/run-state.md`). The mods read it; nothing else does. Run each command from the product root.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state start '<slug>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state wave '<slug>' '<n>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state gate '<slug>' '<brief|plan|ship>' '<passed|changed|stopped>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state ask '<slug>' '<brief|plan|ship>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state end '<slug>' '<ship|abort>'
```

Stage records go through `run-stage` (stage file beside the run, report only):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-stage set '<slug>' '<brief|plan|build|review|ship-gate>'
```

## When
- `run-stage set`: when the run enters a phase: `brief` at Setup, `plan` after the Brief Gate passed, `build` after the Plan Gate passed, `review` when the reviewer lane starts, `ship-gate` just before the Ship Gate `ask`. Same rules as below; it never blocks a Step or a Gate.
- `start`: in Setup, once the task slug is known. A run resumed with "resume <slug>" after an `end` runs `start` again.
- `wave`: at the start of each wave of the plan, `<n>` the plan's wave number (1 to 99). A Fix round keeps the wave it belongs to.
- `ask`: directly before each Brief, Plan and Ship Gate form is shown, so the CEO's wait can be told from run time. An `auto` Gate shows no form and gets no `ask`.
- `gate`: after each Brief, Plan and Ship Gate answer: Approve is `passed`, Change is `changed`, Stop is `stopped`. An `auto` Gate counts as `passed`.
- The Plan Gate `passed` is typed as `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs run-state gate '<slug>' plan passed`: the name exactly as printed by `work-folder`, single-quoted, single spaces otherwise. Only that form is the one the plan Gate mod recognises and checks before it runs.
- `ceo`: after each CEO form is shown, `run-state ceo '<slug>' '<brief|plan|ship|none>' '<n>'` (`n` 1 to 20). `needs-ceo` questions are held until the wave ends and go out as one form, never one at a time (`references/ceo-pack.md`).
- `end`: when the Ship Gate work is done (`ship`) or the CEO stops the run (`abort`).

## Rules
- Pass only checked values: the slug from Setup, a wave number from the plan, and the Gate, result and outcome words from the lists above, each in single quotes. Never put Handoff or CEO text in an argument.
- The script writes the time; the Lead never types it and never edits the file by hand.
- Run-state never blocks a Step or a Gate. A refused command (`refused: <reason>`, exit 2) or any other failure is named in the next Gate summary and the run goes on.

Which project a run joins (`run-state projects --json`, the `project:` line) is decided in Setup by `references/join-project.md`; the `start` command runs after it, with the slug `work-folder` printed.
