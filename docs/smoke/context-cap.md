# Smoke test: context cap enforcement (M6 Fresh Step, agent-ctx)

Date 2026-11-01. Claude Code 2.1.316, Windows 11, headless `claude -p`, terminal surface.
Branch plugin `claude --plugin-dir Z:\projects\aicompany` (init lists `aico` path `Z:\projects\aicompany`, version field reads 0.25.0 because the branch has not bumped it). Never the installed copy.
Throwaway product folder outside the repo (`.company/work` created by hand); deleted after the run.

## Setup
```
cd <throwaway product>
node Z:/projects/aicompany/scripts/run-state.mjs start smoke-run          -> ok: start smoke-run
node Z:/projects/aicompany/scripts/run-state.mjs active --json            -> {"slug":"smoke-run","view":{... "state":"running" ...}}
```
Prompt (stdin) for each session: spawn a general-purpose Agent ("Reply with the single word ready."), wait, then SendMessage `ping` to its id, print the tool result verbatim.
```
claude -p --plugin-dir Z:\projects\aicompany --permission-mode bypassPermissions --output-format stream-json --verbose < prompt1.txt
```

## 1. Run active: model SendMessage to a finished Step is refused (PASS)
Tool result seen by the model (agent `a3cf675b36d091089`):
```
{"success":false,"message":"Not sent: a plugin hook refused it (aico: Steps are never resumed; dispatch a fresh Step (next NN) with the old Handoff as input (pipeline §2))."}
```
The hook's `isDelivered: false` and `reason` arrive wrapped in `Not sent: a plugin hook refused it (<reason>).`. No resume followed.

## 2. Run active: resume denied (NOT observable live; covered by tests)
A resume is reachable only through SendMessage to a finished agent. With a run active the `session.send` hook refuses first, so `agent.spawn` with `resume` never fires. The Agent tool has no `resume` parameter (schema `additionalProperties: false`; second session confirmed the model cannot pass one). The deny path is covered by `mods/test/fresh-step.test.tsx` and `scripts/fresh-step-lib.test.mjs`. The wrapped deny text from T0 (`a plugin declined the resume: <reason>`) was seen live only with the throwaway T0 mod.

## 3. No run active: send passes, resume path passes (PASS)
Both runs in the folder ended (`run-state end smoke-run abort`; a leftover T0 run in the same folder stayed active for 12 h and also refused, so it was ended too). `run-state active --json` -> `{"slug":null,"view":null}`. Same prompt, agent `a9209684f57feec7e`:
```
{"success":true,"message":"Resuming agent a920968","resumedAgentId":"a9209684f57feec7e","pin":{...}}
```
The resumed agent answered "Pong". M6 passed both `session.send` and the `agent.spawn` resume.
Side finding: an unended old run blocks model SendMessage (the accepted 12 h `active` rule); this showed live.

## 4. `ledger agent-ctx` on a live agent id (PASS)
Agent `a3cf675b36d091089` from section 1 (transcript `~/.claude/projects/<munged cwd>/<session>/subagents/agent-<id>.jsonl`):
```
node scripts/ledger.mjs agent-ctx a3cf675b36d091089 a0000000000000000 --json
{"v":1,"agents":[{"agent":"a3cf675b36d091089","ctx":24082},{"agent":"a0000000000000000","ctx":null}]}
node scripts/ledger.mjs agent-ctx a3cf675b36d091089     -> a3cf675b36d091089 24082
node scripts/ledger.mjs agent-ctx 'bad;id'              -> refused: agent must match [A-Za-z0-9_-]{1,64} and not start with -   (exit 2)
```

## Not covered
- The aico-run pane (`ctx` per agent, Lead row) is a TUI mod; not visible headless. Needs the CEO in an interactive session: `cd <product with a run>` then `claude --plugin-dir Z:\projects\aicompany`, start a subagent, read the Savvy pane for `Lead ctx` and `ctx <n>`.
- Desktop surface (no `$.process`) not tested.
