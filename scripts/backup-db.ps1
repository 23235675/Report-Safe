<#
.SYNOPSIS
  Back up the Report Safe PostgreSQL database (Azure Database for PostgreSQL).

.DESCRIPTION
  Runs pg_dump to a timestamped, compressed custom-format file and prunes
  backups older than $RetentionDays. Reads connection details from the same
  PG* env vars the server uses, or from a DATABASE_URL.

  Schedule it with Windows Task Scheduler (daily). Store backups off-box (an
  Azure Blob container or a separate disk) for real disaster resilience —
  a backup on the same VM dies with the VM.

.EXAMPLE
  $env:PGHOST="myserver.postgres.database.azure.com"
  $env:PGUSER="reportsafe"; $env:PGPASSWORD="…"; $env:PGDATABASE="reportsafe"
  ./scripts/backup-db.ps1 -OutDir D:\backups -RetentionDays 14
#>
param(
  [string]$OutDir = "$PSScriptRoot\..\backups",
  [int]$RetentionDays = 14
)

$ErrorActionPreference = 'Stop'

$pgHost = if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }
$pgPort = if ($env:PGPORT) { $env:PGPORT } else { '5433' }
$pgUser = if ($env:PGUSER) { $env:PGUSER } else { 'reportsafe' }
$pgDb   = if ($env:PGDATABASE) { $env:PGDATABASE } else { 'reportsafe' }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file  = Join-Path $OutDir "reportsafe-$stamp.dump"

Write-Host "[backup] pg_dump $pgUser@${pgHost}:$pgPort/$pgDb -> $file"

# Custom format (-Fc) is compressed and restorable with pg_restore.
# PGPASSWORD must be set in the environment for non-interactive auth.
& pg_dump --host=$pgHost --port=$pgPort --username=$pgUser --dbname=$pgDb `
          --format=custom --no-owner --no-privileges --file=$file

if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

$sizeMB = [math]::Round((Get-Item $file).Length / 1MB, 2)
Write-Host "[backup] wrote $file ($sizeMB MB)"

# Prune old backups.
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $OutDir -Filter 'reportsafe-*.dump' |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Host "[backup] pruning old backup $($_.Name)"
    Remove-Item $_.FullName -Force
  }

Write-Host "[backup] done."
