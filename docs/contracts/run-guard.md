# Contract: run-guard v1.2

Provider: `scripts/run-guard.mjs` (Node built-ins only; cwd = product root; `main(args, { root })` exported). Read-only: it writes nothing. Consumers: the Lead of `aico:pipeline` (Ship Gate). Uses: `plan-tasks` v1.3 (`readParallel`), `worktree` v1.1 (`readWorktrees`), `run-state` v1.7 (`show`), `work-folder-name` v1.1 (`isWorkFolder`, `exactWorkPath`). v1.1 is additive: the run argument may be a new work folder name; a legacy slug is accepted as before. v1.2 is additive: a name that matches a folder on disk only in another ASCII letter case is `refused: wrong letter case` (exit 3), checked after the name shape and before any record is read.
The two lines are information for the Ship Gate. They never block a ship and never change an exit code of another command.

## Command
`run-guard.mjs gate '<work folder>'`: the work folder name passes `isWorkFolder` (`work-folder-name` v1: a new name or a legacy slug), checked before any path is built; a name with spaces is one single-quoted argument and never reaches a shell. Exit 0 for a valid name, whatever the records hold. A bad name, an unknown command, a wrong argument count, an argument with a control character (Cc, Cf, Zl, Zp) or over 4096 characters → exit 3 and one line `refused: <reason>`. Prints exactly two lines, in this order:

```
guardrail files: <s> sibling, <e> extra, <a> archived, <c> conflicts
guardrail handover: <h> of <m> Steps
```

- `files`: `s` = `sibling` and `e` = `out` minus `sibling`, both from `readParallel(root, slug)` (the count of out-of-scope paths the `plan-tasks scope` command recorded: paths another task owns, and paths no task owns); `a` = `archived` and `c` = `conflicts` from `readWorktrees(root, slug)` (the `archive` and `conflict` events). No record → `0` for every count.
- `handover`: `m` = the number of Step files `run-state` `show(root, slug).steps` lists; `h` = those with `status: handover`. No run folder → `0 of 0 Steps`.
- A record that cannot be read (a reader throws) → `guardrail files: unknown (<reader message>)`, exit 0; the other line still prints. The same for the handover line: `guardrail handover: unknown (<reader message>)`. The message is the reader's own error text, never record text; it is cut at 120 characters (followed by `...`) and each Cc, Cf, Zl or Zp character prints as `\u{<hex>}`. An error that is not a reader error prints `unreadable`.
- Output holds counts only: no path, task id, commit id or patch name.

## Reading
Records are read only through the three exported readers; the script has no record parser of its own. A link, a hard link, an oversize file or line, a bad line or a non-UTF-8 file is the reader's fail-loud case and prints `unknown`.

## Lead flow
The Lead runs `run-guard.mjs gate '<work folder>'` at the Ship Gate and pastes the two lines into the Gate summary unchanged (`aico:pipeline`, worktree flow). Nothing is asked of the CEO because of them.
