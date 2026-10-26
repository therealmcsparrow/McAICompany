---
role: ai-data-engineer
step: 23
round: 1
status: done
---
## Summary
Skill-file fixes only, under skills/. Nothing committed.

## Changes
- skills/ruleset/SKILL.md:85: split the glued bullets (`- Library missing` now on its own line).
- All script invocations now use `node "${CLAUDE_PLUGIN_ROOT}/scripts/<x>.mjs"` in pipeline, cooler, help, version, ruleset, research (2), feature, setup. Non-command `<plugin root>` prose (paths to read, "plugin root = two folders above") is kept.
- skills/research/SKILL.md: §1.4 presence check now says `All skills already installed.` -> continue, otherwise show the printed commands, and an `ERROR` line is shown with nothing installed. §4 cites the RR `## Short Topic` rule (allow-list, 60 chars, 5 words, slug fallback, never repaired). §8 has the Lead re-check the topic before shell use and uses `git add '<report path>' && git commit -m 'docs: research <Short Topic>'` from the checked value only.
- research/SKILL.md is 68 lines; the largest skill is cooler at 106 (limit 125).

## Verification
- `node scripts/check.mjs`: 0 error(s), 0 warning(s).
- `npm test`: 185 tests, 184 pass, 1 fail. The failing test is `AC5 pick form...` in scripts/research-playbook.test.mjs:48. It still asserts the old string `docs: research <short topic>`; the skill now says `<Short Topic>`. The scripts/ builder needs to update that assertion (and may add the single-quoted form).

## Notes
- The §8 commit-time re-check relies on the report file name being the checked value; the Lead falls back to the run slug if it fails.
