# Settings and locks

## In short
`/aico:settings` opens a page in your browser where you change how the company works. Each setting has a plugin default, your own default and a project override. A few settings could skip a safety check, so they start locked and only you can unlock them.

## How it works
1. Run `/aico:settings`. A page opens on your own machine behind a one-time link.
2. Change what you want on the tabs and press Save. A refused Save changes nothing and links to each problem.
3. Press Done, or wait 30 minutes and the page closes by itself.
4. The changes apply from the next aico run.
5. To unlock a locked setting, use the warning on the settings page. **→ Ship Gate** An auto Ship Gate stays locked until you do.

## Technical details
### Settings
[`/aico:settings`](../commands/settings.md) opens a page in your browser where you change how the company works. It has seven tabs, in this order. Messages ("Saved.", or a refused Save) show at the top, under the page header, so you see them on every tab.

- **Roles** — name, model and effort for each Role, with a bulk change per department. Every field has a visible label.
- **Personality** — one collapsible card per Role, grouped by department, with a User and a Project group of fields. Each group names its Role and level, for example "Ava (architect), User level". The fields are three text boxes with an "n of 80 characters" counter, and two lists for Intelligence and Creativity. Under each list you see what the Role is told for the level you pick. A blank box means "not set at this level". Above the cards, **Filter Roles** narrows them by name, Role or department, and a line says "Showing n of N Roles". The filter only hides cards: hidden cards are still saved, and the filter text is never saved. A refused Save puts "Nothing was saved. Fix n field(s):" at the top, with one link per problem. A link opens the right tab and card and puts focus on the field. Nothing is saved from a refused Save.
- **Language & profile** — the aico language and the `.company/project.md` profile fields.
- **Pipeline** — the user-level rows Second reviewer (`pipeline.second_reviewer`, `off` or `on`, default `off`), Second reviewer model (`pipeline.second_reviewer_model`, `default` or a model at or above the Code Reviewer's floor) and Worktrees (`pipeline.worktrees`, `off` or `on`, default `off`), which a project file cannot set (see [The fresh reviewer](review.md#the-fresh-reviewer) and [Worktrees](parallel-steps.md#worktrees)), the Fix-round limit, the reprompt Question rounds (`reprompt.question_rounds`, 0 to 3, default 1), the Plan check table (`plan_check.policy`: `off`, `warn` or `block`, default `warn`; `plan_check.runs`: 3 to 50, default 5; neither is a lock), parallel or one-at-a-time dispatch, the max context (`context_cap`, deprecated: shown as the fixed value 95000, never read by the pipeline), the review format (`pipeline.review_format`, below), which optional review lanes run (security, compliance, legal, persona, hands-on and accessibility testing), and the brainstorm options: debate style (`brainstorm.debate`) and the film script (`brainstorm.film_script`).
- **Gates** — ask or auto for the Brief, Plan and Ship Gates and for installs.
- **Mods** — on or off and the options for the four [mods](../mods/README.md), including the Blast Radius commit gate.
- **Skill scan** — the SkillSpector scan mode (`skillspector.mode`: `no-llm` or `claude_cli`, default `no-llm`). `no-llm` sends no skill text anywhere, but dependency names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found. `claude_cli` also sends skill text to Anthropic and counts only from your user settings.

Each setting has three levels, shown side by side: the **plugin** default, your **user** default (`~/.mcsparrow/config.json`) and a **project** override (`.company/settings.json`; profile fields stay in `.company/project.md`). The project wins over the user, and the user wins over the plugin. Changes apply from the next aico run. With nothing set, aico behaves exactly as before.

`inherit` as a model means "use the model of the session you run aico in".

**Review format** (`pipeline.review_format`: `plain` or `pilot`, default `plain`). With `plain`, the Code Reviewer and the compliance pass write ordinary findings. With `pilot`, they also write the `aico-top` block, findings as `ID | file:line | problem | why | fix` rows, and a findings ledger when a review hands over; the Lead then checks those Handoffs with `--require-top`. It is not a lock. What we measured, counts only: in a first test (6 re-reviews each way), 4 of 6 pilot Handoffs failed the lint and 2 of 6 wrote a ledger on a finished review. Those were fixed and tested again (3 re-reviews each way, plus 3 forced handovers and a continuation). Both modes pass: with `pilot`, every Handoff passed the lint on the first try, and with `plain` there is no `aico-top` block and no findings ledger. The one part not exercised is appending to a findings ledger, because no new finding came up. `pilot` cost about 5.7k more tokens per re-review than `plain` (about 27.2k against 21.5k). So `pilot` is an opt-in that costs more and is not shown to save anything. Rule slices for builders and search-then-read stay on with either value.

The page runs only on your own machine (127.0.0.1) behind a one-time link, and closes when you press Done or after 30 minutes idle. At the start of every run the Lead tells you which project-level overrides are active, so a cloned or client repo can't quietly change how its Roles work.

### Locks
Some settings could skip a safety check, so they start **locked**: auto for the Ship Gate, auto for installs, and switching off the security or compliance review lanes. Two mod settings are locked the same way: Blast Radius `security: warn` and switching Blast Radius off (see [Mods](../mods/README.md#locks)). You unlock each one on the settings page behind a warning that says what will no longer ask you. Unlocks count **only from your user settings**: a project file can lock things again but never unlock them, so a repo you clone can't turn on auto-push or skip security review on your machine. If a project's settings file is broken, its locks hold anyway.
