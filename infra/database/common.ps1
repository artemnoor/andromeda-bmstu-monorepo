function Get-LocalDatabaseTarget {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("test", "dev")]
        [string] $Target
    )

    $environment = $env:ACADEMIC_DATA_ENV
    $requiredEnvironment = if ($Target -ceq "dev") { "development" } else { "test" }
    if ([string]::IsNullOrWhiteSpace($environment) -or $environment -cne $requiredEnvironment) {
        throw "Set ACADEMIC_DATA_ENV=$requiredEnvironment and pass -Target $Target to select a local database target."
    }

    $rawUrl = $env:ACADEMIC_DATA_DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($rawUrl)) {
        throw "Set ACADEMIC_DATA_DATABASE_URL to the local PostgreSQL URL for the selected $Target target."
    }

    $normalizedUrl = $rawUrl -replace '^postgresql\+psycopg://', 'postgresql://'
    try {
        $uri = [System.Uri]::new($normalizedUrl)
    }
    catch {
        throw "ACADEMIC_DATA_DATABASE_URL is not a valid PostgreSQL URL."
    }
    if ($uri.Scheme -cne "postgresql" -or $uri.Host -notin @("localhost", "127.0.0.1", "::1")) {
        throw "Database utilities accept only localhost PostgreSQL URLs; the configured target was rejected."
    }

    $database = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($database)) {
        throw "ACADEMIC_DATA_DATABASE_URL must name a local database."
    }
    if ($Target -ceq "test" -and $database -cne "academic_data_test") {
        throw "The test target must name academic_data_test."
    }
    if ($Target -ceq "dev" -and ($database -notmatch '^[A-Za-z0-9_]+_dev$' -or $database.StartsWith("andromeda_", [System.StringComparison]::OrdinalIgnoreCase))) {
        throw "The dev target must use a local *_dev name outside the reserved andromeda_* databases."
    }

    $userinfo = $uri.UserInfo
    $separator = $userinfo.IndexOf(':')
    if ($separator -lt 1) {
        throw "ACADEMIC_DATA_DATABASE_URL must include a local username and password."
    }
    $username = [System.Uri]::UnescapeDataString($userinfo.Substring(0, $separator))
    $password = [System.Uri]::UnescapeDataString($userinfo.Substring($separator + 1))
    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($password)) {
        throw "ACADEMIC_DATA_DATABASE_URL must include a local username and password."
    }

    $port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
    [pscustomobject]@{
        Host = $uri.Host
        Port = $port
        Database = $database
        Username = $username
        Password = $password
    }
}

function Invoke-PostgresUtility {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name,
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,
        [Parameter(Mandatory = $true)]
        [string] $TargetDatabase
    )

    $tool = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $tool) {
        throw "Required PostgreSQL utility '$Name' was not found on PATH. Install PostgreSQL client tools for local backup and restore checks."
    }

    & $tool.Source @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode for local target database '$TargetDatabase'."
    }
}

function Get-PostgresConnectionArguments {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject] $Connection,
        [Parameter(Mandatory = $true)]
        [string] $Database
    )

    @(
        "--no-password",
        "--host", $Connection.Host,
        "--port", [string]$Connection.Port,
        "--username", $Connection.Username,
        "--dbname", $Database
    )
}

function Assert-Postgres16Database {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject] $Connection,
        [Parameter(Mandatory = $true)]
        [string] $Database
    )

    $args = Get-PostgresConnectionArguments -Connection $Connection -Database $Database
    $args += @("--no-psqlrc", "--tuples-only", "--no-align", "--command", "SELECT current_database() || '|' || (current_setting('server_version_num')::integer / 10000)::text")
    $psql = Get-Command psql -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $result = & $psql.Source @args
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Could not verify the PostgreSQL server for local target database '$Database'."
    }
    $actual = ($result | Out-String).Trim()
    if ($actual -cne "$Database|16") {
        throw "Local target '$Database' is not running PostgreSQL 16 or its database identity did not match."
    }
}
