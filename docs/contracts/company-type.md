# Contract: company-type v1

Provider: `scripts/company-type.mjs` (Node built-ins only) and the type manifests `company/types/<id>.json` shipped with the plugin. Consumers: `aico:pipeline` Setup §1.0, §2 and §4 (Core), every Playbook's `**Type:**` line, `aico:help`, `aico:lead`, `aico:triage`, `aico:cooler`, `aico:brainstorm`, `aico:setup`, `scripts/check.mjs` (Core, manifest rules). Field in `.company/project.md`: `company_type:` (project template, Core, approved by the CEO at the Brief Gate). Rationale: `docs/adr/0022-company-type-manifests.md`.
A company type says which Roles and Playbooks a project's company has and what "ship" means for it. One type per project. Absent = `software`, which is exactly the v0.12.0 company.

## Project profile field
- One line `company_type: <id>` at the start of a line in `.company/project.md`, outside an HTML comment. Read only by `company-type.mjs`; no other script parses it.
- `<id>` matches `^[a-z][a-z0-9-]{0,31}$` after trimming spaces and tabs, and is a key of the type registry (below). The value is never path-joined: the registry is built from a `readdir` of `company/types/`, and lookup is `Object.hasOwn(registry, id)`.
- No such line, or no `.company/project.md` → `software`, `source: "default"`.
- The settings page never shows or writes it; `writeProfile` (`aico-settings`) keeps the line byte for byte. Switching types is out of scope: `set` refuses when a line exists.

## Manifest `company/types/<id>.json`
Regular file (`lstat`, no link), at most 64 KiB, JSON object, unknown keys refused at every level:
```json
{ "v": 1, "id": "research", "label": "Research consultancy",
  "roles": ["product-manager", "account-manager", "market-researcher", "tech-researcher", "ux-researcher", "writer", "legal", "localizer", "editor", "skill-researcher"],
  "playbooks": ["research", "client", "report", "feedback", "brainstorm", "cooler"],
  "ship": { "kind": "deliver-report",
            "meaning": "The final report goes to the client or is published, with every claim cited [S#] or marked (unverified).",
            "lanes": ["legal"], "checks": ["claims-cited"] },
  "skill_search": { "hints": ["research report writing", "citation and source checking"] } }
```
| Key | Rule |
|---|---|
| `v` | `1` |
| `id` | equals the file stem; id pattern above |
| `label` | one line, 1–40 characters, letters, digits, spaces, `-` |
| `roles` | 1–40 unique slugs, each an existing `agents/<slug>.md`; always includes `skill-researcher` (used by `aico:setup`) |
| `playbooks` | 1–40 unique names, each an existing `skills/<name>/SKILL.md` with `disable-model-invocation: true`, none from `ALWAYS` |
| `ship.kind` | `release \| deliver-report \| publish \| design-handoff` |
| `ship.meaning` | one line, 1–240 characters, no `` ` `` `<` `>` |
| `ship.lanes` | 0–6 unique of `security, compliance, legal, persona, hands_on, accessibility`; forced on for that type's Ship (tighten only, never off) |
| `ship.checks` | 0–4 unique of the check table below |
| `skill_search.hints` | 0–5 unique lines matching `^[a-z0-9][a-z0-9 -]{0,59}$` |

`ALWAYS` (in every type, never listed in a manifest): `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `skillspector`. `lead` and `triage` route only to the type's Playbooks and Roles.

| Check | Satisfied by | Blocks with |
|---|---|---|
| `claims-cited` | an `editor` Handoff in the run, `status: done`, no `## Blocking` (every claim cited `[S#]` or marked `(unverified)`; AC15) | the editor's `[spec]` finding |
| `ai-disclosure` | a `legal` Handoff in the run, `status: done`, stating the AI Act art. 50 disclosure for each AI-generated public image, video or text (AC16) | `[spec]` |
| `asset-licences` | the same `legal` Handoff, stating the licence of every asset (AC16) | `[spec]` |
| `handoff-package` | a `ui-ux-designer` Handoff listing files, specs, tokens and the asset licence record | `[spec]` |

