# Releases and git

## In short
aico works on its own branch and never on your main branch. Every Step makes one small commit. Nothing is pushed before you approve it at the Ship Gate. A release carries a rollback line, an SBOM and a Gate Report.

## How it works
1. The company creates a branch named `aico/<task>`.
2. Each Step commits only its own files.
3. **→ Ship Gate** You approve before anything is pushed or released.
4. A release gets a `Rollback:` line, an SBOM and a Gate Report.

## Technical details
### Releases
A release carries a `Rollback:` line, an SBOM and a Gate Report. This makes no claim to BSI TR-03183-2.

### Git conventions
- Work happens on a branch named `aico/<task>`; the company never works directly on your main branch.
- One commit per Step, committing only that Step's files — never everything at once.
- Commit subjects are `<type>: <summary>` where `<type>` is one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. They are **never** prefixed with `aico` or a Role name.
- Nothing is pushed before you approve it at the Ship Gate. The only exception is an unlocked, auto Ship Gate: it pushes the branch and opens a PR for you to merge.
