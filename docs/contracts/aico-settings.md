# Contract: aico-settings v1

Provider: `scripts/settings.mjs` (and `scripts/settings-server.mjs` for the page). Consumers: `aico:pipeline` Setup §1.7, the Playbooks that run through it, `aico:brainstorm`, `aico:cooler`, `aico:research`, `aico:settings` (command).
Settings say how the company works: each Role's name, model and effort, the pipeline (Fix rounds, dispatch mode, optional lanes) and the Gates. The writing language stays in `aico-language` v1; profile fields stay in `.company/project.md`.

## Storage
- **User:** `<MCSPARROW_HOME or ~/.mcsparrow>/config.json`, key `aico_settings`. Other keys, including `aico_language`, are preserved on write.
- **Project:** `.company/settings.json`, holding `{ "aico_settings": … }`.
- **Plugin:** model and effort from `agents/*.md` frontmatter, names from `company/names.json` (`role-names` v1), `PIPELINE_DEFAULTS` and `GATE_DEFAULTS` in `settings.mjs`.
- Shape (any key may be absent, meaning not set at that level):
  ```json
  { "aico_settings": { "version": 1,
      "roles": { "architect": { "name": "Ava", "model": "opus", "effort": "high" } },
      "pipeline": { "fix_rounds": 2, "dispatch": "parallel",
                    "lanes": { "security": true, "compliance": true, "legal": "auto", "persona": true, "hands_on": true, "accessibility": true } },
      "gates": { "brief": "ask", "plan": "ask", "ship": "ask", "installs": "ask" },
      "unlocked": [] } }
  ```
- Every write is atomic (temp file, then rename).

## Resolution
Per field: project, else user, else plugin. Then the locks:
- `unlocked` counts **only from the user level**. A project `unlocked` is ignored and listed in `ignored`.
- `gates.ship` and `gates.installs` resolve to `auto` only with that key in the user `unlocked`; otherwise `ask`, listed in `ignored`.
- `lanes.security` and `lanes.compliance` resolve to off only with `security` in the user `unlocked`; otherwise on, listed in `ignored`.
- A broken layer (invalid JSON, wrong type, unknown Role) falls back to the level below for the bad parts, with a `warnings` line.

## Schema (allow-list; unknown keys are refused)
| Key | Values |
|---|---|
| `roles.<role>.model` | `opus \| sonnet \| haiku \| fable \| inherit` (`<role>` is an existing `agents/*.md`) |
| `roles.<role>.effort` | `low \| medium \| high \| xhigh \| max` |
| `roles.<role>.name` | `role-names` v1 rules |
| `pipeline.fix_rounds` | integer 0–5 |
| `pipeline.dispatch` | `parallel \| sequential` |
| `pipeline.lanes.<security\|compliance\|persona\|hands_on\|accessibility>` | boolean |
| `pipeline.lanes.legal` | `auto \| on \| off` (`auto`: only for AI, payments or personal data) |
| `gates.<brief\|plan\|ship\|installs>` | `ask \| auto` |
| `unlocked` | list of `ship`, `security`, `installs` |

## CLI (Node ESM, no dependencies, cwd = product repo)
| Command | stdout (exit 0) |
|---|---|
| `node settings.mjs get` | the resolved JSON: `{ revision, roles: {<role>: {name, model, effort, source}}, pipeline: {fix_rounds, dispatch, lanes}, gates, unlocked, ignored, warnings, language, profile }` |
| `node settings.mjs get <key>` | one value (dotted path, e.g. `pipeline.fix_rounds`); strings raw, others as JSON |
| `node settings.mjs serve [--no-open]` | `aico settings: <url>` (127.0.0.1, token in the URL) |

Warnings also go to stderr as `warning: <text>`.

## How the pipeline uses it (`aico:pipeline`)
- Setup §1.7 runs `get` once per run (fixed command) and keeps the JSON; never re-resolved mid-run.
- Model and effort: passed on the Agent call only when they differ from the agent frontmatter; `inherit` is never passed. Recorded in the `Settings:` dispatch line (`dispatch-prompt` v3).
- `pipeline.fix_rounds` is the Fix-round limit; at 0 the first blocking review goes to the CEO. `sequential` dispatches the ∥ Steps one at a time.
- Lanes gate the optional lanes in `feature`, `fix`, `maintain` and `refactor`; lanes a Playbook always runs are unaffected.
- `auto` Gates write their summary to the run folder and continue. Never auto, whatever the settings: `needs-ceo`, Blocking security findings, picks, escalations, design-skill set approval, client sends, publishing, authority reports, production deploys. An auto Ship Gate opens a PR and never merges.

## Error cases
- `get` exits non-zero or prints invalid JSON → the pipeline uses plugin defaults and says so in the first Gate summary.
- Invalid value, unknown key or a stale `revision` on save: `refused: <reason>` (exit 2 on the CLI, 4xx from the server), nothing written.
- Unknown subcommand or extra arguments: `refused: usage: settings.mjs get [key] | serve [--no-open]` (exit 2).
- `get <key>` for a missing key: `refused: no setting <key>` (exit 2).
