# Which model a Role runs on

## In short
Each Role runs on a Claude model. Claude Code, not aico, has the last word on which one, and a few Roles never run below a minimum. Your own model choice for a Role is a request that aico passes on, and aico never lets it go below that minimum where the minimum applies.

## How it works
1. The Lead reads your `roles.<role>.model` setting, if any.
2. At high risk, or for a protected Role, the Lead raises a Role below its floor to the floor.
3. The Lead passes the result as the Agent `model` when it starts the Role.
4. If you set a Claude Code variable that overrides models, the Lead prints one model environment line at the start of a run.

## Technical details
Claude Code decides the model of a sub-agent such as an aico Role. The facts below come from the Claude Code documentation, checked on 2026-10-28: https://code.claude.com/docs/en/sub-agents. Quotations are short and are the documentation's words, not instructions to a Role.

### The order today
From Claude Code 2.1.251, the documentation lists the order as: "1. The per-invocation `model` parameter 2. The subagent definition's `model` frontmatter ... 3. The `CLAUDE_CODE_SUBAGENT_MODEL` environment variable ... 4. The main conversation's model" (https://code.claude.com/docs/en/sub-agents).

- **Agent `model`.** The Lead can pass a model when it starts a Role. The documentation says the call takes "sonnet, opus, haiku, or fable. Claude can't pass a full model ID or `inherit` on that call" (https://code.claude.com/docs/en/sub-agents).
- **Mod `agent.spawn` hook.** An installed mod can set the model too. The documentation says a mod's `agent.spawn` hook model replaces the per-invocation parameter (https://code.claude.com/docs/en/sub-agents).
- **Frontmatter `model`.** Every aico Role sets `model:` in `agents/<role>.md`.
- **`CLAUDE_CODE_SUBAGENT_MODEL`.** On its own this is a default. The documentation says it "is a default" (https://code.claude.com/docs/en/sub-agents). Because every aico Role has a frontmatter model, it changes no Role on 2.1.251 or later. Setting it to `inherit` is the same as leaving it unset.
- **Main conversation's model.** Used only when nothing above is set.

### Before 2.1.251
The documentation says: "Before v2.1.251, `CLAUDE_CODE_SUBAGENT_MODEL` came first in this order and overrode both the per-invocation parameter and the frontmatter, including `model: inherit`" (https://code.claude.com/docs/en/sub-agents). On those versions the variable overrides every Role.

### Forcing one model
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` set to `1` applies the variable's model to every sub-agent. The documentation says it "Requires Claude Code v2.1.257 or later" (https://code.claude.com/docs/en/sub-agents). Set on its own, it runs sub-agents on the main conversation's model (the built-in Explore agent excepted), per the same page.

**Unverified:** whether `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` also beats the Agent `model` parameter. The documentation says "every subagent" but does not state it. aico treats it as a bypass of the floor below.

### Where aico's settings enter
`roles.<role>.model` from [settings](settings-and-locks.md) is not a Claude Code setting. The Lead reads it and passes the result as the Agent `model`. Without a stored model, the Role runs on its frontmatter model.

### The floor and the protected Roles
`company/model-floor.json` lists a **floor** for every Role: the model that Role had in v0.16.0. The floor is the lowest model it runs on in these cases:
- **High risk tier.** The Lead raises a Role below its floor to the floor, passes it as the Agent `model` and writes `floor` at the end of the `Settings:` line of the dispatch. At low and medium tier a Role that is not protected runs the model you set.
- **Protected Roles.** `architect`, `code-reviewer`, `fresh-reviewer`, `pentester`, `security` and `vuln-scanner` hold their floor at every risk tier. A lower `roles.<role>.model` is not applied and the settings warning says so. No unlock lifts this. If the floor file cannot be read, every Role is held at `opus`.
- **Order of the ranks:** `haiku`, then `sonnet`, then `opus`. `fable` is not ranked, so a Role set to it runs at its floor where the floor applies. The Agent call cannot take `inherit`, so the Lead first turns `inherit` into the model of its own session, then applies the floor to that model.

### Choosing models for your Roles
The shipped models follow one split. Opus does the work that judges or shapes code: `architect` (high effort), `senior-engineer` (medium), `code-reviewer` and `fresh-reviewer` (high). Sonnet at medium effort does the work that writes code: `backend-engineer`, `frontend-engineer`, `desktop-engineer`, `game-engineer`, `ai-data-engineer`, `devops` and `qa`.

A builder gets a planned, test-first task. The architect has already set its Contracts and the senior engineer has mapped the ruleset rules to it, and two reviewers check its diff afterwards. Sonnet is enough for that and costs less than Opus, so keep the defaults unless a run shows otherwise:
- **The same builder keeps needing Fix rounds.** Raise its `roles.<role>.effort` to `high` first. That costs less than a model change.
- **The domain is hard,** for example a game engine core, concurrency, or LLM retrieval and evals. Set that one Role, such as `game-engineer` or `ai-data-engineer`, to `opus`. Do it as a project override in `.company/settings.json` so other products keep Sonnet.
- **The work is simple or bulk,** for example CRUD endpoints or glue code. Lower the builder's effort to `low`.

Change one Role at a time, then compare Fix rounds over the next few runs. Protected Roles never go below their floor, and at high risk tier no Role does (see above).

### The model environment line
At the start of a run the Lead runs `settings.mjs model-env`. When `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, it prints one line with the Claude Code version, what the variable does on that version, and whether the floor is `kept` or `bypassed`. It prints nothing when neither is set. A line ending `floor bypassed` is also shown at the Brief Gate of a high-tier run (feature and fix have no Brief Gate; there you see it in the Lead's first chat message). With `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` set, aico reports `floor bypassed` unless both version sources agree on a version below 2.1.257. If the version cannot be read, the line says `version unknown` and counts as bypassed.

### The agent description warning
Claude Code warns at startup when agent descriptions are long. The documentation says: "When the combined descriptions of your subagents, except the built-in ones, exceed 15,000 tokens, Claude Code shows a warning at startup" (https://code.claude.com/docs/en/sub-agents). The error reference adds: "Claude Code loads every agent whether or not the total is over the limit" and that each agent counts "its name plus its `description` frontmatter" (https://code.claude.com/docs/en/errors.md#agent-descriptions-are-over-the-15000-token-limit).

**Unverified:** whether agents that come from a plugin count toward the 15,000 total. The documentation says "your subagents" and does not name plugins. The documentation does not name the token estimator either, so `npm run check` counts UTF-8 bytes, which never counts under, and fails at 15,000 or more. It also fails a Role description over 400 estimated tokens.
