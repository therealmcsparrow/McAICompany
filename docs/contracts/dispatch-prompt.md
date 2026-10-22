# Contract: dispatch-prompt v2

Provider: `aico:pipeline` (and the Playbooks that skip pipeline setup: `aico:brainstorm`, `aico:cooler`, `aico:research`). Consumer: every Role, through `aico:handoff`.
v1 = the prompt in `skills/pipeline/SKILL.md` at 0.8.1. v2 is additive: a Role that gets a v1 prompt behaves as before.

## Lines added in v2
| Line | When | Value |
|---|---|---|
| `Language: <tag>` | every dispatch, every Playbook, directly after `Company profile:` (brainstorm/cooler: after `Company profile:` too) | effective `aico_language` from `aico-language` v1 `resolve`, resolved **once** per run in pipeline Setup §1.6 |
| `Design skills: <name>, <name> \| none` | only for `ui-ux-designer`, `frontend-engineer`, `desktop-engineer`, `game-engineer`, `brand-artist` | names from `.company/project.md` `## Design skills` (`design-skills-section` v1); `none` when empty |

Lead-only Playbooks that dispatch no Role (`aico:triage`, `aico:help`, `aico:version`, `aico:language`) resolve the language the same way and use it for their own forms and replies.

## Role-side rules (written into `aico:handoff`)
- **Prose in `<tag>`:** Handoff prose, forms, Gate summaries, digests, reports, lessons, cooler lines, brainstorm replies.
- **Always English** (machine-read): frontmatter keys and values, `##` section headings, `status:` values, blocking tags `contract|spec|security|test`, AC IDs, file/folder names, slugs, branches, command names, Role names, Contract names, report `## ` headings.
- **Commit subjects:** `<type>: <summary in tag>`; `<type>` stays from the English list in `aico:pipeline`.
- **New code comments:** in `<tag>` unless the product's Ruleset or the existing comments in that codebase use another language; then follow the codebase. Identifiers, code, log keys, API names stay code. Product UI and user docs follow `languages:`, never `Language:`.
- **Rule packs** in `~/.mcsparrow/standards/` use the user default (`language.mjs --default`), not this line. Source quotes stay in their original language.
- `Design skills:` → load each named skill (Skill tool). A named skill that is not available → list it under `## Next` as `missing design skill: <name>`; never skip silently.

## Error cases
- `Language:` absent (v1 prompt, old resume state) → treat as `en`.
- `Language:` value not a valid tag → treat as `en` and add a Nit `invalid Language <value>`.
- `en` → output is identical to 0.8.1 behaviour (no translation step, no extra text).
- `Design skills:` absent for a UI Role → behave as `none`.
