# Local PostgreSQL backup tools

These PowerShell scripts are for explicit local `test` or `dev` databases. They
require `ACADEMIC_DATA_ENV=test` for `-Target test` and `ACADEMIC_DATA_ENV=development` for `-Target dev`, accept only loopback database
URLs, and verify PostgreSQL 16 and the selected database name before use. Test
mode requires `academic_data_test`; dev mode requires a local name ending in `_dev` outside the reserved `andromeda_*` names.
Neither script accepts staging or production targets.

Set the environment for the local target in PowerShell, using credentials that
are not committed:

```powershell
$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:<url-encoded-password>@127.0.0.1:55433/academic_data_test"
```

Create a new custom-format backup. Create its destination directory first; the
script refuses to overwrite an existing file:

```powershell
New-Item -ItemType Directory -Force .\artifacts\local | Out-Null
.\infra\database\backup.ps1 -Target test -OutputPath .\artifacts\local\academic-data-test.dump
```

Check that it restores by creating a unique temporary local database, running
`pg_restore`, checking migration revision `71d8c4a29f30`, the `academic_read`,
`directus_read`, and `directus_meta` schemas, and all 57 Directus read-model
tables, then dropping that temporary database:

```powershell
.\infra\database\restore-check.ps1 -Target test -BackupPath .\artifacts\local\academic-data-test.dump
```

The restore check does not restore over the source database. It needs local
PostgreSQL client tools (`psql`, `pg_dump`, `pg_restore`, `createdb`, and
`dropdb`) on `PATH`, plus permission to create and drop a temporary database.
Passwords are supplied to client tools through the process environment; they
are not command-line arguments or script output. If validation or cleanup
fails, the script returns a non-zero status.
