# 費用削減4項目の本番反映（2026-09-13）

対象は `doujin-info-prod`（プロジェクト番号 `272801294765`）。Firestore Standard `(default)` と Cloud Run Jobs / Workflow は `asia-northeast1`、Firebase App Hosting は `asia-east1`、公開URLは https://doujin-info.jp 。

## 反映内容と設定

- Web: `Meta-ExternalAgent` / `Amazonbot` 向けrobots、初日確定値の表示、ジャンル詳細集約の読込を追加。
- 収集TL / BL: 新しい初日確定と商品更新時の集約無効化を反映。`METRIC_HISTORY_WRITE_MODE=year`、`METRIC_HISTORY_READ_MODE=year`。
- 索引再生成: `GENRE_DETAIL_AGGREGATION_ENABLED=true`。既存商品読込を再利用してジャンル詳細を生成。
- 一覧再生成を含む既存4ジョブ: 修正版イメージへ統一。CPU 1、メモリ1Gi、再試行0、実行サービスアカウント、収集10800秒 / 再生成7200秒を維持。
- Web集約読込: `GENRE_DETAIL_READ_MODE=prefer`。
- 発売日範囲クエリの複合インデックス: `READY`。集約payload等の索引除外も反映。
- 次回の通常日次Workflowは2026-09-14 01:00 JST。スケジュールは変更していない。通常日の収集バッチは再実行していない。

本番はCloud Run Jobsで実行しており、Cloud Functions APIは無効。新しいFunctionsの常設デプロイやスケジュールは追加していない。

## 履歴の全件照合

日次Workflowが停止している時間帯に `migrate-production-metric-years.mjs --project=doujin-info-prod --verify-only` を実行。

| 項目 | 結果 |
|---|---:|
| 保持中のdailyMetrics点数 | 568,599 |
| metricYears文書数 | 15,842 |
| 年次内の点数 | 568,599 |
| 欠落・値の不一致・余剰の点 | 各0 |
| 年次文書の欠落・ヘッダー不一致・余剰 | 各0 |
| 照合によるWrite | 0 |

全件一致を確認してから二重書き込みを終了した。照合と切替の間に収集は実行していない。既存dailyMetricsを削除せず保持する。

## 初回生成で検出・修正した問題

最初の実データ生成では、個々のブロックはサイズ制限内だったが、一括Write全体がFirestoreのリクエスト容量上限を超えた。集約のactiveVersionは公開されず、Webは従来クエリを継続した。サイト統計・検索・ランキング等の既存生成処理は成功した。

`genreDetailView.ts`のWriteバッチを350件上限に加え、パス・メタデータ・圧縮payload・余裕分を含む推定7MiB上限でも分割するよう修正。約12MiBの集約を3コミットへ分ける回帰テストを追加し、既存432条件の表示比較と初日・年次・異常時復帰を再検証した。

修正版の本番実行 `doujin-info-rebuild-indexes-mxtx9` は正常終了。アプリ処理時間72,159ms、15,799作品から406ジャンル・638ブロックを生成し、`published=true`。生成ログのWrite数は1,047（別途、初回制御文書作成や整理に伴う操作がある）。集約元リビジョン0。

## ソースと反映元

最終Webリビジョン `doujin-info-prod-build-2026-09-13-001` が100%のトラフィックを処理。先行反映の `doujin-info-prod-build-2026-09-12-001` から切り替えた。

全406ジャンルの105,054行を実商品から生成した候補と照合し、内容・順序・チェックサムが一致した。圧縮payload合計26,447,552 bytes。人気3ジャンル×全体/TL/BLの9条件では、実際のWeb読込関数のカード項目・並び順が一致。30件表示時のReadは絞り込みあり300→初回5 / キャッシュ時1、絞り込みなし30→5 / 1（共通の公開判定キャッシュが有効な条件）。

手元から本番DBへの測定では、TL/BLの従来934〜1085msに対し集約初回146〜245ms・キャッシュ時30〜40ms。全体30件取得は従来129〜182ms、集約初回173〜351ms、キャッシュ時29〜187ms。初回が約44〜201ms遅い条件もあり、すべての条件で応答が短縮するとは保証しない。各条件1回の参考測定で、クラウド内のWebサーバー計測やページ全体の応答時間とは区別する。

- `2db0b67`: バッチ・データ形式・インデックス。
- `a350d8b`: Web・robots・ローカル検証。
- `6f37d84`: ジャンル一括Writeの容量分割と回帰テスト。
- `fb430f0`: 全件照合済みの本番ジャンル集約読込を有効化。
- バッチCloud Build: `5bb93a6d-a389-4ab4-9d74-302ccc0148a3`。
- 最終バッチイメージ: `asia-northeast1-docker.pkg.dev/doujin-info-prod/doujin-info-jobs/doujin-info-batch@sha256:f44409ade0da62d1f8a637dc831d55abfc5698a9548fd1a2168e3cd53feaebcd`。

本番反映用ソースはGitコミットのarchiveから作成。作業中の `ops/`、モバイル比較資料、X関連スクリプト、`web/tsconfig.tsbuildinfo` は含めていない。

## 公開サイトの最終確認

トップ、ジャンル詳細4条件、ジャンル一覧、新着、ランキング、セール、サークル詳細、作品詳細、検索、グラフAPIの13経路でHTTP 200を確認。ジャンル詳細・新着・ランキング・セール・検索の商品カードHTMLとグラフAPIのJSONは切替前後で一致した。トップの新着・最近追加・セール候補は既存仕様で毎回ランダムに抽出されるため、全文一致から除外し、30カードの正常表示を確認した。

公開 `robots.txt` に対象2UAのルールが反映済み。最終確認時の直近20分のWeb `severity>=ERROR` ログは0件。既存の一覧prefer、検索compact、サークルstats、履歴year設定と、ジョブの既存リソースを維持した。

## 確認の範囲と運用上の注意

初日の販売数は、新コードによる次回以降の発売翌日収集から確定する。今回、確認目的でDLsite収集を再実行したり、過去の初日データを一括補正したりしていない。実際の初日確定とyearのみの新規書込は次回の日次バッチで確認する対象。

robotsは従う巡回に対する制限であり、無視するアクセスを強制遮断する機能ではない。請求額の実減少は同じ利用量での反映後の実績で評価する。今回の全件照合・初回生成・再検証自体にも一時的なRead / Write / ビルド費用が発生する。

ジャンル読込は `GENRE_DETAIL_READ_MODE=legacy` へ戻せる。年次のみの書込開始後、販売履歴の読込をlegacyへ戻すには停止期間のdailyMetrics補完が必要。古い収集イメージへ戻す場合は、ジャンル集約読込も無効にして未対応の更新経路が残らないようにする。

実行ログ・設定退避・照合JSONはローカル `.tmp/cost-reduction/prod-*` に保存。ローカル検証詳細は [cost-reduction-local-validation-2026-09-13.md](cost-reduction-local-validation-2026-09-13.md)。
