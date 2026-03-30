$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoName = Split-Path $repoRoot -Leaf

if ($repoName -ne 'KWG') {
  throw "Backup task registration is locked to the KWG repo. Resolved root: $repoRoot"
}

$backupScriptPath = (Join-Path $repoRoot 'scripts\kwg-auto-backup.ps1')
if (-not (Test-Path $backupScriptPath)) {
  throw "Missing backup script: $backupScriptPath"
}

$taskName = 'KWG Auto Git Snapshot'
$taskDescription = 'Creates a KWG git snapshot backup every 3 hours.'
$escapedScriptPath = $backupScriptPath.Replace('"', '""')
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$escapedScriptPath`""

schtasks.exe /Create /TN $taskName /SC HOURLY /MO 3 /TR $taskCommand /F | Out-Null

$summary = @(
  "Registered scheduled task:"
  "  Name: $taskName"
  "  Frequency: Every 3 hours"
  "  Command: $taskCommand"
)

$summary -join [Environment]::NewLine
