---
tool: nodejs-server
versions: "Node.js as a production HTTP server runtime, LTS lines 24 and 26 (Node 24 Maintenance LTS from 2026-10-20, EOL 2028-04-30; Node 26 LTS from 2026-10-28, EOL 2029-04-30); docs as read 2026-10-21. Complements nodejs@<major> (build runtime)."
researched: 2026-10-21
---
## Must
- nsrv.M1 — Production runs the latest patch of an Active or Maintenance LTS line (security fixes ship as patches); the line moves before its end of life — source: https://nodejs.org/en/about/previous-releases
- nsrv.M2 — The Node line is declared once (`engines.node` in the server's package.json plus `.nvmrc` / CI `node-version-file`) and CI tests on that same line — source: https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines
## Should
- nsrv.S1 — A reverse proxy terminates TLS in front of the Node server and normalises ambiguous requests — source: https://nodejs.org/en/learn/getting-started/security-best-practices#denial-of-service-of-http-server-cwe-400 , https://nodejs.org/en/learn/getting-started/security-best-practices#http-request-smuggling-cwe-444
- nsrv.S2 — `--disable-proto=delete` (or `throw`) is set where no dependency needs `__proto__` — source: https://nodejs.org/en/learn/getting-started/security-best-practices#prototype-pollution-attacks-cwe-1321
- nsrv.S3 — Every outbound HTTP call (`fetch`, provider SDKs) sets a total timeout (`signal: AbortSignal.timeout(ms)` or the SDK's timeout option); a port keeps the source's timeout value — why: undici's defaults wait minutes for headers and body — source: https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay , https://undici.nodejs.org/#/docs/api/Client.md
## May
- nsrv.Y1 — The permission model (`--permission`) for one-off commands that only read files — source: https://nodejs.org/en/learn/getting-started/security-best-practices#nodejs-permission-model
## Security
- nsrv.M-SEC1 — `server.requestTimeout` and `server.headersTimeout` stay non-zero (defaults 300 s / 60 s, or lower); no code sets them to 0 — source: https://nodejs.org/docs/latest-v24.x/api/http.html#serverrequesttimeout , https://nodejs.org/docs/latest-v24.x/api/http.html#serverheaderstimeout
- nsrv.M-SEC2 — No `--insecure-http-parser` and no `insecureHTTPParser: true` (request smuggling) — source: https://nodejs.org/docs/latest-v24.x/api/cli.html#--insecure-http-parser , https://nodejs.org/en/learn/getting-started/security-best-practices#http-request-smuggling-cwe-444
- nsrv.M-SEC3 — No inspector in production: no `--inspect*` in the start command or `NODE_OPTIONS` — source: https://nodejs.org/en/learn/getting-started/security-best-practices#dns-rebinding-cwe-346
- nsrv.M-SEC4 — `server.maxHeadersCount` is not set to 0 (unlimited) — source: https://nodejs.org/docs/latest-v24.x/api/http.html#servermaxheaderscount
- nsrv.M-SEC5 — No experimental runtime flag in production (`--experimental-*`, `--frozen-intrinsics`) — source: https://nodejs.org/en/learn/getting-started/security-best-practices#monkey-patching-cwe-349 , https://nodejs.org/docs/latest-v24.x/api/documentation.html#stability-index
- nsrv.M-SEC6 — TLS certificate verification is never turned off: no `NODE_TLS_REJECT_UNAUTHORIZED=0`, no `rejectUnauthorized: false`, no `checkServerIdentity` that accepts everything; a development CA is added only outside production, through `NODE_EXTRA_CA_CERTS` or a dispatcher `ca` that also keeps the system roots — source: https://nodejs.org/api/cli.html#node_tls_reject_unauthorizedvalue , https://nodejs.org/api/cli.html#node_extra_ca_certsfile
