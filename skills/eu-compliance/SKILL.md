---
name: eu-compliance
description: Use when a product handles personal data, ships software in the EU, has AI features, sells to consumers, or must be accessible. Maps EU laws to owner Roles and checklists.
---

# EU compliance

McSparrow is in the Netherlands and sells into the EU. Check which laws apply from the Project profile (`.company/project.md`), then read only the reference for each law that applies.

> Draft. Have a qualified lawyer review before publishing.

Put this line on every legal-facing text you produce (privacy policy, terms, accessibility statement, withdrawal notice). This Practice is a checklist, not legal advice.

## Scope
| Law | Applies when | Owner Role | Reference |
|---|---|---|---|
| GDPR | Any personal data is processed (accounts, analytics, logs, crash reports) | `legal` | none here; the `legal` agent owns it |
| Cyber Resilience Act (CRA) | A product with digital elements is placed on the EU market (software, apps, games, firmware) | `security` + `devops` | `references/cra.md` |
| AI Act | The product has AI features or produces AI-generated content | `legal` + `ai-data-engineer` + `architect` | `references/ai-act.md` |
| European Accessibility Act (EAA) | Consumer-facing e-commerce, banking, e-books, communication services | `accessibility-tester` + `legal` | `references/eaa.md` |
| VAT OSS and consumer law | Selling to consumers (B2C), especially digital goods or services | `legal` + `product-manager` | `references/vat-consumer.md` |

## Key dates
| Date | What |
|---|---|
| 28 Jun 2025 | EAA applies (already in force) |
| 2 Aug 2026 | AI Act Art. 50 transparency duties apply |
| 11 Sep 2026 | CRA reporting duties apply (ENISA, early warning within 24 h) |
| 11 Dec 2027 | Full CRA obligations apply |

A date that has passed means the duty is live.

## How to use it
1. Planning: the Product Manager and Architect list the applicable laws and missing obligations in their Handoff. When unsure whether a law applies, ask `legal`.
2. Building: engineers follow the reference checklists for the laws that apply.
3. Review: reviewers check the same list. A missing mandatory item goes to `## Blocking`.
4. Ship Gate: the Lead lists open compliance items for the CEO. Nothing legal-facing ships without the lawyer-review line.

## Rules
- GDPR questions (lawful basis, DPA, cookies, retention) go to `legal`, never decided in code review.
- Language-agnostic: for SBOM, scanner or audit tools, look up the stack with `aico:stack-detect`.
- Do not claim certification or compliance in marketing copy. Say what the product does.
- Unsure whether a duty applies: put it in the Handoff as an open question for the CEO, not as a guess.
