param(
  [string]$Message = ""
)

$gitPath = "C:\Program Files\Git\bin\git.exe"
if (Test-Path $gitPath) {
  $git = $gitPath
} else {
  $git = "git"
}

if (-not $Message -or $Message.Trim().Length -eq 0) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Message = "update $timestamp"
}

& $git status --porcelain | ForEach-Object {
  $hasChanges = $true
}
if (-not $hasChanges) {
  Write-Host "No changes to commit."
  exit 0
}

& $git add .
& $git commit -m $Message
& $git push
