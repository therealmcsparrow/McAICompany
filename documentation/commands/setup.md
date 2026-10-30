# `/aico:setup`

`/aico:setup [core] [research] [go] [react] [tanstack] [auth] [type]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Installs the standalone skills the Roles rely on (no arguments → the `core` group), or adds optional stack skill groups. The `core` group includes `research` (`find-skills`, used for guidance only). It also sets your project's [company type](../concepts/company-types.md) and can search for skills that fit it.

**When to use it.** Once after installing the plugin, and again whenever you start working in a stack whose skills you haven't added yet. Use `type` to set the company type on its own.

**Help:** `/aico:setup help` (or `--help`) explains the command without running it.

## How it works
1. It shows you the install commands first (they download third-party code) and asks once to approve; on approval it installs, then tells you to reload so the new skills appear. With only `type` as the argument, this step is skipped.
2. **Company type** (with `type`, or with no arguments at all). If `.company/project.md` does not exist yet, the project profile form runs first. If the type is already set, setup says so and never switches it. Otherwise a form asks "What kind of company is this project?" with the four types: software company, research consultancy, marketing and content agency, and design studio. Each option shows what "ship" means for that type, taken from the plain `list` lines of the plugin's `company-type.mjs` script (one line per type: `<id>: <label>. Ship means: …`). Nothing is preselected and nothing is written until you pick one. Cancel or no answer leaves the project a software company. The choice is saved as `company_type:` in `.company/project.md`, and switching afterwards is not supported.
3. **Skill search.** One question: Search or Skip. Search follows the [skill picks](../concepts/research-and-skills.md) steps for the area `company-type`, with the `skill search hints:` line of your type, and asks for at most 5 picks. Every pick is scanned before you see it, you approve the set, and a second form shows the exact install commands. Nothing installs without your answer.

## Technical details
**You get.** The standalone and stack skills available to the Roles, the company type in your project profile, and, if you approved any, recorded skill picks.

For the one-time Claude Code setting that goes with the Lead hand-over, see [One-time setup](../start/setup.md).

**Example.** `/aico:setup go react` · `/aico:setup type`
