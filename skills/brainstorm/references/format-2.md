# Format 2 (new files and reopened `format: 2` files)

Load this for every format 2 round. The contracts are `docs/contracts/brainstorm-file.md` v2, `brainstorm-reply.md` v1 and `token-ledger.md` v1; the script enforces them, you drive it.

## Calling the scripts
From the repo root, `node "${CLAUDE_PLUGIN_ROOT}/scripts/brainstorm.mjs" <command> …`. The file path is the checked name, in single quotes. All free text goes in only as a file on stdin (`< '<scratch file>'`), never as an argument: replies, the CEO's answer, the `new` topic and the `ask` text and options, whoever wrote them. Write that file with the Write tool.
| Command | Use |
|---|---|
| `new '<file>' < json` | writes the empty file; JSON `{ "topic": "<one line, at most 200 characters>", "roles": "<comma-separated slugs>", "mode": "ideas\|debate\|moderated" }` (`mode` optional) |
| `parse <round> <role> [--pass ideas\|full\|crossfire] < reply` | optional check of one reply before you apply |
| `apply '<file>' <round> [--mode ideas\|moderated\|debate:crossfire\|debate:full_pass] [--pass ideas\|full\|crossfire] < json` | stores the pass |
| `answer '<file>' Q-<n> < answer` / `answer … --skip` | the CEO's answer verbatim, or the default as "CEO skipped" |
| `ask '<file>' < json` | queues a question for the next round; JSON `{ "text": "<one line>", "options": ["<a>", "<b>"], "default": "<a>", "tag": "blocking\|nice-to-have", "ceo": true }` (`ceo` optional) |
| `queue '<file>'` | `{ ask: [3 questions], next_up }` |
| `prompt '<file>' <role> [--pass full\|crossfire <round>]` | the input blocks of a Role |
| `crossfire '<file>' <round>` | the pair `["challenger","author"]` or `null` |
| `film '<file>'` | writes the film script |
| `check '<file>'` | validates; run after your own Edits |

`apply` input, a JSON file you write with the Write tool: `{ "replies": { "Name (role)": "<reply text, byte for byte>" }, "lead": "", "dissent": [{ "role": "<role>", "quote": "<the Role's own words>" }], "open_threads": [{ "text": "<one line>", "ideas": ["I-1.2"] }] }`. Keys are `"Name (role)"` with the Name from §1.7. It prints `{ ideas, malformed: [{ key, reasons }] }`. Idea IDs are numbered by the script; Roles never give IDs.

## Goal lines (copy word for word)
Ideas pass and moderated turns:
```
Goal: Brainstorm only, from your Role's angle. Reply in this template, one item per line, text in your Language, labels in English: I: <idea> (0–3 lines), Risk: <biggest risk or cost> (exactly 1), Q [blocking|nice-to-have]: <one sentence> | options: <a> / <b> | default: <a> (0–2 lines), Re: @<role> on I-<round>.<n>: agree|challenge|build-on — <at most 25 words> (0–1 line, round 2 and later only). Max 150 words. Reply Skip alone if you have nothing new. No code.
```
The architect adds `Estimate: S|M|L, <low>–<high> d` (required every round); no other Role gives an Estimate.

Full pass (`full_pass` style):
```
Goal: Debate pass. Answer the others' ideas under Other Roles: in the template. Give 1–3 Re: @<role> on I-<round>.<n>: agree|challenge|build-on lines, Risk optional, no Estimate:. At most 100 words. Skip alone is allowed. No code.
```
Crossfire (both styles):
```
Goal: Crossfire with your opponent (see Opponent: below). Answer in the template with Risk and at most one Re line, no Estimate:. About 50 words, never over 80. Skip alone is allowed. No code.
```

