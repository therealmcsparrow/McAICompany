# Contract: aico-settings v1.1

Provider: `scripts/settings.mjs` (and `scripts/settings-server.mjs` for the page). Consumers: `aico:pipeline` Setup §1.7, the Playbooks that run through it, `aico:brainstorm`, `aico:cooler`, `aico:research`, `aico:settings` (command) and, from part M, the four mods (`aico-mods` v1).
Settings say how the company works: each Role's name, model and effort, the pipeline (Fix rounds, dispatch mode, optional lanes), the Gates and the mods. The writing language stays in `aico-language` v1; profile fields stay in `.company/project.md`.
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`): it adds `context_cap` (global and per Role), `brainstorm.film_script`, `brainstorm.debate` and (part M) `mods.*`. Every v1 file is a valid v1.1 file and resolves exactly as before; the stored `"version"` stays `1`.

## Storage
- **User:** `<MCSPARROW_HOME or ~/.mcsparrow>/config.json`, key `aico_settings`. Other keys, including `aico_language`, are preserved on write.
- **Project:** `.company/settings.json`, holding `{ "aico_settings": … }`.
- **Plugin:** model and effort from `agents/*.md` frontmatter, names from `company/names.json` (`role-names` v1), `PIPELINE_DEFAULTS`, `GATE_DEFAULTS`, `BRAINSTORM_DEFAULTS` and `MODS_DEFAULTS` in `settings.mjs`.
- Shape (any key may be absent, meaning not set at that level):
  ```json
  { "aico_settings": { "version": 1,
      "roles": { "architect": { "name": "Ava", "model": "opus", "effort": "high", "context_cap": 200000 } },
      "pipeline": { "fix_rounds": 2, "dispatch": "parallel", "context_cap": 150000,
                    "lanes": { "security": true, "compliance": true, "legal": "auto", "persona": true, "hands_on": true, "accessibility": true } },
      "gates": { "brief": "ask", "plan": "ask", "ship": "ask", "installs": "ask" },
      "brainstorm": { "film_script": false, "debate": "crossfire" },
      "mods": { "savvy": { "enabled": true, "pane": "auto" },
                "cache_tax": { "enabled": true, "pane": "command", "keep_warm": false, "keep_warm_horizon_min": 60 },
                "reflect": { "enabled": true, "step_check": true, "retrospective": true, "mode": "deterministic" },
                "blast_radius": { "enabled": true, "core": "ask", "contract": "ask", "security": "ask" } },
      "unlocked": [] } }
  ```
- Every write is atomic (temp file, then rename).

## Resolution
Per field: project, else user, else plugin. Then the locks:
- `unlocked` counts **only from the user level**. A project `unlocked` is ignored and listed in `ignored`.
- `gates.ship` and `gates.installs` resolve to `auto` only with that key in the user `unlocked`; otherwise `ask`, listed in `ignored`.
- `lanes.security` and `lanes.compliance` resolve to off only with `security` in the user `unlocked`; otherwise on, listed in `ignored`.
- A broken layer (invalid JSON, wrong type, unknown Role, unreadable or too large) falls back to the level below for the bad parts, with a `warnings` line.
- A project layer with any such problem may have lost a re-lock, so it fails closed: `gates.ship` and `gates.installs` are held at `ask` and `lanes.security` and `lanes.compliance` on, whatever the user `unlocked` says, with a `warnings` line. Part M: it also holds `mods.blast_radius` at its plugin defaults and `mods.cache_tax.keep_warm` off and `mods.reflect.mode` `deterministic`.
- **Context cap (v1.1):** a Role's effective cap is `roles.<role>.context_cap` (project, else user), else `pipeline.context_cap` (project, else user), else the plugin default `150000`. `source` says which. `settings.mjs` applies **no** risk rule: the high-risk floor and the 80% handover point live only in pipeline Core (`dispatch-prompt` v3.1 `Context cap:`).
- **Debate style (v1.1):** `brainstorm.debate` resolves per field like any other key (project, else user, else plugin default `crossfire`). It is not a lock: no `unlocked` entry is involved and a fail-closed project layer does not change it.
- **Mods (v1.1, part M):** per field like any other key, plus three lock rules:
  1. *Spend switches are user-level only.* `mods.cache_tax.keep_warm: true`, `mods.cache_tax.keep_warm_horizon_min` and `mods.reflect.mode: model` count only from the user level; a project value is ignored and listed in `ignored` (a cloned repo never spends the CEO's tokens).
  2. *The commit gate only tightens from a project.* A project layer may set `mods.blast_radius.enabled: true` or a category to `ask`; a project `enabled: false` or `warn` is ignored and listed in `ignored`.
  3. *Security stays asked unless unlocked.* `mods.blast_radius.security: warn` and `mods.blast_radius.enabled: false` resolve only with `security` in the user `unlocked`; otherwise `ask` and `true`, listed in `ignored`. `core` and `contract` may be `warn` at the user level without an unlock.
  Every other `mods.*` key (each mod's `enabled` except Blast Radius, `pane`, `step_check`, `retrospective`) resolves freely.

## Schema (allow-list; unknown keys are refused)
| Key | Values |
|---|---|
| `roles.<role>.model` | `opus \| sonnet \| haiku \| fable \| inherit` (`<role>` is an existing `agents/*.md`) |
| `roles.<role>.effort` | `low \| medium \| high \| xhigh \| max` |
| `roles.<role>.name` | `role-names` v1 rules |
| `roles.<role>.context_cap` | integer 60000–1000000 (v1.1) |
| `pipeline.fix_rounds` | integer 0–5 |
| `pipeline.dispatch` | `parallel \| sequential` |
| `pipeline.context_cap` | integer 60000–1000000; default 150000 (v1.1) |
| `pipeline.lanes.<security\|compliance\|persona\|hands_on\|accessibility>` | boolean |
| `pipeline.lanes.legal` | `auto \| on \| off` (`auto`: only for AI, payments or personal data) |
| `gates.<brief\|plan\|ship\|installs>` | `ask \| auto` |
| `brainstorm.film_script` | boolean; default `false` (v1.1) |
| `brainstorm.debate` | `crossfire \| full_pass`; default `crossfire` (v1.1) |
| `mods.<savvy\|cache_tax\|reflect\|blast_radius>.enabled` | boolean; default `true` (part M) |
| `mods.<savvy\|cache_tax>.pane` | `auto \| command`; default `auto` for `savvy`, `command` for `cache_tax` (`auto`: the pane opens unasked when a run becomes active, only where the surface docks it as a sidebar) |
| `mods.cache_tax.keep_warm` | boolean; default `false`; user level only |
| `mods.cache_tax.keep_warm_horizon_min` | integer 5–480; default `60`; user level only |
| `mods.reflect.step_check` | boolean; default `true` |
| `mods.reflect.retrospective` | boolean; default `true` |
| `mods.reflect.mode` | `deterministic \| model`; default `deterministic`; `model` user level only |
| `mods.blast_radius.<core\|contract\|security>` | `ask \| warn`; default `ask` |
| `unlocked` | list of `ship`, `security`, `installs` |

A `context_cap` below 60000 (the floor), above 1000000, or not a whole number is refused: `refused: context_cap must be a whole number from 60000 to 1000000`, nothing written.
Any other `brainstorm.debate` value is refused: `refused: brainstorm.debate must be crossfire or full_pass`, nothing written.
A bad `mods.*` value is refused with `refused: mods.<path> must be <allowed values>`, nothing written; `keep_warm_horizon_min` outside 5–480 or not whole: `refused: mods.cache_tax.keep_warm_horizon_min must be a whole number from 5 to 480`.

`brainstorm.debate` picks how a **debate** round runs (`brainstorm-file` v2, `brainstorm-reply` v1):
- `crossfire`: the ideas pass only; the strongest challenge (the crossfire pair) is answered by the idea's author in the next round's ideas pass, with no extra dispatch (Fix round 4, `docs/adr/0014-crossfire-folded-into-next-round.md`; before: one extra dispatch per pair member in the same round).
- `full_pass`: the ideas pass, then a full pass (every Role answers the others' replies of that round), then the crossfire pair on top, dispatched in the same round.
It has no effect on `ideas` or `moderated` rounds. Values and default are unchanged by Fix round 4.

## CLI (Node ESM, no dependencies, cwd = product repo)
| Command | stdout (exit 0) |
|---|---|
| `node settings.mjs get` | the resolved JSON: `{ revision, roles: {<role>: {name, model, effort, context_cap, source}}, pipeline: {fix_rounds, dispatch, context_cap, lanes}, gates, brainstorm: {film_script, debate}, mods: {savvy, cache_tax, reflect, blast_radius}, unlocked, ignored, warnings, language, profile }` |
| `node settings.mjs get <key>` | one value (dotted path, e.g. `pipeline.fix_rounds`, `roles.architect.context_cap`, `brainstorm.debate`, `mods.blast_radius.security`); strings raw, others as JSON |
| `node settings.mjs serve [--no-open]` | `aico settings: <url>` (127.0.0.1, token in the URL) |

Warnings also go to stderr as `warning: <text>`.
The page shows the global cap, a per-Role cap field, the film-script toggle and a debate-style choice (`crossfire` / `full_pass`, the same row control the page uses for `pipeline.dispatch`), using the page's existing controls; it saves through the same validation.
Part M: the page has a **Mods** section with one row per mod: its on/off switch, then its options, built from the page's existing controls (switch, row choice, number field). Keep-warm shows, beside its switch, the sentence "Spends tokens while the Lead waits; see the cost in Cache Tax before you switch it on." A value held by a lock shows the lock and its reason (the same way the page shows `gates.ship`). Switching a mod off keeps its options.

## How the pipeline uses it (`aico:pipeline`)
- Setup §1.7 runs `get` once per run (fixed command) and keeps the JSON; never re-resolved mid-run.
- Model and effort: passed on the Agent call only when they differ from the agent frontmatter. `inherit` means the Lead's session model: the Lead passes its session model family (`opus | sonnet | haiku | fable`), never the literal `inherit` and never an omitted `model` (that falls back to the frontmatter). Recorded in the `Settings:` dispatch line (`dispatch-prompt` v3).
- `pipeline.fix_rounds` is the Fix-round limit; at 0 the first blocking review goes to the CEO. `sequential` dispatches the ∥ Steps one at a time.
- Lanes gate the optional lanes in `feature`, `fix`, `maintain` and `refactor`; lanes a Playbook always runs are unaffected.
- `auto` Gates write their summary to the run folder and continue. Never auto, whatever the settings: `needs-ceo`, Blocking security findings, picks, escalations, design-skill set approval, client sends, publishing, authority reports, production deploys. An auto Ship Gate first runs the Finish writes and commits (summary, Debt, Lessons), then pushes the branch and opens a PR, then stops; it never merges.
- `roles.<role>.context_cap` becomes the `Context cap:` dispatch line after the pipeline applies the high-risk floor and the 80% handover point (`dispatch-prompt` v3.1).
- `brainstorm.film_script` is read by `aico:brainstorm` (`brainstorm-file` v2); `true` renders the film script file at each round.
- `brainstorm.debate` is read by `aico:brainstorm` from the run's `get` JSON (never re-resolved mid-run) and written into each debate round's heading (`brainstorm-file` v2), so the file records which style ran.
- `mods.*` is never read by the pipeline. The mods run `get` themselves at session start and at each main-loop turn start (`aico-mods` v1), so a change takes effect by the next turn.

## Error cases
- `get` exits non-zero or prints invalid JSON → the pipeline uses plugin defaults and says so in the first Gate summary and in its first chat message. Plugin defaults include `context_cap` 150000, `film_script` false and `debate` `crossfire`. The mods use `MODS_DEFAULTS` (all on, keep-warm off, Reflect deterministic, Blast Radius `ask`) and show `settings unknown` in their status line.
- Invalid value, unknown key or a stale `revision` on save: `refused: <reason>` (exit 2 on the CLI, 4xx from the server), nothing written.
- Unknown subcommand or extra arguments: `refused: usage: settings.mjs get [key] | serve [--no-open]` (exit 2).
- `get <key>` for a missing key: `refused: no setting <key>` (exit 2).
- A layer with a bad `context_cap`, `brainstorm.debate` or `mods.*` value → that field falls back to the level below, with a `warnings` line (broken-layer rule above).
