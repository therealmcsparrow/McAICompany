# Spike S1: pinned global install

Date: 2026-11-06. Task T3a. Answer: yes on all three questions.

## Question

Does `skills@1.7.4 add <repo>#<sha> -g` install the pinned commit, and does the installed folder hash equal the hash the scan makes of that commit?

## Setup

- Source repo: `vercel-labs/skills`, skill `find-skills`.
- Pin: `0b8fb22aaa7f82447d4befe1b6a95d30a5b279b8` (2026-03-13). The default branch tip was `d3701c11b1101251af14c9d148f026e1a47ebe17` (2026-11-06). The skill folder changed between the two (last change 2026-07-10), so a pin the CLI ignored would show as a different hash.
- Command, run in an empty temp cwd: `npx -y skills@1.7.4 add "vercel-labs/skills#0b8fb22aaa7f82447d4befe1b6a95d30a5b279b8" -g -y --skill find-skills --agent claude-code`.
- Isolation: `HOME` and `USERPROFILE` set to an empty temp folder, plus `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME` and the npm cache in temp. Before the run a child `node` printed `os.homedir()` as the temp folder. `os.userInfo().homedir` still printed the real home on Windows, because it reads the OS account and ignores both variables. The CLI wrote only under the temp home.
- The real `~/.agents` and `~/.claude/skills` listings were compared before and after: identical.
- `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1` were set for the run.
- All temp folders were deleted at the end. The repo's skills and `.agents` were not touched. The impeccable installer was not run.

## Results

- Pin held: yes. The CLI printed `Source: https://github.com/vercel-labs/skills.git @ 0b8fb22a...` and its lock entry has `ref` equal to the pin.
- Blob path: no blob install. For a `<repo>#<sha>` source the CLI does a git clone at the ref and copies the skill folder. The lock entry has `sourceType: github` and a git tree id in `skillFolderHash` (`3013fdeb...`), which is not the scan hash and must not be compared with it.
- Where it landed: with `--agent claude-code -g` the folder is `<home>/.claude/skills/find-skills` (a copy). The lock is `<home>/.agents/.skill-lock.json`. The summary printed a `~/.agents/skills/find-skills` line, but no such folder was created.

## Hash comparison

Hashes come from `skillFolderHash` (`scripts/skillspector.mjs`) and `boundedFolderHash` (`scripts/skill-catalog.mjs`), not by eye.

| Folder | skillFolderHash | boundedFolderHash |
| --- | --- | --- |
| `skills/find-skills` at the pin (git checkout) | `645b891da1edbae76ab79c7b088d4e73397464f8396edaf773c0e01971ce75d6` | same |
| `<temp home>/.claude/skills/find-skills` after install | `645b891da1edbae76ab79c7b088d4e73397464f8396edaf773c0e01971ce75d6` | same |
| `skills/find-skills` at the branch tip (git checkout) | `d6cb30212b3b19f531378574784af1da09928b2e5078f299eaeaedd50191a4af` | same |

The installed folder hash equals the scan hash of the pinned commit, and differs from the tip hash. The two tools agree.

## Verdict

- Pin holds: yes.
- Folder hash equals scan hash: yes.
- T4 may run a pinned `-g` install, then prove it with `boundedFolderHash` against the scan hash at `<home>/.claude/skills/<name>`.
- Limit: one skill, one repo, one agent, one OS (Windows). Other layouts (nested skill paths, other agents) were not tried.

## What the CLI sends off the machine

- `git clone` of the source repo from github.com, and the npm registry fetch for `skills@1.7.4`.
- The package also holds telemetry calls to `skills.sh` (`/tele/t`, `/tele/audit`). The run set the two opt-out variables, so none was meant to be sent; no network capture was made to confirm. T4 must set both variables the same way.

## Personal copy against a repo folder of the same name

Established from the official Claude Code skills docs (`code.claude.com/docs/en/skills`, section on same names): enterprise wins over personal, and personal wins over project. With `deploy` in both `~/.claude/skills/` and the project's `.claude/skills/`, `/deploy` runs the personal one. This was read from the docs, not tested here.
