# Pack clash table (token-saving-mods by Ben AI)

Task P20261114.000001-T3, spike S2. Source read 2026-11-14: the unzipped pack `token-saving-mods` (9 plugins, marketplace owner "Ben AI"), read only, nothing run, nothing copied. This table is the only pack input a builder gets (see Clean-room rule).

## Licence check (AC27), recorded before any verdict

Method: every file of the pack searched for LICENSE files, `license` keys, SPDX lines, copyright and credit text. Result:

| Pack mod | Version | Licence found | Where | Derivation allowed |
|---|---|---|---|---|
| cache-clock | 0.3.0 | none | no LICENSE, no `license` key, no SPDX line | no |
| efficient-browser-use | 0.2.0 | none | same | no |
| effort-optimizer | 0.1.0 | none | same | no |
| handoff | 0.1.0 | none | same | no |
| input-router | 0.3.1 | none | same | no |
| mods | 0.2.0 | none | same | no |
| research-router | 0.3.0 | none | same | no |
| savings-proof | 0.2.0 | none | same | no |
| model-router | 0.6.0 | MIT (SPDX `MIT`) | `plugins/model-router/LICENSE` (copyright Daniel (San) Avila, 2025) and `"license": "MIT"` in its plugin.json; a copy of davila7/claude-code-templates `jev-model-router`, changed by Ben AI | yes, if the copyright and permission notice stay with the code |

- No licence means no permission to copy, modify or distribute (choosealicense.com, checked 2026-11-14). So 8 of 9 mods are **clean-room**: no pack code, text or structure is reused.
- The pack root has no LICENSE and `marketplace.json` has no `license` key. The upstream repository of the pack was not found (one web search, 2026-11-14), so no later licence grant could be checked.
- model-router: the MIT notice covers the upstream part. Ben AI's own changes carry no separate licence line beyond the package's `"license": "MIT"`. It is release 2 and clean-room here too; if release 2 ever ports its code, the MIT notice goes into NOTICE first.
- aico itself is `UNLICENSED` (`.claude-plugin/plugin.json`); NOTICE grants nothing, it only credits.

## Clean-room rule

- Each saver task builds from the row below and the aico Contracts only. It never opens the pack folder or its zip.
- Ideas, behaviour and settings are described here as facts; no code, identifiers or UI strings of the pack are quoted.
- The tech-researcher read the pack code to write this table; a builder who has not read it is the implementer. A task that did read pack code is dropped and redone by another Role.

## The eight clashes (brainstorm, binding)

| # | Pack mod | Clashes with | aico rule that wins |
|---|---|---|---|
| 1 | handoff | 250k handoff offer vs 180k default cap | `cap` guard, context-guard v2.0: default 180000, range 60000-250000, freeze 90%, hand over 100% |
| 2 | model-router | Haiku picks the subagent model | the dispatch Floor rule of `aico:pipeline` and Role pins in `agents/*.md` |
| 3 | effort-optimizer | sets effort per prompt | Role effort in agent files |
| 4 | input-router | Haiku summary replaces the file text Claude reads | exact text for Read before Edit and for review |
| 5 | research-router | web research routed through a cheap worker | `aico:sourcing` tiers, caps and untrusted-page rules |
| 6 | efficient-browser-use (dropped) | shrinks screenshots | hands-on-tester evidence is never shrunk (AC25) |
| 7 | mods | its own `switches.json` | aico settings with locks (AC15, AC23) |
| 8 | savings-proof | estimated savings | real tokens from the ledger; estimates in a separate labelled field (AC24) |

Extra clash, not one of the eight: cache-clock carries a keep-warm ping (a background model call); the CEO removed it (never list, PM brief).

## Table: one row per pack mod

Verdict words: `keep` (use pack code as is: no row qualifies, see Licence), `rewrite slim` (clean-room, slim), `drop`, `release 2`.

