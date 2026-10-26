---
name: launch
description: Playbook. Take a product or release public with positioning, landing/store copy, release notes, privacy and terms. Ends at the Ship Gate.
disable-model-invocation: true
argument-hint: <product or release to launch>
---

# Playbook: launch

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `launch` and stop.

Run with `aico:pipeline`. No Plan Gate unless step 4 builds a landing page with Core/Contract changes.
Publishing and deploying always ask at the Ship Gate, whatever the settings say (`aico:pipeline` §4).

1. `aico:product-manager`: launch brief (audience, key message, channels, success metric).
   **→ Brief Gate**
2. `aico:marketer` ∥ `aico:writer` ∥ `aico:legal`
   - marketer: positioning, landing/store page copy, SEO, announcement posts
   - writer: release notes, getting-started docs
   - legal: also runs the `aico:eu-compliance` scope check; privacy policy, terms, cookie/consent check, claims check
2b. In parallel with step 2: `aico:brand-artist` (OG/social/store images, app icons) ∥ `aico:prompt-artist` (hero/illustration prompts) ∥ `aico:motion-artist` (demo storyboard, landing animations).
3. `aico:marketer`: final pass merging the legal Handoff and the asset list into its copy (claims, consent wording, image alt texts).
3b. `aico:localizer` on the final copy and release notes if `languages:` lists more than one language, so translations include legal's changes.
4. `aico:frontend-engineer` if the landing page has to be built or changed (then `aico:code-reviewer`).
   **→ Ship Gate** (nothing is published before this)
5. `aico:devops`: publish/deploy.
