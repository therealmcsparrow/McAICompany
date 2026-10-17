---
name: i18n
description: Use when building or reviewing anything a user reads, sees or types in. Covers externalized strings, plurals, locale-aware formats, right-to-left layout and text growth.
---

# Internationalization

Languages come from `languages:` in `.company/project.md` (default `en`). One language today does not excuse hard-coded text: the structure must allow more.

## Rules for engineers
1. **No hard-coded user-facing strings** in code or templates: labels, errors, validation messages, e-mails, notifications, alt text.
2. **Keys, not sentences.** Store strings in the stack's resource format under stable keys (`checkout.pay_button`). Find the stack's i18n library and file format with `aico:stack-detect`.
3. **ICU message format** for plurals, gender and select. Never build sentences by concatenating fragments; word order differs per language.
4. **Locale-aware formatting** for dates, times, numbers, currency and sorting, using the platform or library formatter. Never format by hand.
5. **Time zones**: store UTC, display in the user's zone.
6. **RTL-safe layout**: use logical properties (start/end, not left/right), mirror directional icons, test with a right-to-left locale.
7. **Room for +35 % text growth**: no fixed-width labels or buttons; allow wrapping. German and Dutch run long.
8. **No text in images**; if unavoidable, localize the Asset.
9. **Unicode everywhere**: names, addresses and search must handle non-ASCII input.

## Review checklist
- [ ] No literal user-facing string in changed code.
- [ ] Plurals use ICU, not `if count == 1`.
- [ ] No hand-formatted date, number or currency.
- [ ] Layout survives a long pseudo-locale and a right-to-left locale.
- [ ] A missing translation falls back to the default language, never shows a raw key.

## Writers and translators
- Give each string context (where it appears, max length) in a comment or description.
- The `localizer` Role keeps the Voice preset in every language.
- Machine translation is a draft; a human reviews legal text and anything the CEO publishes.

## Severity
| Finding | Handoff section |
|---|---|
| Hard-coded string when `languages:` lists more than one | `## Blocking` |
| Hard-coded string in a single-language product | `## Nits`, marked *recommendation* |
| Hand-formatted date, number or currency; fixed-width text | `## Nits` |
