# `/aico:campaign`

`/aico:campaign <campaign goal, client brief or audience>`

## In short
**Help:** `/aico:campaign help` (or `--help`) explains the command without running it.

**What it does.** Plans and produces a multi-channel campaign: positioning, copy, images, video storyboards and translations. It checks claims, AI disclosure, asset licences and accessibility, and stops at the Ship Gate before anything is published or handed to the client. Marketing company only. Nothing is built or deployed.

**When to use it.** One effort with several deliverables across channels. For one piece, use [`/aico:content`](content.md).

## How it works
1. **Product Manager** writes the campaign brief (with the Account Manager first, if there is a client). **→ Brief Gate.**
2. **Market Researcher** gathers the audience and competitor facts, each with an `[S#]`.
3. **Marketer** writes the plan from the brief and the research: positioning, messaging, channel plan and the list of deliverables (no copy yet). **→ Plan Gate:** you approve the positioning, the channels and the deliverables before anything is produced.
4. After the Plan Gate, **Marketer** writes SEO, post and ad copy from the approved plan. In parallel, **Brand Artist**, **Prompt Artist** and **Motion Artist** produce visuals, prompts and storyboards. Each asset is listed with its source, tool and licence, and AI-generated ones are marked.
5. **Writer** writes the long-form pieces and landing copy; **Localizer** translates when your project lists more than one language.
6. In parallel: **Editor** (claims cited), **Legal**, **Accessibility Tester** (alt text, captions, transcripts, contrast, reading level) and **Persona Tester** (is the message understood, does the call to action work; the personas are fictional and never appear in copy as real customers). Legal reviews:
   - advertising claims, price and discount claims, and green claims (Directive (EU) 2024/825, applying from 27 September 2026);
   - comparison claims, against the limits of Directive 2006/114/EC;
   - testimonials and reviews: none may be invented or AI-written;
   - labelling of advertising and sponsored content;
   - consent wording;
   - for each AI-generated public image, video or text, the AI Act art. 50 duty that applies and how it is met, or the reason none applies, plus whether it is a deepfake;
   - the licence of every asset.
7. Blocking findings go back to the Role that wrote the text, then the checks repeat for what changed. **→ Ship Gate.**

## Technical details
This command runs through the shared pipeline; see the [command overview](README.md#other-company-types).

**You get.** The final files under `.company/work/<slug>/` and a Ship summary that lists five open checks: `claims-cited`, `ai-disclosure`, `asset-licences`, the legal lane and the accessibility lane. Any open one blocks Ship. Publishing always asks at the Ship Gate, whatever your Gate settings say, and the Lead publishes nothing itself.

**Example.** `/aico:campaign launch campaign for a booking app aimed at independent hairdressers`
