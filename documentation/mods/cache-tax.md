# Cache Tax

## In short
Cache Tax shows what a run spends, Step by Step. It also shows a clock for the Lead's cache: Claude Code keeps a cache of the Lead's conversation so the next turn is cheaper to read, and the clock tells you when that cache runs out.

## How it works
1. Open the pane with the `aico-cost` command (`pane: command` is the default).
2. The pane lists each Step with its tokens in, cache write, out, cache read and spend.
3. Cache writes are marked `[tax]`, and the total shows what share of spend they are.
4. A subagent that has started but has no ledger row yet shows `running`.
5. Read the cache clock at the bottom to see when the Lead's cache expires. Cache Tax only tells you the time; what you do with it is up to you.

## Technical details
Switch it on or off with `mods.cache_tax.enabled`, and choose how the pane opens with `mods.cache_tax.pane` (`auto` or `command`, default `command`). See [Mods](README.md#settings).

Shows what the run spends per Step: tokens in, cache write, out, cache read and spend, taken from the [token ledger](../concepts/token-cost.md). Cache writes are marked `[tax]`, and the total shows what share of spend they are. A subagent that has started but has no ledger row yet shows `running`.

Open it with the `aico-cost` command (`pane: command` is the default).

It also shows the **cache clock**, described next.

### The cache clock

Claude Code keeps a cache of the Lead's conversation so the next turn costs less to read. While the cache is alive, a turn reads it cheaply. After it expires, the next turn has to write it again, which costs more. The cache clock, part of Cache Tax, shows when that happens.

It reads one of three ways:

- `Lead cache: expires 14:32 (in 41 min)`
- `Lead cache: expired 14:32; the next turn rewrites it`
- `Lead cache: unknown`, when the mod has not seen a Lead request in this session yet (for example when it loaded mid-session)

The expiry is the time of the Lead's last request plus the cache lifetime. Every new Lead request restarts it.

The lifetime is read from the Lead's own transcript, so the clock follows the cache you actually have:

- `Lifetime: 1 h (measured)`: the Lead's cache lasts one hour (what we measured on Claude Code 2.1.310). The clock adds 60 minutes. Output is the same as before this change.
- `Lifetime: 5 min (measured)`: your Lead's cache lasts five minutes. The clock adds 5 minutes.
- `Lifetime: 1 h (assumed)`: the lifetime could not be read, so the clock falls back to 60 minutes. Treat the expiry as a guess.

The reading is taken while a run is active. Outside a run nothing is read, so the pane shows `1 h (assumed)` even if your cache lasts one hour. Below the lifetime line, the pane always says: `Subagent caches last 5 minutes; nothing keeps them warm.`

### Why there is no keep-warm

We first planned a feature that would keep the Lead's cache alive by sending a background request. We tested it (spike SP-M3) and found no sign that it works: a forked request sent 55 minutes in did not read the Lead's cached conversation, and the Lead's next real request at 66 minutes read only the small fixed prefix. Spending tokens on something that does not hold the cache would cost money and save none. So the feature was cut. Cache Tax never forks, pings or calls a model; it only tells you the time, and what you do with it is up to you.

Back to [Mods](README.md).
