# 論理削除／復活 運用手順

## 前提

- コマンドは `functions` ディレクトリで実行する。
- 必ず `preview` の対象件数・サークル名・作品一覧を確認する。
- `hide`／`restore` はpreviewで発行された最新の `planHash` が一致しないと実行できない。
- 本番では `--project`、`--allow-production`、`--confirm-production` の三重確認を必須とする。
- `--skip-rebuild` はFirestore Emulatorでだけ使用できる。本番では指定できない。

## サークル削除

```powershell
npm run visibility -- preview seller `
  --action hide `
  --platform dlsite `
  --seller-id RG01040726
```

出力された `sellerName`、`affectedProductCount`、`affectedProductIds` を確認し、`planHash`を指定する。

```powershell
npm run visibility -- hide seller `
  --platform dlsite `
  --seller-id RG01040726 `
  --case-id CASE-2026-001 `
  --confirm <planHash> `
  --performed-by <operator-id>
```

## サークル復活

```powershell
npm run visibility -- preview seller `
  --action restore `
  --platform dlsite `
  --seller-id RG01040726

npm run visibility -- restore seller `
  --platform dlsite `
  --seller-id RG01040726 `
  --case-id CASE-2026-002 `
  --confirm <planHash> `
  --performed-by <operator-id>
```

## 作品削除／復活

内部ID `dlsite_doujin_RJ...` と取得元ID `RJ...` のどちらも指定できる。preview結果では内部IDへ正規化される。

```powershell
npm run visibility -- preview product --action hide --platform dlsite --product-id RJ01706484
npm run visibility -- hide product --platform dlsite --product-id RJ01706484 --case-id CASE-2026-003 --confirm <planHash> --performed-by <operator-id>

npm run visibility -- preview product --action restore --platform dlsite --product-id RJ01706484
npm run visibility -- restore product --platform dlsite --product-id RJ01706484 --case-id CASE-2026-004 --confirm <planHash> --performed-by <operator-id>
```

## 状態確認

```powershell
npm run visibility -- status --operation-id <operationId>
```

- `started`: control/runtime更新済み、作品反映中
- `materialized`: 作品の`isActive`反映済み、再構築未完了またはテストで省略
- `rebuilt`: 正本・インデックス・全リストビューの反映完了
- `partial`: 非公開指示と作品反映は維持されているが、再構築の一部が失敗
- `failed`: 作品反映前に失敗

## 本番実行時の追加引数

本番の変更操作では、Admin SDKが接続しているプロジェクトと `--project` が一致することも検査する。

```powershell
$env:GOOGLE_CLOUD_PROJECT='doujin-info-prod'

npm run visibility -- hide seller `
  --platform dlsite `
  --seller-id RG01040726 `
  --case-id CASE-2026-001 `
  --confirm <planHash> `
  --performed-by <operator-id> `
  --project doujin-info-prod `
  --allow-production `
  --confirm-production I_UNDERSTAND_doujin-info-prod
```

実行後は `status=rebuilt`、対象詳細、一覧、検索、トレンドAPIを確認する。本番投入では最初の1件をカナリアとして実施する。
