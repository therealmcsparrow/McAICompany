# Lead hand-over

## In short
The Lead can run out of room, just like any Role. At the run's hand-over point (162000 tokens at the default cap of 180000) aico writes a Lead Handoff file and the Lead ends with `STATUS: handover`. The main session then starts a fresh Lead from that file. There is one path and no command to type. No setup is needed.

## How it works
1. The Lead runs as the plugin agent `aico:project-manager`, started by your main session. Main is never capped: it only starts the Lead and relays its questions to you.
2. At the hand-over point, at a clean point, a hook writes the Lead Handoff. If a Step is running, no new Step starts; the Handoff is written after it ends.
3. The Lead ends its turn with `STATUS: handover` plus a `handoff:` line (the file) and a `next:` line (what comes next). The old Lead then stops. Every tool is refused for it, so it cannot do more work.
4. Main reads that status and starts a fresh Lead with `aico resume: <slug> (handover)`. The new Lead reads the Handoff file and the run records, not the old chat, so it keeps room to work.
5. Questions for you come back through main. The Lead has no question tool of its own: it opens a form, ends with `STATUS: needs-ceo`, and main shows you the form. Your pick is recorded by a hook from main's answer, and the next Lead reads it from the record. If you decline or interrupt, main starts no Lead and says `aico: run <slug> waits on form <id>; say resume to be asked again`. Say `resume` and you are asked again. A form with no recorded answer is always asked again.

## Technical details
A hook writes a Lead Handoff, `.company/work/<slug>/lead-handoff-<n>.md`, from the run's record files, at a clean point (no Step running). It then refuses every tool of that Lead (`context-guard` v3.0). The Lead returns one `STATUS` block as its last message; main reads only line 1 and its keys (`lead-relay` v1). Forms live in `.company/work/<slug>/forms.jsonl`. Only the hook writes an answer, from main's `AskUserQuestion` result; a call that arrives with answers already filled in is refused, so a model cannot answer for you. Free text you type is stored only in that file; logs and `lead-handover read` show its length and a short hash. A Gate passes only on a recorded answer of yours, and one answer passes one Gate once. Automatic compaction is blocked during a run; manual `/compact` still works. Records beat the summary: an open Gate or form is shown again. A hand-over never asks you to clear or resume, except after a declined form. A Lead that started a helper Lead gets the helper's status; only main asks you.

See [setup](../start/setup.md). The Ship Gate summary has a line `lead hand-overs: <n> (hook <a>, ceo <b>)`: hook counts cap hand-overs, ceo counts forms you were asked.
The hooks read token counts from the local Claude Code transcript and store none of its text. See [Where your words go](where-your-words-go.md).
