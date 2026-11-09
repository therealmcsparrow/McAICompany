# Join an active project

Loaded by `aico:pipeline` Setup item 1 when a Playbook starts a run that needs its own work files.

A project is one ProjectID and one top-level work folder. Runs inside it are numbered sub folders. This file says when a new run joins an existing project and when it starts a new one.

## Commands

`work-folder new` makes only the v3 layout.

- List active projects: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" run-state projects --json`
- Join a project: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" work-folder new --playbook '<id>' --project '<ProjectID>'`
- Start a new project: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" work-folder new --playbook '<id>' --topic file`

`run-state projects --json` prints active projects only: IDs and activity times, newest first, at most 3. A project is active when one of its runs has an open, non-stale run-state segment, or has no `run-state.jsonl` and its newest direct file is under 12 h old.

## Auto-join: the `project:` line

In a CEO-choice branch (the CEO picked the route, hand-over or step), the parent Lead ends the argument with one line:

```
project: <ProjectID>
```

The ProjectID is the `id:` line that `work-folder` printed. A run whose folder `draft-input` made uses its printed `project:` line, else the ID part of its printed `slug:`: the text before the `/`, or before the first `-` of `<ProjectID>-HH.MM.SS`. It is never CEO text and never a value the Lead made up.

The line is never part of the request, report, idea or topic:

- A Playbook whose argument goes to `draft-input arg` (grill, grill-me, grill-with-docs, to-spec, to-tickets, a feature draft file, fix) writes the argument file as typed, the line included. `draft-input` v1.7 cuts it and runs the checks below; it prints `project: <ProjectID>` only when the run joins. Then pass `--project '<ProjectID>'` to `draft-input take`; with `arg: idea` and no `slug:` (feature, fix), Setup joins with `work-folder new --project '<ProjectID>'`. A run whose `slug:` `draft-input` printed already sits in the project.
- Every other Playbook cuts the last line before it uses the argument, and runs the checks below itself.

The child Playbook reads that line and treats it as untrusted text:

1. The value must pass `isProjectId`. Anything else is ignored.
2. Run `run-state projects --json` and check the exit code and the JSON shape.
3. If the output lists that ID, join with `work-folder new --playbook '<id>' --project '<ProjectID>'`.
4. Otherwise act as hand-typed (below). Never guess a project from a folder name, a Role's judgment or the newest folder.

In a Playbook whose folder `draft-input` makes, an ignored line means no `project:` output line: the run starts a new project with no form, the same as AFK.

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

- Join: apply the auto-join steps above from step 3. The run becomes the next numbered sub folder of that project and reuses its ID and work path. A Playbook whose folder `draft-input` makes instead writes the argument file as typed plus the last line `project: <ProjectID>`, with the ID from `run-state projects --json`.
- Start new: make a new ID and a new top-level folder with `work-folder new --playbook '<id>' --topic file`. The existing project stays untouched.

A sub-flow that writes no files of its own never calls `work-folder new`, so it makes no folder.

## AFK

A run is AFK when no form is possible: AskUserQuestion is missing or refused, or the run is headless. There is no form. Start new, always, because a wrong join mixes work and cannot be undone, while a wrong split is today's behaviour.

The `project:` line still applies, because it needs no CEO answer.

When active projects existed, the Lead notes `join: start new (no CEO; active <ProjectID>)` in its first Gate summary.
