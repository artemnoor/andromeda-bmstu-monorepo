[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("test", "dev")]
    [string] $Target,

    [Parameter(Mandatory = $true)]
    [string] $BackupPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$connection = Get-LocalDatabaseTarget -Target $Target
$backup = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
    throw "Backup file does not exist: $backup"
}

$restoreDatabase = "andromeda_restorecheck_$([Guid]::NewGuid().ToString('N'))"
$previousPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
[Environment]::SetEnvironmentVariable("PGPASSWORD", $connection.Password, "Process")
$databaseCreated = $false
try {
    Assert-Postgres16Database -Connection $connection -Database $connection.Database

    $createArguments = @(
        "--no-password",
        "--host", $connection.Host,
        "--port", [string]$connection.Port,
        "--username", $connection.Username,
        "--maintenance-db", "postgres",
        "--template", "template0",
        $restoreDatabase
    )
    Invoke-PostgresUtility -Name "createdb" -Arguments $createArguments -TargetDatabase $connection.Database
    $databaseCreated = $true

    $restoreArguments = @(
        "--no-password",
        "--host", $connection.Host,
        "--port", [string]$connection.Port,
        "--username", $connection.Username,
        "--dbname", $restoreDatabase,
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        $backup
    )
    Invoke-PostgresUtility -Name "pg_restore" -Arguments $restoreArguments -TargetDatabase $connection.Database

    $validationSql = @"
SELECT version_num || '|' ||
       (CASE WHEN to_regnamespace('academic_read') IS NOT NULL THEN '1' ELSE '0' END) || '|' ||
       (CASE WHEN to_regnamespace('directus_read') IS NOT NULL THEN '1' ELSE '0' END) || '|' ||
       (CASE WHEN to_regnamespace('directus_meta') IS NOT NULL THEN '1' ELSE '0' END) || '|' ||
       (SELECT count(*) FROM information_schema.tables WHERE table_schema='directus_read' AND table_type='BASE TABLE')::text
FROM academic_data_alembic_version
"@
    $psqlArguments = Get-PostgresConnectionArguments -Connection $connection -Database $restoreDatabase
    $psqlArguments += @("--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", $validationSql)
    $validationOutput = & (Get-Command psql -CommandType Application -ErrorAction Stop).Source @psqlArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read the restored migration and schema state from temporary database '$restoreDatabase'."
    }
    $validation = ($validationOutput | Out-String).Trim()
    $expected = "f4b19a7c2d61|1|1|1|57"
    if ($validation -cne $expected) {
        throw "Restore check found an unexpected migration or schema state in temporary database '$restoreDatabase'. Expected revision f4b19a7c2d61, all three data schemas, and 57 read-model tables."
    }
    Write-Host "Restore check passed for local '$Target' backup; revision and expected schemas are present."
}
finally {
    try {
        if ($databaseCreated) {
            $dropArguments = @(
                "--no-password",
                "--host", $connection.Host,
                "--port", [string]$connection.Port,
                "--username", $connection.Username,
                "--maintenance-db", "postgres",
                "--if-exists",
                $restoreDatabase
            )
            Invoke-PostgresUtility -Name "dropdb" -Arguments $dropArguments -TargetDatabase $connection.Database
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPassword, "Process")
    }
}
