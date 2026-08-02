# DLsite HTML / Ajax データ取得元検証

## 目的

Firestoreへ書き込まず、1作品について以下を同時に保存・比較する。

- 商品詳細ページの生HTML
- `/product/info/ajax?product_id=...` の生JSON
- 必要に応じて `/product/info/ajax?product_id[]=...` の生JSON
- 現行HTMLパーサーによる抽出結果
- 現行Ajaxパーサーと作品ID直下フィールドによる抽出結果
- 販売数・価格・評価・発売日の比較結果

既存バッチ、Firestore、Cloud Run Jobs、Workflowには影響しない。

## 安全仕様

- `--execute`を付けない限りDLsiteへアクセスしない。
- Firestore read/writeは行わない。
- 通常実行はHTML 1回、Ajax 1回の合計2リクエスト。
- `--include-array-ajax`を付けるとAjaxをもう1回取得し、合計3リクエスト。
- HEADによる画像確認や推測URLアクセスは行わない。

## ビルド

```powershell
cd C:\dev\doujin-info-mvp-node24\functions
npm ci
npm run build
```

## RJ01504617の検証

現行コードが使用している2種類のAjax形式を両方確認する。

```powershell
cd C:\dev\doujin-info-mvp-node24\functions

npm run inspect:dlsite-product-sources -- `
  --execute `
  --product-id=RJ01504617 `
  --floor=auto `
  --include-array-ajax
```

本番相当のUser-Agentを明示する場合は、実行前に環境変数を設定する。

```powershell
$env:DLSITE_USER_AGENT = "doujin-info-prod/1.0 (+https://本番URL; low-frequency public-page fetcher)"
```

出力先を変更する場合：

```powershell
npm run inspect:dlsite-product-sources -- `
  --execute `
  --product-id=RJ01504617 `
  --floor=auto `
  --include-array-ajax `
  --output-dir=C:\dev\dlsite-inspection\RJ01504617
```

## 出力ファイル

デフォルトでは次に出力する。

```text
functions/inspection-output/RJ01504617/
```

- `raw-product.html`
  - HTTPで最初に返された生HTML
- `raw-product-ajax.json`
  - Ajax URL、HTTPステータス、生JSON
- `parsed-html.json`
  - HTMLだけから取得した値
- `parsed-ajax.json`
  - 現行Ajaxパーサーの値、対象作品ID配下の直接フィールド、全スカラー項目一覧
- `comparison.json`
  - HTML、`dl_count`、`dl_count_total`、`dl_count_items`等の比較
- `manifest.json`
  - URL、取得日時、リクエスト数、出力ファイル一覧

## 最重要確認項目

`comparison.json`の次を確認する。

```text
sales.htmlSalesCount
sales.currentAjaxParserSalesCount
sales.currentAjaxParserTotalSalesCount
sales.ajaxDlCount
sales.ajaxDlCountTotal
sales.ajaxDlCountItems
sales.ajaxDlCountItemsSum
sales.htmlMatchesDlCount
sales.htmlMatchesDlCountTotal
```

修正後の期待関係は以下。数値自体は取得時点で増減するため、実出力を正とする。

```text
currentAjaxParserSalesCount
= ajaxDlCount

currentAjaxParserTotalSalesCount
= ajaxDlCountTotal
= ajaxDlCountItemsSum（内訳が完全な場合）
```

HTMLから抽出した販売数・価格は誤った別数値を拾う可能性があるため、動的数値の保存値には使用しない。

## 次の判断

出力結果を確認後、項目ごとに以下を決める。

- HTMLを正とする
- Ajaxの作品ID直下フィールドを正とする
- HTMLを主、Ajaxを補完にする
- 取得失敗時は未取得扱いにして保存しない

検証結果を確認するまで、販売数の本番パーサーや日次差分ロジックは変更しない。
