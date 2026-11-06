# Contract: skills-section v1.1

v1.1 (task skill-audit-bugs, minor, per `docs/adr/0007-contract-minor-versions.md`): the old unpinned `impeccable` line (`` `npx -y impeccable skills install` ``) is a known old form on a `## Skills` line too, as in `design-skills-section` v1.2: it resolves to the pinned manifest command, is printed as `manual`, and `install-skills.mjs` exits 0. Every v1 line stays valid.

Status: **approved** by the CEO at the Plan Gate (P1, 2026-10-26). It changes the Project profile template `skills/lead/references/project-template.md`, which is Core. Still unreleased; Fix round 1 (CEO decision 1) adds the `commit` field in place.

The project-scope skill inventory for the areas `stack`, `product-type` and `company-type` (agentsec.M-SEC6). Design skills stay in `## Design skills` (`design-skills-section` v1.2), so the design freshness rule in `aico:feature` is untouched.
Writer: the Lead, after the CEO approves a set the `skill-researcher` recommended and `skill-picks.mjs vet` scanned (`skill-recommendation` v1.3). Readers: `install-skills.mjs --project` (group `skills`, `skills-manifest` v3.0), the `skill-researcher` (judges the current set).
Its text is untrusted at parse time, as in `design-skills-section` v1.2.

## Format
```markdown
## Skills
<!-- approved by the CEO from a skill-researcher run; one skill per line -->
- area: stack; name: <name>; source: <owner/repo>; license: MIT; vetted: 2026-10-26; commit: <40 hex>; why: <one line>; approved: 2026-10-26
```
- The line matches `^- area: (stack|product-type|company-type); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); why: ([^;]+); approved: ([^;]+)$`; each field is checked with the `design-skills-section` v1.2 table. `source` is a repo or a byte-identical manifest command; `plugin <p>` is not allowed here.
- `commit` is **required**: repo source `^[0-9a-f]{40}$` (the commit `vet` scanned); command source `-`.
- Empty section: `- (none yet; the skill-researcher proposes them)`. At most 5 lines per area, 15 in all. Bounds as in `design-skills-section` v1.2.

## Installs
As `design-skills-section` v1.2 "Installs" (project scope, no `-g`, cwd = product root, two forms, rollback named), through `install-skills.mjs --project` group `skills`. A repo line installs exactly its `commit`: `npx -y skills@1.7.4 add <owner>/<repo>#<commit> -s <name> -a claude-code -y` (`skills-manifest` v3.0).

## skills-manifest additions (from v2.1, kept in v3.0)
`--project <path>` adds group `skills` from `## Skills` beside group `design`; `parseSkillsSection(markdown, manifest)` is exported; a failing line → `ERROR skills line <n>: <field> <reason>`, exit 1, nothing installed in any group.

## Error cases
As `design-skills-section` v1.2, with `skills line` in place of `design skill line`. A repo line with `commit: -`, or a command line with a sha → `ERROR skills line <n>: commit invalid`.
