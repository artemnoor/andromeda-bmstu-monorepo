# Graph explorer boundary

No Neo4j database, graph projection, graph API, or explorer frontend is
configured in this repository. PostgreSQL remains the canonical persistence
store, and `directus_read` is a relational read projection for the optional
Directus viewer.

This directory only reserves a future location. Any graph store or explorer
requires a separate ownership, synchronization, security, and recovery design;
no graph runtime should be inferred from this placeholder.
