# ADR 0066: Project IDs name work folders, branches and tickets

Status: proposed (Plan Gate, task `2026-11-08 22.25 - Project Id Naming`)

One project ID `P<yyyymmdd>.<n>`, counted per day from the folders on disk, names every run folder (`<ProjectID>-HH.MM.SS`, local start time with seconds; an exact same-second clash is refused), the one branch `aico/<ProjectID>` and every ticket (`<ProjectID>-T<n>`), so the CEO and every agent address a piece of work by one name. The description moves out of the name into line 1 of `00-summary.md`; no counter file is kept, and v1.1 names and legacy slugs stay readable and are never renamed (`work-folder-name` v2.0).
