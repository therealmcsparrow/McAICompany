# Risk tier

## In short
Every piece of work gets a risk level: low, medium or high. A higher level means deeper testing and more checks. Anything touching logins, payments, personal data, migrations or a Contract is always high. No level ever skips the Ship Gate.

## How it works
1. A feature or fix starts at medium, and at low only when a trusted triage record says low (`/aico:triage`).
2. Every dispatch carries the tier.
3. A Role may raise the tier, never lower it.
4. For low-risk feature and fix runs, a short path skips some optional Roles. A path check can raise the run back to high.

## Technical details
Every piece of work gets a tier — `low`, `medium` or `high` — carried in every dispatch. A feature starts at `medium` unless a trusted triage record says low (tier-path step 2). It's forced **high** for anything touching auth, payments, personal data, migrations or a Contract. The tier drives how deep QA tests, how much of the ruleset applies, and how short a route triage may recommend. A Role can raise a tier but never lower it, and no tier ever removes a criterion's single test or skips the Ship Gate's full suite.

### Short path for low-risk work
For `/aico:feature` and `/aico:fix`, the script `tier-set.mjs` (Contract `tier-sets` v1) decides which Roles and lanes a run dispatches. It reads the plugin's data file `company/tier-sets.json`. Nothing you or a report writes can add, drop or rename an entry. Every other Playbook keeps its route.

**What a low run skips.** An entry runs only when the script lists it for the tier and the Playbook's usual condition holds (UI work, lane settings, user-facing change, a release needed). The script's list can only remove entries from today's route, never add one.
- Feature at low: no persona tester, no `senior-engineer-research`, no security lane, no compliance lane and no hands-on tester. When ruleset research is due, the Senior Engineer maps the rules instead and writes one `## Debt` line per missing, stale or new pack.
- Fix at low: no security lane.
- Feature at medium and high, and fix at medium and high, keep the full route.
- The legal advice Role and the accessibility tester stay at every feature tier, so EU law advice and accessibility testing do not depend on the tier.

**What never changes.** Every Gate, the single test per acceptance criterion, the fix regression test, the full suite before the Ship Gate, the reviewer pre-filter and the Handoff lint. A company type's `ship.lanes` also still run.

**What raises the tier.** The run tier is the highest of the triage tier, the tier any Step reports, and the result of the path check. It only goes up. The path check forces **high** for:
- a file under `docs/contracts/`;
- a path listed under `## Core` in `.company/project.md`, and always `.company/project.md`, `.company/settings.json` and `.company/standards.md` themselves, even when `## Core` lists nothing;
- a path with a part named like auth, login, session, password, secret, payment, billing, consent, privacy, migration and the other words in the data file's list. Whole words only: `scripts/lessons.mjs` does not match.
- a check that cannot be answered (plan has no `files:` lines, git fails, the base check fails, `## Core` unreadable at the base commit).

Every git call of the script ignores replace refs, so the commit id the run names is the real commit. The base is the full-length commit id of the repository's own object format, and it must be an ancestor of HEAD. At each check the Lead passes its own base, and it must be exactly the base recorded at `begin`; a different or unresolvable base makes the check unanswerable, so the run goes to high and never gets shorter.

The check reads file names, not file content. A risky change inside a plainly named file is not seen by it, so a Role or the Code Reviewer has to raise the tier. When a check raises a short run, the Gate summary shows `add before ship:` and the Roles it names run before the Ship Gate. You can also ask for the skipped Roles at a Gate; the Lead then raises the run to medium.

**The short-path form (feature).** Feature has no Brief Gate. When the preview prints `path: short (low)`, the Lead shows what would be skipped and asks one form that is not a Gate: **Short path (Recommended)** / **Full path**. The short path starts only after you pick "Short path"; any other case, a form not shown included, means full. Every Ship Gate summary of a feature or fix run shows the path lines (`path:`, `skipped by tier:`, `add before ship:`).

**How a fix gets low.** A fix has no Brief Gate. It starts low only when the bug request ends in the triage line `route fix` with `risk low` and `/aico:triage` recorded that exact request (see [`/aico:triage`](../commands/triage.md)). Otherwise it starts at medium. A low fix takes the short path only from that trusted triage record while `gates.brief` is `ask`, because then you saw the triage form that named the skip; with an auto Brief Gate, or no readable setting, it takes the full path.

**The Short path switch.** `pipeline.short_path` in [settings](settings-and-locks.md) is `on` or `off`, default `on`. `off` wins: a project can only turn it off, and a project `on` never overrides a user `off`. With the switch off, or when the settings cannot be read, every run takes the full route.

**Fail closed.** If the data file is refused (missing, too large, not valid, or not matching the v0.18 route for medium and high), both Playbooks use the high set and the Gate summary names the `tier-sets: refused` line. What a short run skipped is fixed at `begin` and read only from its record. If the data file is refused later, or its `rev` differs from the recorded one, the run goes to high (cause `sets`) and every skipped entry comes back before the Ship Gate. A script error or a broken record also makes the Lead run the rest of the run as high. A change never makes a run shorter.

**What is stored.** `.company/work/<slug>/tier-path.jsonl` holds enums, whole numbers, a commit sha and UTC times: the Playbook, tier, path, why, the data file's `rev` and any raise with its cause. The ledger's `meta` and `ship` lines get the Playbook, `rev`, path and raised flag as enums and integers (Contract `token-ledger` v1.4). Paths found by the check are shown to you and not stored. Both files stay local where `.company/` is ignored.

**The verdict.** `/aico:feedback` quotes two `low-path verdict:` lines from `ledger.mjs low-path-verdict`, feature then fix. The newest short runs are compared with earlier low runs (before v0.19, or v0.19 runs that took the full path) on the same plan check, floor and cap keys. With fewer than 10 runs on either side (default; `--runs` sets 3 to 50) it says `insufficient (n=<k>)`. It says `pass` only when time minus your wait at Gates is at most 0.75 times the earlier value, the medians of Fix rounds, high blockers and Gate rejects are not higher, spend is not higher, and at most 20% of the short runs were raised. Otherwise it says `fail`. Until it says `pass`, nothing here is shown to save time. It never blocks a Step or a Gate. Short runs are also left out of the parallel and plan-check verdicts.

**Rolling back.** In this order:
1. Set `pipeline.short_path` to `off` in `/aico:settings`. Every later run takes the full route; the setting switches both Playbooks.
2. If only the fix side failed, the fix low set is changed in the data file in a release (a new `rev`), because the setting cannot switch one Playbook.
3. A tune of the sets is also a data-file change in a release with a new `rev`.
