# Remove the Blast Radius commit gate

Status: accepted (task `P20261112.000001/04-feature`). Supersedes `docs/adr/0017-blast-radius-fail-closed.md`.

aico no longer gates git commits: the Code Reviewer's diff, the `review-depth` tier and the Gates stay the check on Core, Contract and security changes, and aico:review, aico:contracts and aico:security-check make an unplanned such change Blocking. Old `mods.blast_radius` settings are ignored on read with one warning and refused on write (`aico-settings` v2.0, `aico-mods` v2.0). Anyone who wants a commit guard can add a git hook to their repo.
