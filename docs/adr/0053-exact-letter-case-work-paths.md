# Exact letter case for work folder paths

Status: accepted (CEO, 2026-11-01)

A work folder or file typed in another letter case than the one on disk is refused with `refused: wrong letter case` on every platform, by one shared check (`exactWorkPath` in `mods/lib/work-folder.mjs`, `work-folder-name` v1.1) that compares against directory entries, not `realpath` output, so win32, darwin and linux behave the same and a case variant can no longer reach or create a second run record. This is hard to reverse because every script that takes a work folder name now relies on the check, and loosening it again would let the same run be spelled two ways on case-insensitive file systems.
