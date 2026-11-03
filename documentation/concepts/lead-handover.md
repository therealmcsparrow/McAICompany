# Lead hand-over

## In short
The Lead can run out of room, just like any Role. At 85500 tokens aico writes a Lead Handoff file and freezes that session. You start a new session with one command, and it continues from the file. No setup is needed.

## How it works
1. At 85500 tokens, at a clean point, a hook writes the Lead Handoff.
2. If a Step is running, no new Step starts; the Handoff is written after it ends.
3. The frozen Lead calls `lead_new_session` or shows you a command. Run it in the product folder, and close the old session.
4. The new session starts from that file, and an open Gate or form is shown again.

## Technical details
A hook writes a Lead Handoff, `.company/work/<slug>/lead-handoff-<n>.md`, from the run's record files, at a clean point (no Step running), then refuses every tool except `lead_new_session`, which only returns the command. Automatic compaction is blocked during a run; manual `/compact` still works. Records beat the summary: an open Gate or form is shown again. A hand-over never writes a Lead Handoff by hand and never asks you to clear or resume.

See [setup](../start/setup.md). The Ship Gate summary has a line `lead hand-overs: <n> (hook <a>, ceo <b>)`.
The hooks read token counts from the local Claude Code transcript and store none of its text. See [Where your words go](where-your-words-go.md).
