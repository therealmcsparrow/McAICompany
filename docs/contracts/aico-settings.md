# Contract: aico-settings v1.1

Provider: `scripts/settings.mjs` (and `scripts/settings-server.mjs` for the page). Consumers: `aico:pipeline` Setup §1.7, the Playbooks that run through it, `aico:brainstorm`, `aico:cooler`, `aico:research`, `aico:settings` (command).
Settings say how the company works: each Role's name, model and effort, the pipeline (Fix rounds, dispatch mode, optional lanes) and the Gates. The writing language stays in `aico-language` v1; profile fields stay in `.company/project.md`.
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`): it adds `context_cap` (global and per Role), `brainstorm.film_script` and `brainstorm.debate`. Every v1 file is a valid v1.1 file and resolves exactly as before; the stored `"version"` stays `1`.

## Storage
- **User:** `<MCSPARROW_HOME or ~/.mcsparrow>/config.json`, key `aico_settings`. Other keys, including `aico_language`, are preserved on write.
- **Project:** `.company/settings.json`, holding `{ "aico_settings": … }`.
- **Plugin:** model and effort from `agents/*.md` frontmatter, names from `company/names.json` (`role-names` v1), `PIPELINE_DEFAULTS`, `GATE_DEFAULTS` and `BRAINSTORM_DEFAULTS` in `settings.mjs`.
- Shape (any key may be absent, meaning not set at that level):
  ```json
  { "aico_settings": { "version": 1,
      "roles": { "architect": { "name": "Ava", "model": "opus", "effort": "high", "context_cap": 200000 } },
      "pipeline": { "fix_rounds": 2, "dispatch": "parallel", "context_cap": 150000,
                    "lanes": { "security": true, "compliance": true, "legal": "auto", "persona": true, "hands_on": true, "accessibility": true } },
      "gates": { "brief": "ask", "plan": "ask", "ship": "ask", "installs": "ask" },
      "brainstorm": { "film_script": false, "debate": "crossfire" },
      "unlocked": [] } }
  ```
- Every write is atomic (temp file, then rename).

## Resolution
Per field: project, else user, else plugin. Then the locks:
- `unlocked` counts **only from the user level**. A project `unlocked` is ignored and listed in `ignored`.
- `gates.ship` and `gates.installs` resolve to `auto` only with that key in the user `unlocked`; otherwise `ask`, listed in `ignored`.
- `lanes.security` and `lanes.compliance` resolve to off only with `security` in the user `unlocked`; otherwise on, listed in `ignored`.
- A broken layer (invalid JSON, wrong type, unknown Role, unreadable or too large) falls back to the level below for the bad parts, with a `warnings` line.
- A project layer with any such problem may have lost a re-lock, so it fails closed: `gates.ship` and `gates.installs` are held at `ask` and `lanes.security` and `lanes.compliance` on, whatever the user `unlocked` says, with a `warnings` line.
- **Context cap (v1.1):** a Role's effective cap is `roles.<role>.context_cap` (project, else user), else `pipeline.context_cap` (project, else user), else the plugin default `150000`. `source` says which. `settings.mjs` applies **no** risk rule: the high-risk floor and the 80% handover point live only in pipeline Core (`dispatch-prompt` v3.1 `Context cap:`).
- **Debate style (v1.1):** `brainstorm.debate` resolves per field like any other key (project, else user, else plugin default `crossfire`). It is not a lock: no `unlocked` entry is involved and a fail-closed project layer does not change it.

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
| `unlocked` | list of `ship`, `security`, `installs` |

A `context_cap` below 60000 (the floor), above 1000000, or not a whole number is refused: `refused: context_cap must be a whole number from 60000 to 1000000`, nothing written.
Any other `brainstorm.debate` value is refused: `refused: brainstorm.debate must be crossfire or full_pass`, nothing written.

`brainstorm.debate` picks how a **debate** round runs (`brainstorm-file` v2, `brainstorm-reply` v1):
- `crossfire`: the ideas pass, then one crossfire pair (the two clashing Roles answer each other once).
- `full_pass`: the ideas pass, then a full pass (every Role answers the others' replies of that round), then the crossfire pair on top.
It has no effect on `ideas` or `moderated` rounds.

## CLI (Node ESM, no dependencies, cwd = product repo)
| Command | stdout (exit 0) |
|---|---|
| `node settings.mjs get` | the resolved JSON: `{ revision, roles: {<role>: {name, model, effort, context_cap, source}}, pipeline: {fix_rounds, dispatch, context_cap, lanes}, gates, brainstorm: {film_script, debate}, unlocked, ignored, warnings, language, profile }` |
| `node settings.mjs get <key>` | one value (dotted path, e.g. `pipeline.fix_rounds`, `roles.architect.context_cap`, `brainstorm.debate`); strings raw, others as JSON |
| `node settings.mjs serve [--no-open]` | `aico settings: <url>` (127.0.0.1, token in the URL) |

Warnings also go to stderr as `warning: <text>`.
The page shows the global cap, a per-Role cap field, the film-script toggle and a debate-style choice (`crossfire` / `full_pass`, the same row control the page uses for `pipeline.dispatch`), using the page's existing controls; it saves through the same validation.

## How the pipeline uses it (`aico:pipeline`)
- Setup §1.7 runs `get` once per run (fixed command) and keeps the JSON; never re-resolved mid-run.
- Model and effort: passed on the Agent call only when they differ from the agent frontmatter. `inherit` means the Lead's session model: the Lead passes its session model family (`opus | sonnet | haiku | fable`), never the literal `inherit` and never an omitted `model` (that falls back to the frontmatter). Recorded in the `Settings:` dispatch line (`dispatch-prompt` v3).
- `pipeline.fix_rounds` is the Fix-round limit; at 0 the first blocking review goes to the CEO. `sequential` dispatches the ∥ Steps one at a time.
- Lanes gate the optional lanes in `feature`, `fix`, `maintain` and `refactor`; lanes a Playbook always runs are unaffected.
- `auto` Gates write their summary to the run folder and continue. Never auto, whatever the settings: `needs-ceo`, Blocking security findings, picks, escalations, design-skill set approval, client sends, publishing, authority reports, production deploys. An auto Ship Gate first runs the Finish writes and commits (summary, Debt, Lessons), then pushes the branch and opens a PR, then stops; it never merges.
- `roles.<role>.context_cap` becomes the `Context cap:` dispatch line after the pipeline applies the high-risk floor and the 80% handover point (`dispatch-prompt` v3.1).
- `brainstorm.film_script` is read by `aico:brainstorm` (`brainstorm-file` v2); `true` renders the film script file at each round.
- `brainstorm.debate` is read by `aico:brainstorm` from the run's `get` JSON (never re-resolved mid-run) and written into each debate round's heading (`brainstorm-file` v2), so the file records which style ran.

## Error cases
- `get` exits non-zero or prints invalid JSON → the pipeline uses plugin defaults and says so in the first Gate summary and in its first chat message. Plugin defaults include `context_cap` 150000, `film_script` false and `debate` `crossfire`.
- Invalid value, unknown key or a stale `revision` on save: `refused: <reason>` (exit 2 on the CLI, 4xx from the server), nothing written.
- Unknown subcommand or extra arguments: `refused: usage: settings.mjs get [key] | serve [--no-open]` (exit 2).
- `get <key>` for a missing key: `refused: no setting <key>` (exit 2).
- A layer with a bad `context_cap` or `brainstorm.debate` → that field falls back to the level below, with a `warnings` line (broken-layer rule above).
