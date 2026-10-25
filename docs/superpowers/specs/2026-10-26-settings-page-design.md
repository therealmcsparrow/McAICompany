# Settings page: design

Date: 2026-10-26. Status: draft for CEO review.

## Intent
Today aico's behaviour is fixed in files the CEO can't safely edit. Role models and effort sit in the plugin's agent files, which every update overwrites. The Fix-round limit, parallel dispatch, optional lanes and Gates are prose in skills. Only the language has a setting (`/aico:language`). The CEO wants one place to see and change how the company works, for every project or for a single project, without touching plugin files.

## Goals
- `/aico:settings` opens a local **settings page** in the browser that shows every setting and saves on **Save**.
- Settings covered:
  1. **Roles:** name, model and effort per Role, for all 32 Roles.
  2. **Language and profile:** `aico_language` plus the `.company/project.md` header fields (product_type, engagement, client, audience, goal, stack, languages, voice, license, jurisdiction).
  3. **Pipeline:** Fix-round limit, parallel or sequential dispatch, and default optional lanes.
  4. **Gates:** which asks show a form and which auto-approve.
- Two levels: a **user default** (`~/.mcsparrow/config.json`) and a **project override**. The project wins, and both win over the plugin default. Profile fields are project-only.
- Every change applies from the next aico run, with no plugin edit and no reload.

## Non-goals
- Claude Code's own `settings.json` (permissions, env vars, harness default model). The CEO left it out.
- Editing the free-form `project.md` sections (Personas, Art direction, Core, Modules, Pricing, Performance budget). Their owner Roles and Gates keep them.
- A hosted or remote page. It runs on the CEO's machine only.
- Per-run overrides (for example "use opus for this one run").

## Anti-goals (failure even if it "works")
- Any other website or local process can read or change settings through the page's server.
- A setting that silently skips a safety ask the CEO never unlocked.
- Settings that drift from what aico actually does: the page shows a value, but dispatch uses another.
- Hand-editing plugin files (`agents/*.md`) or anything under `${CLAUDE_PLUGIN_ROOT}` to apply a setting.

## Decisions made by the CEO
1. **Scope:** per-Role model and effort, existing aico settings (language and profile fields) and pipeline behaviour (Fix-round limit, parallel dispatch, optional lanes, Gates). Not Claude Code settings.
2. **Form:** a settings page, not command arguments or a hand-edited file.
3. **Levels:** user default plus project override, and the project wins. The page shows which level is in effect.
4. **Locked asks:** the Ship Gate (push and merge), Must exceptions and security asks, and paid actions or installs are **locked by default**. The page lets the CEO unlock each one, behind a clear warning.
5. **Layout B, layers side by side:** tabs (Roles · Language & profile · Pipeline · Gates). Each tab is a table with columns `Plugin | User | Project | In effect`. The User and Project cells are editable (`—` means not set, so the level below wins). The page shows an unsaved-changes count next to Save.
6. **What an unlock allows:** unlocking `security` only allows turning off the security and compliance lanes. Unlocking `installs` lets design-skill and dependency installs run without a form. **Must exceptions and Blocking security findings always ask the CEO**, whatever the settings say.
7. **Auto Ship:** with `ship` unlocked and set to `auto`, aico pushes the branch and opens a PR at the end of a run. It never merges; the CEO merges the PR.

## Design (Lead's calls, open to change)

### How it runs
- `skills/settings/SKILL.md`, a Playbook (`disable-model-invocation: true`) with the Help line. It runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" serve` from the product root, prints the URL, and the script opens the browser. It dispatches no Role and creates no branch or commit.
- `scripts/settings.mjs` is dependency-free Node ESM, like `language.mjs`:
  - `serve` starts an HTTP server bound to **127.0.0.1** on a random free port, with a fresh 32-byte random **token** in the URL. Every request without the token gets a 403. Writes accept only `POST` with `Content-Type: application/json`. The server checks the `Host` header (127.0.0.1 or localhost with its own port) and the `Origin` header (must match), to block DNS rebinding and cross-site posts. Request bodies are capped at 64 KB.
  - The server stops when the CEO presses **Done** on the page, or after 30 minutes idle.
  - `get` prints the resolved settings as JSON (used by the pipeline), and `get <key>` prints one value.
  - The page is one static HTML file (`scripts/settings-page.html`) with inline CSS and JS, no CDN. It works offline and follows light or dark mode.
- **Validation lives in the script, never in the page.** Every value is checked against an allow-list schema (below) before writing. Unknown keys are refused. Writes are atomic (write a temp file, then rename). A refusal returns a `refused:` reason and changes nothing.

