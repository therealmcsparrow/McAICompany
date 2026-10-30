# `/aico:triage`

`/aico:triage <request>`

## In short
**What it does.** A fast pre-router that builds nothing. It classifies a request by **size** (XS → L), **risk tier** (low/medium/high) and **type**, then recommends the *shortest valid route* and the Gates that route keeps — so a one-line change doesn't pay the ceremony of a full feature.

**When to use it.** When you can't tell how big or risky a request is, or want to avoid over-processing a trivial change. [`/aico:lead`](lead.md) can run it for you.

**Help:** `/aico:triage help` (or `--help`) explains the command without running it.

## How it works
1. Reads `.company/project.md` and your request; classifies size, risk and type.
2. Recommends the shortest route that the risk still allows. **Risk overrides size:** anything touching auth, payments, personal data, migrations or a Contract keeps the full reviewer lane and every Gate, however small.
3. Presents size + risk + type + route. **→ Brief Gate** (Approve / Change / Stop). On approve, the chosen command starts by itself with your request plus a short triage note (size, risk, type, route). That run is not triaged again and keeps at least that risk tier.

## Technical details
**Triage record.** Before a direct route starts, triage writes a short-lived triage record: a keyed hash of your exact request (HMAC, keyed by a one-time code; one pair of outer quotes around the request is ignored), kept in a gitignored `.company/triage/` folder, valid 30 minutes and for one use. `/aico:lead` checks the code from triage's own run once and never runs `triage issue` itself. Files with more than one hard link are refused. Only the direct route is recorded, so only a direct triage line can be trusted.

**Low-risk bug.** The one other recorded line is a bug at risk low routed to `/aico:fix` (`route fix`, size XS, S or M): triage records it the same way, and [`/aico:fix`](fix.md) checks it. A fix starts low only when that check passes; it takes the [short path](../concepts/risk-tier.md) only when that check passes and the Brief Gate setting is `ask`. Without the check the fix starts at medium. `/aico:lead` still trusts only a direct line. For such a bug the Brief Gate form notes that the short path skips the security lane.

**Lines you type.** A triage line you type or paste, or one copied from a file or another run, does not count: `/aico:lead` sends that request to triage again. A one-line, low-risk change goes to `/aico:lead`, which checks it really is that small, then runs one builder and one reviewer and keeps the Ship Gate. The same applies when `/aico:lead` started the triage. If the command cannot be started, you are shown it to type.

**You get.** A one-line recommendation; the risk tier then travels into every dispatch of the real run.

**Example.** `/aico:triage change the footer copyright year to be dynamic`
