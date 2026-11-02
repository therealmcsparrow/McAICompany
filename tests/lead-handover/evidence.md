# Spike T1 evidence: automatic Lead hand-over

Date 2026-10-30. Claude Code 2.1.314, model alias haiku, headless (`claude -p`, stream-json). Throwaway plugin copy in a scratch folder outside the repo, loaded with `--plugin-dir`, never installed. The login was the normal one; no login file was copied and no `~/.claude` or repo file was edited. Data is synthetic (random syllable files, a made-up run state). No transcript text, session ids or home paths are kept here.

Pass checks (AC3):
1. Trigger: the hand-over starts with no CEO keystroke.
2. Clean point: the Handoff is written only when `running: none`; a running Step refuses it.
3. Fresh context: the continuing context receives the Handoff from a `SessionStart` hook, source `compact`.
4. State kept: gate, form, running value and marker survive; a nonce created only by the post-reset hook is quoted in the final answer.

## Candidate A, first form: PostToolUse asks the model to write the Handoff
Hook outputs: `PostToolUse` read last-assistant usage 36458 (small run), then 83762, 85033, 85577. Threshold test with threshold 1: the hook fired, the model wrote the file (run 1). Large runs (run 2 window 100000, run 3 window 120000): in run 3 at usage 85577 the hook returned the notice; the model answered that the notice came from tool output and ignored it. Compaction ran 3 times with `handoffFound: false`.
- Check 1 fail for the model-written Handoff, check 3 fail (nothing to inject).
- The usage seen by the hook trails the real context by one tool result (7k to 24k tokens here): 60313 seen, then compaction before the next hook call.

## Candidate A, amended: PreCompact writes the file, SessionStart(compact) injects it
Script writes the Handoff (frontmatter `slug`, `gate`, `form`, `records`, `running`, `tokens-at-handover`, then `## Next`); no model step.
- Runs 4 and 5 (`autoCompactWindow` in the plugin settings.json, then in `--settings`): no compaction up to usage 199827; setting ignored. The same window as the environment variable `CLAUDE_CODE_AUTO_COMPACT_WINDOW` through the `env` block of `--settings`: honored.
- Run 6 (23k-token reads, environment variable through `env`): 3 hand-overs, then `Autocompact is thrashing` (3 refills within 3 turns) and exit 1. Cause: very large reads, not the hook.
- Run 7 (8k-token reads, window 98500 through `env`): exit 0, result `success`. 5 hand-overs, each: `PreCompact` trigger auto, `wrote-handoff`, then `SessionStart` source `compact`, `handoffFound: true`, a fresh nonce.

| Hand-over | PreCompact last usage | compact_boundary pre_tokens | post_tokens |
|---|---|---|---|
| 1 | 68260 | 73117 | 18178 |
| 2 | 70162 | 75054 | 18153 |
| 3 | 70094 | 74990 | 18166 |
| 4 | 70701 | 75635 | 18303 |
| 5 | 70397 | 75292 | 18197 |

Final answer (run 7): gate `ship open`, form `pending f-7`, running `none`, marker, and the post-reset nonce `R-...` (the last one issued; the model also listed the earlier ones). Nonces came only from the hook output after each reset.

Refusal run (run 8): `running.txt` held a Step id. `PreCompact` exit 2 five times (usage 68116, 78460, 89016, 99360, 109697); no Handoff, no compaction, run finished `success`, answer `no nonce`.

## Verdict by check
1. Pass: 5 of 5 hand-overs with no keystroke (run 7).
2. Pass: Handoff written at `running: none`; exit 2 and no file when a Step runs (run 8).
3. Pass: `SessionStart` source `compact`, `handoffFound: true` 5 of 5.
4. Pass: all four state values and the post-reset nonce in the final answer.

Open point: the hand-over fires near context 85.5k only through the window variable (window 98500, rule window minus 13000). Observed at trigger: hook usage 68k to 70k plus one 8k read, `pre_tokens` 73k to 75k (without the fixed prompt). The exact 85500 figure is not confirmed; T14 calibrates the window in its own test. Candidate B was not tried: A passed.

## T1 spike, context-cap hard hand-over (2026-11-02)

Installed: Claude Code 2.1.316, aico 0.26.0 (plugin cache). Branch: `.claude-plugin/plugin.json` 0.26.0. Model alias haiku, `claude -p --output-format json`, throwaway plugin in a temp dir (`--plugin-dir`, never installed), deleted after. Synthetic data only. Hook logged stdin fields, not transcript text. Win32 spawn question skipped: cut, T5 ships points-only.

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Does a subagent PreToolUse deny fire, with `agent_id`? | Yes | Subagent `t1:probe` calls (PowerShell, Glob) reached the hook with `agent_id` and `agent_type` `t1:probe`; the hook denied; the agent reported both calls refused. Lead calls carry no `agent_id`. Stdin keys for subagent: session_id, transcript_path, cwd, prompt_id, permission_mode, agent_id, agent_type, effort, hook_event_name, tool_name, tool_input, tool_use_id. |
| 2 | Subagent transcript path? | Not in stdin; derivable | `transcript_path` in a subagent call is the parent session file. Subagent file is `<session-dir>/subagents/agent-<agent_id>.jsonl` (session dir = `transcript_path` minus `.jsonl`), next to `agent-<id>.meta.json`. |
| 3 | `isSidechain` value? | true in the subagent file, false in the parent | Subagent file first line `"isSidechain":true`. Parent file entries read by the hook gave false (first lines may be null: metadata rows). Read the last assistant usage row of the subagent file, not line 1. |
| 4 | Effect of `continue:false` from PreToolUse (Lead)? | Yes, stops the turn | Result `terminal_reason: hook_stopped`, `stop_reason: tool_use`, `result` empty, exit 0, `subtype: success`. `stopReason` text did not appear in `result`; the new-session command must be shown another way (the hook must print it to stderr or `systemMessage`, untested). |
| 5 | Plugin MCP tool name, cwd? | `mcp__plugin_<plugin>_<server>__<tool>`; cwd = session cwd | Test: `mcp__plugin_t1_t1srv__lead_new_session`, loaded from the plugin `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}`; server process cwd was the session cwd. PreToolUse stdin for it adds `mcp_server`. For aico (plugin `aico`) the name will be `mcp__plugin_aico_<server>__lead_new_session`. |
| 6 | Permission prompt for the plugin tool? | Yes | Without `--allowedTools`/skip-permissions in `-p`, the call landed in `permission_denials`; with it, the call ran. The plugin cannot pre-approve; expect one prompt interactively. |

Side facts
- Hook cwd equals the session cwd (the scratch work dir). Worktree case (Nit in the plan) not tested: no worktree session was started. T3 should still resolve the run from the main tree.
- A plugin agent with a `tools:` frontmatter line reported Bash unavailable in run 1; without the line it inherits tools. Name when dispatched: `<plugin>:<agent>`, bare name did not resolve to it.
- The Lead used PowerShell, not Bash, on win32; match hooks on `*`, never on `Bash`.

Plan decisions: question 1 is yes, so T3 proceeds. Question 5 is yes, so T5 proceeds (points-only). Question 4 changes T4: `stopReason` does not reach the model-visible `result`; T4 must test where the command surfaces.
