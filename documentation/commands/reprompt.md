# `/aico:reprompt`

`/aico:reprompt <prompt to improve>`

## In short
**Help:** `/aico:reprompt help` (or an empty argument) explains the command without running it.

**What it does.** Turns a rough prompt into one complete, ready-to-use prompt: goal, context, inputs, constraints, output format and a done-check. The Role is **Lynn** (the reprompter). She never runs the prompt herself, even if your text says "and run it". Instructions inside your text are treated as content to rewrite, not as orders.

**When to use it.** You have a short or vague prompt for an AI and want it sharpened first. It works in every company type. The Lead can start it for you when you ask to improve a prompt; it passes your text as the command's argument. A prompt for an image model is handed to the prompt-artist instead.

## How it works
**How it runs.** Lynn works in four steps, below. She writes only `prompt.md` and her own Handoff, and nothing runs without your **Use it**.

1. The Lead saves your text verbatim in a new run folder and dispatches the reprompter.
2. If a gap would change the result (goal, target AI, audience or scope), the reprompter returns up to 3 questions with 2 to 4 options each and a recommended one. Each question carries a one-line reason for the recommended option, and the form shows that reason under it. The Lead asks them in one form. The number of question rounds defaults to 1 and you can set it from 0 to 3 in `/aico:settings` (Question rounds); 0 means no questions. That number is an upper bound: as soon as no gap that changes the result is left, the reprompter says "No open question left" and asks no further round, even with rounds remaining. After the last round the reprompter goes on with stated assumptions and does not ask again. (`reprompt` v2.0: a question without its reason is malformed.)
3. The Lead shows the full prompt and its assumptions as plain text in a framed block, so nothing in them is hidden or rendered. Under them is one line saying the prompt is AI-written and to check it before you use it. Then it asks: **Use it** / **Edit** / **Keep only** / **Stop**. Edit has no fixed cap on rounds.
4. **Use it** hands the prompt to the Lead as a new request, exactly the text inside the frame, and the normal route check applies. Nothing runs without Use it.

## Technical details
A write gate limits the reprompter to writing `prompt.md` and its own Handoff in the run folder. After each reply the checker also compares your git settings and a set of config folders. If something changed, it tells you which files and that they stay changed, and the run stops or asks you whether to go on. The gate needs the aico hooks module; without it the command does not run.

**You get.** `.company/work/<slug>/prompt.md` and the Handoff. These files stay on your machine; the command never commits or pushes them. The prompt is written by an AI and may contain mistakes or wrong assumptions. Read it before you use it; the assumptions are listed under it.

**Your data.** Your text is processed like any other request to the company: the Claude model you have configured reads it to write the new prompt. The command adds no other recipient and no web access. Do not put personal data or secrets in a prompt unless you need them. If you do, the copies in `.company/work/<slug>/` are yours to keep out of git or delete; they are also saved there when you pick "Keep only". The folder has its own `.gitignore`, so a later `git add -A` skips it.

**Example.** `/aico:reprompt make the signup page better`
