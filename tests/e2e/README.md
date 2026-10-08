# End-to-end test boundary

No Playwright, Cypress, browser container, or end-to-end test pipeline is
configured here. Existing verification is provided by pytest unit and
integration tests, including the PostgreSQL permission probes and an optional
Directus HTTP smoke at `tests/integration/test_directus_runtime.py`.

The Directus HTTP smoke requires `DIRECTUS_TEST_URL`,
`DIRECTUS_ADMIN_EMAIL`, `DIRECTUS_ADMIN_PASSWORD`, and the dedicated local
`academic_data_test` database. It refuses non-loopback URLs and is skipped when
those local values are absent. Keep any future browser credentials and state
isolated from production data.
