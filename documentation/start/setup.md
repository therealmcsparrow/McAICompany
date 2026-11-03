# No setup needed: the hand-over point

## In short

Claude Code shrinks ("compacts") a long chat when it gets too full. aico does not wait for that. While a job runs, a hook stops each Role and the Lead at 85500 tokens, makes them write their notes, and hands the work to a fresh one. You change no setting. If you set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for an earlier version, you can remove it.

## How it works

1. A Role reaches 85500 tokens. Every tool except writing its Handoff file is refused, so it writes the Handoff and ends. The Lead starts a fresh Role from that file.
2. The Lead reaches 85500 tokens. aico writes the Lead Handoff from the run records and freezes that session.
3. The frozen Lead calls the `lead_new_session` tool, or shows you a command. Run that command in the product folder. Expected result: a new session continues from the Lead Handoff file.
4. Close the old session yourself. It stays frozen.

Claude Code may ask once to allow the `lead_new_session` tool. Automatic compaction is blocked while a job runs. Typing `/compact` yourself still works.

## Technical details

- **The numbers.** Every Role works under one fixed cap: 95000 tokens, with a hand-over at 85500.
- **The hooks.** A PreToolUse hook reads token counts from the local transcript and stores none of its text; at 85500 it refuses tools (`context-guard` v1). A SubagentStop hook blocks a Role's stop once if no Handoff was written. A PreCompact hook blocks auto compaction during a run, and the Lead Handoff `lead-handoff-<n>.md` is written by the script. Contract `lead-handoff` v1.7, ADR 0056.
- **The tool.** `lead_new_session` starts nothing and writes nothing. It returns the command for a new session (`lead-session-mcp` v1.1).
- **Escape.** `AICO_CONTEXT_GUARD=off` in the environment of Claude Code turns the guard off.
- **Where the text goes.** The Lead Handoff is a local file. The Claude model you configured reads it, like the rest of the Lead's work. Nothing is pushed or published. See [Where your words go](../concepts/where-your-words-go.md).
- **More.** [Lead hand-over](../concepts/lead-handover.md) and [Context budget](../concepts/context-budget.md).
