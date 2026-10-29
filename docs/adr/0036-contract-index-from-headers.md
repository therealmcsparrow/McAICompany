# 0036: The Contract index is computed from the Contract headers

Status: proposed (Plan Gate, task v020-gate-roadmap)

The Contract index is computed from the Contract headers and Modules declare themselves in their script header, so there is no second list to drift. `.company/project.md` is not in CI because `.company/` is ignored, so the check reads only tracked files. The check is a Module (`scripts/contract-drift.mjs`) with one call in `scripts/check.mjs`, so Core gains no logic. Hard to reverse because Modules and Contracts rely on the header form.
