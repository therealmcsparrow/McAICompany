# Contract: company-type v1

Provider: `scripts/company-type.mjs` (Node built-ins only) and the type manifests `company/types/<id>.json` shipped with the plugin. Consumers: `aico:pipeline` Setup §1.0, §2 and §4 (Core), every Playbook's `**Type:**` line, `aico:help`, `aico:lead`, `aico:triage`, `aico:cooler`, `aico:brainstorm`, `aico:research`, `aico:feedback`, `aico:client`, `aico:setup`, `scripts/check.mjs` (Core, manifest rules). Field in `.company/project.md`: `company_type:` (project template, Core, approved by the CEO at the Brief Gate). Rationale: `docs/adr/0022-company-type-manifests.md`; stand-in Roles, the `work` list and reading through links: `docs/adr/0023-type-stand-ins-and-readable-output.md`.
A company type says which Roles and Playbooks a project's company has and what "ship" means for it. One type per project. Absent = `software`, which is exactly the v0.12.0 company.
Fix round 1 (task personalities-company-types; v1 is still unshipped, so no version change): the CLI prints readable lines by default and the v1 JSON with `--json` (CEO form 2026-10-27); refusals name the bad input; `.company/` and `project.md` are read through links, and an unreadable file gets its own refusal (AC7); a line that looks like `company_type:` but is not in the exact form is refused; manifests gain `work`; the new command `pick` gives shared Playbooks a stand-in Role; shared Playbooks follow the naming rule ("How consumers use it"); the `ai-disclosure` check is reworded (legal, Step 29).

## Project profile field
- One line `company_type: <id>` at the start of a line in `.company/project.md`, outside an HTML comment. Read only by `company-type.mjs`; no other script parses it.
- `<id>` matches `^[a-z][a-z0-9-]{0,31}$` after trimming spaces and tabs, and is a key of the type registry (below). The value is never path-joined: the registry is built from a `readdir` of `company/types/`, and lookup is `Object.hasOwn(registry, id)`.
- **Look-alike lines (Fix round 1).** A line outside a comment that, after dropping a UTF-8 byte order mark, leading spaces and tabs, and with ASCII letters lowercased, starts with `company_type` and then optional spaces or tabs and `:`, but does not itself start with exactly `company_type:`, is refused as malformed (it is never silently ignored, so the type the script sees is the type a reader sees, `proj.M2`).
- No such line, no `.company/` or no `.company/project.md` → `software`, `source: "default"`.
- **Reading (Fix round 1, AC7).** For every command but `set`, `.company/` and `.company/project.md` are followed through symbolic links, as v0.12.0 Playbooks did: the value is only compared with registry keys, never joined into a path or echoed, so a link adds nothing a committed file could not do. The file is opened read-only (non-blocking where the platform has the flag), the opened descriptor is `fstat`-ed, and only a regular file of at most 256 KiB is read (at most 256 KiB + 1 bytes). A link that leads nowhere counts as no file (default `software`). Anything else that stops the read gets the "cannot read" refusal below, never the invalid-value refusal.
- The settings page never shows or writes it; `writeProfile` (`aico-settings`) keeps the line byte for byte. Switching types is out of scope: `set` refuses when a line exists.

## Manifest `company/types/<id>.json`
Regular file (`lstat`, no link), at most 64 KiB, JSON object, unknown keys refused at every level:
```json
{ "v": 1, "id": "research", "label": "Research consultancy",
  "roles": ["product-manager", "account-manager", "market-researcher", "tech-researcher", "ux-researcher", "writer", "legal", "localizer", "editor", "skill-researcher"],
  "playbooks": ["research", "client", "report", "feedback", "brainstorm", "cooler"],
  "work": ["report"],
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
| `work` (Fix round 1) | 1–3 unique names, each in this manifest's `playbooks`: the Playbooks that do the type's main work, in order of preference. Shared Playbooks hand a picked idea or proposal over to these (`research`, `brainstorm`, `feedback`, `client`) |
| `ship.kind` | `release \| deliver-report \| publish \| design-handoff` |
| `ship.meaning` | one line, 1–240 characters, no `` ` `` `<` `>` |
| `ship.lanes` | 0–6 unique of `security, compliance, legal, persona, hands_on, accessibility`; forced on for that type's Ship (tighten only, never off) |
| `ship.checks` | 0–4 unique of the check table below |
| `skill_search.hints` | 0–5 unique lines matching `^[a-z0-9][a-z0-9 -]{0,59}$` |

