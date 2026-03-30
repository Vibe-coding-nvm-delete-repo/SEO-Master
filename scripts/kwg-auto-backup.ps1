$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoName = Split-Path $repoRoot -Leaf

if ($repoName -ne 'KWG') {
  throw "Backup is locked to the KWG repo. Resolved root: $repoRoot"
}

if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
  throw "Missing .git directory at repo root: $repoRoot"
}

$backupRoot = Join-Path $repoRoot 'backups'
$bundleDir = Join-Path $backupRoot 'git-snapshots'
$untrackedDir = Join-Path $backupRoot 'untracked-snapshots'
$logDir = Join-Path $backupRoot 'logs'

New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
New-Item -ItemType Directory -Force -Path $untrackedDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$refName = "refs/backups/auto/$timestamp"
$bundlePath = Join-Path $bundleDir "kwg-auto-$timestamp.bundle"
$logPath = Join-Path $logDir 'kwg-auto-backup.log'

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Args
  )

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $process = Start-Process -FilePath 'git.exe' `
      -ArgumentList (@('-C', $repoRoot) + $Args) `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $stdout = if (Test-Path $stdoutPath) { (Get-Content -Path $stdoutPath -Raw) } else { '' }
    $stderr = if (Test-Path $stderrPath) { (Get-Content -Path $stderrPath -Raw) } else { '' }

    if ($process.ExitCode -ne 0) {
      $combined = (($stdout + [Environment]::NewLine + $stderr).Trim())
      throw "git $($Args -join ' ') failed: $combined"
    }

    if ($null -eq $stdout) {
      return ''
    }

    return $stdout.Trim()
  }
  finally {
    Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

$headSha = Invoke-Git @('rev-parse', 'HEAD')
$snapshotSha = Invoke-Git @('stash', 'create', "kwg-auto-$timestamp")
if ([string]::IsNullOrWhiteSpace($snapshotSha)) {
  $snapshotSha = $headSha
}

Invoke-Git @('update-ref', $refName, $snapshotSha) | Out-Null
Invoke-Git @('bundle', 'create', $bundlePath, $refName) | Out-Null

$statusText = Invoke-Git @('status', '--short', '--untracked-files=no')
$trackedStatus = @(($statusText -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

$untrackedFiles = @(
  ((Invoke-Git @('ls-files', '--others', '--exclude-standard')) -split "`r?`n") |
    Where-Object {
      -not [string]::IsNullOrWhiteSpace($_) -and
      $_ -notlike 'backups/*'
    }
)

$untrackedZipPath = $null
if ($untrackedFiles.Count -gt 0) {
  $untrackedZipPath = Join-Path $untrackedDir "kwg-untracked-$timestamp.zip"
  $absoluteUntracked = $untrackedFiles | ForEach-Object { Join-Path $repoRoot $_ }
  Compress-Archive -Path $absoluteUntracked -DestinationPath $untrackedZipPath -CompressionLevel Optimal -Force
}

$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -Path $bundleDir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
Get-ChildItem -Path $untrackedDir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
Get-ChildItem -Path $logDir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force

$summary = @(
  "[$((Get-Date).ToString('s'))] repo=$repoRoot"
  "  head=$headSha"
  "  snapshot=$snapshotSha"
  "  ref=$refName"
  "  bundle=$bundlePath"
  "  tracked_changes=$($trackedStatus.Count)"
  "  untracked_files=$($untrackedFiles.Count)"
)

if ($untrackedZipPath) {
  $summary += "  untracked_zip=$untrackedZipPath"
}

$summaryText = $summary -join [Environment]::NewLine
$summaryText | Tee-Object -FilePath $logPath -Append
