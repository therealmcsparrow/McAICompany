// Shared forced-high word list and the token split of one path segment (contract: docs/contracts/tier-sets.md v2.0,
// docs/contracts/diff-facts.md v1.2). Dependency free: no imports, so any script can load it, also through require().

export const FORCED_HIGH_V1 = Object.freeze(
  ('auth authn authz authentication authorization authorize oauth oauth2 oidc saml sso jwt login logout signin signup session sessions ' +
    'password passwords passwd credential credentials mfa 2fa totp rbac acl permission permissions secret secrets keystore crypto ' +
    'payment payments billing checkout invoice invoices stripe paypal mollie subscription subscriptions refund refunds pii gdpr ' +
    'consent personal privacy migration migrations migrate alembic flyway liquibase').split(' ')
);

// Tokens of one segment: the word split, then the acronym split added after it, without repeats.
function wordSplit(segment) {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '');
}

const isUpper = (c) => c >= 'A' && c <= 'Z';
const isLower = (c) => c >= 'a' && c <= 'z';

// Breaks between a run of upper-case letters and an upper-case letter that starts a word, in one pass.
function acronymBreaks(segment) {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (i > 0 && isUpper(c) && isUpper(segment[i - 1]) && i + 1 < segment.length && isLower(segment[i + 1])) out += ' ';
    out += c;
  }
  return out;
}

export function tokens(segment) {
  if (typeof segment !== 'string') return [];
  return [...new Set([...wordSplit(segment), ...wordSplit(acronymBreaks(segment))])];
}
