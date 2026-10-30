# Savvy

## In short
Savvy shows how the current run is going: which task, which Step, which Role, how many Gates passed and how long it has taken. When no run is active it shows nothing.

## How it works
1. A run starts. With `pane: auto` (the default), Savvy opens a pane on its own if your terminal can dock it as a sidebar.
2. While the run goes, the pane updates with the current Step and Role, and one line per running subagent.
3. When the run ends, Savvy keeps the final state, with outcome and total time, until the next run starts or the session ends.
4. To open it yourself, run the `aico-run` command.

## Technical details
Switch it on or off with `mods.savvy.enabled`, and choose how the pane opens with `mods.savvy.pane` (`auto` or `command`). See [Mods](README.md#settings).

Shows the progress of the current run: task, wave, current Step and Role (with its name), Gates passed, Fix round, elapsed time, and one line per running subagent. Two text bars sit under the elapsed time: `Gates 1/3 [###-----] last: brief` (Gates passed of three, and the latest one) and `Steps 5/8 [#####---]` (done Steps of those listed). The count comes first, then the bar. The bars use plain ASCII and shrink to fit the pane. With no Steps listed it shows `Steps 0/0` with no bar. A value Savvy cannot read shows `?` with no bar; a run that shipped shows both bars full; with the mod off there are no bars. The status line is unchanged. After the run ends it keeps the final state with outcome and total time until the next run starts or the session ends. With no active run it shows nothing.

Open it with the `aico-run` command. With `pane: auto` (the default) it opens on its own when a run starts, but only where it can dock as a sidebar: a terminal at least 110 columns wide. Below that, or under `claude -p`, nothing opens and the one-line summary is on the status line instead.

It follows [run-state](../../GLOSSARY.md), the small record the Lead writes of each run's wave, Gates and end.

Back to [Mods](README.md).
