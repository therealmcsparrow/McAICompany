# `/aico:vulnscan`

`/aico:vulnscan`

## In short
**What it does.** On-demand scan of your dependencies and code against published vulnerability databases (NVD/CVE, OSV, GitHub Advisories, vendor advisories, CISA KEV).

**When to use it.** You want a point-in-time supply-chain check — what in your tree is known-vulnerable right now, and what version fixes it.

**Help:** `/aico:vulnscan help` (or `--help`) explains the command without running it.

## How it works
Before it starts, you are told that dependency names and versions go to public sources (NVD, OSV, GitHub Advisories, vendor sites); nothing else leaves the repo.

1. **Vuln-scanner** enumerates your real dependency tree and matches each against advisory ranges, using primary sources only, recording a source URL for every finding.
2. It splits results: **Critical/High** (and anything KEV-listed or actively exploited) into a report for you to act on — a KEV hit is Blocking and suggests [`/aico:incident`](incident.md); **Medium/Low** into a ready **upgrade set** you can apply in one [`/aico:maintain`](maintain.md) run.

## Technical details
**You get.** `.company/work/<slug>/vuln-report.md` with `## Report` and `## Upgrade set`. No tree changes.

**Example.** `/aico:vulnscan`
