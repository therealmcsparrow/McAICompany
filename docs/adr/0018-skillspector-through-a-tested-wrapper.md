# 0018 SkillSpector runs only through a tested wrapper

Date: 2026-10-26. Status: accepted (Plan Gate, task skill-researcher-scan).

aico runs NVIDIA SkillSpector only through `scripts/skillspector.mjs` (`skillspector-scan` v1): its CLI, one resolved skill path per call, an allow-listed env and an allow-listed set of output fields, with every failure read as `error`. Never the MCP tool and never `-r`. Reason: the tool's exit code does not reflect HIGH issues, its recursive mode silently stops at 32 skills, its MCP tool defaults to `use_llm: true`, and an empty folder scans as SAFE. So the verdict has to come from tested code, not from a model reading tool output. The LLM mode (`claude_cli`) is a user-level-only setting, so a cloned repo cannot send skill text to Claude on the CEO's account.
