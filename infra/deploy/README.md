# Deployment boundary

There is no deployment adapter, cloud provider, hosted database, or release
pipeline defined here. The root `docker-compose.yml` starts local PostgreSQL
and an optional loopback-only Directus viewer; it is not a deployable platform
stack.

Keep provider selection, remote networking, identity, secret injection,
rollout, rollback, and data migration decisions in a future deployment design
with an assigned owner. Do not add production URLs or credentials to committed
configuration. See the [development](../environments/dev/README.md), [staging](../environments/staging/README.md), and [production](../environments/production/README.md)
boundary notes.
