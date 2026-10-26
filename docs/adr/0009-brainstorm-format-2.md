# Brainstorm format 2 with a script-kept digest

New brainstorms use `brainstorm-file` v2: `scripts/brainstorm.mjs` stores every reply verbatim, keeps the question queue and the mechanical parts of the digest, and builds each Role's round input, so from round 2 Roles read the digest instead of the whole file. Old files are never converted (CEO, Brief Gate Q1) and keep the format-1 path. `check.mjs` verifies every quoted CEO answer and dissent line byte for byte against the stored rounds, so a Lead-written digest can't quietly change what was said.
