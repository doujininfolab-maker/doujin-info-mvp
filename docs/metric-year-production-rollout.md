# metricYears 本番移行手順

対象は `doujin-info-prod/(default)` の履歴形式だけです。発売日当日の販売数を0にする変更は含みません。旧 `dailyMetrics` は削除しません。

## 事前条件

- 日次Workflowが実行中でないことを確認する。
- `metricYears` のワイルドカード単一フィールドIndex exemptionを先行反映する。
- Functions、Cloud Run Jobs、App Hostingは最初に `legacy` モードでデプロイする。
- `scripts/migrate-production-metric-years.mjs --dry-run` が成功していること。

## 安全性

本番移行ツールは `metricYears` 以外へ書き込まず、Delete処理を持ちません。年次ドキュメントは日キー単位のupdate maskで部分更新するため、途中失敗後の再実行と、別の日付ポイントとの共存が可能です。

本番書込みには次の2つを同時に明示する必要があります。

```powershell
--project=doujin-info-prod --confirm-project=doujin-info-prod
```

## 手順

1. Index exemptionを反映して有効化を確認する。
2. Functions/Cloud Run Jobs/App Hostingへコードを `legacy` でデプロイする。
3. 本番 `dailyMetrics` を年次ドキュメントへ移行する。
4. 全日ポイント、年次ヘッダー、欠損、余剰を照合し、すべて0件を確認する。
5. App HostingのReadを `year` へ切り替え、作品詳細の7/30/90/365日とサークル集計を確認する。
6. 収集Jobと手動実行FunctionsのWriteを短期間だけ `dual` へ切り替える。
7. 次の日次Workflow完了後に再照合し、その日を含め不一致0を確認する。
8. Writeを `year` へ切り替えてdual writeを終了する。

PowerShellからCloud Run Jobの環境変数を更新する場合、カンマが引数分割されないようオプション全体を引用符で囲む。

```powershell
gcloud run jobs update doujin-info-collect-tl `
  '--update-env-vars=METRIC_HISTORY_WRITE_MODE=dual,METRIC_HISTORY_READ_MODE=year' `
  --region=asia-northeast1 `
  --project=doujin-info-prod
```

## 移行・照合コマンド

```powershell
node scripts/migrate-production-metric-years.mjs `
  --project=doujin-info-prod `
  --confirm-project=doujin-info-prod `
  --migrate

node scripts/migrate-production-metric-years.mjs `
  --project=doujin-info-prod `
  --verify-only
```

成功条件は次のすべてです。

- `sourcePoints === destinationPoints`
- `missingPoints === 0`
- `mismatchPoints === 0`
- `extraPoints === 0`
- `missingYearDocuments === 0`
- `mismatchHeaders === 0`
- `extraYearDocuments === 0`

## 切り戻し

画面エラーまたは値の不一致がある場合、App Hostingの `METRIC_HISTORY_READ_MODE` を `legacy` に戻して再デプロイする。バッチ側は `METRIC_HISTORY_WRITE_MODE=dual` の期間中なら `legacy` に戻す。旧 `dailyMetrics` は保持しているため、データ復元やDeleteは不要。

年次のみのWriteへ切替後に切り戻す場合は、先に対象日を `metricYears` から `dailyMetrics` へ修復して照合してからReadを戻す。旧形式への修復確認なしに `legacy` へ切り替えない。

## 監視

- Workflowと4つのCloud Run Jobがすべて成功していること。
- App Hostingの5xx、レスポンス時間、Cloud Runの実行時間が変更前基準を超えていないこと。
- Firestore Readが作品詳細30日で約30から1～2、365日で最大365から1～2へ減ること。
- Writeは `dual` 期間だけ日次履歴分が増え、`year` 切替後は従来と同程度へ戻ること。
- `metricYears` のドキュメント数が概ね作品×保存年数で増え、日数には比例しないこと。
