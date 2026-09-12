# 読み取り費用・巡回削減の調査と改善案

調査日: 2026-09-12。対象 `doujin-info-prod`（272801294765）。本番の設定、Firestoreデータ、アプリソースは変更していない。調査用ファイルと本書のみ追加。

## 判断

最初の実装候補は、(1)ジャンル詳細で既存compact索引を使う、(2)Meta-ExternalAgent/Amazonbot等の不要な巡回をrobots.txtで抑える、(3)フッターの先読みを止める。この3点を先に検証する。

ページ全体の長時間キャッシュは次段階。URLの種類が多く、同じページの再訪だけをキャッシュしても初回アクセスの大量読み取りは残る。非表示反映やTL/BLの表示を壊さず、まず1回の読み取り自体を減らす。

## 現状の根拠

本番revisionは `doujin-info-prod-build-2026-09-03-001`。LIST_VIEW_MODE=prefer、SEARCH_INDEX_READ_MODE=compact、SELLER_DETAIL_READ_MODE=stats、METRIC_HISTORY_READ_MODE=year。既存の改善設定は有効。

9/12 00:00〜01:00 JSTの公開側ログ3,348件を全ページ取得した。1時間の標本であり月間へ単純外挿しない。User-Agent分類は自己申告に基づく。

| パス群 | リクエスト | CDN cacheHit=true | ボットを名乗るリクエスト |
|---|---:|---:|---:|
| 作品詳細 `/work/*` | 888 | 0 | 875 |
| ジャンル詳細 | 384 | 0 | 384 |
| サークル詳細 | 206 | 1 | 206 |
| ガイド等6ページ | 1,083 | 0 | 1,077 |
| ロゴ画像 | 520 | 520 | 507 |

- Meta-ExternalAgent: 1,945件、Amazonbot: 900件。合計2,845件、全リクエストの約85%。これは削減できる課金の割合ではない。
- 作品詳細888件は769種類のURL、ジャンル詳細384件は344種類。HTMLキャッシュだけで対応するには再利用が少ない。
- `/about`、`/privacy`、`/faq`、`/guide`、`/contact`、`/terms` の1,083件すべてに `_rsc` が付いていた。フッター6リンクには `prefetch={false}` がなく、先読みによる増加と整合する。ただしログだけで全件の発生源を断定しない。
- `null`で終わる作品・ジャンル・サークル等URLへのアクセスも177件存在し、175件がHTTP 200。無効URL判定をFirestoreより前に行う改善候補。ストリーミング時のnotFound等もあり、200だけで表示内容を判断しない。リンク生成ミスか巡回側生成かは未確定。
- 同じ1時間のアプリ警告/ERROR/fallback検索は0件。計測未実装の経路を含めて全フォールバックがゼロと保証するものではない。

20:49 JST頃に公開URL5件をGETしてヘッダーを確認。トップ、ジャンル詳細、作品詳細、aboutはすべて `private, no-cache, no-store, max-age=0, must-revalidate`。Cookieは付いていない。robots.txtは `public, max-age=0, must-revalidate`。

## 1. ジャンル詳細: 最優先のFirestore改善

該当箇所:

- `web/lib/firebase/products.ts:424` queryLimitForFilter
- `web/lib/firebase/products.ts:1054` getProductsByGenre
- `web/app/[platform]/[audience]/[category]/genre/[genreId]/page.tsx:59` 呼び出し

TLが既定値のため通常も後段フィルターが有効。30件表示でもジャンルの販売数上位を最大300件取得し、その後TL/BLや作品形式で絞る。100件表示では最大800件、200件表示では最大1,600件。ページ位置に応じて取得上限も増える。contentType=all等で後段絞り込みがない場合にもoffset方式の読み取りが残る。

今朝の標本では、nullを除いた346リクエスト中317件がこの後段絞り込み経路。全317件が300ドキュメントを返すわけではない。4URLのクエリ条件を読み取り専用countで確認したところ、取得候補数は134、1、300、131件だった。ドキュメントを大量取得しての計測ではなく、同じwhere/orderBy/limitの候補件数照合。

**提案:** 既存 `compactSearchIndexes` でジャンル・TL/BL・形式を絞り、販売数で並べて対象ページのIDだけ決める。その後30件など表示分の商品だけ取得する。既存の `getCatalogProductsPage`、`candidateGenreIds`、`catalogCandidateMatchesFilter`、`getProductsByIds` を再利用できる。

現在の本番compact索引は15,746作品、6ブロック。ルート＋版＋6ブロックで初回8ドキュメント、同じプロセスで有効なキャッシュがあれば候補選択の追加Readは0。期限切れでも同じ版ならルート1件の確認で済む実装がある。表示30件なら通常約30Read＋共有の可視性確認、初回約38Read＋可視性確認を見込む。300件を読むページでは約90%の候補削減を狙えるが、少数ジャンルの初回は増える場合がある。データ更新時の版読込、障害時の旧経路、欠落後の補充も費用に含める。

これらはソースとメタデータに基づく見積もり。新経路の本番測定値ではなく、課金額の90%減を意味しない。

表示互換性の確認点: 同順位の並び、TL/BL/all、形式、改ページ、30/50/100/200件、非表示、索引と商品更新の時間差。現行は上位300件等の外にある該当作品を落とす可能性があるため、全候補へ広げた差分は仕様改善として明示する。無言で順序・件数を変えない。

## 2. 不要な巡回と先読みを減らす

