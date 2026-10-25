# Settings page and Role names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/aico:settings` opens a local page to change every Role's name, model and effort, the language and profile, and pipeline and Gate behaviour. Values are saved at user or project level, and aico applies them on every run.

**Architecture:** There are three parts:
- `scripts/settings.mjs` owns the schema, validation, layer reads and writes, and resolution (project > user > plugin). Its CLI (`get`) is the only way the pipeline reads settings.
- `scripts/settings-server.mjs` serves the static page `scripts/settings-page.html` on 127.0.0.1, behind a token. It calls `settings.mjs` for everything.
- The pipeline resolves settings once in Setup and passes the results on: `model` and `effort` on the Agent call, `Name:` and `Settings:` in the dispatch block, and Fix rounds, dispatch mode, lanes and Gates in its own flow.

**Tech Stack:** Node ≥ 24 ESM, no dependencies, `node --test`. Markdown skills.

**Spec:** `docs/superpowers/specs/2026-10-26-settings-page-design.md`

## Global Constraints
- No npm dependencies, and no CDN or remote URL in the page. Node `>=24`.
- Server binds `127.0.0.1` only. The token is 32 random bytes, hex. Every request without the token gets a 403. Writes are `POST` with `Content-Type: application/json` only. The `Host` and `Origin` headers must be `127.0.0.1:<port>` or `localhost:<port>`. The body cap is 64 KB (65536 bytes; larger gets a 413). The idle timeout is 30 minutes.
- `model` is one of `opus | sonnet | haiku | fable | inherit`. `effort` is one of `low | medium | high | xhigh | max`. `fix_rounds` is an integer 0–5. `dispatch` is `parallel | sequential`.
- Lanes: `security`, `compliance`, `persona`, `hands_on` and `accessibility` are booleans. `legal` is `auto | on | off`. Gates `brief | plan | ship | installs` are `ask | auto`. `unlocked` may contain only `ship`, `security` and `installs`.
- `unlocked` counts only from the user level. A project `unlocked` is ignored and reported in `ignored`.
- Names are 1–30 characters matching `^[\p{L}][\p{L} '\-]{0,29}$`u. Effective names are unique, case-insensitive.
- Profile free text (`client`, `audience`, `goal`, `stack`, `license`, `jurisdiction`) is ≤ 200 characters, with no control characters (`/[\u0000-\u001f\u007f]/`). `product_type`, `engagement` and `voice` must be options from `skills/lead/references/project-template.md`. `voice` can join several options with ` + `. A value that is already stored and unchanged is never re-validated, so existing values like `product_type: plugin` survive.
- Storage:
  - User: `<MCSPARROW_HOME or ~/.mcsparrow>/config.json`, key `aico_settings`. Other keys, including `aico_language`, are preserved.
  - Project: `.company/settings.json` holding `{ "aico_settings": … }`.
  - Every write is atomic (write to a temp file, then rename).
- Machine-read parts stay English (`dispatch-prompt` v2). Role names are display only. Never route on a name except the Lead's exact single-match rule.
- Agents stay ≤ 50 lines and skills ≤ 125 lines (the checker warns past that). Commit subjects are `<type>: <summary>`, with no `aico` or Role prefix.