`ALWAYS` (in every type, never listed in a manifest): `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `skillspector`. `lead` and `triage` route only to the type's Playbooks and Roles.

| Check | Satisfied by | Blocks with |
|---|---|---|
| `claims-cited` | an `editor` Handoff in the run, `status: done`, no `## Blocking` (every claim cited `[S#]` or marked `(unverified)`; AC15) | the editor's `[spec]` finding |
| `ai-disclosure` | a `legal` Handoff in the run, `status: done`, that states for each AI-generated public image, video or text: the AI Act art. 50 duty that applies and how it is met, or the reason none applies (for example: not a deepfake; a human reviewed it and holds editorial responsibility; not text published to inform the public on matters of public interest), plus `deepfake: yes` or `deepfake: no` (a realistic person, place or event). A run with no AI-generated asset states `ai-disclosure: none (no AI-generated assets)`. A passed check records Legal's statement; it is not legal clearance (AC16) | `[spec]` |
| `asset-licences` | the same `legal` Handoff, stating the licence of every asset (AC16) | `[spec]` |
| `handoff-package` | a `ui-ux-designer` Handoff listing files, specs, tokens and the asset licence record | `[spec]` |

## Shipped types (ids approved by the CEO at the Brief Gate)
| id | roles | playbooks | work | ship.kind / lanes / checks |
|---|---|---|---|---|
| `software` | the 33 Roles of v0.12.0 (every agent except `editor`) | `audit, brainstorm, client, cooler, feature, feedback, fix, incident, launch, maintain, pentest, refactor, research, standards, usability-test, vulnscan` | `feature, fix` | `release` / none / none; `meaning`: "Push, merge, release or deploy." |
| `research` | as in the example | as in the example | `report` | `deliver-report` / `legal` / `claims-cited` |
| `marketing` | `product-manager, account-manager, marketer, writer, brand-artist, prompt-artist, motion-artist, localizer, market-researcher, persona-tester, accessibility-tester, legal, editor, skill-researcher` | `campaign, content, research, client, feedback, brainstorm, cooler` | `content, campaign` | `publish` / `legal, accessibility` / `claims-cited, ai-disclosure, asset-licences` |
| `design` | `product-manager, account-manager, ui-ux-designer, design-researcher, ux-researcher, brand-artist, motion-artist, prompt-artist, game-artist, persona-tester, hands-on-tester, accessibility-tester, frontend-engineer, code-reviewer, security, writer, legal, skill-researcher` | `design, research, client, feedback, brainstorm, cooler` | `design` | `design-handoff` / `legal, accessibility, security` / `ai-disclosure, asset-licences, handoff-package` |

