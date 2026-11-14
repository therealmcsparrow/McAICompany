# `/aico:settings`

`/aico:settings [help]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Opens a local settings page in your browser, where you change how the company works without editing files by hand.

**When to use it.** You want to change how the company works without editing files by hand: a different model for a Role, auto instead of ask on a Gate, a project-specific override.

**Help:** `/aico:settings help` explains the command without running it.

## How it works
One local server, no Roles, no Gates, no branch or commit.
1. The page opens in your browser by itself. It is reachable only through the link with its token, which is printed in the terminal.
2. Change what you want. Changes are saved to the level you chose, your user default or the project override.
3. Press Done. The server also stops after 30 minutes idle. Changes apply from the next aico run.

## Technical details
**What the page covers.** Role name, model and effort; the skills each Role gets (Skills tab, at most 5 per Role, chosen from your skill list; a sixth pick is refused with "Limit reached: a Role can have 5 skills. Clear one first."; each skill shows its install status, license and vetted text, and an installer command shows as `command (manual)`, never run); language and profile; the pipeline (Fix-round limit, reprompt Question rounds (0 to 3, default 1), the [Plan check](../concepts/plans.md) policy (`plan_check.policy`: `off`, `warn` or `block`, default `warn`) and Verdict runs (`plan_check.runs`, 3 to 50, default 5), parallel or sequential, Parallel cap (`pipeline.parallel_cap`, 3 to 5, default 4: at most that many Steps run at once; ignored when Dispatch is sequential; see [Parallel Steps](../concepts/parallel-steps.md)), Short path (`pipeline.short_path`, `on` or `off`, default `on`: a low-risk feature where you pick "Short path" on the short-path form, or a fix triaged as low risk while the Brief Gate setting is `ask`, skips some review lanes; every Gate and test stays; a project can only turn it off; see [Short path](../concepts/risk-tier.md)), max context, review format (`plain` or `pilot`, default `plain`), optional lanes, brainstorm debate style and film script); Gates (ask or auto); and each Role's [personality](../concepts/personalities.md) on the Personality tab, with a filter for Roles. Locked Gates (Ship, installs, security lanes) can only be unlocked from user settings. See [Settings and locks](../concepts/settings-and-locks.md).

**Two levels.** Your user default (`config.json` under `~/.mcsparrow/`, or the folder in `MCSPARROW_HOME`) and a project override (`.company/settings.json`, with the profile in `.company/project.md`). The project wins.

**Max context** (`pipeline.context_cap`, shown as `context_cap`): how much text a Role may hold at once, a whole number from 60000 to 1000000, default 180000. Roles hand over at 90% of it, 162000 at the default. A project value wins over your user value. The value is frozen at the start of a run, so a change applies from the next run, not the one in progress. A stored value now takes effect.

**You get.** The full link to the page in the terminal, and the settings saved to the level you chose.

**Example.** `/aico:settings`
