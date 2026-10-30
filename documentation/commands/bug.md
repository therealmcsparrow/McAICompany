# `/aico:bug`

`/aico:bug <bug report | resume <slug>>`

## In short
**Help:** `/aico:bug help` (or `--help`) explains the command without running it.

**Only you start this command.** No other command or the Lead starts it. Software company only.

**What it does.** The same guided route as [`/aico:idea`](idea.md), for a bug report. Its build step is always [`/aico:fix`](fix.md). A report that asks for a feature, or says it is not a bug, changes nothing.

**When to use it.** You have a bug report and want questions, a route and approved tickets before the fix.

## How it works
1. As in `/aico:idea`: capture, grill choice, reprompt, routes A to E, ticket approval, then F, G or E.
2. F builds through `/aico:fix` on `.company/work/<slug>-build/plan.md`; the build step comes from the script's `build:` line, not from the report text.

## Technical details
**You get.** As in `/aico:idea`, ending in a fix with a regression test through the Ship Gate.

**Your data.** The same as `/aico:idea`; the report is saved as `idea.md` and a parked report is copied to `.company/ideas/<name>/`.

**Example.** `/aico:bug the export button does nothing on Safari`
