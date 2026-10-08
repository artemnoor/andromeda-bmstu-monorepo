# Staging environment boundary

No staging runtime, database, deployment target, or credential set is configured
in this repository. The local Compose file is for one developer workstation and
must not be reused as a shared staging deployment.

A staging environment requires a separately reviewed deployment design,
network boundary, identity and access policy, backup/restore process, monitoring
owner, and secret-management location. Keep all staging credentials and
connection URLs outside Git and outside `.env.example`.

Do not set `ACADEMIC_DATA_ENV=staging` for the local backup scripts. They accept
only explicit local `test` or `dev` targets and refuse non-loopback URLs.
