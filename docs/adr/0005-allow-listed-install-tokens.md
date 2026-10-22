# Install commands are built only from allow-listed tokens

Text in `## Design skills` comes from LLM web research, and `install-skills.mjs` runs commands through a shell (Windows `.cmd` shims leave no other way, CVE-2024-27980), so a design-skill `source` is either an `owner/repo` and `name` that match fixed patterns or a command byte-identical to one already in the repo-owned `deps/skills.json`; free-form commands are refused. Loosening this later would reopen CWE-78, so it needs a new ADR and a Security review.
