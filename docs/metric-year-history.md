# 作品履歴の年次ドキュメント化

## 構造

```text
products/{productId}/metricYears/{yyyy}
```

```ts
{
  schemaVersion: 1,
  year: "2026",
  platform: "dlsite",
  audience: "female",
  category: "doujin",
  points: {
    "0831": {
      salesCount: 123,
      dailySalesCount: 4,
      dailySalesStatus: "calculated",
      priceCurrent: 770,
      priceOriginal: 770,
      fetchedAt: Timestamp,
    },
  },
  updatedAt: Timestamp,
}
```

日次ポイントには販売数計算・価格履歴・推定売上の再現に必要な値だけを保存します。作品名、サークル、分類、評価、レビュー数、ウィッシュリスト数など現在値として十分な項目は親`products`を正とします。年ごとに分割するため、履歴を削除せず1年・2年・3年と保持しても1ドキュメントのサイズは増え続けません。

`metricYears`はドキュメントIDを直接指定してサーバーから取得し、フィールド検索は行いません。そのため`firestore.indexes.json`でワイルドカードの単一フィールドIndexを無効化します。Webクライアントからの直接読取りはSecurity Rulesの既存catch-all denyを維持し、Next.js/FunctionsのAdmin SDKだけが利用します。

## 読み書きモード

Web:

- `METRIC_HISTORY_READ_MODE=legacy`: 旧日次形式を読む（既定値・切り戻し用）
- `METRIC_HISTORY_READ_MODE=year`: 年次形式を読む
- `METRIC_HISTORY_READ_MODE=compare`: 両方を比較し、画面には旧形式を返す

Functions:

- `METRIC_HISTORY_WRITE_MODE=legacy`: 旧日次形式へ書く（既定値・切り戻し用）
- `METRIC_HISTORY_WRITE_MODE=year`: 年次形式へ書く
- `METRIC_HISTORY_WRITE_MODE=dual`: 短期間の移行検証だけで両方へ書く
- `METRIC_HISTORY_READ_MODE`はランキング補完処理の履歴読取りにも適用する

本番切替時は`compare`で不一致0を確認し、短期間だけ`dual`、バックフィル、再照合、`year`読取り、`year`書込みの順に進めます。旧`dailyMetrics`はロールバック期間中削除しません。長期間のdual writeは行いません。

## Read数

単一作品では同一年の範囲は1 read、年をまたぐ1年表示は最大2 readsです。旧形式の7/30/90/365日表示は最大7/30/90/365 readsでした。サークル集計も「作品数 × 対象年数」に抑えられ、日数には比例しません。

## 2026-08-31 ローカル実測

- 旧日次ポイント: 392,345
- 年次ドキュメント: 15,146
- 年次ポイント: 392,345
- 欠損 / 不一致 / 余剰: 0 / 0 / 0
- 29日分のJSON概算サイズ: 平均10,123 bytes、最大11,619 bytes
- 最大値を366日へ線形換算: 約146,640 bytes（Firestore 1MiB上限の約14%）
- 現在の作品数で365日へ線形換算: 合計約1.80GiB/年、3年で約5.39GiB（ドキュメント本体のJSON概算。Firestore内部表現・メタデータを除く）

履歴年数が増えても年ごとに別ドキュメントとなるため、単一ドキュメントの使用率は上がりません。現在の画面は最大365日だけを直接指定して読むため、2年目・3年目の保存データが増えても画面Read数と応答サイズは増えません。

## 2026-09-02 本番断面の再検証

- products: 15,245
- 旧日次ポイント: 419,435
- 年次ドキュメント: 15,245
- 年次ポイント: 419,435
- 欠損 / 不一致 / 余分: 0 / 0 / 0
- JSON概算サイズ: 平均10,756 bytes、最大12,425 bytes
- 最新日: 20260902
- 作品APIの7 / 30 / 90 / 365日を3作品で比較し、全レスポンス一致
- Read上限: 30日 30→1、365日 365→最大2

## ローカル検証

プロジェクトルートで次を実行します。

```powershell
node scripts/migrate-daily-metrics-to-years.mjs
node scripts/migrate-daily-metrics-to-years.mjs --verify-only
```

移行はmergeで再実行可能です。同一年の複数日補正を1回の書込みにまとめ、年跨ぎだけ2ドキュメントへ分割します。旧形式は削除しません。
