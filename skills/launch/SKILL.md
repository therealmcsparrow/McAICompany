---
name: launch
description: Playbook. Take a product or release public with positioning, landing/store copy, release notes, privacy and terms. Ends at the Ship Gate.
disable-model-invocation: true
argument-hint: <product or release to launch>
---

# Playbook: launch

Run with `aico:pipeline`.

1. `aico:product-manager`: launch brief (audience, key message, channels, success metric).
   **→ Brief Gate**
2. `aico:marketer` ∥ `aico:writer` ∥ `aico:legal`
   - marketer: positioning, landing/store page copy, SEO, announcement posts
   - writer: release notes, getting-started docs
   - legal: privacy policy, terms, cookie/consent check, claims check
3. `aico:marketer`: final pass merging the legal Handoff into its copy (claims, consent wording).
4. `aico:frontend-engineer` if the landing page has to be built or changed (then `aico:code-reviewer`).
   **→ Ship Gate** (nothing is published before this)
5. `aico:devops`: publish/deploy.
