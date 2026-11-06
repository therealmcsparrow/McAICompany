#!/usr/bin/env bash
# Setup wizard: walks a person through manual steps one stage at a time.
# Run from the repository root: bash scripts/wizards/<name>.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
TOTAL_STAGES=1
STAGE=0
DONE=()

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say() { printf '%s\n' "$*"; }
step() { printf '  -> %s\n' "$*"; }

stage() {
  STAGE=$((STAGE + 1))
  clear 2>/dev/null || true
  bold "Stage ${STAGE}/${TOTAL_STAGES}: $*"
  say ""
}

open_url() {
  step "Opening $1"
  if command -v wslview >/dev/null 2>&1; then wslview "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$1" >/dev/null 2>&1 || true
  else say "  Open this URL yourself: $1"
  fi
}

# ask VAR "prompt": reads a visible value into VAR.
ask() {
  local value=""
  while [ -z "$value" ]; do read -r -p "$2: " value; done
  printf -v "$1" '%s' "$value"
}

# ask_secret VAR "prompt": reads a hidden value into VAR.
ask_secret() {
  local value=""
  while [ -z "$value" ]; do read -r -s -p "$2: " value; printf '\n'; done
  printf -v "$1" '%s' "$value"
}

pause() { read -r -p "Press Enter when done. " _; }

confirm() {
  local answer=""
  read -r -p "$1 [y/N] " answer
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# write_env KEY VALUE: sets KEY in $ENV_FILE, replacing an existing line.
write_env() {
  local dir root="" target
  dir="$(CDPATH= cd "$(dirname "$ENV_FILE")" 2>/dev/null && pwd -P)" || {
    say "Refusing to write $1: the folder of $ENV_FILE does not exist."
    return 1
  }
  target="$dir/$(basename "$ENV_FILE")"
  while :; do
    if [ -e "$dir/.git" ]; then root="$dir"; break; fi
    [ "$(dirname "$dir")" = "$dir" ] && break
    dir="$(dirname "$dir")"
  done
  # Inside a repo, write only when git answers that the file is ignored.
  # Any other answer (not ignored, git failed, unsafe owner) refuses.
  if [ -n "$root" ] && ! ( unset $(git rev-parse --local-env-vars); git -C "$root" check-ignore -q -- "$target" ) >/dev/null 2>&1; then
    say "Refusing to write $1: git did not confirm that $ENV_FILE is ignored. Add it to .gitignore first."
    return 1
  fi
  # An exported GIT_DIR or GIT_WORK_TREE can put the file in a repo with no .git in the tree: ask git.
  if [ -z "$root" ] && [ -n "${GIT_DIR:-}${GIT_WORK_TREE:-}" ] && ! git check-ignore -q -- "$target" >/dev/null 2>&1; then
    say "Refusing to write $1: git did not confirm that $ENV_FILE is ignored. Add it to .gitignore first."
    return 1
  fi
  touch "$ENV_FILE"
  local tmp
  tmp="$(mktemp)"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  DONE+=("$ENV_FILE: $1")
  step "Wrote $1 to $ENV_FILE"
}

# set_secret NAME VALUE / set_var NAME VALUE: GitHub Actions secret or variable via gh.
set_secret() {
  printf '%s' "$2" | gh secret set "$1"
  DONE+=("GitHub secret: $1")
  step "Set GitHub secret $1"
}

set_var() {
  gh variable set "$1" --body "$2"
  DONE+=("GitHub variable: $1")
  step "Set GitHub variable $1"
}

summary() {
  clear 2>/dev/null || true
  bold "All ${TOTAL_STAGES} stages done."
  for item in "${DONE[@]+"${DONE[@]}"}"; do say "  - $item"; done
}

# ---- STAGES (edit below this line only) ----

stage "Example: create an API key"
say "Create a key for this project."
open_url "https://example.com/settings/api-keys"
step "Settings -> API keys -> Create key -> copy"
ask_secret EXAMPLE_API_KEY "Paste the key"
write_env EXAMPLE_API_KEY "$EXAMPLE_API_KEY"
if confirm "Also store it as a GitHub secret?"; then set_secret EXAMPLE_API_KEY "$EXAMPLE_API_KEY"; fi

summary
