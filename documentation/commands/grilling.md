# `/aico:grilling`

`/aico:grilling <idea | file | resume <slug>>`

## In short
**Help:** `/aico:grilling help` (or `--help`) explains the command without running it.

**Only you start this command.** No other command or the Lead starts it. All four company types.

**What it does.** Interviews you about an idea, one question at a time, until every branch is closed. Facts the repo or the web can answer are looked up and cited with their source; the rest is asked. Builds nothing.

**When to use it.** The idea is rough and you want its decisions made. This is the recommended grill.

## How it works
1. Each question has two to four options and a recommended one.
2. Each answer is saved to `.company/work/<slug>/grill.md` before the next question.
3. It ends with a form whose options depend on your company type.

## Technical details
**You get.** `grill.md` with the idea, decisions, facts with sources, and proposed glossary and ADR lines. Proposals are never written for you.

**Your data.** Local files in `.company/work/<slug>/` and `.company/draft-input-arg-grill.txt`. The Claude model reads them. The idea and your answers may become web search queries for fact lookups; the Lead keeps each query to the fact needed.

**Example.** `/aico:grilling let customers pause their subscription`
