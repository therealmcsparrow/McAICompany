# 0039: The fresh reviewer is its own Role

Status: proposed (Plan Gate, task elephant-goldfish)

The plan review and the optional second code review run as a new Role, `fresh-reviewer`, not as a mode of the Code Reviewer, because findings are keyed by Role id (`handoff` v1.2 lineage) and two parallel `code-reviewer` Handoffs in one round would merge their `R-<n>` rows into one finding, which breaks both the contest states and the disagreement list. The Role reads only a script-built list of the plan, its Contracts and the code the plan cites (plus the judging diff in code mode), writes its paraphrase and first-pass findings before it may open any Handoff, and never reads the brief. Hard to reverse because finding keys, the tier sets and the dispatch lines name the Role.

The Role is protected (floor `opus` at every tier, sixth name in `company/model-floor.json` `protected`), because project settings win for `roles.<role>.model` and a cloned repo's `.company/settings.json` could otherwise run the plan reviewer on a weaker model at medium tier (Security Step 08, Blocking 4).
