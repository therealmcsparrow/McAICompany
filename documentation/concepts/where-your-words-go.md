# Where your words go

## In short
In the idea flow, your words go to the Claude model you configured, to a web search tool in the cases listed below, and into local files. They are not pushed or published by the idea flow. This page names every place.

## How it works
1. You write an idea or a bug report. The Claude model you configured reads it.
2. Some commands look facts up on the web. The queries come from your idea.
3. Records and copies are saved as local files in your product.
4. Whether those files reach git depends on your own `.gitignore`.

## Technical details
- **The Claude model you configured** reads your idea or bug text, the grill file, the tickets and the Lead Handoff.
- **The web search tools:** The web search tools (WebSearch, WebFetch) run in grill lookups and in research, and in the Water cooler and Brainstorm routes when a Role that holds them (market-researcher, tech-researcher, design-researcher, skill-researcher, senior-engineer or vuln-scanner) joins; those two routes do not forbid it, and a request can carry words from the idea. No other recipient. `/aico:grill-me` never searches. `/aico:grill-with-docs` reads repo files only and never searches the web.
- **`/aico:vulnscan`** sends dependency names and versions to public vulnerability databases, package registries and web search (a name known or suspected to be private goes in no query), and the audit tools it runs may send private package names too (examples: OSV, NVD, GitHub Advisories, npm, PyPI; not a complete list). The Claude model you configured reads the repo (manifests, lockfiles and code) to run the scan, and advisory pages are fetched from vendor and advisory sites. The notice comes before the scan starts, on a direct dispatch too.
- **Local files only:** `.company/work/<slug>/` (records and copies), `.company/draft-input-arg-*.txt`, `.company/ideas/<name>/` (a parked idea) and `.company/roadmap/` (parked tickets). aico writes no ignore rule. These files are git-ignored only where your product ignores `.company/`, so add that line to your `.gitignore`. Files are archived, never deleted.
- **The hand-over hooks** read token counts from the local Claude Code transcript and store none of its text.
- Nothing in the idea flow is pushed or published. The build Playbook then follows its own rules.
