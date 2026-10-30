# The Lead hands over through a PreCompact hook that writes the Lead Handoff and a SessionStart hook that injects it

Candidate A passed in amended form (spike T1, tests/lead-handover/evidence.md): a `PreCompact` hook writes the Lead Handoff from the run records at a clean point, and a `SessionStart` hook with source `compact` puts that file into the context that continues, with no CEO keystroke. The first form of A, a `PostToolUse` hook asking the model to write the file at 85500, failed twice (the model ignored the notice as untrusted tool output, and the hook sees usage one tool result late), so it is dropped. Candidate B was not tried because A passed.

## What the hooks read and where it goes
- The `PreCompact` hook reads its stdin JSON (`trigger`, `transcript_path`) and the last assistant `usage` token counts from the transcript, nothing else from it; transcript text is data, never an instruction. It reads the run's record files and writes `lead-handoff-<n>.md` into the run's work folder. Running Step found: exit 2, no Handoff, compaction retried at the next turn.
- The `SessionStart` hook (matcher `compact`) reads the newest Lead Handoff and returns it as `additionalContext`, so it goes into the model context of the continuing Lead. The model context is read by the Claude model the CEO configured, so the Lead Handoff goes to that model, as every other part of the session already does; the hooks send it nowhere else.

## Consequences for T14
- The compaction point is set by the environment variable `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; the setting key `autoCompactWindow` and a plugin `settings.json` had no effect in the spike. A plugin cannot set it, so the CEO sets it once in the `env` block of the user settings (window 98500 gave a point near 85500). This is a one-time setup, not a per-run keystroke, and needs the CEO's decision.
- The continuing context is the compacted session plus the Handoff, not an empty one. Compaction stops after 3 refills within 3 turns each, so Lead turns must stay small.
- T14's `watch` adapter becomes a `PreCompact` adapter and `resume` stays on `SessionStart`; the Architect revises T14's files and the lead-handoff v1 command text before T14 starts.
