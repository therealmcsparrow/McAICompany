---
name: content
description: Playbook for a marketing or content agency. Produce one piece of content (article, post, newsletter, script, page copy) with sources, images and disclosures, check claims, licences and accessibility, and end at the Ship Gate before it is published or handed to the client.
disable-model-invocation: true
argument-hint: <topic, brief or existing draft to improve>
---

# Playbook: content

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `content` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook content` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; keep the §1.0 JSON for the run. Use this for one piece. A multi-channel effort with several deliverables is `/aico:campaign`. No Plan Gate, nothing is built. Publishing or handing the piece to the client always asks at the Ship Gate (`aico:pipeline` §4). Only Roles in the type's `roles` are dispatched.

1. `aico:product-manager`: content brief (audience, purpose, format, length, channel, voice, one call to action). Argument is a draft → the brief states what to improve.
   **→ Brief Gate**
2. `aico:market-researcher` when the piece states facts, numbers or comparisons: the facts as `[S#]` in `## Sources`. Skip it for a piece with no factual claims and say so in the Ship Gate summary.
3. `aico:writer`: the piece, in the project's Voice preset (`aico:writing`). Every claim carries `[S#]` or is marked `(unverified)`. `aico:marketer` instead for SEO-led or conversion copy.
3b. When the piece needs images or video: `aico:brand-artist` ∥ `aico:prompt-artist` ∥ `aico:motion-artist`, only the ones needed. Each lists every asset with its source, tool and licence, and marks anything AI-generated.
4. `aico:localizer` when `languages:` lists more than one language.
5. Checks, in parallel, on the final text and asset list:
   - `aico:editor`: claims cited or marked `(unverified)` (`claims-cited`).
   - `aico:legal`: states the AI Act art. 50 disclosure for each AI-generated public image, video or text (`ai-disclosure`) and the licence of every asset (`asset-licences`); also advertising, endorsement and data-use wording.
   - `aico:accessibility-tester`: headings, alt text, captions, transcripts, contrast, reading level. Forced on by the type.
6. Fix round per `aico:pipeline` §3 for each Blocking item, then the checks repeat for what changed.
   **→ Ship Gate** (first line `Ship means: …`, `aico:pipeline` §4). Any open check or lane blocks.
7. After approval the Lead names the final files and the CEO publishes or sends them; the Lead publishes nothing itself. A client hand-over goes through `/aico:client`.
