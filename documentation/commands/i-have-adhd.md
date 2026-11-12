# `/aico:i-have-adhd`

`/aico:i-have-adhd [help]`

## In short
**Only you start this command.** No other command, file or Role turns it on.

**What it does.** Switches on ADHD mode for the rest of this session. Replies to you start with the next action, number multi-step work, say `step n of m`, keep lists to five items per group and end with one next action.

**When to use it.** When long replies are hard to act on and you want each answer to tell you what to do first.

**Stop it.** Write `stop adhd mode` or `normal mode`, in any letter case. You get one confirmation line, then the default style returns.

**Help:** `/aico:i-have-adhd help` (or `--help`) explains the command without running it.

## How it works
No Gates, no files written.
1. You run `/aico:i-have-adhd`. You get one line: `ADHD mode on — say "stop adhd mode" or "normal mode" to end.` A request in the same message is answered in the new shape.
2. The mode stays on for the whole session, also when the topic changes.
3. You write `stop adhd mode` or `normal mode`. It ends.

Session only: the mode is not saved to any file, Handoff, setting, run state or memory. A new session starts in normal mode.

Safety comes first. Before a destructive step (force push, delete, migration) you are asked to confirm, and a Gate or form is shown as usual.

## Technical details
**You get.** Prose in the main session only. Handoff files, Gate and ask forms, Step prompts and AC IDs stay as they are. Roles never receive the mode. Your own tone and length instructions still apply inside the shape.

**Example.** `/aico:i-have-adhd`
