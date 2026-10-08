[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("test", "dev")]
    [string] $Target,

    [Parameter(Mandatory = $true)]
    [string] $OutputPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$connection = Get-LocalDatabaseTarget -Target $Target
$output = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($output)
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw "Backup output directory does not exist: $outputDirectory"
}
if (Test-Path -LiteralPath $output) {
    throw "Backup output already exists; choose a new path to avoid overwriting local data."
}

$previousPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
[Environment]::SetEnvironmentVariable("PGPASSWORD", $connection.Password, "Process")
try {
    Assert-Postgres16Database -Connection $connection -Database $connection.Database
    $arguments = Get-PostgresConnectionArguments -Connection $connection -Database $connection.Database
    $arguments = @("--format=custom", "--no-owner", "--no-privileges", "--file", $output) + $arguments
    try {
        Invoke-PostgresUtility -Name "pg_dump" -Arguments $arguments -TargetDatabase $connection.Database
    }
    catch {
        if (Test-Path -LiteralPath $output) {
            Remove-Item -LiteralPath $output -Force
        }
        throw
    }
    Write-Host "Backup complete for local '$Target' database '$($connection.Database)': $output"
}
finally {
    [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPassword, "Process")
}