現行robots.txtは `/api/` と `/search` 以外を概ね許可。最初は大量アクセスを観測した `Meta-ExternalAgent` と `Amazonbot` を個別の巡回抑制候補とし、Googlebot/Bingbot等の検索巡回、SNS共有プレビュー用の別エージェントを一括遮断しない。Meta公式ページは今回取得制限で読めず、細かな仕様は反映前に再確認する。

Amazon公式資料ではAmazonbot、Amzn-SearchBot、Amzn-Userの設定は独立。Amazonbotはcrawl-delay非対応なので、crawl-delayだけでは対策にならない。robots.txtは強制遮断ではなく、守られないアクセスは後段の対策が必要。

`web/components/Footer.tsx:55` の6リンクへ `prefetch={false}` を付ける案は小さく検証しやすい。通常のクリック・リンク先は維持する。ガイドページ群はFirestoreを直接読まないため、この改善の中心はSSR回数と転送量であり、Firestore費用の大幅減とは別。

全ボットに対するクエリ文字列の一律禁止や、`_rsc`の無条件削除は採用しない。TL/BLの有効なURLとNext.jsの画面遷移を守り、limit/page/workTypeの組合せの巡回方針は検索流入を確認して決める。canonicalだけで巡回が止まるとは見込まない。

## 3. 作品詳細・サークル詳細の短時間データキャッシュ

`getProductsBySameSeller` はサークル作品を全件取得する。画面は現在全件表示しており、単純な件数制限はUIの変更になる。4作品の例では同サークル取得は4、11、32、3件だった。全作品履歴の走査が毎回起きているわけではない。

`cache()` from Reactはメタデータと画面内の重複呼び出しをまとめる用途。別リクエストにまたがるキャッシュとしては数えない。チャートは商品内の直近スナップショットを優先し、長期間だけ年次履歴を読むため、ここを最初の修正対象にしない。

第一案はサークル単位の取得結果を60秒程度、容量上限付きで共有し、同時リクエストの重複取得もまとめること。全件表示を維持でき、同じサークルの別作品への巡回でも再利用できる。商品単体も短時間キャッシュ候補。コンテナ再起動や複数インスタンスでは別キャッシュになり、ヒット率は実測が必要。

非表示判定はキャッシュから取得した後にも必ず適用し、既存のcontentVisibilityRuntimeの60秒更新経路を維持する。価格・新規作品等の最大反映遅延を決め、バッチ更新境界での混在も検証する。非表示済みの結果自体を長時間保存しない。より長い保存は版とvisibility revisionによる失効を用意した後に検討。

## 4. HTML/CDNキャッシュは段階的に

共通layoutのforce-dynamicを一括削除すると、searchParams、useSearchParams、TL/BL切替、非表示反映、RSCとの相互作用がある。最初はabout等の静的内容を対象にし、必要ならルート構成・Suspense境界を整える。

商品画面には、データキャッシュ改善後に短いCDN TTLを検討。HTML/RSCとクエリ条件のキャッシュ分離、実ヘッダー、更新後の失効、非表示反映が受入条件。App Hostingはmiddlewareの影響を受けるルートをキャッシュしないと公式に記載しているため、全ルートmiddlewareでボット判定を追加する案はCDN方針と衝突する。初手では行わない。

新しい有料WAF・Redisやホスティング移転は最初の対策に含めない。固定費・移行リスクを増やす前に、既存基盤での読み取り削減を測る。

## 検証・効果判定

1. 既存の表示比較テストを参考に、エミュレーターでジャンルの絞り込み・順序・ページ・非表示・欠損・旧版フォールバックを検証。新旧の1リクエストReadを計測し、冷えた状態と再利用時の両方を比べる。本番全履歴の照合はこの変更に不要。
2. キャッシュは異なるTL/BL、同時リクエスト、期限切れ、バッチ更新、非表示変更を確認。上限のないMapは使わない。
3. ロールアウト単位を分けて前後48〜72時間を比較。日次バッチ時間を分離し、アクセス量で正規化したRead/画面要求も使う。ログにはIPや検索語を追加せず、画面種別・取得件数・キャッシュ成否・フォールバックだけを限定サンプリングする。診断ログ自体の費用を増やさない。
4. 監視: Firestore QUERY/LOOKUP、公開側の画面別・UA別リクエスト、cacheHit、5xx/429、p95、検索流入、DLsiteクリック。48〜72時間はコストの初期判断、検索への影響はより長く追う。
5. キャッシュまたは索引の不具合時に旧経路へ戻せるモードを用意。今回の初手はバッチ・履歴形式を変えないため、その巻き戻しは不要。

前回の月末予測2,055円は9/11確認時の値であり、今回再取得していない。初回施策の目標は全体Read50%減、ジャンル詳細の高Read経路80〜90%減とするが、達成額は未確定。ボット抑制とキャッシュによる節約は重複するため足し算しない。収益450円との黒字化は期間をそろえた実績で判断する。

## 根拠

- `tmp/prod-audit-20260912-edge-00h.json`: 1時間の公開ログ、ページング完了。
- `tmp/prod-audit-20260912-fallback-00h.json`: 同時間の警告等検索。
- `tmp/cost-investigation-20260912.json`: 本番revision、実ヘッダー、候補件数。
- `tmp/prod-audit-20260912-compact-root.json`: 索引15,746作品・6ブロック。
- [Firebase App Hostingのキャッシュ](https://firebase.google.com/docs/app-hosting/optimize-cache)
- [Firestore料金とoffset](https://firebase.google.com/docs/firestore/pricing)
- [Googleの絞り込みURL巡回指針](https://developers.google.com/crawling/docs/faceted-navigation)
- [Amazonbot公式仕様](https://developer.amazon.com/amazonbot)
- [Next.js 15のデータキャッシュ](https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache)
