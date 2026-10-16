---
name: security-check
description: Use when the aico security Role audits code, or a builder handles auth, user input, secrets, payments or personal data.
---

# Security check

**Use** `security-review` for audits and `security-and-hardening` while building; `auth-implementation-patterns` for auth; `two-factor-authentication-best-practices` for 2FA. Load only the one that fits.

**Fallback:** OWASP Top 10 (injection, broken auth/access control, XSS, SSRF, insecure deserialization), secrets out of the repo, dependency audit with the stack's tool, least privilege, and personal data minimized and logged per GDPR. Desktop apps add code signing, update channel integrity and IPC input validation.

Report findings with confidence (high/medium) and file:line. High-confidence exploitable → `## Blocking`.
