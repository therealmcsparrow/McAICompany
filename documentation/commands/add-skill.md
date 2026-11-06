# `/aico:add-skill`

`/aico:add-skill [help]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Adds a third-party skill to your own skill list, `~/.mcsparrow/3rdpartyskills.json`, in a few form questions. Nothing is installed or run.

**When to use it.** You found a skill that aico does not list and want to select it for a Role in the settings page, Skills tab.

**Help:** `/aico:add-skill help` explains the command without running it.

## How it works
No Roles, Gates, branch or commit. One question at a time, each with Cancel.
1. Name: lowercase letters, digits and `-`, starting with a letter or digit, at most 64.
2. Repo (`owner/name`) or an installer command, one of the two.
3. Category, one of seven.
4. Commit, for a repo: exactly 40 lowercase hex characters.
5. License: you state it, nothing checks it.
6. A preview, then Save or Cancel. Cancel, or any refusal, writes nothing.

## Technical details
**Where answers go.** Your answers reach the script as one line of JSON on stdin, never on a command line, so text such as `$(...)` stays plain text. `role-skills add` checks each field, names the field and reason on a refusal and never echoes the value.

**A command is text.** A stored installer command is saved and shown. aico never runs it and never scans it; the skill shows as not vetted.

**The scan.** A repo entry is scanned at install, when its files go to SkillSpector on this machine. It shows as vetted only after a clean scan.

**A name in your list at another commit.** You pick Keep, Move or Cancel. Move changes the commit and license, clears the stored hash and vetted date, and keeps the category and selections. Other products read `folder not recognized` until reinstalled.

**With `MCSPARROW_HOME` set elsewhere** the command prints a warning and stops before the first question.

**You get.** One new entry in your skill list, ready to select for Roles in aico settings.

**Example.** `/aico:add-skill`
