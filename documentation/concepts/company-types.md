# Company types

## In short
A project has one company type. It decides which Roles and Playbooks the company has and what "ship" means. If you set none, you have a software company. Switching a type later is not supported.

## How it works
1. Run [`/aico:setup`](../commands/setup.md) and pick a type. It is saved as `company_type:` in `.company/project.md`.
2. The Lead and `/aico:triage` route only to that type's own Playbooks and Roles.
3. **→ Ship Gate** For types other than `software`, the Ship Gate summary starts with `Ship means: …`.
4. Run the `company-type.mjs` script to see what your project allows.

## Technical details
A project has one company type. It decides which Roles and Playbooks the company has and what "ship" means. Set it with [`/aico:setup`](../commands/setup.md); it is saved as `company_type:` in `.company/project.md`. With no `company_type:` line a project is a `software` company, exactly as before. Switching a type later is not supported, and the settings page neither shows nor changes it.

| Type | Roles | Playbooks | What "ship" means |
|---|---|---|---|
| `software` (Software company) | 34 Roles, every Role except the editor | audit, brainstorm, client, cooler, feature, feedback, fix, grill, incident, launch, maintain, pentest, refactor, research, standards, to-spec, to-tickets, usability-test, vulnscan | Push, merge, release or deploy. Unchanged. |
| `research` (Research consultancy) | 11 | research, client, report, feedback, brainstorm, cooler, grill | The final report goes to the client or is published, with every claim cited `[S#]` or marked `(unverified)`. |
| `marketing` (Marketing and content agency) | 15 | campaign, content, research, client, feedback, brainstorm, cooler, grill | The work is published or handed to the client after the legal and accessibility lanes, with every claim cited or marked unverified. |
| `design` (Design studio) | 19 | design, research, client, feedback, brainstorm, cooler, grill | The design handoff package (files, specs, tokens and the asset licence record) goes to the client or the build team. |

Every type also has `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `skillspector` and `reprompt`, and every type has the reprompter Role. The Lead and `/aico:triage` route only to the type's own Playbooks and Roles, and `/aico:cooler` and `/aico:brainstorm` pick Roles only from it. A Role or command outside the type is refused with the list of allowed ones, and nothing is dispatched.

`grill` is in all four types; `to-spec` and `to-tickets` are in `software` only. `grill` ends with a form that fits the type. Where the main work of the type is `feature`, it offers `/aico:to-spec` on the grill file (recommended), `/aico:feature` with the file, or Stop. Otherwise it offers only what the type has. `grill`, `to-spec` and `to-tickets` run only on your own command, like the other CEO-only commands.

For types other than `software`, the Ship Gate summary starts with `Ship means: …`. The type also switches on review lanes and checks that settings cannot turn off:

| Type | Lanes forced on at Ship | Checks that must pass |
|---|---|---|
| `research` | legal | `claims-cited` |
| `marketing` | legal, accessibility | `claims-cited`, `ai-disclosure`, `asset-licences` |
| `design` | legal, accessibility, security | `ai-disclosure`, `asset-licences`, `handoff-package` |

A check with no matching Handoff is an open blocker:
- **`claims-cited`**: an editor Handoff in the run with `status: done` and no blocking finding. Every claim is cited `[S#]` or marked `(unverified)`.
- **`ai-disclosure`**: a legal Handoff that states, for each AI-generated public image, video or text, which AI Act art. 50 duty applies and how it is met, or the reason none applies (for example: not a deepfake; a human reviewed it and holds editorial responsibility; not text published to inform the public on matters of public interest). It also says `deepfake: yes` or `deepfake: no`, where a deepfake is a realistic person, place or event. A run with no AI-generated assets states `ai-disclosure: none (no AI-generated assets)`.
- **`asset-licences`**: the same legal Handoff, stating the licence of every asset.
- **`handoff-package`**: a UI/UX designer Handoff that lists the files, specs, tokens and the asset licence record.

A passed check records that Legal stated its position. These checks are a process check, not legal advice or a compliance certificate. Have a qualified lawyer review before you publish. In particular, the timing of the AI Act art. 50 duties may still change, so confirm the dates with a lawyer. Personas used in testing are fictional, and copy must never present one as a real customer.

To see which type a project has, and what it allows, the plugin script `company-type.mjs` prints plain lines by default:

```
company type: research (Research consultancy), from .company/project.md
roles: product-manager, account-manager, …
playbooks: research, client, report, …
work: report
ship: deliver-report. The final report goes to the client or is published, …
ship lanes: legal
ship checks: claims-cited
skill search hints: …
```

A project with no `company_type:` line shows `company type: software (Software company), default: no company_type line`. `work` lists the Playbooks that do the type's main work. When a brainstorm, a research run or a feedback run hands an idea over, it goes to the first of them. Tools that parse the output pass `--json` to get JSON instead. A refusal is one line starting with `refused:` that names the bad input, never a value from your project file.

The `design` company has two Roles that the brief did not list, `code-reviewer` and `security`, because a clickable prototype is code and the security lane is always on. The software Ship Gate is unchanged. If the type setting is broken, for example an unknown value or two `company_type:` lines, a Playbook stops with a refusal and changes nothing.
