# Contract: design-skills-section v1

The project-level skill list. Lives in `.company/project.md` under `## Design skills` (template: `skills/lead/references/project-template.md`). Not in `.company/standards.md`.
Writer: the Lead, after the CEO approves a set the `design-researcher` recommended. Readers: `install-skills.mjs --project` (`skills-manifest` v2), `aico:pipeline` (the `Design skills:` dispatch line, `dispatch-prompt` v2), `aico:feature` (freshness), `design-researcher` (judges the current set).

## Format
```markdown
## Design skills
<!-- approved by the CEO from a design-researcher run; one skill per line -->
- name: impeccable; source: `npx -y impeccable skills install`; why: <one line>; approved: 2026-10-22
- name: hallmark; source: nutlope/hallmark; why: <one line>; approved: 2026-10-22
- name: aico:ui-design; source: plugin aico; why: <one line>; approved: 2026-10-22
```
- Keys in this order, separated by `; `: `name`, `source`, `why`, `approved`. `why` must not contain `;`.
- `source`: `owner/repo` (skills CLI), a backticked install command, or `plugin <plugin-name>` (never installed by the script).
- Empty section: the single line `- (none yet; the design-researcher proposes them)`.
- At most 5 lines (AC20 recommended-set cap).

## Freshness
The set is **stale** when the section is empty or the newest `approved:` date is more than 180 days before today. `aico:feature` runs the `design-researcher` Step only when the product has UI (`product_type` web, desktop or game, or the brief has UI work) and the set is stale. Re-approving a skill rewrites its date.

## Error cases
- A line that does not parse → `install-skills.mjs` fails with the line number (no partial install); the pipeline sends `Design skills: none` and names the bad line in the Gate summary.
- A listed skill that is not installed → the Role names it under `## Next` (`dispatch-prompt` v2); the Lead offers the AC8 Install / Skip form at the next run start.
