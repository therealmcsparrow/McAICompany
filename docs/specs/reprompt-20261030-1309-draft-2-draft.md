---
slug: reprompt-20261030-1309-draft-2-draft
version: 0.23.0
shipped: 2026-10-30
---
## Problem
The CEO has no guided path from a rough idea or a bug report to a build. He has to know which command comes next, long runs lose quality once a context grows past about 100k tokens, and feature and fix stop him at a Brief Gate and a Plan Gate he no longer wants. A CEO who works by keyboard and screen reader must be able to answer every question as a plain form. The documentation is a few long flat pages that are hard to scan.

## Solution
Release 0.23.0 ships:
- One fixed Context cap for every Role, every tier and every fallback: 95000 with a hand-over at 85500. A Role that reaches it hands over to a fresh Step of the same Role, with no CEO form, and the old Step is never resumed. The old per-Role and pipeline cap settings are still accepted but have no effect; the settings page shows the cap as fixed text.
- An automatic Lead hand-over: before Claude Code compacts the main session, a hook writes a Lead Handoff from the run records, and after compaction a second hook injects it, so the Lead continues with no keystroke and no lost Gate, form or run state. A new command records the run's base commit and tier once at Step 01 so later dispatches use the recorded base. It needs a one-time setup: the CEO sets CLAUDE_CODE_AUTO_COMPACT_WINDOW=98500 in the env block of the Claude Code user settings and restarts.
- aico:idea and aico:bug: one shared route. Capture, a grill choice (grilling, grill-me, grill-with-docs), reprompt, then a form with A Water cooler, B Brainstorm, C Research, D Spec and tickets, E Park the idea. After D the tickets are approved or changed one by one, then F Build, G Park tickets on the roadmap, or E. Idea builds through aico:feature, bug always through aico:fix. The allowed picks of every form come from a script, never from the Lead's text.
- Outside a software company the flow offers only Water cooler, Brainstorm, Research and Park the idea, and after Research the form is Park the idea or Stop. aico:bug is software only; idea and the three grill commands are in every company type.
- Three grill commands, each usable alone, each writing a valid grill file; aico:grill is unchanged.
- Ticket approval: each ticket is approved once, recorded only by the Lead at the CEO's pick; a ticket changed after approval, or one whose text merely claims approval, is asked again.
- aico:feature and aico:fix have no Brief Gate and no Plan Gate in any run; the Ship Gate always runs and its summary carries what the two Gates used to show. A feature run starts at Risk tier medium unless a trusted triage record says otherwise. In fix, the CEO's Approve at the Ship Gate approves any Core change.
- Documentation by topic: start, commands, concepts, roles and mods folders, one page per command and per Role, each page with In short, How it works and Technical details. The old flat pages are removed.
- The CEO-only command list grows from ten to fifteen. Release changes only the version files and the changelog.

## User stories
- As the CEO, I can type an idea or a bug and be walked to a build, a roadmap entry or a parked idea by forms, with only valid next steps offered (AC4, AC6, AC7, AC8, AC12).
- As the CEO, I approve each ticket once; I am asked again only for new or changed tickets (AC9, AC10, AC14, AC17, AC18).
- As the CEO, a bug I report is always built by fix, whatever its text says, and an idea is never built by fix (AC11, AC12, AC19).
- As the CEO, feature and fix run from intake to the Ship Gate without stopping, direct calls included (AC15, AC16).
- As the CEO, a long run continues after compaction without a keystroke, and every Role stays under 95000 tokens (AC1, AC2, AC3).
- As the CEO, I can run any grill command on its own and get a grill file (AC5).
- As a screen reader user, I can read every form and ticket as plain lines, with no table or emoji, and pick by keyboard.
- As a reader of the docs, I find each command and Role on its own short page with the same three sections (AC13).

## Decisions
- Risk tier high: Core (pipeline, handoff, structural check) and Contracts change (brief Decisions).
- One cap for all, settings kept but inert, so old settings files keep validating (plan Decided).
- Route steps run inline in the same session up to fixed stop points, because the Skill tool refuses CEO-only Playbooks (plan Decided, ADR 0048).
- bug and idea share one route; only the build Playbook differs, taken from the flow record, so no spec carries a bug mark (CEO decision 2026-10-30).
- Brief and Plan Gate removed from feature and fix, Core and Contract changes included; former Gate decisions become a form when they arise; script refusals are never bypassed (CEO decision, ADR 0050).
- Feature without a trusted triage record starts at medium tier; a longer route is always valid (CEO decision in run).
- In fix the CEO's Ship Gate Approve approves Core (CEO decision in run).
- Lead hand-over by PreCompact and SessionStart hooks after the spike, with the one-time compaction window setup (ADR 0049, CEO decision in run).
- Frontmatter values that hold a colon are quoted so every file parses (CEO decision in run).
- Outside software the flow offers only Water cooler, Brainstorm, Research and Park the idea, with Stop after Research (CEO decision in run).
- Docs restructured by topic with one page template; old flat pages removed, not kept as pointers (CEO decision in run, architect map).
- Help lines point at the per-command page as an unshipped amendment of company-type v1.7, no version bump (architect Decisions).

## Testing decisions
- Tier high: each of AC1 to AC19 has at least one test; none is covered lightly.
- Route forms are tested for identical letters for kind idea and kind bug at every form; any other pick is refused.
- Ticket approval is tested for a changed block, a fake approval line in ticket text and repeated approvals counted as duplicates.
- Every stop-point heading the route relies on is asserted to exist, so a rename breaks the build.
- The structural check enforces one page per command and per Role, the three sections in order on every documentation page and working relative links.
- The Lead hand-over is tested from the hook side: Handoff written at a clean point, refused while a Step runs, base and tier recorded once.
- Success metric: duplicate ticket approvals per D-to-F run, target 0; guardrails, all target 0: Lead hand-overs needing a keystroke, Brief or Plan Gates shown in feature or fix, bug builds not via fix. Measured from run state and form logs over the first 3 runs after 0.23.0, reported in aico:feedback.

## Out of scope
- Push, publish or tag of the release; per-Role caps; roadmap triage of parked tickets (later).
- A singular to-ticket command, new Roles, changes to aico:grill.
- Skipping the Ship Gate; Gate changes in Playbooks other than feature and fix.
- The old bug route through reprompt and to-spec; building bug tickets with feature.
- Known issue, not fixed in 0.23.0: the contracts skill still says approved Core comes from a Plan Gate, so a fix that adds Core may be blocked by the reviewer until the CEO decides.
- Known issue, not fixed in 0.23.0: after a Lead hand-over with no injected Lead Handoff, the hand-over read command does not print the recorded base commit or tier, and the rule to use only the recorded base is written for feature and fix only.
