# ADR 0067: One project, one folder; runs are sub folders

Status: accepted (task `P20261109.000009`, run 2)

Every run of a project (first run, later draft/build/fix runs and every sub-flow it starts) lives in `.company/work/<ProjectID>/<NN>-<playbook>/` and is addressed by the run slug `<ProjectID>/<NN>-<playbook>`, so one CEO request leaves one top-level entry and one branch; a sub-flow joins its parent only through a `project:` line in the hand-over argument that names a project `run-state projects` lists as active, and a hand-typed Playbook asks the CEO (start new when no one can answer). Old v2, v1.1 and legacy folders stay top-level and unchanged, and `isWorkFolder` keeps its old meaning so an unconverted consumer refuses a v3 slug instead of misreading it (`work-folder-name` v3.0, `run-state` v2.0).
