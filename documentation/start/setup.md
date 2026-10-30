# One-time setup: the compaction point

## In short

Claude Code shrinks ("compacts") a long chat when it gets too full. The Lead, the part of aico that runs your job, saves its own notes just before that happens, so it can carry on without losing track. For that to work, you change one setting once. This step is optional but recommended. Without it the Lead still works, but it hands over only at Claude Code's default compaction point.

## How it works

1. Open `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`).
2. Add this line to the `env` block, and create the block if it is missing:

   ```json
   "env": {
     "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "98500"
   }
   ```

3. Restart Claude Code. Expected result: new sessions compact near 85500 tokens, and the Lead continues from its own Lead Handoff file.

It applies to every Claude Code session on the machine. To undo it, remove the line.

## Technical details

- **Why you set it.** This step lets the Lead hand over to itself at about 85500 tokens, before Claude Code's own limit. A plugin cannot set it, so you set it once.
- **The numbers.** Every Role works under one fixed cap: 95000 tokens, with a hand-over at 85500. The setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is `"98500"`.
- **The hooks.** A PostToolUse hook reads token counts from the local transcript and stores none of its text. At 85500 it tells the Lead to write `lead-handoff-<n>.md` at the next clean point (no Step running). A SessionStart hook for source `compact` injects the newest Lead Handoff after compaction. Contract `lead-handoff` v1, ADR 0049.
- **Where the text goes.** The Lead Handoff is a local file. The Claude model you configured reads it, like the rest of the Lead's work. Nothing is pushed or published. See [Where your words go](../concepts/where-your-words-go.md).
- **More.** [Lead hand-over](../concepts/lead-handover.md) and [Context budget](../concepts/context-budget.md).
