# Contract: role-names v1

Provider: `company/names.json` (defaults) and `roles.<role>.name` in `aico-settings` v1 (overrides). Consumers: `aico:pipeline` (the `Name:` dispatch line, `dispatch-prompt` v3), `aico:brainstorm`, `aico:cooler`, `aico:research`, the settings page.
Every Role has a person's name, shown next to its title: "Ava (architect)". Names are display only.

## Defaults
`company/names.json` is `{ "<role>": "<name>" }` with exactly one entry per `agents/*.md`. It lives outside agent frontmatter, because frontmatter allows only documented keys. `scripts/check.mjs` checks it.

## Rules
- A name is 1–30 characters matching `^[\p{L}][\p{L} '\-]{0,29}$`u: Unicode letters, spaces, hyphens and apostrophes, starting with a letter.
- Effective names (after project > user > plugin) are unique across Roles, case-insensitive. A save that would clash is refused, naming both Roles.
- Never route, file or match on a name. `aico:<role>` IDs, file names, frontmatter and every machine-read part stay unchanged. The one exception is the Lead's rule: a name in the CEO's request that matches exactly one effective name routes to that Role.
- A Role that gets no `Name:` uses its Role title.

## Error cases
- `names.json` missing a Role, an invalid name or a duplicate → `check.mjs` error.
- A stored override that fails the rules → ignored with a warning; the level below wins.
- Stored names that clash (for example after a hand edit) → `get` still resolves them and adds a `warnings` line naming both Roles.
