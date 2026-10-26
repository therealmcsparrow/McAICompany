# ADR 0020: Bind the gating scan to the bytes that install

Date: 2026-10-26. Status: accepted (CEO, Fix round 2 of task skill-researcher-scan).

The skills CLI picks a skill by its frontmatter name, prefers a repo-root `SKILL.md`, follows committed links on POSIX, and fetches any fork-network commit by sha, so a clean scan of a folder chosen by name could approve bytes that never install. So `vetCandidate` scans only the one folder the CLI can pick (anything ambiguous is refused), refuses link and submodule entries and commits on no branch or tag of the named repo, and records that folder's hash with the CLI's own algorithm. After install, `check-install` compares it with `skills-lock.json`, and any mismatch or missing result stops the run. Command-source picks are no longer approvable, because their command cannot be pinned.
