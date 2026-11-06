# `/aico:vulnscan`

`/aico:vulnscan`

## In short
**What it does.** On-demand scan of your dependencies and code against published vulnerability databases (NVD/CVE, OSV, GitHub Advisories, vendor advisories, CISA KEV).

**When to use it.** You want a point-in-time supply-chain check — what in your tree is known-vulnerable right now, and what version fixes it.

**Help:** `/aico:vulnscan help` (or `--help`) explains the command without running it.

## How it works
Before it starts, you are told that dependency names and versions go to third parties, private package names included. Destinations: the web search tool and fetched advisory pages (NVD, OSV, GitHub Advisories, CISA KEV, the ecosystem DB, vendor sites), and the audit tool the scanner runs: `npm audit` (the npm registry), `pip-audit` (PyPI and OSV), `cargo audit` (the RustSec database on GitHub), `osv-scanner` (api.osv.dev), `govulncheck` (vuln.go.dev). Private or unresolvable packages are listed as unscanned and are not queried by the scanner itself; an audit tool may still send a name it reads from a lockfile. The Claude model you configured for aico is also a recipient: it reads the repo (manifests, lockfiles and code) to run the scan.

1. **Vuln-scanner** enumerates your real dependency tree and matches each against advisory ranges, using primary sources only, recording a source URL for every finding.
2. It splits results: **Critical/High** (and anything KEV-listed or actively exploited) into a report for you to act on — a KEV hit is Blocking and suggests [`/aico:incident`](incident.md); **Medium/Low** into a ready **upgrade set** you can apply in one [`/aico:maintain`](maintain.md) run.

## Technical details
**You get.** `.company/work/<slug>/vuln-report.md` with `## Report` and `## Upgrade set`. No tree changes.

**Example.** `/aico:vulnscan`
