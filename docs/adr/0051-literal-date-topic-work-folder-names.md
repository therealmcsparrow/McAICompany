# Work folders get literal date-topic names

Work folders take the `YYYY-MM-DD HH.MM - Topic` shape of roadmap and research files so the CEO can scan `.company/work/` by date and topic; one module (`mods/lib/work-folder.mjs`, `work-folder-name` v1) checks, creates and maps every name, and legacy slugs stay valid, so nothing is renamed. Git refs cannot hold a space, so branches and worktrees use a derived branch id. This is hard to reverse because every script, mod and Playbook reads both forms from now on, and a rollback would strand the folders created with new names.
