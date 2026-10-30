# Lead hand-over

## In short
The Lead can run out of room, just like any Role. When Claude Code is about to compact its session, aico writes a Lead Handoff file and loads it into the continued session. You type nothing. It needs a one-time setup.

## How it works
1. Do the [one-time setup](../start/setup.md) once.
2. When Claude Code is about to compact the Lead's session, a hook writes the Lead Handoff at a clean point.
3. If a Step is running, the compaction is retried at the next turn.
4. The next session starts with that file, and an open Gate or form is shown again.

## Technical details
The Lead hands over without you typing anything. When Claude Code is about to compact the Lead's session, a `PreCompact` hook writes a Lead Handoff, `.company/work/<slug>/lead-handoff-<n>.md`, from the run's record files, at a clean point (no Step running). If a Step is running, the compaction is retried at the next turn. A `SessionStart` hook for the `compact` source then puts that file into the context that continues. Records beat the summary: an open Gate or form is shown again. A hand-over never writes a Lead Handoff by hand and never asks you to clear or resume.

This needs a [one-time setup](../start/setup.md). Without it, the Lead hands over only at Claude Code's default compaction point. The Ship Gate summary has a line `lead hand-overs: <n> (hook <a>, ceo <b>)`.

The hooks read token counts from the local Claude Code transcript and store none of its text. See [Where your words go](where-your-words-go.md).