### Storage
- **User:** `~/.mcsparrow/config.json` (`MCSPARROW_HOME` respected, as in `language.mjs`). Keys go under `aico_settings` (v1). `aico_language` stays where it is.
- **Project:** `.company/settings.json` (`aico_settings` v1, same shape). It's a new file because 32 Roles would clutter `project.md`.
- **Profile fields and the project language:** written to the `.company/project.md` header lines, as today. Through `language.mjs`'s existing logic for `aico_language` (reused as a module, not duplicated), so the `aico-language` v1 Contract doesn't change.
- Shape (`aico-settings` v1):
  ```json
  { "aico_settings": { "version": 1,
      "roles": { "architect": { "model": "opus", "effort": "high" } },
      "pipeline": { "fix_rounds": 2, "dispatch": "parallel",
                    "lanes": { "security": true, "compliance": true, "legal": "auto", "persona": true, "hands_on": true, "accessibility": true } },
      "gates": { "brief": "ask", "plan": "ask", "ship": "ask", "installs": "ask" },
      "unlocked": [] } }
  ```
  Any key can be absent, meaning not set at that level.
- **Schema:**
  - `model`: `opus | sonnet | haiku | fable | inherit`. These are the values the Agent tool accepts, plus `inherit` (no override, so the session model is used).
  - `effort`: `low | medium | high | xhigh | max`.
  - Role names must match an existing `agents/*.md`.
  - `fix_rounds`: integer 0–5. `dispatch`: `parallel | sequential`.
  - Lanes: boolean. `legal` is `auto | on | off`, where `auto` is today's rule (only for AI, payments or personal data).
  - Gate values (`brief`, `plan`, `ship`, `installs`): `ask | auto`. `unlocked` lists only `ship`, `security`, `installs`.

