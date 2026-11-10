# The .company folder

## In short
Everything a job produces lands in the `.company/` folder in your product's repo, as plain files you can read. Whether it is committed to git depends on whether your product ignores `.company/`.

## How it works
1. A job writes its Handoffs and reports under `.company/work/<ProjectID>/<NN>-<playbook>/`, one project folder per project.
2. Other files hold the profile, settings, rules, lessons and ledger.
3. Parked ideas and research reports have their own folders.
4. Open the files any time. Archive them rather than delete them.

## Technical details
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/settings.json` — this project's [settings](settings-and-locks.md) overrides, if any
- `.company/work/<ProjectID>/` — one folder per project, for example `P20261109.000009`. `00-project.md` in it holds the project's one-line description. Each run (draft, build, fix, and any sub-flow) is a sub folder `<NN>-<playbook>` such as `01-feature`, with its Handoffs and reports. Folders made before this keep their old names (`<ProjectID>-HH.MM.SS`, dated, or short slugs), stay where they are and stay readable (Contract `work-folder-name` v3.0).
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/ledger/` — the token ledger, counts only
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](../commands/brainstorm.md) at each stage
- `.company/cooler/` — recorded chats from [`/aico:cooler`](../commands/cooler.md)
- `.company/research/` — reports from [`/aico:research`](../commands/research.md); `outcome:` records your pick
