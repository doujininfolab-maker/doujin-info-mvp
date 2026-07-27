# List-view rebuild operations

## Overview

The optimized list views are rebuilt independently from the DLsite collection jobs.
The source collection jobs remain unchanged.

The scheduled function `scheduledRebuildAllListViews` runs every day at **04:00 Asia/Tokyo**.
It rebuilds the following components in order:

1. new
2. ranking
3. seller
4. home
5. sale

The schedule retries for up to four hours when a source batch or another list-view rebuild is still running. On a partial failure, the next retry rebuilds only the failed components.

## Safety behavior

- A Firestore lock prevents overlapping all-view rebuilds.
- Recent running product-collection jobs block the rebuild.
- Each component retains its own active/previous-version safety behavior.
- A component failure does not remove its current active version.
- Run state is stored in:
  - `systemJobs/listViewRebuild`
  - `listViewRebuildRuns/{runId}`
- No DLsite HTTP access is performed by the list-view rebuild.

## Emulator manual test

```powershell
$url = "http://127.0.0.1:5001/doujin-info-mvp/asia-northeast1/rebuildAllListViewsNow"
$result = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 1800
$result | ConvertTo-Json -Depth 100 | Set-Content ".\phase6-all-list-views.json" -Encoding UTF8
```

Summary:

```powershell
$result | Select-Object ok, phase, domain, status, partial, runId, elapsedMs
$result.components | Format-List
```

Run selected components only (add `includeDetails=true` only when detailed per-list output is needed):

```powershell
$url = "http://127.0.0.1:5001/doujin-info-mvp/asia-northeast1/rebuildAllListViewsNow?components=new,ranking,home"
```

## Production initial build

The manual endpoint requires the existing manual key and explicit write confirmation:

```powershell
$url = "https://asia-northeast1-doujin-info-mvp.cloudfunctions.net/rebuildAllListViewsNow?key=MANUAL_FETCH_KEY&confirmWrites=true"
$result = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 1800
```

Run this once after deploying Functions and before relying on the scheduled rebuild.

## App Hosting mode

`web/apphosting.yaml` uses:

```text
LIST_VIEW_MODE=prefer
LIST_VIEW_DEBUG=false
```

`prefer` uses the optimized view when available and preserves the existing fallback during the initial production verification period.
