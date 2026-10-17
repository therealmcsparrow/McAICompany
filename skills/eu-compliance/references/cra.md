# Cyber Resilience Act (CRA)

## What applies
Products with digital elements placed on the EU market: apps, desktop software, games, firmware, libraries sold commercially. Pure SaaS run on your own servers is generally out of scope; ask `legal` when a client app talks to it.

## Obligations (checklist)
- [ ] SBOM in CycloneDX or SPDX, generated in CI by `devops` on every release. Tool: see `aico:stack-detect`.
- [ ] Vulnerability-handling policy published, with a `SECURITY.md` containing a contact and how to report.
- [ ] Support period stated to users (how long security updates are provided).
- [ ] Security updates delivered separately from feature updates where feasible.
- [ ] No known exploitable vulnerabilities at release; dependencies scanned (see `aico:security-check`).
- [ ] Secure by default configuration; no default passwords.

## Reporting
For an actively exploited vulnerability or a severe incident, report through the single reporting platform to the coordinating CSIRT; ENISA is notified simultaneously (not ENISA alone):
- Early warning within 24 h.
- Notification within 72 h.
- Final report: for an actively exploited vulnerability, 14 days after a fix is available; for a severe incident, 1 month after the 72 h notification.

Start the Incident playbook and bring in `legal` and the CEO at once.

## Dates
- Reporting duties apply from 11 Sep 2026.
- Full CRA obligations apply from 11 Dec 2027.

## Goes to `## Blocking`
- Release without an SBOM step in CI.
- No `SECURITY.md` or no stated support period.
- A known actively exploited vulnerability in a shipped dependency.
