# Review group

Read this only when the dispatch has a `Review group: <i>/<n> <path>` line (`dispatch-prompt` v4.4). The file lists the paths of this group, one per line; the Lead made the groups with `step-split` so one reviewer fits the diff inside the handover point.

- Scope: judge the listed paths (callers and Contracts at `full`) from the judging diff of those paths only. Do the first pass and every other check of `aico:review` on them.
- A bug you see outside the listed paths, also one whose cause lies in another group, stays Blocking with its own `<path>:<line>`. `step-split fix` places it by that path.
- Other remarks about paths outside the group are Nits.
- Your Handoff covers this group only. The review closes when every group's Handoff is done; yours alone closes nothing.
- A group of one very large file may need the handover chain (`status: handover`) when you near the handover point.
