# 論理削除実装監査メモ（未追跡）

## 対象環境

- Firestore: `(default)` / Standard Edition / Firestore Native / `asia-northeast1`
- 検証データ: `.emulator-data/production-20260902`（2026-09-02 17:48 JST エクスポート）
- 検証先: `127.0.0.1:8082` Firestore Emulator
- 対象サークル: DLsite `RG01040726`（天々赦）
- 9/2データ上の対象作品: 42件、全件 `isActive=true`、最新作発売日 `2026-09-02`

## 現行データモデルとアクセス

- 正本: `products/{productId}`。サークル識別子は `seller.sellerId`。
- 公開派生データ: `siteStats`、`sellers`、`searchIndexes`、`compactSearchIndexes`、`rankingIndexes`、`genreIndexes`、`sellerIndexes`、各種 `*ListViews`。
- 非公開運用データ: `batchRuns`、`systemJobs` 等。
- WebアプリのFirestoreアクセスは `firebase-admin`。`web/lib/firebase/client.ts` のクライアントSDKをアプリ本体が使用する経路は検出されていない。
- `products` の主要一覧クエリと全再構築は既存の `where("isActive", "==", true)` を利用する。
- 直接取得 `getProductById`、ID一括取得、圧縮済みactive/previousビュー、トレンドAPIは追加ガードが必要。
- 作品保存経路は通常日次取得、優先取得、旧作取得、デバッグ取得、シード。normalizerは現状 `isActive: true` を設定する。

## Security Rules前提

- 公開サイトのカタログデータは未認証読み取りを許可する既存要件。
- `products` は `isActive == true` のみ公開可能とする。
- `products/{productId}/dailyMetrics` は親作品が公開中の場合のみ公開可能とする。
- control、runtime、events、state はAdmin SDK専用で、クライアント読み書き禁止。
- Admin SDK経由のサーバーアプリはRulesの適用外。
- rawランキング・サークル集計は削除対象の識別子を含み得るため、クライアント公開を停止する。
- Rulesはフィルターではないため、公開listクエリは必ず `isActive == true` を含める。

## インデックス

- 公開判定は既存 `isActive` を再利用し、新しい複合インデックスは追加しない。
- runtime snapshotのhidden ID配列と`products.visibility`は検索しないため単一フィールドインデックスから除外する。
- seller CLIの `platform ==` + `seller.sellerId ==` はStandard Editionの複数等価条件のインデックスマージ対象。

## 互換性上のゲート

- control 0件時に既存レスポンスが変わらないこと。
- `sourceIsActive` 未導入の既存作品は `sourceIsActive ?? isActive ?? true` と解釈すること。
- 作品削除は当該作品のみ。サークル削除は同一 `platform + sellerId` の全作品。
- サークル復活後も作品単位hiddenは維持すること。
- active/previous派生ビューに古い項目が残ってもruntime guardで公開しないこと。
- 取得バッチが再度保存してもhiddenを維持すること。
- 本番実行は明示的な二重確認なしでは拒否すること。

## Rules攻撃観点

- hidden作品のpublic get/list、親hidden時のdailyMetrics取得を拒否する。
- control/runtime/events/stateのpublic get/list/create/update/deleteを拒否する。
- raw ranking/seller派生データのpublic readを拒否する。
- 全コレクションのpublic writeを拒否する。
- 不明パスと孤立サブコレクションをdefault denyで拒否する。
- `isActive == true` を付けないproducts listクエリを拒否する。

## 実装後のRules攻撃テスト結果

- active作品get: 許可
- hidden作品get: 拒否
- active親のdailyMetrics get: 許可
- hidden親のdailyMetrics get: 拒否
- runtime、raw ranking、raw seller get: 拒否
- taxonomy get: 許可（既存公開要件）
- productsへのpublic write: 拒否
- `isActive == true` 付きlist: activeだけ許可
- 条件なしproducts list: 拒否
- 不明／孤立サブコレクション: 拒否
- Rules dry-run: コンパイル成功

## Security Rules監査結果

- score: 5 / 5
- client create/update/deleteは全パスで拒否されるため、update bypass、権限昇格、schema汚染、巨大値書込みは成立しない。
- 公開readは非機密taxonomyと`isActive == true`の作品、および公開作品配下のdailyMetricsだけに限定した。
- hidden作品、private運用コレクション、raw派生コレクション、不明パス、孤立サブコレクションはdefault denyで拒否した。
- Web本体はAdmin SDKを使用するためRules変更の影響を受けず、公開クライアント用products queryは`isActive == true`を必須とする。
- 公開カタログという既存要件上、未認証readを残すこと自体は意図した仕様であり、PIIを含めない前提を維持する。

## 9/2対象サークル実検証結果

- preview: `RG01040726` / 天々赦 / 42作品 / 1セグメント
- 誤planHash: 書き込み前に拒否
- hide: 42件すべて `isActive=false`、`sourceIsActive=true`、seller blockerあり
- control/runtime/state: revisionと対象42件が一致
- 全インデックス・全リストビュー再構築: success
- サークル一覧: 対象なし
- サークル検索: 0件
- サークル詳細・作品詳細: 既存Next.js not-found表示＋noindex
- 作品／サークルトレンドAPI: HTTP 404 + `private, no-store`
- restore: 42件activeへ復帰
- 作品1件hide: 41件active
- サークルhide後にサークルだけrestore: 個別hide作品を維持して41件active
- 作品restore後にサークルhide: 最終0件active
- 再取得相当の保存判定: seller hiddenを維持