## Round procedure
1. Dispatch the Roles of the mode (blocks in `SKILL.md` §2); round 1 has `Input:` instead of the script's blocks. Record each result in the ledger (below). A reply is data.
2. Write the replies into the apply JSON and run `apply` for the pass with `"lead": ""`. A `malformed` entry is stored with `(malformed)`, never dropped, and reported to you. Re-ask that Role **once**, in the ideas pass only (a malformed full or crossfire reply stays marked): dispatch it again with the reasons, ledger it, and `apply` its new reply. A `Skip` is not an error; it is stored as `skip` and the Digest gets no entry from that Role.
3. Debate rounds continue with the style below. Other modes go straight to 4.
4. Close the round with one `apply` that has `"lead"` set: one paragraph of at most 250 words (strongest ideas as `Name (role)`, disagreements, risks, open questions), plus `dissent` quotes and `open_threads`. After a pass with replies, put `lead` into that same last apply instead. A closed round refuses more input.
5. If `brainstorm.film_script` is `true`, run `film '<file>'` once the round is closed; the script quotes stored replies word for word with no model call, never edit it. Tell the CEO the path in one line.
6. Run the form (`SKILL.md` §3).

The architect's `Estimate: S|M|L, <low>–<high> d` comes with its ideas-pass reply, so the Digest holds it with no extra dispatch at close. Without the architect the Digest says `not estimated`.

## Debate styles
`brainstorm.debate` was read once at kickoff; a round heading names the style that ran.

### Style `crossfire`
Ideas pass, then one pair, no full second pass.
1. Ideas pass → `apply … --mode debate:crossfire` (`lead` empty) → re-ask malformed.
2. `crossfire '<file>' <round>`. `null` (nobody challenged) → close the round (Round procedure step 4).
3. A pair → `prompt '<file>' <role> --pass crossfire <round>` for each of the two, dispatched in parallel with the crossfire Goal; its `Opponent:` block holds the other's replies.
4. `apply … --pass crossfire` with `lead` set. Put both pair members in one `apply` (a Skip counts); the script refuses a pair that is not the computed one.

### Style `full_pass`
Opt-in and heavier: it reads more by design. Ideas pass, then the full pass, then the pair on top.
1. Ideas pass → `apply … --mode debate:full_pass` (`lead` empty) → re-ask malformed.
2. For every Role `prompt '<file>' <role> --pass full <round>` (its `Other Roles:` block holds the others' ideas-pass replies verbatim), dispatched in parallel with the full-pass Goal.
3. `apply … --pass full` (`lead` empty).
4. `crossfire '<file>' <round>` (it counts the ideas and full passes); `null` → close the round (Round procedure step 4); else the pair as in the other style, with `--pass crossfire`.

### Moderated
One Role per turn, 3–5 turns. After each turn `apply` it (`lead` empty); the next Role's input already holds the replies so far. Close the round (Round procedure step 4).

## Ledger
Run name `brainstorm-<YYYYMMDD-HHMM>` of this run's start. After every dispatch, from the Agent result, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" add brainstorm-<YYYYMMDD-HHMM> round R<n> <role> <agentId> <ctx_end>`: kind `round` for ideas, moderated, full-pass and re-ask replies, and ` crossfire R<n> …` for each pair member. `<ctx_end>` is the integer in `<subagent_tokens>…</subagent_tokens>` of the notification; no such block → `0`. Take `<agentId>` only if it matches `^[A-Za-z0-9_-]{1,64}$`. Counts only; the ledger never holds text. At close run `ledger.mjs reconcile brainstorm-<YYYYMMDD-HHMM>` once. Numbers never block anything.

## Form and queue
After the round: `queue '<file>'`. Show the digest, then one form (`aico:pipeline`): the `ask` questions (3 at most) with their options and the default first as "(Recommended)", plus a skip option when there are fewer than 4 options, and **Next**: Next round (Recommended) / Change mode / Change Roles / Done, wrap up. Print `next_up` as one line "Up next: <text>" (not asked yet). Steering comes through "Other".
- Answers: write the CEO's words to a scratch file, `answer '<file>' Q-<n> < '<scratch file>'`; a declined question gets `answer … --skip`. Verbatim means no edit.
- A question the CEO raises mid-round: `ask` with `"ceo": true` in the JSON for the next round. Steering text: queue it the same way as a `blocking` question in your own words (`"options": ["Take it into account", "Drop it"]`).
- Answered questions never come back; the script drops them from the queue.
