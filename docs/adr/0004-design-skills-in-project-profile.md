# Project design skills live in the Project profile, read by the installer

A product's approved UI/UX skills are one `## Design skills` section in `.company/project.md` that `install-skills.mjs --project` parses directly, instead of a separate `.company/skills.json`, so there is one source of truth the CEO reads and the scripts install from. Installs stay user-global (`-g`), as for plugin groups; the section records which ones this product uses.

**Consequences**: the line format (`design-skills-section` v1) is a Contract; a malformed line fails the install rather than being guessed.