`software` + `ALWAYS` = the 24 v0.12.0 commands; `software.roles` = every agent but `editor`. `check.mjs` asserts both (AC8). The union of every shipped manifest's `playbooks` plus `ALWAYS` is exactly the set of the plugin's `disable-model-invocation: true` skills (each such skill outside `ALWAYS` is in at least one manifest; `check.mjs` reports one in none as an `ERROR`). `design` adds `code-reviewer` and `security` to the brief's list: `frontend-engineer` writes prototype code and the security lane is locked on (Plan Gate item). `skill-researcher` is in every type for `aico:setup`.

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, one line; never echoes a project value)
Every command takes an optional `--json` (once, anywhere after the command). Without it the output is readable lines (CEO form 2026-10-27); with it, the v1 JSON. Refusals are the same line in both modes. Tests and scripts that parse the output pass `--json`; Playbooks and the Lead read the readable lines.
| Command | stdout, exit 0 (readable) | with `--json` |
|---|---|---|
| `resolve` | the **type lines** (below) | `{ "v":1, "id", "source":"project"\|"default", "label", "roles":[…], "playbooks":[…manifest, …ALWAYS], "work":[…], "ship":{…}, "skill_search":{…} }` |
| `check-playbook <name>` | `ok: <name> is part of the <id> company`, then the type lines, when `<name>` is in `playbooks` | the `resolve` JSON |
| `check-role <role>` | `ok: <role> is part of the <id> company`, then the type lines, when `<role>` is in `roles` | the `resolve` JSON |
| `roles` | the type's role slugs, one per line (cooler and brainstorm pick from these) | JSON array of the slugs |
| `pick [--max <n>] <role> [<role>…]` (Fix round 1) | the first `<n>` (1–4, default 1) of the given Roles, in the given order, that are in `roles`, one per line. 1–8 unique candidates, each matching the id pattern | JSON array of the picked slugs |
| `list` | one line per type, in the order `software, research, marketing, design`: `<id>: <label>. Ship means: <ship_meaning>` | `[{ "id", "label", "ship_meaning" }]`, same order |
| `set <id>` | `set <id>`; writes `company_type: <id>` into `.company/project.md` atomically, as the line before `product_type:` (else after the first comment line), every other byte unchanged | `{ "v":1, "set":"<id>" }` |

**Type lines**, exactly, each `key: value` on its own line, lists joined with `, ` (hints with `; `), an empty list as `none`:
```
company type: <id> (<label>), from .company/project.md     # source project
company type: software (Software company), default: no company_type line     # source default
roles: <roles>
playbooks: <manifest playbooks, then ALWAYS>
work: <work>
ship: <ship.kind>. <ship.meaning>
ship lanes: <ship.lanes>
ship checks: <ship.checks>
skill search hints: <skill_search.hints>
```
(The `#` notes are not printed; exactly one of the two `company type:` lines appears.)

