# Contract: skills-section v1 (proposed: Plan Gate P1)

Status: **proposed**. It changes the Project profile template `skills/lead/references/project-template.md`, which is Core, so it takes effect only when the CEO approves P1 at the Plan Gate. Without P1, nothing here is built and `skill-recommendation` v1 step 3 uses its fallback.

The project-scope skill inventory for the areas `stack`, `product-type` and `company-type` (agentsec.M-SEC6). Design skills stay in `## Design skills` (`design-skills-section` v1, unchanged), so the design freshness rule in `aico:feature` is untouched.
Writer: the Lead, after the CEO approves a set the `skill-researcher` recommended (`skill-recommendation` v1). Readers: `install-skills.mjs --project` (group `skills`, `skills-manifest` v2.1), the `skill-researcher` (judges the current set).
Its text is untrusted at parse time, as in `design-skills-section` v1.

## Format
```markdown
## Skills
<!-- approved by the CEO from a skill-researcher run; one skill per line -->
- area: stack; name: <name>; source: <owner/repo>; license: MIT; vetted: 2026-10-26; why: <one line>; approved: 2026-10-26
```
- The line matches `^- area: (stack|product-type|company-type); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); why: ([^;]+); approved: ([^;]+)$`; each field is checked with the `design-skills-section` v1 table. `source` is a repo or a byte-identical manifest command; `plugin <p>` is not allowed here.
- Empty section: `- (none yet; the skill-researcher proposes them)`. At most 5 lines per area, 15 in all. Bounds as in `design-skills-section` v1.

## Installs
Exactly as `design-skills-section` v1 "Installs" (project scope, no `-g`, cwd = product root, two forms, rollback named), through `install-skills.mjs --project` group `skills`.

## skills-manifest v2.1 (additive, with P1)
`--project <path>` adds group `skills` from `## Skills` beside group `design`; `parseSkillsSection(markdown, manifest)` is exported; a failing line → `ERROR skills line <n>: <field> <reason>`, exit 1, nothing installed in any group.

## Error cases
As `design-skills-section` v1, with `skills line` in place of `design skill line`.