| Pack mod | Licence | Clash # | Verdict | Release | aico target | Spec for the clean-room build (facts only) | One executable test (AC26) |
|---|---|---|---|---|---|---|---|
| cache-clock 0.3.0 | none, clean-room | extra (ping) | rewrite slim: countdown only; drop the keep-warm ping, its `/keepwarm` command and button | 1 | existing `mods/cache-tax.tsx`, manifest `cache-tax` (title "Cache clock"); switch `mods.cache_tax.enabled` | Shows time left until the prompt cache goes cold, above the prompt; lifetime 5 min or 1 h from usage `cache_creation`; unknown = 1 h labelled assumed; offers a hand-over when a big chat goes cold. aico already has this (aico-mods v1.9); T-saver adds only the manifest and the no-ping scan | AC22 scan: no fetch, http, net, `model.fork` or spawn in the mod; clock shows countdown, sends no ping |
| handoff 0.1.0 | none, clean-room | 1 | drop the pack code; rewrite slim as the `cap` guard from context-guard v2.0 | 1 | `hooks/rules/cap.mjs` (guard, locked on) | Pack facts: offers a fresh chat at a token threshold, repeats after a snooze, writes a hand-over of the chat. aico takes only the idea of one user-set threshold; warn, freeze, hand-over bands and the 250000 ceiling come from the Contract, not the pack. The pack's 250k offer point is not carried | clash.1: threshold 250000 offered, 180000 used when unset; 250001 and bad values fall back to 180000 with one warning; the pack offer never fires |
| efficient-browser-use 0.2.0 | none, clean-room | 6 | rewrite slim: note-only (`browser.Y1`); the pack shrinks the tool result, which `mod-hook` v1 cannot do | 1 | `hooks/rules/browser.mjs`, manifest `efficient-browser-use`, default off, Lead session only | Pack facts: screenshots cost about width x height / 750 tokens; the pack shrinks each by half (min 512 px long side), keeps the click coordinate frame, or has Haiku describe it; zoom and own-scale shots are left alone. aico release 1 only notes the cost to the CEO when on; no shrink, no Haiku | clash.6: hands-on-tester and any Step session produce no note and no change; off by default; evidence bytes unchanged |
| mods 0.2.0 | none, clean-room | 7 | rewrite slim as Switchboard | 1 | `mods/switchboard.tsx`, pane `aico-mods`, built from `hooks/manifests/*.json`; writes only via `settings.mjs set-mod` | Pack facts: lists mods found on disk with On/Off per mod and Shown/Hidden, reads a user-level `switches.json`, shows owner, licence and source link. aico: no `switches.json` at all; guards shown read-only `locked on`; savers a switch | clash.7: hand-editing settings cannot turn a guard off; a `switches.json` is never read or written; lock beats switch (AC15, AC23) |
| savings-proof 0.2.0 | none, clean-room | 8 | rewrite slim | 1 | `mods/savings.tsx`, pane `aico-savings`; reads `ledger.mjs` only | Pack facts: pane for tokens saved, today and this chat, read from a savings log that each pack mod appends estimates to. aico: median real tokens per Step from the ledger versus the `baseline` run set; estimates in a separate labelled field; empty or missing field = "no data" or "unmeasured", never NaN; text escaped | clash.8: the pack's savings log is never read; an estimate never enters the real figure; NaN never shows (AC24) |
| input-router 0.3.1 | none, clean-room | 4 | release 2 | 2 | none in release 1 | Pack facts: big file and connector results are read by Haiku first; Claude gets short notes and a path; `/input-router full` lets one through whole; PDF needs Poppler. Release 2 spec must exclude Read before Edit, review and any guard input | clash.4 (specified now, run in release 2): exact text for Edit and review; Haiku note never feeds a guard, gate or Edit |
| model-router 0.6.0 | MIT (upstream Daniel Avila; notice required if code is ever reused) | 2 | release 2 | 2 | none in release 1 | Pack facts: Haiku judges each subagent task into fast, balanced or deep with a confidence; moves down only above a bar (0.6); never changes the main chat model. Release 2 spec: acts only above the model floor and never below a Role pin | clash.2: never below `company/model-floor.json`; a Role pin wins; floor guard result unchanged |
| effort-optimizer 0.1.0 | none, clean-room | 3 | release 2 | 2 | none in release 1 | Pack facts: reads each prompt, picks an effort level by a four-question framework, offers a switch or sets it in auto mode. Release 2 spec: never overrides a Role effort; Lead session only | clash.3: Role effort in the agent file is never changed |
| research-router 0.3.0 | none, clean-room | 5 | release 2 | 2 | none in release 1 | Pack facts: Haiku shortens big search results; `/research-router` has a cheap worker read pages and return a brief with sources. Release 2 spec: sourcing tiers, caps and untrusted-page rules of `aico:sourcing` stay with the researcher Roles | clash.5: no source tier, cap or `(unverified)` mark is dropped or reworded |

Notes for the Lead and QA:
- AC26 needs one executable test per row: the rows above carry the clash id (`clash.1` to `clash.8`) plus the cache-clock extra. The Haiku rows are specified now, tested in release 2 (brainstorm).
- A saver ships only when its row is green. A pack mod that fails its row is dropped (Q-24 default; the CEO decides when it happens).
- Removal trigger for a skill's text: its mod passes the replay (brainstorm round 14).
- Row release 1 count: 4 rows (cache-clock, handoff as `cap`, mods, savings-proof; efficient-browser-use dropped in v0.45 guard freeze). Release 2: 4 Haiku rows.