- **Profile fields** (*Lead's call*):
  - `product_type`, `engagement` and `voice` must be one of the options in `skills/lead/references/project-template.md`.
  - `languages` is a comma-separated list of BCP 47 tags, checked with `language.mjs`'s `validate`.
  - Free-text fields (`client`, `audience`, `goal`, `stack`, `license`, `jurisdiction`) are capped at 200 characters, with no newlines or control characters.
  - `stack` stays editable, but the page notes that `aico:stack-detect` may overwrite it.

### Plugin defaults
- The **Plugin** column reads model and effort from `agents/*.md` frontmatter at serve time. That's the source of truth, so the page can't drift from the files.
- Pipeline and Gate defaults are constants in `settings.mjs` matching today's behaviour (Fix rounds 2, parallel, every lane as today, every Gate `ask`). A test asserts they match the prose in `skills/pipeline` and `skills/feature`.

### How settings take effect
- **Pipeline Setup** gets a step right after the language step (§1.6). It runs `settings.mjs get` once per run (fixed command, no arguments) and keeps the JSON for the whole run, never re-resolving it. A failure or invalid output means plugin defaults, with one line in the first Gate summary.
- **Dispatch:** for each Role, when the resolved model or effort differs from the agent's frontmatter, the Lead passes `model` and/or `effort` on the Agent call. It never passes `inherit`; it omits the parameter instead. The dispatch block gets a `Settings:` line with what was overridden, so Handoffs record it. This is what lets the CEO's settings take effect: the Agent tool honours `effort` when a skill explicitly asks for it.
- **Fix rounds:** `aico:pipeline` §5 reads the limit from settings instead of a fixed 2. At 0, the first blocking review goes straight to the CEO.
- **Dispatch mode:** `sequential` dispatches the Steps marked ∥ one at a time, in the listed order.
- **Lanes:** `/aico:feature` step 4 (and 2b for persona testing) includes a lane only when its setting is on. A skipped lane is named in the Ship Gate summary ("skipped by settings: accessibility").
- **Gates:** `auto` means the Lead writes the Gate summary into the run's Handoff folder and continues without a form, and says so in its next message. Gate settings cover only the Brief, Plan and Ship Gates and the install forms. Every other CEO ask stays a form: `needs-ceo` Must exceptions, Blocking security findings, picks from a report, escalations after the Fix-round limit, and design-skill set approval.
- **Auto Plan Gate:** still stops with a form when Must exception requests or a rejected ruleset rule are pending.
- **Auto Ship Gate:** pushes the branch and opens a PR (`gh pr create`), then stops. It never merges. Anything sent outside the machine other than that PR always asks, whatever the settings: messages or handoffs to a client (`/aico:client`), publishing (`/aico:launch`), reports to authorities (`/aico:incident`) and production deploys.
- **Which Playbooks:** every Playbook that runs through `aico:pipeline` reads model, effort, Fix rounds, dispatch mode and Gates. Lane settings apply wherever that lane is optional today (`feature`, `fix`, `maintain`, `audit`, `refactor`). A lane a Playbook always runs (for example security in `/aico:audit`) isn't affected.

### Lock and unlock (Lead's call on the details)
- Locked rows on the Gates tab show a lock icon. Unlocking opens a confirm dialog that names what will no longer ask (for example "aico will push and merge without asking you"). Only after confirming can the CEO set the Gate to `auto`.
- The **security** and **compliance** lanes count as locked ("security is law", and Must includes all security in `aico:ruleset`). Turning either off needs the `security` unlock. *Lead's call.*
- **Unlocks count only from the user level** (`~/.mcsparrow/config.json`). An `unlocked` list in `.company/settings.json` is ignored, and the page shows it as ignored, because a cloned or client repo must never unlock push or skip security on this machine. A project can still lock again: setting a Gate to `ask` or a lane on at project level always wins. *Lead's call.*
- `.company/settings.json` follows the repo's `.company/` policy. The page makes no commits.
- Pentest production authorization and incident reporting stay CEO asks no matter what. They live in their own Playbooks, which don't read Gate settings.

### Page details
- **Roles tab:** one row per Role, grouped under department sub-headers in README order (layout B's table, with C's grouping as visual dividers only). The User and Project cells each hold a model and an effort dropdown. A bulk row at the top applies a model and/or effort to a department or to all Roles at the chosen level.
- **In effect** is computed live in the page from the three columns. After Save, it's re-read from `settings.mjs get` so it matches what dispatch will use.
- When there's no `.company/` (the page was opened outside a product repo), the Project column is disabled with a short explanation.
- **Reset:** each cell can be cleared back to `—`, and each tab has "clear this level".

### Role names (CEO: add to this design; defaults are international first names)
- Every Role gets a person's name, shown next to its title: "Ava (architect)". The name is for display only. `aico:<role>` IDs, file names, routing, frontmatter and every machine-read part stay unchanged (`dispatch-prompt` v2 English-only list).
- **Defaults** ship in `company/names.json` (`role-names` v1: `{ "<role>": "<name>" }`), not in agent frontmatter, because cc.M4 allows only documented keys. *Lead's call.* Proposed defaults, short, mixed origins and easy to tell apart. The CEO can change them on the page:

  | Role | Name | Role | Name | Role | Name | Role | Name |
  |---|---|---|---|---|---|---|---|
  | architect | Ava | backend-engineer | Ben | frontend-engineer | Freya | desktop-engineer | Kenji |
  | ai-data-engineer | Dev | game-engineer | Hugo | devops | Omar | senior-engineer | Erik |
  | code-reviewer | Rui | qa | Quinn | security | Sam | pentester | Pavel |
  | vuln-scanner | Viktor | product-manager | Nora | account-manager | Carmen | legal | Leila |
  | ui-ux-designer | Yuki | brand-artist | Bianca | motion-artist | Milo | game-artist | Gabriel |
  | prompt-artist | Iris | writer | Wen | marketer | Maya | localizer | Lucía |
  | ux-researcher | Uma | persona-tester | Priya | hands-on-tester | Hana | accessibility-tester | Amara |
  | market-researcher | Mateo | tech-researcher | Tariq | design-researcher | Daria | support | Sofia |

- **Settings:** `roles.<role>.name` at user and project level, shown as a **Name** column on the Roles tab (plugin, user and project layers, like model and effort).
- **Validation:** 1–30 characters of Unicode letters, spaces, hyphens and apostrophes. Effective names must be unique across Roles, case-insensitive, and Save refuses duplicates with the clashing Role named.
- **Where names show** (from the queued follow-up):
  - cooler scripts (speaker names)
  - brainstorm rounds
  - Gate summaries
  - Handoff bylines, as a prose line under the frontmatter: `By: Ava (architect)`
  - `/aico:help` and the README roster
- Setup resolves the names once with the rest of the settings, and every dispatch carries a `Name:` line. That's an additive `dispatch-prompt` v2 → v3 change, and an ADR 0006 note.
- **The Lead understands names in requests** ("have Ava look at the Contracts" → `aico:architect`), only when the name matches exactly one Role. *Lead's call.*
- `check.mjs`: `company/names.json` has exactly one valid, unique name per agent.

### Docs, checks and Contracts
- `documentation/commands.md` gets a `### /aico:settings` entry, and README and `docs/spec.md` mention it.
- ADR 0006: "Settings resolve in a script and travel in the dispatch". The precedence is project > user > plugin, and the script owns validation and writes.
- `check.mjs`: the roster's Role list must equal the set of Roles the settings schema allows.
- Tests (`scripts/settings.test.mjs`, `node --test`):
  - schema accept and refuse
  - precedence
  - atomic write
  - token, Host and Origin rejection
  - body cap
  - plugin defaults read from frontmatter
  - `get` output shape
  - the lock rules
  - profile writes leave the rest of `project.md` byte-identical
- Version: minor bump (new Playbook) to 0.10.0, with a CHANGELOG entry.

## Left to the builder
- The exact page styling, within the McSparrow voice and the light and dark rules above.
- Port choice and the browser-open command per OS (`start`, `open`, `xdg-open`). The URL is always printed as a fallback.
- Message wording, error copy and the idle-timeout notice.
