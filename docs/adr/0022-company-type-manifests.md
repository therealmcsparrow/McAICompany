# Company types are plugin-shipped manifests, absent means software

A type is a validated JSON manifest in `company/types/` (Roles, Playbooks, ship meaning, lanes, checks, skill-search hints) read by one script, `company-type.mjs`, and selected by one `company_type:` line in the project profile; absent means `software`, whose manifest equals the v0.12.0 company, so existing projects see no change. Manifests are looked up from an allow-listed registry, never by path from the project value, and custom or mixed types stay out until a later Contract version (`company-type` v1).
