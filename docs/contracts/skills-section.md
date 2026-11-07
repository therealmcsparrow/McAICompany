# Contract: skills-section v2.0

v2.0 (task role-skills-file, major, per `docs/adr/0007-contract-minor-versions.md`; rationale ADR 0062): the section is no longer read at run time. No install, dispatch or researcher reads it. Only the migration in scripts/role-skills.mjs (`skill-catalog` v1) reads it, and the format below stays as that migration's input. A migrated line becomes a user catalog entry and Role selections.

v1.1 (task skill-audit-bugs, minor, per `docs/adr/0007-contract-minor-versions.md`): the old unpinned `impeccable` line (`` `npx -y impeccable skills install` ``) is a known old form on a `## Skills` line too, as in `design-skills-section` v2.0: it resolves to the pinned manifest command, is printed as `manual`, and `install-skills.mjs` exits 0. Every v1 line stays valid.

Status: **approved** by the CEO at the Plan Gate (P1, 2026-10-26). It changes the Project profile template `skills/lead/references/project-template.md`, which is Core. Still unreleased; Fix round 1 (CEO decision 1) adds the `commit` field in place.

The old project-scope skill inventory for the areas `stack`, `product-type` and `company-type`. Inventory now lives in `skill-catalog` v1 (agentsec.M-SEC6). Design skills stay in `## Design skills` (`design-skills-section` v2.0).
Writer: none since v2.0. Reader: the migration. A CEO form shows each line's validated name, source, commit, license and dates before any entry is written (`skill-catalog` v1 Layers).
Its text is untrusted at parse time, as in `design-skills-section` v2.0.

## Format
```markdown
## Skills
<!-- approved by the CEO from a skill-researcher run; one skill per line -->
- area: stack; name: <name>; source: <owner/repo>; license: MIT; vetted: 2026-10-26; commit: <40 hex>; why: <one line>; approved: 2026-10-26
```
- The line matches `^- area: (stack|product-type|company-type); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); why: ([^;]+); approved: ([^;]+)$`; each field is checked with the `design-skills-section` v2.0 table. `source` is a repo, a command byte-identical to the baseline's (`skill-catalog` v1), or the known old unpinned `impeccable` form (`npx -y impeccable skills install`) that resolves to the pinned baseline command; `plugin <p>` is not allowed here.
- `commit` is **required**: repo source `^[0-9a-f]{40}$` (the commit `vet` scanned); command source `-`.
- Empty section: `- (none yet; the skill-researcher proposes them)`. At most 5 lines per area, 15 in all. Bounds as in `design-skills-section` v2.0.

## Installs
None from this section since v2.0. A migrated line installs as any Role selection, through `install-skills --selected` (`skill-catalog` v1).

## Error cases
A line that fails its checks is never shown by the migration and stays in the section, with the reason named by line number and field and its text never echoed. A repo line with `commit: -`, or a command line with a sha, fails as `commit invalid`.
