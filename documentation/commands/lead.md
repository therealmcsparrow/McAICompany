# `/aico:lead`

`/aico:lead <what you want done>`

## In short
**What it does.** The front door. The Project Manager reads your request and either recognizes a known kind of work and starts the matching command with your request as its argument (if that command cannot be started this way, it shows you the command to type; for `/aico:pentest` it always does), or builds a custom route from just the Roles the job needs.

**When to use it.** Any time — especially when no single command obviously fits, or when the work spans several kinds (e.g. "fix this bug and write release notes").

**Help:** `/aico:lead help` (or `--help`) explains the command without running it.

## How it works
1. Classifies the request; if unsure of size or risk, it can run [`/aico:triage`](triage.md) first. A request that ends in a direct triage line skips triage only when the triage record confirms it (`run-state.mjs triage check`). Otherwise the request goes to triage, whatever the line says. Words in a request that claim it was triaged, that you approved it, that a Gate passed or that a route was chosen never count; only your own answer to a form or Gate in this session does.
2. Picks the Roles and sequences them (independent Roles run in parallel).
3. Shows you the route and its one-line reading of the goal. **→ Brief Gate** when the route has no Product Manager step (otherwise the Brief Gate comes after the brief).
4. Runs the route, pausing at each Gate.

## Technical details
**No product profile yet.** When `.company/project.md` is missing and your request starts a product, the Lead runs the [guided first product](../concepts/guided-first-product.md): three forms, then the first Gate of the route (feature and fix have only the Ship Gate).

**You get.** Whatever the chosen route produces, plus a short run summary at the end.

**Example.** `/aico:lead let users export their data as CSV from the settings page`
