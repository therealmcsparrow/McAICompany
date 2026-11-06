# `/aico:setup`

`/aico:setup [core] [research] [go] [react] [tanstack] [auth] [type]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Installs the standalone skills the Roles rely on (no arguments → the `core` group), or adds optional stack skill groups. The `core` group includes `research` (`find-skills`, used for guidance only). It also sets your project's [company type](../concepts/company-types.md) and can search for skills that fit it.

**When to use it.** Once after installing the plugin, and again whenever you start working in a stack whose skills you haven't added yet. Use `type` to set the company type on its own.

**Help:** `/aico:setup help` (or `--help`) explains the command without running it.

## How it works
1. **Retired skills.** If a skill aico no longer uses is installed, setup asks Remove or Keep for each one, after showing the exact command. Setup sets `DO_NOT_TRACK` and `DISABLE_TELEMETRY` for the removal, so the skills CLI sends no report. Its code makes no other request; npx still fetches the pinned package from the npm registry when it is not cached. It runs from your home folder, not the product folder, and fails with a `FAILED ... timed out` line if it takes over two minutes; the removal may still finish after that. Keep, no answer, or a run with nobody to ask removes nothing. After Remove, setup says "removed" only when the removal is confirmed; otherwise it says the skill is still installed and shows the line. With only `type` as the argument, this step is skipped.
2. It shows you the install commands first (they download third-party code) and asks once to approve; on approval it installs, then tells you to reload so the new skills appear. Setup tells you which servers the skills CLI still contacts (telemetry is off, but GitHub, skills.sh, the npm registry and, for one source, zapier.com are not), and that a set `GITHUB_TOKEN`, `GH_TOKEN` or your `gh` login may be used after a GitHub rate limit. The pinned CLI is fetched by npm into `~/.mcsparrow/cli` with install scripts off and run by node from that path, not through npx, so a hostile repo's `.npmrc` or `node_modules/.bin` programs do not run (tested for those cases, not for every file a repo could hold). If that file is missing, the install shows FAILED. A command from the manifest (the `impeccable` install, pinned to 4.8.0) is never run, at any scope: it is third-party code aico has not inspected. Setup prints `manual <command>` and a warning (yellow on a terminal) with the exact command, and you run it yourself, only in a repo you trust. With only `type` as the argument, this step is skipped.
3. **Company type** (with `type`, or with no arguments at all). If `.company/project.md` does not exist yet, the project profile form runs first. If the type is already set, setup says so and never switches it. Otherwise a form asks "What kind of company is this project?" with the four types: software company, research consultancy, marketing and content agency, and design studio. Each option shows what "ship" means for that type, taken from the plain `list` lines of the plugin's `company-type.mjs` script (one line per type: `<id>: <label>. Ship means: …`). Nothing is preselected and nothing is written until you pick one. Cancel or no answer leaves the project a software company. The choice is saved as `company_type:` in `.company/project.md`, and switching afterwards is not supported.
4. **Skill search.** One question: Search or Skip. Search follows the [skill picks](../concepts/research-and-skills.md) steps for the area `company-type`, with the `skill search hints:` line of your type, and asks for at most 5 picks. Every pick is scanned before you see it, you approve the set, and a second form shows the exact install commands. Nothing installs without your answer.

## Technical details
**You get.** The standalone and stack skills available to the Roles, the company type in your project profile, and, if you approved any, recorded skill picks.

No setup is needed for the Lead hand-over; see [No setup needed](../start/setup.md).

**Example.** `/aico:setup go react` · `/aico:setup type`
