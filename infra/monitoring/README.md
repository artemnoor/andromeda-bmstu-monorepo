# Monitoring boundary

No metrics backend, log aggregation service, alert routing, or service-level
objective is configured in this repository. Local Compose provides a
PostgreSQL readiness health check and service logs only; these do not establish
operational monitoring coverage.

A future runtime owner must define database availability, migration and
publication failures, backup age, restore-check results, disk capacity, and
Directus availability signals before adopting a monitoring platform. Keep
credentials, tokens, and credential-bearing URLs out of logs and metrics.
