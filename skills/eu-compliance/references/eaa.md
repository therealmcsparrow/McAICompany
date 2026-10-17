# European Accessibility Act (EAA)

## What applies
In force since 28 Jun 2025. In scope: e-commerce, consumer banking, e-books and readers, consumer communication services, passenger transport sites and apps, and similar consumer-facing services.

## Working target
WCAG 2.2 AA (a superset of the WCAG 2.1 AA that EN 301 549 references). The `accessibility-tester` Role checks it (see `aico:usability`).

## Obligations (checklist)
- [ ] The whole user journey meets WCAG 2.2 AA: keyboard, focus, contrast, text alternatives, labels, error messages, zoom and reflow.
- [ ] An accessibility statement is published and kept current: conformance level, known gaps, a feedback contact, and the enforcement body.
- [ ] Accessibility is checked in CI or at every release, with results kept.
- [ ] Documents and support information are accessible too (help pages, e-mails, invoices).
- [ ] Accessibility problems reported by users are triaged like bugs.

## Exemption
Micro-enterprises are exempt for services: fewer than 10 staff and turnover of at most EUR 2M (or balance sheet total). The exemption does not cover products, and does not apply to a client whose company is larger. Record the basis in the Project profile; `legal` confirms.

## Goes to `## Blocking`
- A WCAG 2.2 AA failure on a core journey (sign-up, checkout, payment).
- A consumer service in scope with no accessibility statement at the Ship Gate.
