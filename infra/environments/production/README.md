# Production environment boundary

This repository does not configure or claim an active production deployment.
It contains no production database URL, credentials, cloud account, deployment
provider selection, or production backup destination.

Production setup requires an approved environment design with named owners,
access controls, change and rollback procedures, data-retention rules, and
verified recovery objectives. Store secrets in an approved secret manager and
inject them at runtime; never put them in Git, `.env.example`, images, or local
Compose configuration.

The optional Directus service is intended for a private local viewer. Its
PostgreSQL role is restricted to approved `directus_read` projections and its
own `directus_meta` schema. Do not treat loopback-bound Compose as a production
service or expose it to a public network.