**Showing an argument.** A refusal may name a command-line argument (never a project value): `"<arg>"` when the argument matches `^[\x21-\x7E]{1,40}$` and holds no `"` or `` ` ``, else `(<n> characters, not shown)`.

## How consumers use it
- **Every Playbook** outside `ALWAYS` has, after its `**Help:**` line, exactly one empty line and then the line ``**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook <name>` first; exit not 0 → show its output line and stop.`` (the empty line keeps them two Markdown paragraphs). It is the file's only `**Type:**` line, and the Playbook keeps the type lines it printed for the run. `check.mjs` reports an `ERROR` when the line after `**Help:**` is not empty or the line after that does not start with ``**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook <name>` first;`` (AC9, AC10).
- **Pipeline Setup §1.0** (before any other Setup step, so a refusal changes nothing): takes those type lines (or runs `resolve` for a Playbook that has none). Exit not 0, no output, or a first line that starts with neither `ok: ` nor `company type: ` → stop. §2: a Role not in `roles` is not dispatched; the Lead shows the `check-role` refusal and stops the Step. §4 Ship Gate: when the type is not `software`, the summary's first line is `Ship means: <ship.meaning>`, `ship lanes` run whatever `pipeline.lanes` says, and each `ship checks` item without its satisfying Handoff is an open blocker. For `software` the Ship Gate is byte for byte the v0.12.0 one (AC7).
- **`aico:help`** lists only `playbooks`; a command outside them → "not part of your `<id>` company" and the allowed list (AC10).
- **`aico:cooler` / `aico:brainstorm`** pick every Role, including cooler walk-ups and every Role a brainstorm adds (kickoff, a research file's findings, "Change Roles"), only from `roles`. A reopened brainstorm whose `roles` frontmatter holds Roles outside the type stages and dispatches only the Roles in `roles` (`stage --roles`), names the dropped ones to the CEO in its kickoff line and never rewrites the file's `roles` line.
- **Shared Playbooks** (listed in more than one manifest: `research`, `client`, `feedback`, `brainstorm`, `cooler`) never dispatch a Role outside the type. A Role only some types have is reached with `pick` and a fallback in the same command (for example `pick architect product-manager`); `pick` refused → the Playbook skips that dispatch only when its text says so, else it shows the line and stops. `aico:research`, which skips pipeline setup, runs `check-role` before each dispatch, as pipeline §2 does. A hand-over to "the main work" (`aico:feature` and `aico:fix` in v0.12.0) goes to the `work` Playbooks of the type, first one first; for `software` that is `feature`, then `fix`, so the v0.12.0 text and behaviour stay (AC7).
- **Naming rule (Fix round 1, tested).** In a Playbook's `SKILL.md` and its `references/*.md`, `aico:<role>` names only a Role that is in the `roles` of every manifest listing that Playbook, and `/aico:<name>` or `aico:<name>` names only a Playbook in `ALWAYS` or in the `playbooks` of every such manifest. Anything else goes through `pick` (Roles) or `work` (Playbooks). `scripts/type-playbook-roles.test.mjs` asserts this for every manifest and every Playbook it lists.
- **`aico:setup`** uses `list`, `set` and `skill_search.hints` (W3, `skill-recommendation` v1, `Area: company-type`). The id it passes to `set` is one of the `<id>` words `list` printed.

## Error cases
All exit 2 unless stated. `<allowed>` = `software, research, marketing, design`. Nothing is written by any refusal.
- **Project value** (never echoed; line numbers count from 1 in the file):
  - not a valid id or not in the registry → `refused: company_type on line <n> of .company/project.md is not valid; allowed: <allowed>` (AC9).
  - more than one line → `refused: .company/project.md has <k> company_type lines (lines <a>, <b>[, …]); keep one; allowed: <allowed>` (AC9).
  - a look-alike line → `refused: line <n> of .company/project.md looks like a company_type line but is not "company_type: <id>" at the start of the line; allowed: <allowed>` (AC9).
  - `.company` exists and is not a folder (after following links) → `refused: .company is not a folder, so the company type is unknown`.
  - `project.md` cannot be read → `refused: cannot read .company/project.md (<reason>), so the company type is unknown; fix the file and run again`, `<reason>` one of `not a regular file`, `larger than 256 KiB`, `no permission`, `read error` (AC7: never the invalid-value line).
- **Arguments:**
  - no command → `refused: no command; usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | pick [--max <n>] <role>... | list | set <id> [--json]`; an unknown command → `refused: unknown command <shown>; usage: …` (same usage text).
  - wrong number of arguments → `refused: <command> needs <what>; usage: …`, `<what>` one of `no arguments`, `one Playbook name`, `one Role name`, `one company type`, `1 to 8 Role names`.
  - `check-playbook` name not matching `^[a-z][a-z0-9-]{0,31}$` → `refused: Playbook name <shown> is not valid: use a-z, 0-9 and -, start with a letter, at most 32 characters`; `check-role` and `pick` the same with `Role name`.
  - `--max` not a whole number 1–4 → `refused: --max must be a whole number from 1 to 4`; a repeated candidate or `--json` twice → `refused: <shown> is given twice`.
  - `set` id that is not a registry key → `refused: <shown> is not a company type; allowed: <allowed>`.
- `check-playbook` / `check-role` outside the type → `refused: <name> is not part of the <id> company; allowed: <comma list>` (AC10). `pick` with none of the candidates in the type → `refused: none of <candidates> is part of the <id> company; allowed: <roles>`.
- A manifest that breaks a rule, a link, or a registry without `software` → `refused: type manifest <id> invalid: <rule>` (exit 3). `check.mjs` reports the same as an `ERROR` in CI.
- `set` with a line (or a look-alike line) already present → `refused: company_type already set; switching types is not supported`; no `.company/project.md` → `refused: no .company/project.md`; `.company` or `project.md` is a link → `refused: .company/project.md is a link; set writes only a regular file in a real .company folder` (writes never follow links).
- Any other failure → `refused: could not read the company type`.
- `company-type.mjs` cannot run or prints nothing → treated like exit not 0: the Playbook stops (fail closed). The script ships with the plugin, so this means a broken install; the stop line says to reinstall.
