# `/aico:content`

`/aico:content <topic, brief or existing draft to improve>`

## In short
**Help:** `/aico:content help` (or `--help`) explains the command without running it.

**What it does.** Produces one piece of content (article, post, newsletter, script or page copy) with sources, images and disclosures, checks it, and stops at the Ship Gate before it is published or handed to the client. Marketing company only.

**When to use it.** One piece. For a multi-channel effort, use [`/aico:campaign`](campaign.md).

## How it works
1. **Product Manager** writes the content brief (audience, purpose, format, length, channel, voice, one call to action). With a draft as the argument, the brief states what to improve. **→ Brief Gate.**
2. **Writer** writes the outline (or **Marketer** for SEO-led or conversion copy). **→ Plan Gate:** you approve the outline before any research or drafting.
3. **Market Researcher** gathers the facts when the piece states facts, numbers or comparisons. A piece with no factual claims skips this, and the Ship summary says so.
4. **Writer** drafts the piece (or **Marketer**). Brand, prompt and motion artists produce images or video only if the piece needs them. **Localizer** translates when you support more than one language.
5. In parallel: **Editor**, **Legal** and **Accessibility Tester**, as in `/aico:campaign`. Legal covers the same list, including testimonials, advertising labels, price and green claims, comparison limits and the AI Act art. 50 statement per AI-generated asset.
6. Fix rounds for blocking items, then **→ Ship Gate.** Any open check or lane blocks.

## Technical details
This command runs through the shared pipeline; see the [command overview](README.md#other-company-types).

**You get.** The piece and its asset list under `.company/work/<slug>/`. You publish or send it; the Lead does not.

**Example.** `/aico:content a newsletter about our new opening hours`
