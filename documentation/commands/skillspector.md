# `/aico:skillspector`

`/aico:skillspector [--project | --global | --all | <skill-name>] [--no-llm | --claude-cli] [install]`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Scans the agent skills installed in this project or your user folder with NVIDIA SkillSpector and reports what it finds per skill. It never removes anything.

**When to use it.** You installed a third-party skill and want a check before you trust it, or you want to install the scanner.

**Help:** `/aico:skillspector help` (or `--help`) explains the command without running it.

## How it works
1. Checks that the tool is installed. If not, it shows an install form with the pinned release (v2.13.1), the two exact commands, and the rollback. The install changes your user-scope Claude config, so it always asks, even when your Gates are set to auto. Skip runs nothing. aico never installs `uv`; without it, the command stops and says so.
2. Before it scans, it says in one line how many skills it will scan, a time estimate and that package names, versions and ecosystems, plus the ids of any vulnerabilities found, go to OSV.dev. Then it scans each skill in scope. The mode comes from the `skillspector.mode` setting (default `no-llm`: static rules on this machine; no skill text leaves it; package names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found); `--no-llm` or `--claude-cli` overrides it for one run.
3. Reports per skill: pass, findings or error. An error is never shown as safe. For a skill with blocking findings it suggests removal commands for you to run; it runs none.

## Technical details
### Options
- `--project`: scan the skills in this project. `--global`: scan the skills in your user folder. `--all`: scan both.
- No scope, or more than one scope flag: a form asks which scope to scan: Project (Recommended), Global or All.
- `<skill-name>`: scan one installed skill. The name is matched against the installed skills and never passed to a command line; an unknown name is reported as not found.
- `--no-llm` or `--claude-cli`: the scan mode for this run. Without either, the `skillspector.mode` setting decides.
- `install`: install the scanner (see step 1 above).

### Install commands
Run in this order, only after you choose Install:
```
uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'
claude mcp add --scope user skillspector -- skillspector mcp
```
Rollback:
```
uv tool uninstall skillspector
claude mcp remove --scope user skillspector
```
Both install commands change your user-scope configuration, not just this project. The release is pinned to v2.13.1. An unpinned install from the SkillSpector `main` branch would run whatever was last pushed there, which is a supply-chain risk, so aico does not offer it.

### Scan mode
`no-llm` runs static rules on your machine. No skill text leaves it, and it costs nothing. Package names, versions and ecosystems from a skill's dependency files do go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found, and SkillSpector has no switch to turn that off. `claude_cli` also asks Claude to judge each skill: the text of every scanned skill goes to Anthropic through your local `claude` login and counts toward your usage, and the command says so before it scans. The OSV.dev lookup still happens. If `claude` is not available, a skill is reported as `error`, never as clean. Set the default in [`/aico:settings`](settings.md) (Skill scan tab). `claude_cli` counts only from your user settings; a project file cannot turn it on.

### Skill picks (the skill-researcher)
When the Lead vets a third-party skill before you see it, these checks apply:
- The Lead scans only the folder the skills CLI will install, not the whole repo.
- It refuses a commit that is not in the repo (for example a fork commit), and a candidate that contains a symbolic link or a submodule.
- After the install it compares the hash the skills CLI recorded for the skill folder it installed with the hash of the scanned folder. A mismatch, or a missing result, stops the run. It then shows you the removal command and removes nothing itself.
- A pick that has only a command source cannot be pinned to a commit, so it cannot be approved. When a skill has both a repo source and a command source, the repo source is recommended.

**You get.** `.company/work/<slug>/skillspector-report.md` with names, verdicts and counts only, never skill text. No other file changes.

**Example.** `/aico:skillspector --project`
