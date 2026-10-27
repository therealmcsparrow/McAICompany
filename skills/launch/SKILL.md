---
name: launch
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. Take a product or release public with positioning, landing/store copy, release notes, privacy and terms. Ends at the Ship Gate.
argument-hint: <product or release to launch>
---

# Playbook: launch

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:launch` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook launch` first; exit not 0 → show its output line and stop.

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
