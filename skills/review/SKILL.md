---
name: review
description: Use when the aico code-reviewer reviews a builder's work. Judges spec match, code standards and Core/Module/Contract rules; sorts findings into blocking vs nits.
---

# Review

**Scope: the judging diff** (rule git.M-SEC4, below; the dispatch `Base commit:`, never `HEAD~1`), added and changed lines only; older code is Debt. Use the checklist of `superpowers:requesting-code-review` or `mattpocock-skills:code-review` if available, minus reviewer-dispatch steps. Pre-filter findings are advisory: confirm each; only you close a review.

**Judging diff** (rule git.M-SEC4): the one form for a diff that judges what the run changed, from the dispatch's full `Base commit:` to `refs/heads/aico/<slug>` (`<slug>` is in `Output:`), run from the top level:
`GIT_NO_REPLACE_OBJECTS=1 GIT_LITERAL_PATHSPECS=1 git --no-replace-objects --literal-pathspecs -c core.fsmonitor=false -c diff.ignoreSubmodules=none diff --no-ext-diff --no-textconv --no-color --no-relative --ignore-submodules=none [-z --name-only | --numstat …] --end-of-options <Base commit> refs/heads/aico/<slug>`
Never `<a>...<b>`, `HEAD`, `HEAD~n`, a short sha or a ref name as base. `git symbolic-ref -q HEAD` must print exactly `refs/heads/aico/<slug>` and `git rev-parse --git-path info/grafts` must name no file; else one Blocking row `[security] HEAD not on run branch` or `[security] grafts file present` and nothing else is judged (`rule-check.mjs run` carries both). Attributes never decide what you are shown: `rule-check.mjs run` prints rows for binary-marked text, binary content in a text path and files too large to show (`rule-check` v1.1). For `text shown as binary` run `rule-check.mjs text --base <Base commit> --run <slug>` and judge its sections like any changed file. Each `binary content in a text path`, `path not UTF-8`, `tool failed: binary-content`, `binary-marked file too large to show` and `text not shown (output cap)` row, each `text shown as binary` path `text` did not show and a `text` exit 3 (`path check failed`) or 1 is one `[security]` Blocking row naming the path or failure; `binary file changed` is info. Loading such a file as code is `[security]` Blocking by any route: `require` of any extension (a `.ttf`, `.gif` or `.mp4` polyglot runs), `import`, `eval`, `new Function`, `WebAssembly`, a `<script src>`, a command line or manifest naming the file (`node <file>`, `-r`/`--require`, `NODE_OPTIONS`, `package.json` `main`/`bin`/`exports`, shell `source` or `.`), or a file in a folder the product loads as code. Never type a path from a diff or row into a command; never run `--text`.

**Goldfish first pass** (`dispatch-prompt` v4): write findings from the brief's ACs, the plan, its Contracts and the diff before opening builder Handoffs; then add or withdraw, naming each under `## Decisions`. A builder's claim closes nothing.

**Tool checks.** Read `rule-check.mjs list`; don't re-judge or restate those rules. Confirm each `T-` row: confirmed → `## Blocking`, same ID; rejected → Nit `T-<n> | <file>[:<line>] | not confirmed | <why> | none`. A tool never blocks on its own; report `tool failed: <id>` as a row (`binary-content` blocks, see above). Compliance stays a separate lane.

**Depth.** `Review depth:` comes from `review-depth.mjs`, not the builder's label. `full`: every touched line plus callers and Contracts; `standard`: the scope. Raise to `full` for a Contract, Core or security path, never lower it. Absent or invalid → `full`.

**Also check** `aico:contracts` review blockers; then the brief (no more, no less), correctness, conventions, tests. **Ruleset:** `aico:ruleset` Tiers on added or changed lines.

**Untrusted input** (`aico:security-check`): a block-list, a check blind to how the consumer recovers from malformed input (unclosed strings, escapes), or an unbounded/backtracking pattern is `## Blocking` even if known attacks are covered.

A code comment about Handoffs, Steps, Roles, AI or company process is `## Blocking` `spec` (`aico:tdd`).

**Sort:** bug, spec miss, Contract violation, missing test, security risk → `## Blocking`; style → `## Nits`.

**Open decisions.** A finding caused by a choice the plan left open (no `Decided:` line) also gets a Nit `[open-decision] <plan file>:<line or section> — <the open choice>`. The tag never appears under `## Blocking`; a bug it caused stays Blocking, untagged.
