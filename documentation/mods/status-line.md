# The status line

## In short
The four mods share one line of text at the bottom of Claude Code. It shows only what has something to say: version, run progress, a commit warning, cache cost and waiting Lessons.

## How it works
1. Claude Code prints `⚠ aico: ` first. The mods add the text after it.
2. Each mod contributes one short part, in a fixed order, and only when it has something to say.
3. If the line gets too long, the last parts are lost first.
4. For more detail, open the mod's pane.

## Technical details
The four mods share one status line. They cannot overwrite each other. Claude Code prints `⚠ aico: ` before it, and the mods supply only the text after that. The text is in compact form:

```
v<version> · <savvy> · <blast> · <cost> · <reflect>
```

Only the parts that have something to say appear, always in this order:

1. `version`: the plugin version, for example `v0.20.0`, read from the plugin's own `plugin.json`. It is left out when that file cannot be read. It is the last part to go when the line gets too long.
2. `savvy`: `W<wave> S<step> <role> <elapsed>`, for example `W3 S12 ba-eng 14m`. The role is cut to two letters per leading word and three for the last. After the run ends it reads `ended <outcome> <elapsed>`. Elapsed time is in whole minutes. An unknown field shows `?`.
3. `blast`: `⚠ <category>` for 60 seconds after a warning. Before a code review it reads `rev <depth>`.
4. `cost`: `<n> tax <m>m`, for example `12.4k tax 60m`. `n` is the run's cache write count. The clock shows `exp` when the cache has expired and `?` when unknown.
5. `reflect`: `<n> lessons` (`1 lesson`), the suggestions waiting for you.

Each part has a fixed width, so the text is at most 70 cells (version 8, Savvy 17, Blast Radius 10, Cache Tax 13, Reflect 10). With the host's `⚠ aico: ` in front, the line fits one 80-column terminal row. If the host still cuts it, the last parts are lost first.

The compact form leaves out the slug, Fix round, Gates, Names, spend, exact counts, expiry time and blast paths. Those are in the panes. Where a pane does not open on its own (under 110 columns, or `claude -p`), the status line is all you see of that mod.

Back to [Mods](README.md).
