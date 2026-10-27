# Run state

The Lead records where a run is in `.company/work/<slug>/run-state.jsonl` through five commands (`run-state` v1.3, `docs/contracts/run-state.md`). The mods read it; nothing else does. Run each command from the product root.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" start '<slug>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" wave '<slug>' '<n>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" gate '<slug>' '<brief|plan|ship>' '<passed|changed|stopped>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" ask '<slug>' '<brief|plan|ship>'
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" end '<slug>' '<ship|abort>'
```

## When
- `start`: in Setup, once the task slug is known. A run resumed with "resume <slug>" after an `end` runs `start` again.
- `wave`: at the start of each wave of the plan, `<n>` the plan's wave number (1 to 99). A Fix round keeps the wave it belongs to.
- `ask`: directly before each Brief, Plan and Ship Gate form is shown, so the CEO's wait can be told from run time. An `auto` Gate shows no form and gets no `ask`.
- `gate`: after each Brief, Plan and Ship Gate answer: Approve is `passed`, Change is `changed`, Stop is `stopped`. An `auto` Gate counts as `passed`.
- `end`: when the Ship Gate work is done (`ship`) or the CEO stops the run (`abort`).

## Rules
- Pass only checked values: the slug from Setup, a wave number from the plan, and the Gate, result and outcome words from the lists above, each in single quotes. Never put Handoff or CEO text in an argument.
- The script writes the time; the Lead never types it and never edits the file by hand.
- Run-state never blocks a Step or a Gate. A refused command (`refused: <reason>`, exit 2) or any other failure is named in the next Gate summary and the run goes on.
