---
slug: one-project-one-folder
version: pending
shipped: pending
---
## Problem
One CEO request breaks into many projects because every sub-flow (bug, grill, reprompt, fix and the rest) mints its own project ID and its own top-level work folder; one request recently left seven IDs. The CEO, finding, resuming and reviewing one piece of work, has to chase it across folders. The goal is one project ID and one project folder per request, with every sub-flow and later run nested inside it.

This spec covers run 1 of 2. Run 1 ships the building blocks behind an opt-in flag; nothing a Playbook does changes yet. Run 2 wires them in and makes the nested layout the default.

## Solution
Shipped in run 1:
- Nested layout, opt-in: `work-folder new --layout v3` makes one project folder per project ID with a project file holding its description, and each run as a numbered sub folder `<NN>-<playbook>` inside it. The run slug is `<ProjectID>/<NN>-<playbook>`. Runs are numbered per project, not timed.
- Joining a project: `work-folder new --layout v3 --project <ProjectID>` adds the next numbered run to that project. Two runs of the same kind in one project get distinct sub folders and never overwrite each other. A project that so far has only old-style run folders gets a nested project folder beside them; the old folders are untouched.
- Default unchanged: `work-folder new` without the flag prints the same old-style name as in 0.32.0. No Playbook passes the flag.
- Run state reads nested runs: `run-state` start, step, end and show accept a nested run slug and keep its run state inside the run's own sub folder. `run-state list` and `run-state active` output is unchanged and stays top-level.
- Active projects: `run-state projects --json` lists active projects, newest first, at most 3, IDs and activity times only. A project is active when one of its runs has an open, non-stale run-state segment, or has no run state and was touched within 12 hours. At most 200 runs are read; past that one warning is printed.
- Run state reads the work folder only when it is the real folder under the project root, not a link pointing elsewhere.
- Join rule text, dormant: a pipeline reference describes the join rule. A parent hand-over or route ends with one line `project: <ProjectID>`; the child joins only when `run-state projects --json` lists that ID. A hand-typed Playbook with an active project shows one form, join (recommended, up to 3 active IDs) or start new; no active project means no form and a new project. With no CEO to answer (AFK, headless) the default is start new. No Playbook cites this text yet, so it never shows.
- Contracts: work-folder-name v2.1 and run-state v1.10, both additive minors.

Not yet shipped (run 2): Playbook wiring (hand-over auto-join, the join form, the `project:` line), the flip to the nested layout as default, nested listing in `run-state list` and `active`, the dashboard showing sub-flows inside the project drawer, the seven-sub-flow chain test, and the majors work-folder-name v3.0, run-state v2.0 and dashboard v2.0 with handoff-lint accepting both layouts.

## User stories
- As the CEO, I can create a nested project folder by hand with the opt-in flag and add more runs to it, each in its own numbered sub folder.
- As the CEO, I see no change in my Playbooks after run 1; every old folder still lists and resumes as before.
- As a Playbook author, I can ask run state which projects are active right now, without guessing from the newest run.
- Not yet (run 2): as the CEO, a request that runs bug, grill, reprompt and fix leaves one project folder and one branch.
- Not yet (run 2): as the CEO, typing a Playbook while a project is active asks me once to join it or start new.

## Decisions
- Run 1 bumps only minors (work-folder-name v2.0 to v2.1, run-state v1.9 to v1.10): every change is additive and default output is unchanged. The majors land with the flip in run 2 (CEO approved the split at the Plan Gate).
- The nested layout sits behind a flag because no reader is converted yet; a live nested run would get a slug an old consumer refuses.
- Old-style name checks keep their meaning and consumers opt in to nested slugs, so an unconverted consumer refuses a nested slug instead of writing beside it.
- Every run, the first included, is a numbered sub folder: one shape for every reader.
- The project description lives in its own project file, not a run summary, so "a folder with a summary is a run" stays true.
- Auto-join never guesses from run state alone: run state cannot tell which session owns a run, and several sub-flows write no run state. The parent passes the ID explicitly; the child checks it is active.
- Join is the recommended form pick, since the form only shows for work in the last 12 hours and splitting is the problem being fixed. AFK defaults to start new, because a wrong join mixes work and cannot be undone, while a wrong split is today's behaviour.
- A sub-flow with no own files makes no folder; this needs no code, since it never asks for one.
- Old folders (all earlier layouts, including sibling timed run folders) are never renamed or moved.
- Success metric: new top-level work entries per CEO request; target 1 for 10 of the next 10 multi-sub-flow runs, measured at the first aico feedback run after run 2 ships. Run 1 alone cannot move it.
- Laws: none apply. Local plugin files, no personal data; run state keeps IDs and times only.

## Testing decisions
Risk tier high: every run 1 criterion has its own test, none covered lightly. Tests drive the work-folder and run-state commands and assert the join rule text.

- AC2: Given a nested project, When a run needs files, Then they sit in a numbered sub folder of the one project folder.
- AC3: Given a sub-flow with no own files, When it ends, Then no folder exists for it.
- AC5: Given two runs of one kind in one project, When both are made, Then each has its own sub folder and neither overwrites the other.
- AC6: Given no flag, When a new project starts, Then the old-style name is printed exactly as in 0.32.0; Given no active project, Then the join text asks no form.
- AC7: Given old-style, legacy and sibling timed folders, When run state lists or resumes them, Then output and disk are unchanged.
- AC9: Given a later run of a nested project, When it starts with the project flag, Then it gets the next numbered sub folder, never a sibling timed folder.
- AC1, AC10, AC11: covered in run 1 as dormant rule text only (the `project:` line, the active check, the form, AFK start new); live behaviour is tested in run 2.
- Run 2, not tested here: AC4 (seven-sub-flow chain leaves one entry and one branch), AC8 (dashboard drawer), AC12 (major Contract versions and lint accepting both layouts).
- Also tested: a hostile linked work folder is refused, the 200-run cap and its single warning, and the bounded folder walk.

## Out of scope
- Renaming, moving or merging old folders.
- Changing the project ID shape.
- Project IDs across repos.
- A dashboard redesign; it only has to keep showing every run.
- Later: a CEO command to attach a stray project to another one.
- Run 2 items listed under Solution, until run 2 ships.
