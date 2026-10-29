---
name: content
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. For a marketing or content agency. Produce one piece of content (article, post, newsletter, script, page copy) with sources, images and disclosures, check claims, licences and accessibility, and end at the Ship Gate before it is published or handed to the client.
argument-hint: <topic, brief or existing draft to improve>
---

# Playbook: content

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:content` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook content` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; keep the §1.0 type lines for the run. Use this for one piece. A multi-channel effort with several deliverables is `/aico:campaign`. Nothing is built; the Plan Gate shows no Core, Contracts or Ruleset line. Publishing or handing the piece to the client always asks at the Ship Gate (`aico:pipeline` §4). Only Roles in the type's `roles` are dispatched.

1. `aico:product-manager`: content brief (audience, purpose, format, length, channel, voice, one call to action). Argument is a draft → the brief states what to improve.
   **→ Brief Gate**
2. `aico:writer`: the outline (sections, key points, claims that need a source, call to action). `aico:marketer` instead for SEO-led or conversion copy.
   **→ Plan Gate** (the CEO approves the outline). Research and drafting start after it.
3. `aico:market-researcher` when the piece states facts, numbers or comparisons: the facts as `[S#]` in `## Sources`. Skip it for a piece with no factual claims and say so in the Ship Gate summary.
4. The Role from step 2 drafts the piece from the approved outline, in the project's Voice preset (`aico:writing`). Every claim carries `[S#]` or is marked `(unverified)`.
4b. When the piece needs images or video: `aico:brand-artist` ∥ `aico:prompt-artist` ∥ `aico:motion-artist`, only the ones needed. Each lists every asset with its source, tool and licence, and marks anything AI-generated.
5. `aico:localizer` when `languages:` lists more than one language.
6. Checks, in parallel, on the final text and asset list:
   - `aico:editor`: claims cited or marked `(unverified)` (`claims-cited`).
   - `aico:legal`: states, per AI-generated public image, video or text, the art. 50 duty that applies and how it is met, or why none applies (`ai-disclosure`), plus `deepfake: yes` or `deepfake: no` (a realistic person, place or event); a run with no AI-generated asset states `ai-disclosure: none (no AI-generated assets)`. It also states the licence of every asset (`asset-licences`); also no invented or AI-written testimonials or reviews, ad and sponsored-content labels, price and green claims (Directive (EU) 2024/825), comparative advertising (Directive 2006/114/EC) and data-use wording.
   - `aico:accessibility-tester`: headings, alt text, captions, transcripts, contrast, reading level. Forced on by the type.
7. Fix round per `aico:pipeline` §3 for each Blocking item, then the checks repeat for what changed.
   **→ Ship Gate** (first line `Ship means: …`, `aico:pipeline` §4). Any open check or lane blocks.
8. After approval the Lead names the final files and the CEO publishes or sends them; the Lead publishes nothing itself. A client hand-over goes through `/aico:client`.
