# Cloud Run Jobs + Workflows 日次バッチ

## 構成

毎日 01:00（Asia/Tokyo）に Workflow を開始し、次を直列実行します。

1. `doujin-info-collect-tl`
2. 5分待機
3. `doujin-info-collect-bl`
4. `doujin-info-rebuild-indexes`
5. `doujin-info-rebuild-list-views`

4つの Cloud Run Job は同じコンテナイメージを使用し、`JOB_MODE`だけを変えます。

## 安全方針

- TL・BLはタスク数1、並列数1、Cloud Runの自動再試行0。
- BL収集ではsiteStatsを生成しない。集計は独立Jobで行う。
- 前段Jobが失敗した場合、Workflowは後続Jobを実行しない。
- 既存HTTP Functionsはロールバック用に残す。
- 新パイプラインが安定するまでは旧Schedulerを削除せず、一時停止する。
- `functions/.env`と秘密値をコンテナイメージへ含めない。

## ローカル確認

```powershell
cd C:\dev\doujin-info-mvp-node24\functions
npm run build
Test-Path .\lib\jobs\runCloudRunJob.js
```

`True`になればエントリーポイントは生成されています。

## イメージ作成

```powershell
cd C:\dev\doujin-info-mvp-node24\functions

$imageTag = "asia-northeast1-docker.pkg.dev/doujin-info-mvp/doujin-info-jobs/doujin-info-batch:20260728-1"

gcloud builds submit `
  --tag $imageTag `
  --project doujin-info-mvp `
  .
```

## Job設定

### TL

```powershell
gcloud run jobs deploy doujin-info-collect-tl `
  --image $imageTag `
  --region asia-northeast1 `
  --service-account doujin-info-job-runtime@doujin-info-mvp.iam.gserviceaccount.com `
  --tasks 1 `
  --parallelism 1 `
  --cpu 1 `
  --memory 1Gi `
  --task-timeout 3h `
  --max-retries 0 `
  --set-env-vars JOB_MODE=collect-tl `
  --project doujin-info-mvp
```

### BL

```powershell
gcloud run jobs deploy doujin-info-collect-bl `
  --image $imageTag `
  --region asia-northeast1 `
  --service-account doujin-info-job-runtime@doujin-info-mvp.iam.gserviceaccount.com `
  --tasks 1 `
  --parallelism 1 `
  --cpu 1 `
  --memory 1Gi `
  --task-timeout 3h `
  --max-retries 0 `
  --set-env-vars JOB_MODE=collect-bl `
  --project doujin-info-mvp
```

### siteStats・既存インデックス

```powershell
gcloud run jobs deploy doujin-info-rebuild-indexes `
  --image $imageTag `
  --region asia-northeast1 `
  --service-account doujin-info-job-runtime@doujin-info-mvp.iam.gserviceaccount.com `
  --tasks 1 `
  --parallelism 1 `
  --cpu 1 `
  --memory 1Gi `
  --task-timeout 90m `
  --max-retries 0 `
  --set-env-vars JOB_MODE=rebuild-indexes `
  --project doujin-info-mvp
```

### 高速一覧ビュー

```powershell
gcloud run jobs deploy doujin-info-rebuild-list-views `
  --image $imageTag `
  --region asia-northeast1 `
  --service-account doujin-info-job-runtime@doujin-info-mvp.iam.gserviceaccount.com `
  --tasks 1 `
  --parallelism 1 `
  --cpu 1 `
  --memory 1Gi `
  --task-timeout 90m `
  --max-retries 0 `
  --set-env-vars JOB_MODE=rebuild-list-views `
  --project doujin-info-mvp
```

## Workflowデプロイ

```powershell
cd C:\dev\doujin-info-mvp-node24

gcloud workflows deploy doujin-info-daily-pipeline `
  --location asia-northeast1 `
  --source workflows/doujin-info-daily-pipeline.yaml `
  --service-account doujin-info-workflow@doujin-info-mvp.iam.gserviceaccount.com `
  --project doujin-info-mvp
```

## Workflowテスト

```powershell
gcloud workflows run doujin-info-daily-pipeline `
  --location asia-northeast1 `
  --project doujin-info-mvp
```

この実行は実際にDLsiteへアクセスします。重複実行しないでください。
