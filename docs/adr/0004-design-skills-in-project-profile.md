# Project design skills live in the Project profile, read by the installer

A product's approved UI/UX skills are one `## Design skills` section in `.company/project.md` that `install-skills.mjs --project` parses directly, instead of a separate `.company/skills.json`, so there is one source of truth the CEO reads and the scripts install from. Repo-sourced design skills install in project scope (no `-g`; the skills CLI default, Spike S1 Q5), so each product keeps its own set and `skills-lock.json` records it; plugin groups stay user-global.

**Consequences**: the line format (`design-skills-section` v1) is a Contract and the project-scope inventory; a malformed line fails the install rather than being guessed. Installs add `.agents/`, `.claude/skills/` links and `skills-lock.json` to the product repo, which no Playbook commits.
