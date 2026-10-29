# 0040: Contests carry evidence, escalations go to the CEO

Status: proposed (Plan Gate, task elephant-goldfish)

A contest counts only with evidence the raising reviewer can open (a repo file, a line range or a test name the lint finds in that file); "intentional" is not evidence, and a comprehension-gap finding can never be contested, because a reader who misread the text is itself the defect. Evidence the reviewer cannot reach (a CEO decision, an outside fact) goes the other way: the builder escalates, the finding stays Blocking, and only a ruling the Lead writes from the CEO's own Gate answer into the run folder closes it, so no Role can close its own disagreement. CEO exceptions in `.company/standards.md` name the run slug from now on, because the bare key `05-code-reviewer:R-2` recurs in almost every run and an old exception would otherwise close a new security finding.
