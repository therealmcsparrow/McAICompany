---
name: campaign
description: Playbook for a marketing or content agency. Plan and produce a multi-channel campaign (positioning, copy, images, video storyboards, translations), check claims, AI disclosure, asset licences and accessibility, and end at the Ship Gate before anything is published or handed to the client.
disable-model-invocation: true
argument-hint: <campaign goal, client brief or audience>
---

# Playbook: campaign

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `campaign` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook campaign` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; keep the §1.0 type lines for the run. Nothing is built or deployed: the work is text, images, prompts and storyboards. The Plan Gate shows no Core, Contracts or Ruleset line. Publishing or handing work to the client always asks at the Ship Gate, whatever the settings say (`aico:pipeline` §4). Only Roles in the type's `roles` are dispatched (`aico:pipeline` §2).

1. `aico:product-manager`: campaign brief (goal, audience, key message, channels, deliverables, success metric, budget and deadline if given). With a client: the `aico:account-manager` turns the client's words into the brief first.
   **→ Brief Gate**
2. `aico:market-researcher`: audience, competitors and the facts the copy will lean on. Every fact goes in `## Sources` as `[S#]`. Needs only the brief.
3. `aico:marketer`: positioning, messaging, the channel plan and the deliverables list (no copy yet).
   **→ Plan Gate** (the CEO approves positioning, channels and deliverables). Production starts after it.
3a. `aico:marketer`: SEO, post and ad copy from the approved plan. Every claim carries `[S#]` from step 2 or is marked `(unverified)`.
3b. In parallel with step 3a, after the Plan Gate: `aico:brand-artist` (brand-fit visuals) ∥ `aico:prompt-artist` (image and video prompts) ∥ `aico:motion-artist` (storyboards, motion). Each lists every asset with its source, tool and licence (`aico:art-direction`), and marks each AI-generated image, video or text.
4. `aico:writer`: long-form pieces and landing copy from the messaging, in the project's Voice preset (`aico:writing`). Same citation rule.
5. `aico:localizer` on the final copy when `languages:` lists more than one language.
6. Checks, in parallel, once the copy and the asset list are final:
   - `aico:editor`: every claim cited `[S#]` or marked `(unverified)`; satisfies `claims-cited`.
   - `aico:legal`: the `aico:eu-compliance` scope check, no invented or AI-written testimonials or reviews, ad and sponsored-content labels, price and green claims (Directive (EU) 2024/825), comparative advertising (Directive 2006/114/EC), consent and data-use wording. The Handoff states, per AI-generated public image, video or text, the art. 50 duty that applies and how it is met, or why none applies (`ai-disclosure`), plus `deepfake: yes` or `deepfake: no` (a realistic person, place or event); a run with no AI-generated asset states `ai-disclosure: none (no AI-generated assets)`. It also states the licence of every asset (`asset-licences`). A missing statement is a `[spec]` finding.
   - `aico:accessibility-tester`: alt text, captions and transcripts, contrast and reading level of the deliverables. The lane is forced on by the type.
   - `aico:persona-tester` as each target persona on the near-final copy: is the message understood, does the call to action work.
7. Fix round per `aico:pipeline` §3 for each Blocking item; the Role that wrote the text fixes it, then step 6 repeats for the changed parts. Never reword a claim to dodge the editor; add the source or mark it `(unverified)`.
   **→ Ship Gate** (first line `Ship means: …`, `aico:pipeline` §4). The summary lists the five open checks: `claims-cited`, `ai-disclosure`, `asset-licences`, legal lane, accessibility lane. Any open one blocks.
8. After approval the Lead tells the CEO where the final files are and what to publish or send; it publishes nothing itself. Hand-over to a client goes through `/aico:client`.
