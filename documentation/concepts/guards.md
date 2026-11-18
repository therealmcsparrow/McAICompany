# Guards

## In short
A guard is a check that runs before a tool call and can refuse it. aico has four: `cap`, `dotenv`, `model-floor` and `self-protect`. They work in the background while a run is active, and a Role that is refused sees only a short reason. You cannot switch an individual guard off. You can stand all of them down in the main and Lead sessions with `AICO_GUARDS=off`.

Guards stop accidents, not a determined attacker. They block common mistakes, such as touching a `.env` file. They do not stop someone who crafts a command to get around them. Known gaps are tracked as Debt.

## How it works
1. A Role or the Lead calls a tool, such as writing a file or running a command.
2. The guards check the call before it runs.
3. If a guard refuses, the tool does not run and the Role sees the reason. The first refusal of each guard shows you one note; later ones are only counted.
4. The last refusals show on the `/aico-mods` pane under RECENT DENIES.

## Technical details

### The four guards
| Guard | What it refuses |
|---|---|
| `cap` (`cap.M1`) | Tools past the freeze point, 162000 tokens at the default cap of 180000. A Step may then only write its Handoff and one findings ledger. The Lead ends with `STATUS: handover` at 162000 and every tool is refused at 180000. Main is never capped, but in a run it may start only the Lead, and a Role may never start one. See [Context budget](context-budget.md). |
| `.env` (`dotenv.M-SEC1`) | Tool calls that touch `.env` and `.env.<x>`, except `.env.example`, `.env.sample` and `.env.template`. A shell command is checked for `.env` only. |
| `model floor` (`model-floor.M1`) | A Role dispatched on a model below its floor. A dispatch with no model passes, and the Role's own file applies. |
| `self-protect` (`self-protect.M-SEC1`) | Writes to aico's own settings, hooks and pins by a file tool, and writes to the run records (`guard.jsonl`, `forms.jsonl`, `run-state.jsonl`) by a file tool or a shell command. It is hygiene against a model that follows the rules, not a sandbox. |

Shell commands are checked only for `.env` and for writes to run records (ADR 0079). Any other shell command passes. A command with a target the guard cannot resolve passes too, unless it also names a run-record path. A command over 200000 characters is refused.

Each guard is a pair of words: the guard name and a rule ID, so a ruleset can name it.

### When a guard cannot decide
Guards fail closed. In an active run, a guard that errors, times out or cannot read the transcript refuses with `<rule ID>: <reason>`. With no active run, the `cap` guard passes. A Step that has no usage row yet counts as 0 tokens and passes.

### The off switch
`AICO_GUARDS=off` is set by you in the environment when you launch Claude Code. It stands the guards down in the main and Lead sessions only. A Step session ignores it and is always guarded, even when launched from a Lead with the switch on. Two checks stay on: the refusal of a form pre-filled with answers, and the refusal of writes to run records. A Role still may not start a Lead. Spelling matters: only `off` works. See [No setup needed](../start/setup.md).

### Where refusals are recorded
The engine appends every refusal to a deny log under `MCSPARROW_HOME`, at most 1000 lines. The guard record for a run is `.company/work/<slug>/guard.jsonl`. A deny-log row holds the rule ID, the kind, the time and the session, not the text of your files.

### Savers are not guards
A saver, such as the Cache clock or the Browser screenshot note, only shows a note to you. It never refuses a tool. See [Mods](../mods/README.md) and [Switchboard](../mods/switchboard.md).

Contracts: `context-guard` v3.0, `mod-hook` v1.2, `hook-event` v1.4, `mod-manifest` v1.1.