## Shipped types (ids approved by the CEO at the Brief Gate)
| id | roles | playbooks | ship.kind / lanes / checks |
|---|---|---|---|
| `software` | the 33 Roles of v0.12.0 (every agent except `editor`) | `audit, brainstorm, client, cooler, feature, feedback, fix, incident, launch, maintain, pentest, refactor, research, standards, usability-test, vulnscan` | `release` / none / none; `meaning`: "Push, merge, release or deploy." |
| `research` | as in the example | as in the example | `deliver-report` / `legal` / `claims-cited` |
| `marketing` | `product-manager, account-manager, marketer, writer, brand-artist, prompt-artist, motion-artist, localizer, market-researcher, persona-tester, accessibility-tester, legal, editor, skill-researcher` | `campaign, content, research, client, feedback, brainstorm, cooler` | `publish` / `legal, accessibility` / `claims-cited, ai-disclosure, asset-licences` |
| `design` | `product-manager, account-manager, ui-ux-designer, design-researcher, ux-researcher, brand-artist, motion-artist, prompt-artist, game-artist, persona-tester, hands-on-tester, accessibility-tester, frontend-engineer, code-reviewer, security, writer, legal, skill-researcher` | `design, research, client, feedback, brainstorm, cooler` | `design-handoff` / `legal, accessibility, security` / `ai-disclosure, asset-licences, handoff-package` |

`software` + `ALWAYS` = the 24 v0.12.0 commands; `software.roles` = every agent but `editor`. `check.mjs` asserts both (AC8). The union of every shipped manifest's `playbooks` plus `ALWAYS` is exactly the set of the plugin's `disable-model-invocation: true` skills (each such skill outside `ALWAYS` is in at least one manifest; `check.mjs` reports one in none as an `ERROR`). `design` adds `code-reviewer` and `security` to the brief's list: `frontend-engineer` writes prototype code and the security lane is locked on (Plan Gate item). `skill-researcher` is in every type for `aico:setup`.

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout; never echoes a project value)
| Command | stdout, exit 0 |
|---|---|
| `resolve` | `{ "v":1, "id", "source":"project"\|"default", "label", "roles":[…], "playbooks":[…manifest, …ALWAYS], "ship":{…}, "skill_search":{…} }` |
| `check-playbook <name>` | the `resolve` JSON when `<name>` is in `playbooks` |
| `check-role <role>` | the `resolve` JSON when `<role>` is in `roles` |
| `roles` | the type's role slugs, one per line (cooler and brainstorm pick from these) |
| `list` | `[{ "id", "label", "ship_meaning" }]` in the order `software, research, marketing, design` |
| `set <id>` | `set <id>`; writes `company_type: <id>` into `.company/project.md` atomically, as the line before `product_type:` (else after the first comment line), every other byte unchanged |

## How consumers use it
- **Every Playbook** outside `ALWAYS` has, after its `**Help:**` line, exactly one empty line and then the line ``**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook <name>` first; exit not 0 → show its output line and stop.`` (the empty line keeps them two Markdown paragraphs). It is the file's only `**Type:**` line, and the Playbook keeps the JSON for the run. `check.mjs` reports an `ERROR` when the line after `**Help:**` is not empty or the line after that does not start with ``**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook <name>` first;`` (AC9, AC10).
- **Pipeline Setup §1.0** (before any other Setup step, so a refusal changes nothing): takes that JSON (or runs `resolve` for a Playbook that has none). §2: a Role not in `roles` is not dispatched; the Lead shows the `check-role` refusal and stops the Step. §4 Ship Gate: when `id` is not `software`, the summary's first line is `Ship means: <ship.meaning>`, `ship.lanes` run whatever `pipeline.lanes` says, and each `ship.checks` item without its satisfying Handoff is an open blocker. For `software` the Ship Gate is byte for byte the v0.12.0 one (AC7).
- **`aico:help`** lists only `playbooks`; a command outside them → "not part of your `<id>` company" and the allowed list (AC10).
- **`aico:cooler` / `aico:brainstorm`** pick Roles only from `roles`.
- **`aico:setup`** uses `list`, `set` and `skill_search.hints` (W3, `skill-recommendation` v1, `Area: company-type`).

## Error cases
- Bad or unknown `company_type:` value, or more than one line → `refused: company_type is not valid; allowed: software, research, marketing, design` (exit 2), nothing else printed, nothing written (AC9). The Playbook stops with that line.
- `check-playbook` / `check-role` outside the type → `refused: <name> is not part of the <id> company; allowed: <comma list>` (exit 2). `<name>` must match `^[a-z][a-z0-9-]{0,31}$`, else `refused: usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | list | set <id>` (exit 2) (AC10).
- A manifest that breaks a rule, a link, or a registry without `software` → `refused: type manifest <id> invalid: <rule>` (exit 3). `check.mjs` reports the same as an `ERROR` in CI.
- `set` with a line already present → `refused: company_type already set; switching types is not supported` (exit 2); no `.company/project.md` → `refused: no .company/project.md` (exit 2); `<id>` not in the registry → the AC9 refusal.
- `company-type.mjs` cannot run or prints no JSON → treated like exit not 0: the Playbook stops (fail closed). The script ships with the plugin, so this means a broken install; the stop line says to reinstall.