## Review Focus
1. **Broken `config.json` or `settings.json`** (invalid JSON, wrong types, a deleted agent's Role key). `get` still returns plugin defaults for the bad parts, with a stderr warning, and the page shows it. Covered by a test in Task 3.
2. **Two browser tabs or a stale page saving over newer values.** Each save sends the `revision` it loaded. A mismatch gets a 409, and the page reloads its state. Covered by a test in Task 5.
3. **A project `unlocked: ["ship"]` with `ship: auto` from a cloned repo.** The effective ship Gate stays `ask`. Covered by a test in Task 3.
4. **Opening the page outside a product repo (no `.company/`).** The Project column and profile are disabled, and saving at user level still works. Covered by a test in Task 5.
5. **A `project.md` with CRLF line endings or extra header lines.** A profile write changes only the edited lines and keeps the line endings. Covered by a test in Task 4.

---

### Task 1: Finish the effort work (docs drift and commit)

**Files:**
- Modify: `documentation/roles.md` (each Role table becomes `| Role | Model | Effort | What it's for |`; the models change for writer, vuln-scanner and design-researcher; rewrite the line-5 intro to mention effort)
- Modify: `scripts/check.mjs` (`checkRoleCounts`)
- Test: `scripts/check.test.mjs`

**Interfaces:**
- Produces: a check that each `| **<role>**… | <model> | <effort> |` row in `documentation/roles.md` matches the agent's frontmatter.

- [ ] **Step 1: Write the failing test** `roles.md model or effort that differs from frontmatter is an error`. Build a fixture with agent `qa` (sonnet, medium) and `documentation/roles.md` containing `| **qa** | opus | medium | x |`. Assert that an error includes `documentation/roles.md: qa model opus != sonnet`. Add a second case for effort.
- [ ] **Step 2:** Run `node --test scripts/check.test.mjs`. Expected: the new test FAILS.
- [ ] **Step 3:** In `checkRoleCounts`, parse rows with `/^\|\s*\*\*([a-z-]+)\*\*[^|]*\|\s*(\w+)\s*\|\s*(\w+)\s*\|/m` per line and compare them to the parsed frontmatter. Pass the parsed agent frontmatter in from `check()` as a `Map<role,{model,effort}>`.
- [ ] **Step 4:** Update `documentation/roles.md`. Run `npm test && npm run check`. Expected: all tests pass and `0 error(s)`.
- [ ] **Step 5: Commit**
  ```bash
  git add agents docs/spec.md README.md CHANGELOG.md scripts/check.mjs scripts/check.test.mjs scripts/research-roles.test.mjs documentation/roles.md
  git commit -m "feat: set an effort level for every Role and rebalance three models"
  ```
  The `.company/` standards edit is gitignored and stays local.

### Task 2: Default Role names

**Files:**
- Create: `company/names.json`, holding the 32 names from the spec table, as `{ "<role>": "<name>" }` in roster order.
- Modify: `scripts/check.mjs`
- Test: `scripts/check.test.mjs`

**Interfaces:**
- Produces:
  - `export const NAME_RE = /^[\p{L}][\p{L} '\-]{0,29}$/u` in `scripts/check.mjs`, imported later by `settings.mjs`.
  - `export function checkNames(root, agentNames, errors)`.

- [ ] **Step 1: Write the failing tests**:
  - `names.json missing a Role is an error`: the error includes `company/names.json: qa has no name`.
  - `duplicate names (case-insensitive) are an error`: `qa: "Sam"` and `support: "sam"` give an error including `duplicate name sam`.
  - `invalid name is an error`: `"Sam!"` gives an error including `invalid name`.
  - `a name for an unknown Role is an error`.
  - All checks are skipped when `company/names.json` is absent, so the existing fixtures stay green.
- [ ] **Step 2:** Run `node --test scripts/check.test.mjs`. Expected: the 4 new tests FAIL.
- [ ] **Step 3:** Implement `checkNames` and call it from `check()` after `checkRoleCounts`. Create `company/names.json`.
- [ ] **Step 4:** Run `npm test && npm run check`. Expected: pass and `0 error(s)`.
- [ ] **Step 5: Commit** `feat: default person names for every Role`.

### Task 3: Settings core: schema, layers, resolution, `get`

**Files:**
- Create: `scripts/settings.mjs`
- Test: `scripts/settings.test.mjs`. Use the sandbox pattern from `scripts/language.test.mjs`: a temp `home` and `repo`, `MCSPARROW_HOME`, `t.after` cleanup, and a fixture plugin root with 3 agents plus `company/names.json`.

**Interfaces:**
- Consumes: `NAME_RE` from `scripts/check.mjs`.
- Produces (all exported from `scripts/settings.mjs`):
  - `MODELS`, `EFFORTS`, `LANES`, `GATES`, `LOCKABLE`: arrays of the values in Global Constraints. `LANES = ['security','compliance','legal','persona','hands_on','accessibility']`, `GATES = ['brief','plan','ship','installs']`, `LOCKABLE = ['ship','security','installs']`.
  - `PIPELINE_DEFAULTS = { fix_rounds: 2, dispatch: 'parallel', lanes: { security: true, compliance: true, legal: 'auto', persona: true, hands_on: true, accessibility: true } }`
  - `GATE_DEFAULTS = { brief: 'ask', plan: 'ask', ship: 'ask', installs: 'ask' }`
  - `pluginDefaults(pluginRoot) -> { roles: { [role]: { name, model, effort } }, pipeline, gates }`. Reads `agents/*.md` frontmatter and `company/names.json`.
  - `validateLayer(layer, roleNames: Set<string>) -> string[]`. Returns refusal reasons; empty means valid. `layer` has the shape `{ version: 1, roles?, pipeline?, gates?, unlocked? }`. Unknown keys at any depth are refused.
  - `readLayer(level: 'user'|'project', { home, cwd }) -> { layer, warnings: string[] }`. Invalid parts are dropped, with a warning.
  - `resolveSettings({ home, cwd, pluginRoot }) -> Resolved`. `Resolved = { revision, roles: { [role]: { name, model, effort, source: { name, model, effort } } }, pipeline, gates, unlocked: string[], ignored: string[], warnings: string[] }`. `source` values are `plugin|user|project`. `revision` is the sha256 hex of both raw layer files.
  - `writeLayer(level, layer, { home, cwd, pluginRoot }) -> void`. Validates, checks name uniqueness against the resolved result, and writes atomically. Throws `Refusal` (exported class) with the reasons joined by `; `.
  - `run(args, { home, cwd, pluginRoot }) -> { code, out }`.
    - `get` prints `JSON.stringify(Resolved)`.
    - `get <dot.path>` prints that value (strings raw, others as JSON).
    - An unknown command prints `refused: usage: settings.mjs get [key] | serve [--no-open]` and returns code 2.

- [ ] **Step 1: Write the failing tests**:
  - `plugin defaults come from frontmatter and names.json`
  - `project beats user beats plugin, per field`: user sets `qa.model=opus`, project sets `qa.effort=high`. Resolved is `opus/high`, with sources `user/project`, and the name from `plugin`.
  - `validateLayer refuses` `model: "gpt4"`, `effort: "huge"`, `fix_rounds: 6`, `fix_rounds: 1.5`, `dispatch: "fast"`, `legal: true`, `gates.ship: "yes"`, `unlocked: ["brief"]`, an unknown Role, and an unknown key `foo`. Each gives one reason naming the field.
  - `ship auto without a user unlock stays ask`.
  - `project unlocked is ignored`: project `{ unlocked: ['ship'], gates: { ship: 'auto' } }` resolves to `gates.ship === 'ask'`, and `ignored` includes `project unlocked: ship`.
  - `security lane off needs the user security unlock`: the same rule applies to `compliance`, and `installs: auto` needs the `installs` unlock.
  - `project can lock again`: user unlocks `ship` with `ship: 'auto'`, project sets `ship: 'ask'`, and the result is `ask`.
  - `duplicate effective names are refused on write`: user `qa.name = "Ava"` collides with plugin `architect: Ava`. The `Refusal` message includes `Ava` and `architect`.
  - `broken config.json falls back to defaults with a warning` (Review Focus 1).
  - `writeLayer user keeps aico_language and other keys`
  - `write is atomic`: no `*.tmp` file is left behind, and an invalid write leaves the file byte-identical.
  - `get CLI prints JSON` and `get roles.qa.model prints sonnet`: spawned with `MCSPARROW_HOME`.
- [ ] **Step 2:** Run `node --test scripts/settings.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `scripts/settings.mjs`. Copy the bounded-read, atomic-write and `Refusal` patterns from `language.mjs`; don't import its private helpers. Resolution goes per field: project, then user, then plugin. Then apply the lock rule: an `auto` on a `LOCKABLE` Gate, or `false` on the `security` or `compliance` lane, only takes effect when the matching key is in the user layer's `unlocked`. Otherwise it falls back to the default and pushes a note to `ignored`. The CLI entry follows `language.mjs`'s `import.meta.url` pattern, with `pluginRoot = path.join(import.meta.dirname, '..')`.
- [ ] **Step 4:** Run `node --test scripts/settings.test.mjs && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: settings resolver with user and project layers`.

### Task 4: Profile fields and language through settings

**Files:**
- Modify: `scripts/settings.mjs`
- Modify: `scripts/language.mjs` (export the existing `headerEnd` only)
- Test: `scripts/settings.test.mjs`

**Interfaces:**
- Consumes: `setLanguage` and `clearLanguage` from `language.mjs`. `resolve` is imported as `resolveLanguage`.
- Produces:
  - `PROFILE_FIELDS = ['product_type','engagement','client','audience','goal','stack','languages','voice','license','jurisdiction']`
  - `templateOptions(pluginRoot) -> { product_type: string[], engagement: string[], voice: string[] }`. Parsed from the `a | b | c` values in the template. Options in `<…>` are skipped.
  - `readProfile({ cwd }) -> { hasProject: boolean, fields: { [field]: string } }`
  - `writeProfile(changes: { [field]: string }, { cwd, pluginRoot }) -> void`. Throws `Refusal`.
  - `Resolved` gains `language: { tag, source }` (from `resolveLanguage`) and `profile: { hasProject, fields, options }`.

- [ ] **Step 1: Write the failing tests**:
  - `writeProfile changes only edited lines`: the rest of `project.md` stays byte-identical, with CRLF preserved (Review Focus 5).
  - `writeProfile refuses` `product_type: "spaceship"`, a newline in `goal`, 201 characters in `audience`, and `languages: "en, xx-!!"`.
  - `voice accepts "technical + clear"`
  - `an unchanged stored value outside the options is kept` (`product_type: plugin` as stored is not refused when other fields change).
  - `no .company/project.md → readProfile.hasProject false; writeProfile refuses "no .company/project.md"`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the functions. A field missing from the header is inserted after the last `key:` header line, the same way as `setLanguage`. Compare against the stored value before validating, so unchanged values skip validation.
- [ ] **Step 4:** Run `node --test scripts/settings.test.mjs scripts/language.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: profile fields and language in the settings resolver`.

### Task 5: Local settings server

**Files:**
- Create: `scripts/settings-server.mjs`
- Modify: `scripts/settings.mjs` (`serve` subcommand delegates to the server)
- Test: `scripts/settings-server.test.mjs`. Start the server on port 0 with `open: false` and a temp home and repo, and use global `fetch`.

**Interfaces:**
- Consumes: `resolveSettings`, `pluginDefaults`, `readLayer`, `writeLayer`, `writeProfile`, `setLanguage`, `clearLanguage`, `Refusal`.
- Produces: `startServer({ home, cwd, pluginRoot, port = 0, idleMs = 1_800_000, open = true }) -> Promise<{ url, port, token, closed: Promise<void>, close() }>`.
- HTTP API (all require `?token=` or the `X-Aico-Token` header):
  - `GET /` returns the page, with `__AICO_TOKEN__` replaced in `<meta name="aico-token">`.
  - `GET /api/state` returns `{ plugin, user, project, resolved, hasProject }`, where `user` and `project` are the raw layers.
  - `POST /api/save` takes the body `{ revision, user?, project?, profile?, language?: { user?: tag|null, project?: tag|null } }`. It returns 200 `{ state }`, 400 `{ refused: string[] }`, or 409 `{ state }` when `revision` is stale. It validates everything before writing anything.
  - `POST /api/done` returns 200 and then closes the server.
- On start, it prints `aico settings: <url>` to stdout. It opens the browser with `start "" <url>` (win32), `open` (darwin) or `xdg-open`, using `spawn` with `shell: false` (on win32, via `cmd /c start "" url`). If the open fails, the printed URL is still there.

- [ ] **Step 1: Write the failing tests**:
  - `403 without token`
  - `403 for a bad Host header`: `Host: evil.example:PORT`
  - `403 for a POST with foreign Origin`: `Origin: http://evil.example`
  - `403 for a POST without Origin`
  - `415 for a POST that is not application/json`
  - `413 for a body over 65536 bytes`
  - `GET / injects the token and has no http(s) URL except the server's own`: assert `!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(html)`.
  - `save writes user and project layers and returns new state`
  - `save refuses invalid and writes nothing`
  - `stale revision → 409` (Review Focus 2)
  - `no .company → project save refused, user save works, hasProject false` (Review Focus 4)
  - `done closes the server`
  - `idle timeout closes the server`: `idleMs: 50`
- [ ] **Step 2:** Run `node --test scripts/settings-server.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement it with `node:http` and `crypto.randomBytes(32).toString('hex')`. Every request resets the idle timer. Read the body with a running byte count, and destroy the request once it passes 65536 bytes. Compare tokens with `crypto.timingSafeEqual`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: token-protected local settings server`.

### Task 6: Settings page (layout B)

**Files:**
- Create: `scripts/settings-page.html` (inline CSS and JS only)
- Test: `scripts/settings-server.test.mjs` (static assertions on the served HTML)

**Interfaces:**
- Consumes: the Task 5 HTTP API and `Resolved` shape.

The page:
- **Tabs:** `Roles · Language & profile · Pipeline · Gates`.
- **Every table has the columns** `Plugin | User | Project | In effect`.
  - User and Project cells are dropdowns or inputs, where `—` means not set.
  - "In effect" is computed live, and re-read from `state.resolved` after Save.
- **Roles tab:**
  - Name, model and effort per Role, with department sub-header rows in README order.
  - A bulk row: department or all, level, model and/or effort, then Apply.
- **Gates tab:**
  - The Ship, Installs and security rows (the security row covers the security and compliance lanes) show a lock.
  - Changing them at the User level first opens a `<dialog>` with the exact consequence text. For ship: "aico will push the branch and open a PR without asking you. It never merges."
  - The Project column for locks is read-only, labelled "unlocks only count from your user settings".
  - Every `ignored` entry is listed.
- **Footer:** an "N unsaved changes" counter, Save, "Clear this level" per tab and level, and Done.
- **No `.company/`:** the Project column and profile are disabled, with a one-line reason.
- **Theme:** CSS custom properties with `prefers-color-scheme: dark`. Works at 360 px wide (the tables scroll inside their own container).

- [ ] **Step 1: Write the failing test** `page has the four tabs, a lock dialog, and no external resources`. Assert that the HTML contains the 4 tab labels, `<dialog`, and `__AICO_TOKEN__` in the raw file, and that it has no `<script src=`, no `<link rel="stylesheet"`, and no `@import`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Build the page.
- [ ] **Step 4:** Run `npm test`. Then run it by hand: `node scripts/settings.mjs serve` in this repo. Change `writer` effort to `medium` at project level, Save, and check that `node scripts/settings.mjs get roles.writer.effort` prints `medium`. Clear it again, and press Done.
- [ ] **Step 5: Commit** `feat: settings page with side-by-side layers`.

### Task 7: `/aico:settings` Playbook and docs entry

**Files:**
- Create: `skills/settings/SKILL.md` (`disable-model-invocation: true`, `argument-hint: "[help]"`, Help line, ≤ 40 lines)
- Modify: `documentation/commands.md` (a `### /aico:settings` entry in the same format as `### /aico:language`)
- Modify: `scripts/check.mjs` (`LANGUAGE_EXEMPT` gains `settings`, the same as `language`)

The Playbook:
1. Runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" serve` from the product root, with `run_in_background`.
2. Reads the printed URL and gives it to the CEO in full.
3. Says the page stops on Done or after 30 minutes idle, and that changes apply from the next aico run.
4. Dispatches no Role, creates no branch, and makes no commit.
5. Never edits `config.json`, `settings.json` or `project.md` itself.

- [ ] **Step 1:** Run `npm run check` once the skill exists without a commands entry. Expected: FAIL with `Playbook settings has no ### /aico:settings entry`.
- [ ] **Step 2:** Add the entry and the exemption. Run `npm run check`. Expected: `0 error(s)`.
- [ ] **Step 3: Commit** `feat: /aico:settings Playbook`.

### Task 8: Pipeline applies settings

**Files:**
- Modify: `skills/pipeline/SKILL.md`, `skills/feature/SKILL.md`, `skills/fix/SKILL.md`, `skills/maintain/SKILL.md`, `skills/refactor/SKILL.md`, `skills/client/SKILL.md`, `skills/launch/SKILL.md`, `skills/incident/SKILL.md`
- Modify: `docs/contracts/dispatch-prompt.md` (v2 → v3)
- Create: `docs/contracts/aico-settings.md`, `docs/contracts/role-names.md`, `docs/adr/0006-settings-in-script-and-dispatch.md`
- Modify: `scripts/check.mjs` (dispatch blocks with `Company profile:` must also have `Name:`)
- Test: `scripts/check.test.mjs`, plus a new `scripts/settings-docs.test.mjs` (drift)

**Interfaces:**
- Consumes: the `settings.mjs get` output (`Resolved`).
- Produces: dispatch-prompt v3, which adds two lines after `Language:`:
  - `Name: <name>`: always.
  - `Settings: model=<m> effort=<e>`: only the overridden ones; the line is omitted when nothing is overridden.

  Contract rule: a Role with no `Name:` uses its Role title.

Pipeline text to add:
- **Setup §1.7 Settings:**
  - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" get` once (fixed command). Keep the JSON for the run.
  - A non-zero exit or invalid JSON means plugin defaults, plus one line in the first Gate summary. List `warnings` and `ignored` in that summary too.
- **§2:**
  - Pass `model` (omitted when `inherit`) and `effort` on the Agent call when they differ from the agent frontmatter.
  - `pipeline.dispatch == 'sequential'` → dispatch the ∥ Steps one at a time, in the listed order.
- **§4:**
  - A Gate with `auto` writes `NN-gate-<brief|plan|ship>.md` (its summary) and continues, then states it in the next message.
  - An auto Plan Gate still stops when there are exception requests or a rejected rule.
  - An auto Ship Gate pushes the branch, runs `gh pr create`, and stops. It never merges.
  - These always remain forms: `needs-ceo`, Blocking security, picks, escalations and design-skill set approval.
  - Client sends, publishing, authority reports and production deploys always ask.
- **§5:**
  - The limit is `pipeline.fix_rounds`. At 0, the first blocking review goes to the CEO.
- **Lanes:** each optional lane in `feature` (2b persona, 4: security, compliance, legal, hands_on, accessibility), `fix` (security), `maintain` and `refactor` (compliance) gets the phrase "when `lanes.<key>` is on (`aico:pipeline` §1.7)". Skipped lanes are listed in the Ship Gate summary. Lanes a Playbook always runs (`audit`) are unchanged.
- **Installs:** `feature` 1a-d runs without the Install form only when `gates.installs == 'auto'`.
- **`client`, `launch`, `incident`:** one line each saying their outside sends always ask, whatever the settings say.

- [ ] **Step 1: Write the failing tests**:
  - In `check.test.mjs`: `dispatch block without Name: is an error`.
  - In `settings-docs.test.mjs`:
    - `PIPELINE_DEFAULTS.fix_rounds matches pipeline prose`: the pipeline text contains `(max 2)` or `at most 2`.
    - `pipeline says parallel by default`
    - `every lane key appears in a Playbook`
    - `dispatch-prompt is v3 and lists Name: and Settings:`
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Make the edits. Add `Name:` to every dispatch block (pipeline, brainstorm, cooler, research), so the checker passes. Write the contract docs and ADR 0006: precedence project > user > plugin, the script owns validation, settings travel in the dispatch, and unlocks count only from the user level.
- [ ] **Step 4:** Run `npm test && npm run check`. Expected: pass, with 0 errors and no line-limit warnings.
- [ ] **Step 5: Commit** `feat: pipeline applies settings at dispatch, Gates and Fix rounds`.

### Task 9: Names on display

**Files:**
- Modify: `skills/cooler/SKILL.md`. Cues become `**<NAME> (<ROLE>)**` on a speaker's first line and `**<NAME>**` after that. Action lines use `<NAME>`. Names come from the settings `get` output in step 4.
- Modify: `skills/brainstorm/SKILL.md` (digests use `Name (role)`)
- Modify: `skills/handoff/SKILL.md`. Add a prose line `By: <Name> (<role>)` directly under the frontmatter, written from `Name:`. A missing `Name:` means the Role title is used.
- Modify: `skills/lead/SKILL.md`. Add a rule: a name in the CEO's request that matches exactly one effective Role name, case-insensitive, routes to that Role. Two or no matches means a form or normal routing.
- Modify: `skills/help/SKILL.md` and `documentation/roles.md` (a Name column with the defaults; the help Role lookup also accepts a name).
- Modify: `skills/pipeline/SKILL.md` §4 (Gate summaries name Roles as `Name (role)`)
- Test: `scripts/settings-docs.test.mjs`

- [ ] **Step 1: Write the failing tests**:
  - `handoff skill documents the By: line`
  - `cooler cues use names`: the cooler skill contains `<NAME> (<ROLE>)`.
  - `roles.md lists every default name`: each `names.json` value appears in `documentation/roles.md`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Make the edits, keeping each file under its line limit. Task 1's roles.md row regex has to still match after the Name column is added, so put Name **after** Effort: `| Role | Model | Effort | Name | What it's for |`.
- [ ] **Step 4:** Run `npm test && npm run check`. Expected: pass.
- [ ] **Step 5: Commit** `feat: show Role names in scripts, Handoffs, Gates and help`.

### Task 10: Release 0.10.0

**Files:**
- Modify: `.claude-plugin/plugin.json` (`"version": "0.10.0"`), `documentation/README.md` (`Current: 0.10.0`)
- Modify: `CHANGELOG.md`. Turn `[Unreleased]` into `[0.10.0] - <date>` and add Added: `/aico:settings`, Role names. Changed: the pipeline reads settings; dispatch-prompt v3.
- Modify: `README.md` (Use table row for `/aico:settings`, a line on names), `docs/spec.md` (`/aico:settings` section, Name column in the roster)

- [ ] **Step 1:** Run `npm test && npm run check && claude plugin validate .`. Expected: all pass, `0 error(s)`, and `✔ Validation passed`.
- [ ] **Step 2:** Run it end to end in this repo:
  1. `node scripts/settings.mjs serve`.
  2. Set `architect` name to `Ada` at project level and save.
  3. Check that `node scripts/settings.mjs get roles.architect.name` prints `Ada`.
  4. Clear it again.
- [ ] **Step 3: Commit** `chore: release 0.10.0`.
