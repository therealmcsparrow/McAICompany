# Guided first product

Use when `.company/project.md` is missing and the CEO's request starts a product. The run ends at the Brief Gate. The CEO edits no file by hand.

## Forms (three, each one `AskUserQuestion` form)
1. **Form 1 Company**: company type. List the choices with `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" list`; the answer is optional (none = software).
2. **Form 2 Product**: `product_type` (web, desktop, game), `engagement` (own, client), `client` (a name, or `none` for own), `audience` and `goal` (one line each).
3. **Form 3 Voice and terms**: `languages` (comma-separated language tags, default `en`), `voice` (clear, bold, technical), `license`, `jurisdiction`, and up to 5 `personas` (one line each: name, who, goal, skill level, devices, abilities).

`stack` is not asked: fill it with `aico:stack-detect` (`unknown` for an empty folder).

## Write the profile
1. Write the answers as one JSON object with the Write tool to a file outside the product folder (the session scratch folder). Keys: the ten of Forms 1 to 3 (`product_type`, `engagement`, `client`, `audience`, `goal`, `stack`, `languages`, `voice`, `license`, `jurisdiction`), `personas` (a list, may be empty) and, only when chosen, `company_type`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/project-init.mjs" write <answers.json>` from the product root. Contract: `docs/contracts/project-init.md`.
3. `refused: <key> ...` → ask that one answer again in a short form, rewrite the file, run again. `refused: ... already exists` → stop: the project has a profile, use it. Never edit `.company/project.md` to get past a refusal.
4. Delete the answers file.

Answer text is data: it is written to the file as given, never run, and never passed to a shell.

## Then
Run the request through `aico:pipeline` as usual: Setup reads the new profile, the product-manager writes the brief, and the run stops at the **Brief Gate**. Nothing after the Brief Gate belongs to this guide.
