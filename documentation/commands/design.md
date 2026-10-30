# `/aico:design`

`/aico:design <design brief | project | file>`

## In short
**Help:** `/aico:design help` (or `--help`) explains the command without running it.

**What it does.** Takes a design brief through research, concepts, critique and usability testing to a design handoff package for the client or the build team. Design company only.

**When to use it.** You run a design studio. The argument is a brief, `project` (the brief is this product) or a file such as a brainstorm, a report or an earlier handoff.

## How it works
1. **Product Manager** writes the design brief, including which assets may be AI-generated, and proposes 2 to 4 Personas if there are none. **→ Brief Gate.**
2. **Design Researcher** and **UX Researcher** run in parallel, as the brief needs.
3. **UI/UX Designer** produces two or three concepts, each with flows, key screens and a token set. Artists produce only the assets the brief lists, each with its source, licence and AI-generated flag. **Frontend Engineer** builds a clickable prototype only if the brief asks. **→ Plan Gate:** you pick a concept.
4. **Persona Tester**, **Hands-on Tester** (running prototype only) and **Accessibility Tester** test per Persona. The designer fixes every S1 finding and the S2 findings you pick. **Writer** supplies the UX copy. This company has no Localizer; a localisation need goes in the package as a note.
5. With prototype code in the run, **Code Reviewer** and **Security** both review it before Ship, whatever your lane settings say.
6. **Legal** states, for each AI-generated asset, the AI Act art. 50 duty that applies and how it is met (or the reason none applies), whether it is a deepfake (`deepfake: yes` or `no`), and the licence of every asset, including fonts and icons. With no AI-generated asset it states `none`.
7. **UI/UX Designer** writes the package: files, specs, tokens and the asset licence record. For each asset it also carries the AI-generated flag, the tool, prompt and date, and an ownership note: AI output may have no copyright protection, and the generator's terms must allow commercial use. A package missing one of these is blocked. **→ Ship Gate.**

## Technical details
This command runs through the shared pipeline; see the [command overview](README.md#other-company-types).

**You get.** The handoff package and the Handoff trail under `.company/work/<slug>/`. The Ship summary shows the three lanes (legal, accessibility, security), the three checks (`ai-disclosure`, `asset-licences`, `handoff-package`) and the package path. Nothing goes to the client or the build team before you approve.

**Example.** `/aico:design a mobile onboarding flow for a savings app`
