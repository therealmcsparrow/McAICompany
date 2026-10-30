# `/aico:language`

`/aico:language [<tag> [project] | clear [project]]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Shows or sets the language aico writes in: Handoff prose, forms, reports, Gate summaries and commit summaries. Machine-read parts stay English in every language: frontmatter, headings, status values, blocking tags, file names and commit types.

**When to use it.** You want the company to write in Dutch (`nl`) or another language. Product UI strings are a different setting: `languages:` in `.company/project.md`, handled by the Localizer.

**Help:** `/aico:language help` (or `--help`) explains the command without running it.

## How it works
One command, no Roles, no Gates, no branch or commit.
1. **No argument:** shows the effective language and where it comes from: `project`, `user` or `default`.
2. **`<tag>`:** sets your default for every product on this machine. The tag is a BCP 47 tag such as `nl` or `pt-BR`.
3. **`<tag> project`:** sets an override for this product only, as `aico_language:` in `.company/project.md`. Needs an existing `.company/project.md`.
4. **`clear`** or **`clear project`:** removes your default or the project override.

## Technical details
Effective language: the project override, else your default, else English. An unknown tag is refused with the reason, and no file changes. Your default is stored in `config.json` under `~/.mcsparrow/` (or the folder in `MCSPARROW_HOME`). It applies from the next aico run.

**You get.** One line in the terminal: the new effective language and where it is set.

**Example.** `/aico:language nl` · `/aico:language pt-BR project` · `/aico:language clear project`
