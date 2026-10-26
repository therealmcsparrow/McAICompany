---
tool: claude-code-plugins
versions: "Claude Code plugins, skills and subagents as documented 2026-10 (code.claude.com/docs); Agent Skills format as documented on platform.claude.com 2026-10"
researched: 2026-10-22
---
<!-- No major version: keyed to the year of the docs read. Re-research when stale (180 days) or when the frontmatter field tables change.
     Facts used: unknown frontmatter fields are silently ignored (skills and subagents); a SKILL.md whose first line is not `---` is all body;
     description + when_to_use is truncated at 1,536 chars in the listing; Agent Skills spec caps `name` at 64 chars and `description` at 1,024;
     plugin subagents ignore `hooks`, `mcpServers`, `permissionMode` and `initialPrompt`; `${CLAUDE_PLUGIN_ROOT}` resolves in skill/agent Markdown
     bodies but is not in the Bash tool's environment. -->
## Must
- cc.M1 — Every `skills/<name>/SKILL.md` has `---` on line 1, YAML frontmatter that parses, `name` equal to the folder name, and a `description` — why: otherwise the file is read as body only, or loads with no fields — source: https://code.claude.com/docs/en/skills — enforced-by: scripts/check.mjs
- cc.M2 — A skill `description` says what the skill does and when to use it, key use case first, ≤ 1,024 characters — why: Claude matches requests against it, and the listing truncates — source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview , https://code.claude.com/docs/en/skills — enforced-by: scripts/check.mjs
- cc.M3 — Every agent file has `name` (no `:`, not starting with `-`, unique across `agents/`) and `description`; `model` is `sonnet`, `opus`, `haiku`, `inherit` or a full model ID; `effort` is set and is `low`, `medium`, `high`, `xhigh` or `max` (levels a model lacks fall back to the highest it supports below that) — source: https://code.claude.com/docs/en/sub-agents — enforced-by: scripts/check.mjs
- cc.M4 — Frontmatter keys are spelled exactly as documented (skills: `disable-model-invocation`, `argument-hint`, `allowed-tools`, `user-invocable`; agents: `tools`, `disallowedTools`, `model`, `effort`, `skills`) — why: unknown keys are silently ignored, so a typo drops the behaviour without an error — source: https://code.claude.com/docs/en/skills , https://code.claude.com/docs/en/sub-agents
- cc.M5 — Plugin agents do not rely on `hooks`, `mcpServers`, `permissionMode` or `initialPrompt` — why: "plugin subagents don't support" them; they are ignored at load — source: https://code.claude.com/docs/en/sub-agents
- cc.M6 — plugin.json component paths start with `./` and resolve inside the plugin root (no `..`); nothing writes state under `${CLAUDE_PLUGIN_ROOT}` (it changes on update) — user state lives outside the plugin (e.g. `~/.mcsparrow/`, `${CLAUDE_PLUGIN_DATA}`) — source: https://code.claude.com/docs/en/plugins-reference
## Should
- cc.S1 — Skill and agent bodies name bundled scripts as `${CLAUDE_PLUGIN_ROOT}/scripts/<file>` (substituted when the content loads), never a placeholder like `<plugin root>` or a cwd-relative path — source: https://code.claude.com/docs/en/plugins-reference#environment-variables
- cc.S2 — Skills that act (install, commit, write config, dispatch) set `disable-model-invocation: true`, so only the user starts them — source: https://code.claude.com/docs/en/skills
- cc.S3 — SKILL.md stays concise (it stays in context once invoked); detail moves to files in the skill folder, each linked from SKILL.md with when to load it — source: https://code.claude.com/docs/en/skills , https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- cc.S4 — Skill names use lowercase letters, digits and hyphens, ≤ 64 characters, without `anthropic` or `claude` — why: portable to the Agent Skills format — source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- cc.S5 — `claude plugin validate .` passes without errors before a version bump; warnings are fixed or noted in the Handoff — source: https://code.claude.com/docs/en/plugins-reference#validate-the-manifest
## May
- cc.Y1 — `license` in plugin.json is an SPDX identifier (proprietary: `LicenseRef-<name>`) — source: https://code.claude.com/docs/en/plugins-reference#fields , https://spdx.org/licenses/
## Security
- cc.M-SEC1 — Agent `tools` is an explicit allow-list with only what the Role's Goal needs (omitting `tools` inherits every tool); read-only Roles get no `Edit`, and no Role lists `Agent` unless it must dispatch — source: https://code.claude.com/docs/en/sub-agents , https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- cc.M-SEC2 — Plugin skills set no `allowed-tools` that pre-approves `Bash`, `Write`, `Edit`, `WebFetch` or MCP tools — why: `allowed-tools` skips the permission prompt, also in untrusted folders and `-p` runs — source: https://code.claude.com/docs/en/skills#security-notes
- cc.M-SEC3 — `` !`command` `` injection in a skill runs only fixed commands: no `$ARGUMENTS`, `$N` or named argument inside it, and no command whose output is web or third-party content — why: it runs before Claude sees the skill and its output becomes prompt text — source: https://code.claude.com/docs/en/skills#dynamic-context-injection , https://cwe.mitre.org/data/definitions/78.html
