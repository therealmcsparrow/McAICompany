---
step: 20
role: legal
task: research-team
status: done
round: 0
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
acceptance-ids: [AC4, AC7, AC20]
---
Draft. Have a qualified lawyer review before publishing. I am not a lawyer.

## Did
Scope: diff d39e8824..HEAD, read against `aico:eu-compliance`. Read `skills/sourcing/SKILL.md`, `skills/research/SKILL.md`, `docs/contracts/research-report.md`, the three researcher agents, `deps/skills.json`, `scripts/install-skills.mjs` (license check), and the README/CHANGELOG/documentation text added in the diff. No code edited.

Applicability: GDPR, AI Act and DSM Directive apply. CRA does not (aico is internal-only, `plugin.json` license `UNLICENSED`). EAA, VAT/OSS and consumer law do not apply (no sale, no consumer UI).

| Law | Obligation | Status |
|---|---|---|
| AI Act Art. 50 (live since 2 Aug 2026) | Machine-readable marking of AI-generated text | Met. Report frontmatter `label: AI-generated research` (RR, `skills/research` §4). The pick summary shows the label too (§6). |
| AI Act Art. 50 | Public disclosure of AI text on matters of public interest | Not triggered. Reports are internal and committed, never pushed or published. If the CEO publishes one, add a visible label or human editorial review. |
| GDPR Art. 5(1)(c) | Data minimisation | Met by instruction. `aico:sourcing` "Legal limits" restricts research to public business facts and bans profiling. Reports, Handoffs and the committed commit contain no data subjects by design. Not enforced by a check (see Nits). |
| GDPR Art. 6, 13, 30 | Lawful basis, notice, RoPA | Not triggered while no personal data is recorded. If a researcher records a named sole trader or founder, the fact stays business-only (Art. 6(1)(f)) and goes to the CEO as an open question. |
| DSM Directive Art. 4 (NL Auteurswet art. 15n) | Honour machine-readable TDM reservations | Partly met. `aico:sourcing` says respect robots.txt `Disallow` and other machine-readable opt-outs, and bans skills.sh `/api/` and `/search`. There is no step that checks for them (see Nits). |
| Quotation (Berne 10, InfoSoc Art. 5(3)(d)) | Short, attributed quotes | Met. Quotes are at most 25 words, in quote marks, with URL (`aico:sourcing`, RR). Sources carry a check date. |
| Third-party skill licenses | SPDX recorded before install | Met for what is new. `find-skills` is `MIT`, vetted 2026-10-22 in `deps/skills.json`. I confirmed MIT, not a fork, not archived, last push 2026-10-19 via the GitHub API on 2026-10-22. Design skills need an SPDX `license` on every DS line (`install-skills.mjs:98` refuses `NONE`, `NOASSERTION` and malformed values). Vetting rule 2 in `aico:sourcing` rejects unclear licenses. |
| Marketing claims | No compliance or certification claims | Met. README, CHANGELOG and `documentation/*` additions describe behaviour only ("labelled AI-generated research", "nothing is pushed", "unverified"). No "compliant", "secure", "certified" or superlative wording found. |

## Decisions
- Risk tier stays high (touches third-party code installs). No legal blocker.
- Art. 50 is satisfied for an internal artifact by the frontmatter label plus the summary line. A visible body label is not required while the report stays internal.
- The MIT license of `find-skills` imposes no obligation on an installed, non-redistributed tool. aico's proprietary license is not affected.

## Blocking
- (none)

## Nits
- [DSM Art. 4] `aico:sourcing` tells researchers to respect opt-outs but never says how. Add: fetch `/robots.txt` before the first fetch on a new host, and treat `noai`/`noimageai` meta tags, `tdm-reservation` headers (TDMRep) and an explicit "no AI/TDM" in the terms as opt-outs. When a source opts out, skip it and list it under `## Open questions`. WebFetch behaviour toward robots.txt is not documented by me; do not assume the tool enforces it.
- [Licenses] Pre-existing debt, not introduced here: the other `core` entries (`hallmark`, `impeccable`, `frontend-ui-engineering`, `security-*`, `auth-implementation-patterns`) and all `go`/`react`/`tanstack`/`auth` entries record no `license` or `vetted` date in `deps/skills.json`. This matches the rejected agentsec.M-SEC6 debt line. Fill SPDX ids before the next release.
- [Licenses] The DS license check validates the format only. A `LicenseRef-` or a restrictive id (non-commercial, GPL-family, "no AI use") would pass. Add to vetting rule 2: reject licenses that forbid commercial or AI-agent use, and show the license on the Install form, which already lists it.
- [GDPR] "Public business facts only" is an instruction, not a check. Cheap hardening: `aico:sourcing` tells the researcher to stop and flag when a page is mainly about a named private person. Low risk today.
- [AI Act] If a report is pasted into a brief, README or client deliverable, the label does not travel. State in `documentation/commands.md` that exported research text should keep the "AI-generated" note.
- [Process] Handoffs by the researchers are AI text without the label. They are internal working files and not committed; no action.

## Next
- Lead: no legal block for the Ship Gate. List for the CEO: (1) TDM opt-out wording nit, (2) license inventory debt for the older skills, (3) lawyer review of the Art. 50 reading above if reports are ever shared outside McSparrow.
- Senior Engineer or ai-data-engineer: optional edit of `skills/sourcing/SKILL.md` for the two nits above (outside my write scope).
- Open question for the CEO: will research reports ever go to clients or be published? If yes, Art. 50 visible disclosure and the client-facing GDPR position need a re-check.
