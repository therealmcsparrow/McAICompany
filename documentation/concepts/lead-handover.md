# Lead hand-over

## In short
The Lead can run out of room, just like any Role. At the run's hand-over point (162000 tokens at the default cap of 180000) aico writes a Lead Handoff file and freezes that session. You start a new session with one command, and it continues from the file. No setup is needed.

## How it works
1. At the hand-over point, at a clean point, a hook writes the Lead Handoff.
2. If a Step is running, no new Step starts; the Handoff is written after it ends.
3. The frozen Lead calls `lead_new_session`. On Windows a helper types `/clear` and the resume prompt into the same console once the turn is over. Nothing to close. On macOS and Linux the tool answers `refused: unsupported terminal`, and the frozen Lead shows you the command from the freeze reason. The same command stands if typing fails on Windows. Run it in the product folder, then close the old session. The frozen Lead may also call `SendFeedback`; every other tool is refused.
4. The new session starts from that file, reading only a short resume page before its first Step so it keeps room to work, and an open Gate or form is shown again.

## Technical details
A hook writes a Lead Handoff, `.company/work/<slug>/lead-handoff-<n>.md`, from the run's record files, at a clean point (no Step running), then refuses every tool except `lead_new_session` and `SendFeedback` (`context-guard` v2.2). On Windows `lead_new_session` starts a helper that types into your console; on macOS and Linux it starts nothing and refuses with `refused: unsupported terminal`, and the command comes from the freeze reason (`lead-session-mcp` v2.1). Automatic compaction is blocked during a run; manual `/compact` still works. Records beat the summary: an open Gate or form is shown again. A hand-over never writes a Lead Handoff by hand and never asks you to clear or resume.

See [setup](../start/setup.md). The Ship Gate summary has a line `lead hand-overs: <n> (hook <a>, ceo <b>)`.
The hooks read token counts from the local Claude Code transcript and store none of its text. See [Where your words go](where-your-words-go.md).
