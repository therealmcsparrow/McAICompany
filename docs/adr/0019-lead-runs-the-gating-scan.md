# ADR 0019: The Lead runs the scan that gates a skill install

Date: 2026-10-26. Status: accepted (CEO, Fix round 1 of task skill-researcher-scan).

The `skill-researcher` reads the candidate's untrusted files, so a scan result it reports can be steered, and the scanned commit could differ from the installed one. So the gating scan is run by a deterministic tool the Lead calls (`skill-picks.mjs vet` → `skillspector-scan` `vetCandidate`) on the exact commit the Role vetted, the install pins that commit (`#<sha>`), and a blocking or `error` post-install scan stops the run with a CEO form. The Role loses `Bash`, which retires the agentsec.M-SEC3 exception P3.
