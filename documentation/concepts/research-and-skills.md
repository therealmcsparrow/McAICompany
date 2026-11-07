# Research and skills

## In short
Before building, researchers can look a topic up online and the Product Manager writes one sourced report. Third-party skills are kept in a catalog, and the picks a researcher proposes are scanned before you see them. You pick up to 5 per Role. A skill installs only when you say yes in the Install form, unless you set installs to automatic in settings (`gates.installs: auto`), which answers Install for you.

## How it works
1. Run [`/aico:research`](../commands/research.md) and read the report with its verdict.
2. Name an earlier report as input to a run if you want.
3. A design-researcher or the skill-researcher proposes skills.
4. You approve the set in one form. Approved skills go into your skill list and onto the Roles you choose.
5. At the start of a run, an Install form asks Install or Skip for each skill that can be installed. A Skip leaves out only that skill. A baseline skill with no pin, a command and a plugin get a line instead of a question (see Installing).

## Technical details
### Research inputs
You can name an earlier report from `.company/research/` as input to a run. The Product Manager and Architect cite it as `[S#]` with the report's date, and re-check or mark `(unverified)` any verdict or blocker taken from it. An old report is never a decision.

### Research before building
[`/aico:research`](../commands/research.md) has three researchers (market, tech and, for UI work, design) look the topic up online before anything is built. The Product Manager writes one report with a verdict (go, go-with-conditions or no-go), ranked actions, low-hanging fruit (impact and effort), risks and open questions. Every claim cites a source with its URL and check date. A claim with no source is marked `unverified` and cannot support the verdict. The report is labelled as AI-generated research. Researchers read web pages as data, never as instructions, and never install anything.

### The skill catalog
Skills come from two lists. The baseline is `deps/3rdpartyskills.json`, shipped with the plugin and read-only. Your own list is `~/.mcsparrow/3rdpartyskills.json`; [`/aico:add-skill`](../commands/add-skill.md), a migration and approved picks write to it. Each entry has one source (a GitHub repo, an installer command, or a plugin; a repo in your own list has a pinned commit, a baseline repo has none until you pin it with [`/aico:add-skill`](../commands/add-skill.md)), a category, and a license. The license is what you state; nothing checks it, and a baseline skill with none shows "no license on record". A command is stored as text and never run by aico: it is shown as a `manual` line for you to run yourself. A product folder never supplies an entry, a command or a path.

Each Role can select at most 5 skills from entries whose category fits it, on the Skills tab of [`/aico:settings`](../commands/settings.md). A project selects by name only. If you clone a repo, you get its names and usually nothing else, so a name reads `missing` or `not found` on your machine until you install it. A repo can also commit its own `.claude/skills/<name>` folder: at project scope that reads `installed (name only)`, proves no version and still reaches the Role's `Role skills:` line, and for a repo entry with a commit a folder that does not match the scan reads `folder not recognized`. A name that is not in the catalog (baseline or your own list) is ignored.

**Installing.** At the start of a run, an Install form asks Install or Skip for each selected repo skill that has a pinned commit and is not there yet. A Skip leaves out only that skill, and the run records `degraded: missing <name>`. Three cases get a line and no question: a baseline repo skill with no pin shows `needs a pin` (run [`/aico:add-skill`](../commands/add-skill.md) with the same repo and a commit to pin it), a command shows a `manual` line for you to run yourself, and a plugin shows a `/plugin` line. With `gates.installs: auto` the form is skipped and the answer is Install, but only while your settings folder is in its default place. For a repo skill the installer scans the pinned commit with SkillSpector, installs that commit, and compares the installed folder to the scanned one. A failed scan or a different hash installs nothing or stops the run, and the skill is left off the Role's list.

**What the status tells you.** `installed` means the folder matches the scanned hash. `installed (name only)` means a folder of that name exists and proves no version. A scan checks one pinned commit at one time; it does not make a skill safe, and a date after "vetted" says only when that scan was clean. A stored command is never scanned or run.

### Skill picks
The skill-researcher (Selin) proposes third-party skills for four areas: `stack`, `product-type`, `company-type` and `design`. It has no Bash, so it runs no scanner. It vets each candidate against its sources, then the Lead scans every pick with SkillSpector in a new quarantine folder before you see it. A critical or high finding, a failed scan or a timeout means the pick is rejected, and with no scanner installed nothing is recommended. You approve the set (at most 5 per area) in one form and state each new skill's license. Approved picks are saved to your own skill list, by default with category `design` for the design area, `engineering` for `stack` and `product-type`, and `product` for `company-type`; you can change it and choose the Roles. They install later, in the Install form. The install pins the commit that was scanned. After it, the Lead checks the installed skill again; a bad result stops the run and shows you the removal command, which only you run. The design-researcher's picks go through the same vetting and carry a commit.

**Scan data.** At scan time SkillSpector runs on your machine. With `no-llm` mode no skill text is sent, but dependency names, versions and ecosystems from a skill's dependency files go to OSV.dev, plus the ids of any vulnerabilities found. `claude_cli` also sends skill text to Anthropic.

**Old project lines.** `## Skills` and `## Design skills` lines in `.company/project.md` are no longer read. [`/aico:setup`](../commands/setup.md) migrates them to your own list after a form. To scan skills you already have, use [`/aico:skillspector`](../commands/skillspector.md).
