---
name: security-check
description: Use when the aico security Role audits code, or a builder handles auth, user input, secrets, payments or personal data.
---

# Security check

**Use** `security-review` for audits and `security-and-hardening` while building; `auth-implementation-patterns` for auth; `two-factor-authentication-best-practices` for 2FA. Load only the one that fits.

**Fallback:** OWASP Top 10 (injection, broken auth/access control, XSS, SSRF, insecure deserialization), secrets out of the repo, dependency audit with the stack's tool, least privilege, and personal data minimized and logged per GDPR. Desktop apps add code signing, update channel integrity and IPC input validation.

**Untrusted input (imports, pasted text, files, URLs, config from others) — builders must:**
- **Allow-list, never block-list.** Accept only what is provably safe (exact formats, known keys, same-origin paths); everything else is rejected or flagged. Never try to enumerate dangerous patterns: every "add one more case" fix is a defect.
- **Parse like the consumer parses.** Use the real parser (CSS, URL, SVG/DOM, YAML) or mirror its rules, including error recovery: unterminated strings and brackets, escapes, comments, whitespace and control characters, case. A check that only sees well-formed input is wrong.
- **Bound the work.** Size limits before parsing, linear-time patterns (no nested or overlapping quantifiers), a test that a worst-case input finishes fast.
- **Test the hostile cases first:** malformed and truncated input, encoding tricks, values split across fields, and very large input — plus the safe cases that must still pass.

**Ruleset:** these rules are the project ruleset's `proj.M1`–`proj.M4` (`aico:ruleset`); security rules there are always Must.

Report findings with confidence (high/medium) and file:line. High-confidence exploitable → `## Blocking`.
