---
name: design
description: Playbook for a design studio. Take a design brief through research, concepts, critique and usability testing to a design handoff package (files, specs, tokens, asset licence record) for the client or the build team.
disable-model-invocation: true
argument-hint: <design brief | project | file>
---

# Playbook: design

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `design` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook design` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; keep the §1.0 type lines for the run. The `design` company ships a handoff package, not a release. Ship means the package goes to the client or the build team. Ship Gate: `aico:pipeline` §4, company types other than `software`.

## 1. Brief
1. Argument: a brief (text), `project` (the brief is this product: read `.company/project.md`) or a file path (a brainstorm, report or earlier handoff).
2. Dispatch `aico:product-manager` for the design brief: goal, audience, Personas, deliverables, platforms, brand constraints, and which assets may be AI-generated. Empty `## Personas` → it proposes 2–4.
3. **Brief Gate:** the CEO approves the brief, the Personas and the deliverable list. Nothing is designed before it.

## 2. Research
Dispatch in parallel, in one message, only what the brief needs:
- `aico:design-researcher`: references, patterns, competitor interfaces, design skills.
- `aico:ux-researcher`: user needs, tasks and journeys from the Personas.
Findings follow `aico:sourcing`. A `blocked` researcher does not stop the run; the concepts Step notes the gap.

## 3. Concepts
1. Dispatch `aico:ui-ux-designer` with the brief and the research Handoffs, following `aico:ui-design`. Output: two or three concepts, each with flows, key screens, and a token set (colour, type, spacing, radius, motion).
2. Assets, only as the brief lists them: `aico:brand-artist`, `aico:motion-artist`, `aico:prompt-artist` or `aico:game-artist`, following `aico:art-direction`. Each Handoff records, per asset, its source, its licence, whether it is AI-generated and, if so, the tool, the prompt and the date.
3. A clickable prototype is built by `aico:frontend-engineer` only when the brief asks for one. Prototype code is code: step 5 applies.
4. **Plan Gate:** the CEO picks one concept (or a mix) in a form. The others are dropped.

## 4. Critique and polish
1. Dispatch `aico:persona-tester` (designs or prototype), `aico:hands-on-tester` (running prototype only) and `aico:accessibility-tester`, per Persona, in parallel, following `aico:usability`.
2. The designer fixes every S1 and the S2 findings the CEO picks in a form, then the testers re-check those findings. Fix rounds follow `aico:pipeline` §5.
3. `aico:writer` supplies the UX copy. This company has no localizer: a localisation need goes in the package as a note.

## 5. Prototype review
Whenever the run contains prototype code, both lanes run before the Ship Gate, whatever `pipeline.lanes` says:
- `aico:code-reviewer` reviews the prototype against the Handoff and the ruleset.
- `aico:security` audits it (`aico:security-check`).
A blocking finding goes to `aico:frontend-engineer` as a Fix round. Prototype code is delivered only after both pass.

## 6. Legal
Dispatch `aico:legal` with every asset record and the list of AI-generated public images, video or text. Its Handoff, `status: done`, must state:
- per AI-generated public image, video or text: the art. 50 duty that applies and how it is met, or why none applies (`ai-disclosure`), plus `deepfake: yes` or `deepfake: no` (a realistic person, place or event); a run with no AI-generated asset states `ai-disclosure: none (no AI-generated assets)`;
- the licence of every asset, including fonts and icons (`asset-licences`).
Missing or unclear → `[spec]` blocking.

## 7. Handoff package
1. Dispatch `aico:ui-ux-designer` for the package Handoff (`handoff-package`). It lists, as paths in the work dir:
   - files: the design source, exports, prototype, if any;
   - specs: screens, states, components, spacing, behaviour, accessibility notes;
   - tokens: the token file and its names and values;
   - per asset: the AI flag, and for AI assets the tool, prompt and date, plus a note that AI output may not be protected by copyright, so ownership is not guaranteed;
   - the asset licence record, linked to the legal Handoff.
2. A package that misses one of the four lists is `[spec]` blocking.

## 8. Ship Gate
Per `aico:pipeline` §4. The summary starts with `Ship means: <ship.meaning>` and shows the three lanes (legal, accessibility, security), the three checks and the package path. Nothing goes to the client or the build team before the CEO approves. Then follow `aico:pipeline` §6; commit the package and the Handoffs on the run branch, never push without the Ship Gate.
