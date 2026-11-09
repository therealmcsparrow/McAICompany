# Join an active project

Dormant reference. No Playbook loads it yet. Load it only when a Playbook starts a run that needs its own work files and the v3 layout is on.

A project is one ProjectID and one top-level work folder. Runs inside it are numbered sub folders. This file says when a new run joins an existing project and when it starts a new one.

## Commands

All commands use the v3 layout.

- List active projects: `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs run-state projects --json`
- Join a project: `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs work-folder new --layout v3 --project <ProjectID> <playbook>`
- Start a new project: `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs work-folder new --layout v3 <playbook>`

`run-state projects --json` prints active projects only: IDs and activity times, newest first, at most 3. A project is active when one of its runs has an open, non-stale run-state segment, or has no `run-state.jsonl` and its newest direct file is under 12 h old.

## Auto-join: the `project:` line

The parent Lead ends every hand-over or route argument with one line:

```
project: <ProjectID>
```

The ProjectID is the `id:` line that `work-folder` printed. It is never CEO text and never a value the Lead made up.

The child Playbook reads that line and treats it as untrusted text:

1. The value must pass `isProjectId`. Anything else is ignored.
2. Run `run-state projects --json` and check the exit code and the JSON shape.
3. If the output lists that ID, join with `work-folder new --layout v3 --project <ProjectID>`.
4. Otherwise act as hand-typed (below). Never guess a project from a folder name, a Role's judgment or the newest folder.

A forged line can at most join a project that is active anyway, the same as the join pick in the form.

## Hand-typed Playbook with an active project

A hand-typed Playbook has no `project:` line. Before any folder or ID is made, run `run-state projects --json`.

- No active project: no form, ask no question. Start a new project as today.
- One or more active projects: ask one form, before any folder or ID exists.

The form offers:

- Join `<ProjectID>`, one pick per active project, at most 3 IDs shown. Join is the recommended pick and goes first, because splitting one project into two is the problem this rule fixes.
- Start new, the last pick. One click.

Show a project description in the form only after the proj.M-SEC9 check, never raw. When the check fails, show the ID alone.

## What each pick does

- Join: apply the auto-join steps above from step 3. The run becomes the next numbered sub folder of that project and reuses its ID and work path.
- Start new: make a new ID and a new top-level folder with `work-folder new --layout v3`. The existing project stays untouched.

A sub-flow that writes no files of its own never calls `work-folder new`, so it makes no folder.

## AFK

In an AFK run there is no form. Start new, always. The `project:` line still applies, because it needs no CEO answer.
