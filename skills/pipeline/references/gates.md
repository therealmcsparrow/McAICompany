# Gates

What the Lead runs at a Gate (`ship-check` v1.0, `docs/contracts/ship-check.md`; `aico:pipeline` §4, §6).

## Ship Gate: one call
Before every Ship Gate form, once the last review is clean, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" ship-check '<slug>' --base <Base commit> --branch '<branch>' --acs <acs> [--baseline <run>,<run>,<run>]`.
- `--branch` is the printed `branch:` value; `--acs` the Brief's ACs shipped.
- It runs eight checks, always all, in order: `tree`, `contests`, `drift`, `ledger`, `review-loop`, `tier`, `lead`, `worktrees`. One block per check: `ok`, `block`, or `info`. Last line: `ship-check: <b> blocking, <i> info`.
- Run the full test suite once, in the foreground, after this call; quote its result line. `ship-check` never runs it.
- Exit 0: put the `info` lines (cost, `lead peak`, untracked) in the Ship Gate summary. Exit 1: name each `block` line in the summary and clear it first. Exit 2: you passed a bad argument; fix it, nothing ran.
- A `block` is never ignored; a cost or `lead peak` line never blocks.

## Clearing a `tier` block
The `tier` check blocks on `add before ship:` entries or on `owed: security`. Dispatch each owed Step, then record it. Nothing else clears the block.
- `add before ship: <entry>` → dispatch that Role, then `tier-set ran '<slug>' <entry>`.
- `owed: security` → dispatch `security`, then `route fix '<slug>' security '<why>'`.
- Then run `ship-check` again.

## Other Gates
Every Gate runs `worktree leftovers` and `handoff-lint --contests` (`references/worktrees.md`, `references/contest.md`). Held `needs-ceo` questions join the Gate's own form (`references/ceo-pack.md`).
