# Context budget

## In short
A Role can only hold so much in its head before it gets sloppy. aico gives every Role the same limit. A Role that gets close stops at a clean point and passes the rest to a fresh Role of the same kind. That is not a failure.

## How it works
1. The Lead puts the limit in every dispatch.
2. A Role that gets close to the handover point finishes a clean piece of work (tests green, nothing half-edited).
3. It writes its Handoff with `status: handover` and lists what is left.
4. The Lead starts a fresh Step of the same Role to carry on.

## Technical details
One cap applies to every Role and every risk tier in a run: **180000 tokens** of context by default, with a hand-over at 90% of it, **162000**. Set it with `pipeline.context_cap` (60000 to 250000); only your user level sets it, and a project value is ignored. aico reads the cap from a snapshot taken when each Step starts, so a change applies from the next Step. Every dispatch carries the cap line, `Context cap: 180000 handover 162000` at the default. The cap is one of five guards (cap, git add, .env, model floor, self-protect) that check every tool call; see [Guards](guards.md). A stored `roles.<role>.context_cap` is validated but has no effect. The Lead has a cap too, and it hands over without you: see [Lead hand-over](lead-handover.md). Long contexts get sloppy and compaction drops detail, so a Role that gets close stops at a clean point (tests green, nothing half-edited) and writes its Handoff with `status: handover`, listing exactly what's left under `## Next`. The Lead then dispatches a fresh Step of the same Role to carry on from there. A handover isn't a failure and doesn't use up a Fix round. A handover opens no form for you and the old Step is never resumed.

You can lower or raise the cap on the settings page. The model does not enforce it; the Lead passes it in each dispatch and a hook stops a Role at the hand-over point.
