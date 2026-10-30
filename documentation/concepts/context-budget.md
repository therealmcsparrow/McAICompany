# Context budget

## In short
A Role can only hold so much in its head before it gets sloppy. aico gives every Role the same limit. A Role that gets close stops at a clean point and passes the rest to a fresh Role of the same kind. That is not a failure.

## How it works
1. The Lead puts the limit in every dispatch.
2. A Role that gets close to the handover point finishes a clean piece of work (tests green, nothing half-edited).
3. It writes its Handoff with `status: handover` and lists what is left.
4. The Lead starts a fresh Step of the same Role to carry on.

## Technical details
One cap applies to every Role and every risk tier: **95000 tokens** of context, with a hand-over at **85500**. Every dispatch carries the line `Context cap: 95000 handover 85500`. The older settings `context_cap` (global and per Role) are still accepted so old settings files keep working, but they have no effect. The Lead has a cap too, and it hands over without you: see [Lead hand-over](lead-handover.md). Long contexts get sloppy and compaction drops detail, so a Role that gets close stops at a clean point (tests green, nothing half-edited) and writes its Handoff with `status: handover`, listing exactly what's left under `## Next`. The Lead then dispatches a fresh Step of the same Role to carry on from there. A handover isn't a failure and doesn't use up a Fix round. A handover opens no form for you and the old Step is never resumed.

The settings page shows the fixed value as text; you cannot lower or raise it. The cap is a soft limit that the Lead passes in each dispatch; it is not enforced by the model.
