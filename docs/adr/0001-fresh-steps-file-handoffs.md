# Every Step starts fresh from a file Handoff

Each Role runs as a subagent with a clean context and knows only what its incoming Handoff file (`.company/work/<task>/NN-<role>.md` in the product repo) tells it. We chose this over passing summaries in-prompt or letting one long session carry everything, because it keeps token cost per Step flat, survives restarts and compaction, and leaves an auditable trail in git.

**Considered Options**: in-prompt summaries from the Lead (bloats the Lead, lost on restart); GitHub issues/PRs (needs a remote and `gh`).
