# 0035: The plan Gate is enforced inside the scripts that record or act on it, and the hook mod only explains a refusal early

Status: proposed (Plan Gate, task v020-gate-roadmap)

The plan Gate is enforced inside `run-state gate … plan passed` and `plan-tasks begin`, `next` and `start`, which rescan every plan in the run folder under `block` and trust no record; the hook mod only explains a refusal early, so no command form, forged record, linked plan or project setting can skip the Gate. A Role with Bash can write `.company/` files and run any command form, so a hook that judges command text can only ever be a convenience: it parses two exact argv shapes, asks `plan-check verify <slug> --json` for the verdict, and under `block` also refuses a Write or Edit on a `run-state.jsonl`. Hard to reverse because later releases rely on the scripts, not the mod, being the check.
