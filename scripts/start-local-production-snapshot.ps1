$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$snapshotPath = Join-Path $repositoryRoot ".emulator-data\production-20260902"
$metadataPath = Join-Path $snapshotPath "firebase-export-metadata.json"

if (-not (Test-Path -LiteralPath $metadataPath)) {
  throw "2026-09-02 snapshot is missing: $metadataPath"
}

$env:JAVA_TOOL_OPTIONS = "-Xmx16g"

Push-Location $repositoryRoot
try {
  npx -y firebase-tools@latest emulators:start `
    --only firestore `
    --project doujin-info-mvp `
    --config firebase.test-emulator.json `
    "--import=$snapshotPath"
} finally {
  Pop-Location
}
