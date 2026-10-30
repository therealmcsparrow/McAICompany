# `/aico:version`

`/aico:version`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Shows which version of the plugin is installed, the date and one-line summary of its latest changelog entry, and where the plugin lives on disk.

**When to use it.** To check whether an update landed (after `/plugin marketplace update aico`), or when reporting a problem.

**Help:** `/aico:version help` (or `--help`) explains the command without running it.

## How it works
Read-only, no Gates.
1. Reads the plugin's own `plugin.json` and `CHANGELOG.md`.
2. Prints the answer in the terminal.

## Technical details
**You get.** A two- or three-line answer, e.g. `aico 0.7.4`.

**Example.** `/aico:version`
