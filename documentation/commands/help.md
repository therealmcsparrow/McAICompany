# `/aico:help`

`/aico:help [command]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Without a command, lists every command with one line each. With one, explains it: usage, every option and its effect (and the default when you leave it out), what it does, what you get, an example. A Playbook's own `/aico:<command> help` or `--help` answers from the same page in this folder.

**When to use it.** Before running a command you haven't used, or to check an option.

## How it works
Read-only, starts nothing, no Gates.
1. Reads the command guide in this folder and the command's own definition.
2. Prints a short explanation in the terminal.

## Technical details
**You get.** A short explanation in the terminal. The list shows only the commands of your [company type](../concepts/company-types.md).

**Example.** `/aico:help pentest` · `/aico:cooler help` · `/aico:help dashboard` (the read-only board of your runs; see [dashboard](dashboard.md))
