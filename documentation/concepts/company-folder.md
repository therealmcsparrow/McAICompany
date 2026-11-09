# The .company folder

## In short
Everything a job produces lands in the `.company/` folder in your product's repo, as plain files you can read. Whether it is committed to git depends on whether your product ignores `.company/`.

## How it works
1. A job writes its Handoffs and reports under `.company/work/<ProjectID>-HH.MM.SS/`.
2. Other files hold the profile, settings, rules, lessons and ledger.
3. Parked ideas and research reports have their own folders.
4. Open the files any time. Archive them rather than delete them.

## Technical details
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/settings.json` — this project's [settings](settings-and-locks.md) overrides, if any
- `.company/work/<ProjectID>-HH.MM.SS/` — the Handoffs and reports for one run of a project, for example `P20261108.000001-22.25.10`. Each run (draft, build, fix) gets its own folder. `00-summary.md` in it holds the project's one-line description. Folders made before project IDs keep their old names and stay readable (Contract `work-folder-name` v1.1).
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/ledger/` — the token ledger, counts only
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](../commands/brainstorm.md) at each stage
- `.company/cooler/` — recorded chats from [`/aico:cooler`](../commands/cooler.md)
- `.company/research/` — reports from [`/aico:research`](../commands/research.md); `outcome:` records your pick
