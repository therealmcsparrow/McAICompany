# ADR 0062: The role skill catalog replaces the skills manifest

Date: 2026-11-06. Status: accepted (CEO, run 2026-11-06 17.03 - Role Skills File). Decided: CEO answers "Replace" and "1, but give status if installed".

`3rdpartyskills.json` replaces the old manifest as one list in a repo-owned baseline layer inside the plugin and a user layer in the real user home, because one list was the CEO's decision and the layers keep repo-owned trust while stopping a cloned repo from supplying entries or commands. The user path comes from `os.userInfo().homedir` and ignores `HOME`, `USERPROFILE` and `MCSPARROW_HOME`, because a repo's `.claude/settings.json` can set env values. A stored command is shown and never run, and status comes from file reads only.
