# `/aico:dashboard`

`/aico:dashboard [help] [--lan] [--port <1024-65535>]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Starts a read-only local dashboard: a board with one card per run, in columns from Brief to Done, and a drawer per run with its Steps, Gates, review verdicts and token use.

**When to use it.** You want to see where every run stands without reading Handoff files.

**Help:** `/aico:dashboard help` explains the command without starting anything.

## How it works
One local server, no Roles, no Gates, no branch or commit. It reads run data and never writes it.
1. The server starts in the background and prints a link such as `aico dashboard: http://127.0.0.1:<port>/t/<token>/`. Open that full link in your browser.
2. The board refreshes by itself. A change to the active run shows within 5 seconds; any other change, including a new run, within 35 seconds. "Pause updates" stops the refreshing until you press it again.
3. Stop the server by stopping the background task. It also ends itself after 60 idle minutes. Then the page says: `Dashboard server stopped. Run /aico:dashboard for a new link.`

**Options.**
- **Start:** `/aico:dashboard`. The server listens on this computer only (127.0.0.1). The port is chosen by the system; `--port <1024-65535>` pins one.
- **Stop:** stop the background task, or let the idle timeout end it.
- **`--lan`:** also listens on every network interface (IPv4), so another device can open the link. The server prints this warning and the page shows a banner:
  - CLI: `WARNING: LAN mode has no login beyond this link. Anyone on your network who gets the link can read these runs, including names in Handoffs. The link travels unencrypted. Stop the server to end access.`
  - Page: `LAN mode is on. Anyone on your network who has this link can read these runs, including names in Handoffs. Stop the server to end access.`

## Technical details
**Each start makes a new link.** The token in the link is random, held only in server memory, and checked on every request. A link from an earlier start never works again.

**Residuals.**
- With `--lan` the link is plain HTTP; anyone on the network who sees the traffic can read it.
- The link is in your session transcript.
- Anyone who has the link can read the runs, including names in Handoffs, until the server stops.

**Where data goes.** Without `--lan`, nothing leaves your computer except the pull request and issue links in a run's drawer, which call github.com through the `gh` tool when you open the drawer. With `--lan`, run data is readable on your local network. The server stores no run or PR data on disk.

**Token use.** The card shows tokens ("tokens, not cost"), not money. Dollars appear only where a cost source has them.

**Page texts.** `Updates paused`, `Updates resumed`, and the stopped text above are fixed.

**Launch command** (the skill runs it): `node --disable-proto=delete "<plugin root>/scripts/dashboard-server.mjs" serve [--lan] [--port <n>]`.

**You get.** The full link in the terminal, and a read-only board in your browser.

**Example.** `/aico:dashboard --lan`
