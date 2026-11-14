# No setup needed: the hand-over point

## In short

Claude Code shrinks ("compacts") a long chat when it gets too full. aico does not wait for that. While a job runs, five guards watch every tool call. One of them, the cap guard, stops each Role and the Lead at the hand-over point (162000 tokens by default), makes them write their notes, and hands the work to a fresh one. You change no setting. If you set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for an earlier version, you can remove it.

You have three things to know:

- **The off switch.** Launch Claude Code with `AICO_GUARDS=off` and the guards stand down in the Lead session. Steps are not affected (see Technical details).
- **The cap range.** The cap is 180000 tokens by default. You can set it from 60000 to 250000 in `/aico:settings`, at user level only.
- **The two panes.** `/aico-mods` lists every mod and guard and switches the savers. `/aico-savings` shows tokens per Step against the runs before the guards.

## How it works

1. A Role reaches the hand-over point. Every tool except writing its Handoff file is refused, so it writes the Handoff and ends. The Lead starts a fresh Role from that file.
2. The Lead reaches the hand-over point. aico writes the Lead Handoff from the run records and freezes that session.
3. The frozen Lead calls the `lead_new_session` tool, or shows you a command. Run that command in the product folder. Expected result: a new session continues from the Lead Handoff file.
4. Close the old session yourself. It stays frozen.

Claude Code may ask once to allow the `lead_new_session` tool. Automatic compaction is blocked while a job runs. Typing `/compact` yourself still works.

## Technical details

- **The five guards.** `cap` (the hand-over point), `git add` (refuses any form that stages files not named one by one), `.env` (refuses `.env` and `.env.<x>`, except `.env.example`, `.env.sample` and `.env.template`), `model floor` (refuses a Role dispatched on a model below its floor) and `self-protect` (refuses writes to aico's own hooks and settings). They stop accidents, not a determined attacker who crafts evasive commands; known gaps are tracked as Debt. They fail closed: if a guard cannot decide in an active run, it refuses. The details are in [Guards](../concepts/guards.md).
- **The numbers.** Every Role in a run works under one cap, 180000 tokens by default, with a hand-over at 90% of it, 162000 at the default. The cap is the `pipeline.context_cap` setting, 60000 to 250000, at user level only; a project value is ignored. aico reads the cap from a snapshot taken when each Step starts, so a change applies from the next Step. The cap is not frozen per run.
- **The off switch.** `AICO_GUARDS=off` in the environment of Claude Code, set by you at launch, stands the guards down in the Lead session only. A Step session ignores it and is always guarded, even when launched from a Lead that has the switch on. The name appears only here and in the CEO band, never in a refusal text. The earlier cap-only switch is gone; this one covers all five guards.
- **The hooks.** A PreToolUse hook reads token counts from the local transcript and stores none of its text; at the hand-over point it refuses tools (`context-guard` v2.0). A SubagentStop hook blocks a Role's stop once if no Handoff was written. A PreCompact hook blocks auto compaction during a run, and the Lead Handoff `lead-handoff-<n>.md` is written by the script. Contract `lead-handoff` v2.4, ADR 0070.
- **The tool.** `lead_new_session` starts nothing and writes nothing. It returns the command for a new session (`lead-session-mcp` v1.1).
- **The panes.** Both run in the Lead session only and make no model call. See [Switchboard](../mods/switchboard.md) and [Savings](../mods/savings.md).
- **Where the text goes.** The Lead Handoff is a local file. The Claude model you configured reads it, like the rest of the Lead's work. Nothing is pushed or published. See [Where your words go](../concepts/where-your-words-go.md).
- **More.** [Lead hand-over](../concepts/lead-handover.md), [Context budget](../concepts/context-budget.md) and [Guards](../concepts/guards.md).
