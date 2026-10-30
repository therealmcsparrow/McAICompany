# 0041: A reviewer that did not run is never a clean pass

Status: proposed (Plan Gate, task elephant-goldfish)

Reviewer retries, `not run` results and the commit each Fix round starts from live in an append-only record per run, written only through one script, so the "retry once, then not run" rule and the churn stop survive a compacted or resumed Lead. Churn is decided from git hunks of the judging diff between that commit and the run ref, matched to the locations of findings first raised in the round, so it stops a loop on evidence rather than on the Lead's reading; a forged record can only add Gate items or end Fix rounds early, never mark a review clean. Hard to reverse because the Ship Gate list and the Fix-round stop read the record.
