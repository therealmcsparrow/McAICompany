# Reflect

## In short
Reflect looks at each finished Step and suggests what to remember, as short Lessons. You accept or decline each one. Nothing is saved unless you accept.

## How it works
1. Reflect starts at the first Step the run dispatches. If you resume a run, it stays idle until the next Step is dispatched.
2. For each new or changed Step file it writes a short check: what was done, what went wrong, what to remember.
3. It may suggest up to three Lessons. Each has its own Accept and Decline buttons.
4. Accept writes that one line to `.company/lessons.md`. Decline, no answer, or ending the session writes nothing.
5. When the run ends, a retrospective shows the top costs and times, what caused Fix rounds, and suggested Lessons.

## Technical details
Settings: `mods.reflect.enabled`, `mods.reflect.step_check`, `mods.reflect.retrospective`, `mods.reflect.mode` (`deterministic` or `model`). `model` mode is user-level only; see [Locks](README.md#locks).

Reflect looks at each finished Step and suggests what to remember.

- **Step check.** For each new or changed Step file, it writes at most five lines: what was done, what went wrong, what to remember, and up to three suggested Lessons. The lines go to a notice in the transcript (which the model never reads) and to the `aico-reflect` pane.
- **Retrospective.** When the run ends, it shows the top three costs and the top three times, what caused Fix rounds, and suggested Lessons.
- **Lessons.** Each suggestion is labelled `suggested` and has its own Accept and Decline buttons. Accept writes that one line to `.company/lessons.md`. Lesson text may hold only letters, digits, spaces and these marks: `. , ; : ! ? ' " ( ) - _ / %`. It cannot start with `-`. A suggestion with any other character, such as `$` or a backtick, is dropped. Decline, no answer, or ending the session writes nothing.
- **When it starts.** Reflect starts at the first Step the run dispatches, not at session start. If you resume a run, it stays idle until the next Step is dispatched.
- **Never in the way.** No hook waits for Reflect. It does not edit Handoffs, block a Step or delay a dispatch.

By default it works from fixed rules and spends no tokens (`mode: deterministic`). With `mode: model` it makes one model call per check, on your session's model, using at most 16 KiB of that Handoff. That call is real spend, so it is off by default. Its tokens are written to the ledger as `reflect` rows.

Back to [Mods](README.md).
