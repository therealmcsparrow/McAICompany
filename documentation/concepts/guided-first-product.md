# Guided first product

## In short
If your project has no profile yet and you ask for a new product, the Lead asks you three short forms. You never edit a file by hand. The stack is detected, not asked.

## How it works
1. **Company.** Pick the company type (optional; none means software).
2. **Product.** Pick the product type, engagement, client, audience and goal.
3. **Voice and terms.** Pick languages, voice, license, jurisdiction and personas.
4. aico writes `.company/project.md` and the run goes on as usual.

## Technical details
When `.company/project.md` is missing and your request starts a product, the Lead asks three forms, so you edit no file by hand:
1. **Company.** The company type (optional; none means software).
2. **Product.** Product type (web, desktop or game), engagement (own or client), client, audience and goal.
3. **Voice and terms.** Languages, voice (clear, bold or technical), license, jurisdiction and up to 5 personas.

The stack is not asked; it is detected. `scripts/project-init.mjs write` checks each answer (one line of 1 to 200 characters, no control characters) and creates `.company/project.md`. It never replaces an existing profile, and a refused answer is named by its key and asked again. Answers are stored as text and never run. The run then goes on as usual and stops at the Brief Gate.
