param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $NodePath) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $NodePath = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  }
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw 'Node.js 24 is required; specify -NodePath.' }
$settings = @{
  GCLOUD_PROJECT = 'demo-cost-review'
  GOOGLE_CLOUD_PROJECT = 'demo-cost-review'
  FIRESTORE_EMULATOR_HOST = '127.0.0.1:8188'
  METRIC_HISTORY_WRITE_MODE = 'year'
  METRIC_HISTORY_READ_MODE = 'year'
  GENRE_DETAIL_AGGREGATION_ENABLED = 'true'
  SEARCH_INDEX_WRITE_MODE = 'dual'
}
$original = @{}
foreach ($key in $settings.Keys) {
  $original[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
}
function Invoke-CheckedNode([string[]]$NodeArguments) {
  & $NodePath @NodeArguments
  if ($LASTEXITCODE -ne 0) { throw "Local check failed: $($NodeArguments -join ' ')" }
}
Push-Location $repositoryRoot
try {
  # A dedicated Firestore emulator with firestore.rules must already be running
  # on port 8188. All mutation tests independently enforce this host/project.
  Invoke-CheckedNode @('functions/node_modules/typescript/bin/tsc', '-p', 'functions/tsconfig.json')
  Invoke-CheckedNode @('functions/lib/tools/testProductMetricHistory.js')
  Invoke-CheckedNode @('functions/lib/tools/testDailyPrioritySalesPatch.js')
  Invoke-CheckedNode @('functions/lib/tools/testCostReductionEmulator.js')
  Invoke-CheckedNode @('functions/lib/tools/backfillReleaseDaySales.js', '--project=demo-cost-review', '--product-ids=retro_PROOF')
  Invoke-CheckedNode @('functions/lib/tools/backfillReleaseDaySales.js', '--project=demo-cost-review', '--product-ids=retro_PROOF', '--apply', '--confirm-project=demo-cost-review')
  Invoke-CheckedNode @('functions/lib/tools/verifySiteStatsRebuildEmulator.js')
  Invoke-CheckedNode @('web/node_modules/typescript/bin/tsc', '-p', 'web/tsconfig.json', '--noEmit', '--incremental', 'false')
  Push-Location (Join-Path $repositoryRoot 'web')
  try {
    Invoke-CheckedNode @('--import', './tests/register-typescript.mjs', './tests/costReduction.emulator.ts')
  } finally { Pop-Location }
} finally {
  Pop-Location
  foreach ($key in $settings.Keys) { [Environment]::SetEnvironmentVariable($key, $original[$key], 'Process') }
}
