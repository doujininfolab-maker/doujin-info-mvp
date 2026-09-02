# サークル・作品の論理削除／復活 設計

## 1. 目的

削除依頼を受けた作品またはサークルを、公開画面・検索・ランキング・集計・公開 API から非表示にする。元データと履歴は保持し、後から同じ URL と識別子で復活できるようにする。

対象は次の 2 種類とする。

- 作品単位の削除／復活
- サークル単位の削除／復活（所属する全作品と、削除後に取得した新作を含む）

両者の影響範囲は重ね合わせるが、親子方向は次のとおりとする。

- **作品を削除しても、その作品だけを非公開にする。同じサークルの他作品は公開を継続し、公開作品が 1 件以上残る限りサークルも公開する。**
- 削除対象が唯一の公開作品だった場合、現行のサークル情報は作品から生成されるため、サークル詳細も公開対象がなくなり 404 になる。これはサークル削除 control を設定する動作ではなく、公開作品 0 件による既存データモデル上の結果である。
- **サークルを削除した場合は、そのサークルと所属する全作品を非公開にする。**
- サークルを復活しても、作品単位で削除中の作品は復活させない。

本設計の「論理削除」は公開停止を対象とする。元データと履歴は保持し、取得バッチによる内部更新も既定では継続する。削除依頼に「今後の収集・処理も停止」が含まれる場合は、公開状態とは別の収集停止ポリシーとして扱う。

## 2. 現状と設計上の制約

- 正本は `products`。サークル情報は各作品の `seller` に埋め込まれている。
- `sellers` にはサークル集計ドキュメントも保存され、サイト統計再構築時に置換・削除される。サークル削除状態の正本にはできない。
- 一覧・検索・ランキング・ジャンル・サークル・トップ画面は、`products` から複数のバージョン付き派生ビューを生成している。
- 主要な正本クエリと派生ビュー生成は、すでに `isActive == true` を公開対象の条件としている。
- 現在の取得処理は作品保存時に `isActive: true` を書くため、単純に `false` にするだけでは翌日の取得で復活してしまう。
- 作品詳細の ID 直接取得、派生ビューから ID を引く取得、トレンド API には、現在 `isActive` を確認しない経路がある。
- 派生ビューは前バージョンへのフォールバックを持つ。再構築だけに依存すると、障害時に削除済みデータが再表示される可能性がある。
- Firestore Rules は現在、作品・日次メトリクス・ランキングスナップショット・サークルを公開読み取り可能にしている。

## 3. 採用方針

### 3.1 削除指示と実効公開状態を分離する

削除依頼の正本として、非公開の `contentVisibilityControls` コレクションを追加する。`products.isActive` は既存クエリとの互換性を維持するため、公開可否を表すマテリアライズ済みフラグとして使う。

公開判定は次の式に統一する。

```text
effectiveVisible =
  sourceIsActive
  AND productControl != hidden
  AND sellerControl != hidden
```

```text
products.isActive = effectiveVisible
```

これにより既存の複合インデックスと主要クエリを維持できる。新しい削除状態フィールドを全クエリへ追加する方式は採用しない。

### 3.2 サークルの識別子

サークルは、原則として次の組み合わせで識別する。

```text
platform + source seller ID
```

DLsite の `seller.sellerId` など、取得元が提供する安定 ID を使う。本番のサークル削除は `platform + sellerId` を必須とし、名前だけでは実行しない。名称はプレビューと監査表示にだけ使用する。現行本番データでは active 作品 15,147 件すべてに seller ID があり、同一名称が複数 ID に対応する例もあるため、名称一致は誤削除の危険がある。

## 4. データモデル

### 4.1 `contentVisibilityControls/{controlId}`

`controlId` は `entityType | platform | stableEntityKey` の SHA-256 などから決定的に生成する。

```ts
type ContentVisibilityControl = {
  schemaVersion: 1;
  entityType: "product" | "seller";
  platform: "dlsite" | "fanza";

  // product の場合
  productId?: string;
  sourceProductId?: string;

  // seller の場合
  sourceSellerId?: string;
  normalizedSellerName?: string; // 表示・調査用。本番の削除キーには使わない
  sellerNameAtRequest?: string;  // 表示・監査用スナップショット

  state: "hidden" | "visible";
  reasonCode: "deletion_request" | "rights_issue" | "operator_action";
  caseId: string;                // 依頼者の個人情報ではなく社内管理番号
  revision: number;
  requestedAt: Timestamp;
  requestedBy: string;           // IAM 主体または運用者 ID
  updatedAt: Timestamp;
  updatedBy: string;
};
```

復活時にもドキュメントを消さず、`state: "visible"` として残す。現在状態の確認と再削除時の追跡が容易になる。

### 4.2 `contentVisibilityEvents/{eventId}`

操作履歴は追記専用にする。

```ts
type ContentVisibilityEvent = {
  schemaVersion: 1;
  operationId: string;
  controlId: string;
  entityType: "product" | "seller";
  action: "hide" | "restore";
  previousState: "hidden" | "visible" | "unset";
  nextState: "hidden" | "visible";
  caseId: string;
  affectedProductCount: number;
  affectedSegments: string[];
  status: "started" | "materialized" | "rebuilt" | "partial" | "failed";
  performedAt: Timestamp;
  performedBy: string;
  errorSummary?: string;
};
```

メール本文や依頼者の連絡先は Firestore の公開データと混在させない。必要なら別のアクセス制限された案件管理側に保存し、ここでは `caseId` だけを持つ。

### 4.3 `contentVisibilityState/current`

```ts
type ContentVisibilityState = {
  schemaVersion: 1;
  revision: number;
  updatedAt: Timestamp;
};
```

状態変更のたびにトランザクションで単調増加させる。取得バッチ、派生ビュー、再照合処理がどの削除状態を反映したか確認するために使う。

### 4.4 `contentVisibilityRuntime/current`

公開経路とバッチが control を 1 件ずつ読まないように、現在 hidden の識別子だけを持つコンパクトな実行時スナップショットを追加する。control と state の revision 更新と同じトランザクションで更新する。

```ts
type ContentVisibilityRuntime = {
  schemaVersion: 1;
  revision: number;
  hiddenProductIds: string[];       // 作品単位control
  hiddenSellerProductIds: string[]; // サークル削除時点の所属作品。sellerIdを持たない旧派生データの防御用
  hiddenSellerKeys: string[]; // `${platform}:${sourceSellerId}`
  updatedAt: Timestamp;
};
```

- Web サーバーはこの 1 ドキュメントをプロセス内で最大 60 秒キャッシュし、同時リフレッシュを 1 回にまとめる。
- 取得・再構築ジョブは実行開始時に 1 回読み、メモリ上で全作品へ適用する。作品ごとの Firestore 読み取りは禁止する。
- 配列フィールドはインデックス対象外にする。
- 非公開件数が増えてドキュメントサイズ上限へ近づく前に分割する。目安として 5,000 キー到達時にシャード移行を判断する。
- runtime は高速な公開防御用で、監査上の正本は `contentVisibilityControls` とする。

### 4.5 `products` への追加フィールド

```ts
type ProductVisibilityMaterialization = {
  sourceIsActive: boolean;
  isActive: boolean; // 既存フィールド。今後は effectiveVisible
  visibility?: {
    status: "visible" | "hidden";
    blockers: Array<"product" | "seller" | "source">;
    controlRevision: number;
    evaluatedAt: Timestamp;
  };
};
```

`visibility` には案件番号、理由、依頼者情報をコピーしない。公開ドキュメントには判定結果だけを持たせる。

移行中の後方互換は次のように扱う。

```text
sourceIsActive = product.sourceIsActive ?? product.isActive ?? true
```

## 5. 状態遷移と優先順位

```text
visible -- hide --> hidden -- restore --> visible
```

優先順位は「1 つでも hidden の指示があれば非表示」とする。

- サークルが hidden の間は、個別作品を restore しても公開しない。
- サークルを restore しても、個別作品が hidden ならその作品だけ公開しない。
- 取得元で非公開になった作品は、削除依頼を restore しても `sourceIsActive=false` のため公開しない。

この規則により、復活操作が別の削除指示を意図せず解除することを防ぐ。

## 6. 操作フロー

初期提供は公開 HTTP エンドポイントや管理画面ではなく、Firebase Admin SDK を使う IAM 制御下の運用 CLI とする。既存の `confirmWrites=true` 型の公開 Functions を削除操作へ転用しない。

CLI は少なくとも `preview`、`hide`、`restore`、`status` を提供する。

### 6.1 共通プレビュー

1. 作品 ID または `platform + sellerId` を解決する。
2. 対象作品、サークル名、件数、影響セグメント、現在の個別／サークル制御を表示する。
3. 対象一覧のハッシュを `planHash` として出力する。
4. 実行には `--confirm <planHash>` と `--case-id` を必須にする。

対象ゼロ、複数サークル ID の衝突、名前だけの曖昧一致は実行を止める。

### 6.2 作品の削除

1. トランザクションで `contentVisibilityControls` と runtime snapshot を `hidden` にし、グローバル revision を増やす。
2. イベントを `started` で記録する。
3. 対象作品を再評価し、`isActive=false`、`visibility.blockers` を更新する。
4. 影響セグメントのサイト統計、検索・ランキング・ジャンル・サークルインデックスを再構築する。
5. その後、全リストビューを再構築する。
6. 公開経路と件数を検証し、成功時にイベントを `rebuilt` にする。

### 6.3 サークルの削除

1. トランザクションで安定したサークルキーの制御と runtime snapshot を `hidden` にし、revision を増やす。
2. 現在一致する全作品を BulkWriter 等で再評価して `isActive=false` にする。
3. 該当する全セグメントを再構築する。
4. サークル一覧・詳細・トレンド、所属作品の詳細、検索、各一覧から消えたことを検証する。

制御レコードを最初に hidden にする。途中で一部の作品更新や再構築に失敗しても、実行時ガードが削除指示を見て公開を止められるためである。

### 6.4 復活

1. トランザクションで対象制御と runtime snapshot を `visible` にし、revision を増やす。
2. 対象作品ごとに、取得元状態と残っている他の hidden 制御を再評価する。
3. 公開可能な作品だけ `isActive=true` に戻す。
4. 削除時と同じ順序で派生データを再構築する。
5. URL、一覧、検索、集計値を検証する。

復活途中の失敗は「まだ一部が見えない」状態に倒す。削除済みデータが意図せず見える状態には倒さない。

## 7. 公開経路の防御

派生ビュー再構築だけに依存せず、次の実行時ガードを恒久的に入れる。

### 7.1 正本取得

- `getProductById` は `isActive !== true` の作品を `null` として扱う。
- `getProductsByIds` は取得後に `isActive === true` の作品だけ返す。
- サークル ID／名前から作品を取る既存クエリは、現在の `isActive == true` 条件を維持する。

### 7.2 派生ビュー

古い active／previous version に削除対象が残っていても、レスポンス直前に `contentVisibilityRuntime/current` のキャッシュで次を除外する。control を作品ごと、またはリクエストごとに直接読まない。

- 作品カード: product control または seller control が hidden
- 検索候補: product control または seller control が hidden
- サークルカード／サークル詳細: seller control が hidden
- ホーム、ランキング、新着、セール、ジャンル: 上記と同じ

再構築が完了するまで、一時的にページ件数が少なくなることは許容する。削除操作の完了条件には、再構築後に件数とページングが一致することを含める。

### 7.3 トレンド API とキャッシュ

- 作品トレンドは、先に公開中の作品であることを確認し、非公開なら 404 を返す。
- サークルトレンドは、先に公開中のサークルであることを確認し、非公開なら 404 を返す。
- 非公開判定後のレスポンスは `Cache-Control: private, no-store` とする。
- 現在の `stale-while-revalidate=3600` は削除後も古い応答を最大 1 時間返し得るため廃止する。成功レスポンスは原則 `public, max-age=60, s-maxage=300, must-revalidate` とし、最大残存時間を 5 分へ制限する。
- 法的要件などで 5 分も許容できない案件では `s-maxage=60` へ短縮する。その場合はバックエンド負荷と課金がやや増える。
- インメモリキャッシュを参照する前に公開判定する。削除状態の revision をキャッシュキーに含める方法も可とする。

### 7.4 SEO

- 非公開の作品・サークル詳細は存在を確認できる専用メッセージではなく 404 とする。
- 既存 URL は物理的に変えないため、復活後は同じ URL を再利用できる。
- 現在の sitemap は固定ルートだけなので、作品・サークル URL の除去対応は不要。将来動的 URL を追加する場合は公開判定を必須にする。

### 7.5 Firestore Rules

サーバーアプリは Admin SDK を利用しており、Web アプリから Firestore Lite SDK を使う実経路は現在見当たらない。この前提をアクセスログとテストで確認した後、段階的に次を行う。

- `products` の公開 get/list は `isActive == true` のみに制限する。
- `dailyMetrics` は親 `products/{productId}` が公開中の場合だけ読めるようにする。
- ランキングスナップショットや派生サークル集計は、削除済み ID や名称を漏らすため、公開クライアント読み取りを原則停止し、サーバー経由に寄せる。
- `contentVisibilityControls`、events、state は常に公開読み書き禁止とする。

Firestore Rules はフィルターではないため、公開クライアントの list を残す場合はクエリ側にも `where("isActive", "==", true)` が必要になる。

## 8. 取得・再構築バッチの変更方針

全ての作品保存経路を共通の `applyContentVisibility` 相当の関数へ通す。

1. 取得元の値を `sourceIsActive` として保存する。
2. ジョブ開始時に `contentVisibilityRuntime/current` を 1 回読み、product control と seller control をメモリ上で評価する。
3. `isActive` と `visibility` を計算して保存する。

少なくとも、通常日次取得、優先取得、旧作取得、デバッグ取得、シードを確認対象にする。`normalizeProduct` が無条件に `isActive: true` を返すだけの状態を残さない。

長時間バッチと削除操作が競合した場合に備え、`visibility.controlRevision` を保存する。古い revision で後から書かれた作品は、操作完了時の再照合と定期リコンサイルで修正する。公開経路は最新 runtime snapshot をガードに使うため、競合中も最大 60 秒のキャッシュ更新後は公開漏れを防ぐ。

## 9. インデックスへの影響

- 公開一覧は既存の `isActive` 条件を維持するため、既存 `products` 複合インデックスは原則そのまま使える。
- control は CLI と監査処理だけが決定的 ID の point read を行う。通常の公開リクエストは runtime snapshot のキャッシュを使う。
- hidden 一覧を読む場合も `state == "hidden"` の単一条件で足り、Standard Edition の自動単一フィールドインデックスを利用できる。
- `products.visibility` は検索に使わないため、インデックス除外を推奨する。
- 新しい複合インデックスが必要になった場合は、エミュレーターと本番同等クエリで確認してから `firestore.indexes.json` に明示する。

## 10. 障害時の扱い

- 削除操作で一部更新に失敗: control は hidden のまま、イベントを `partial` にして再実行可能にする。公開は実行時ガードで停止する。
- 派生ビュー再構築に失敗: 旧バージョンを維持するが、実行時ガードで対象を除外する。
- 復活操作で一部更新に失敗: control は visible でも `isActive=false` が残り得る。非公開側に倒れるため、再照合して再実行する。
- 同じ操作の再実行: `operationId` と control revision で冪等にする。
- 対象件数がプレビューから変化: `planHash` 不一致で停止し、再プレビューを要求する。

## 11. ロールアウト手順

### Phase 1: 防御を先に導入

1. 型、runtime snapshot 読み取り、共通公開判定を追加する。
2. 詳細取得、ID 一括取得、検索、各派生ビュー、トレンド API に実行時ガードを追加する。
3. 既存機能の比較テストを行う。control が 0 件ならレスポンスが完全一致することを確認する。

### Phase 2: 書き込みの永続化

1. 全作品保存経路を共通公開判定へ通す。
2. `sourceIsActive`、`visibility` をバックフィルする。この時点では既存作品の `isActive` を変えない。
3. 古い revision の作品を検出・修復するリコンサイル処理を追加する。

### Phase 3: 運用 CLI

1. preview／hide／restore／status と監査イベントを実装する。
2. エミュレーターで作品・サークルの削除／復活を確認する。
3. テストプロジェクトで実データ相当の dry-run と再構築を行う。

### Phase 4: Rules と本番投入

1. クライアント Firestore 読み取りが使われていないことを確認する。
2. `isActive` 条件と raw 履歴の非公開化を Rules に反映する。
3. 1 作品でカナリア実施し、続いてテスト用サークルで実施する。
4. 監視後に実際の削除依頼へ適用する。

## 12. 回帰テスト／受け入れ条件

### 12.1 control なし

- 主要ページ、検索件数、ランキング順、サークル件数、サイト統計が変更前と一致する。
- 既存の active／previous version フォールバックが機能する。
- 日次取得後も既存作品が公開されたままになる。

### 12.2 作品削除

- 作品詳細、metadata、トレンド API が 404。
- 検索結果と totalCount、ランキング、新着、セール、ジャンル、同一サークル作品、ホームから消える。
- サークル作品数・売上集計・サイト統計から除外される。
- 日次取得を再実行しても復活しない。
- Firestore の公開読み取りから作品と配下メトリクスを取得できない。

### 12.3 作品復活

- サークル control が visible かつ取得元が active の場合だけ復活する。
- URL は削除前と同一。
- 再構築後に一覧件数、ページング、集計が一致する。

### 12.4 サークル削除

- サークル一覧・検索・詳細・トレンドが 404 または非表示。
- 所属する全作品が、作品 ID 直アクセスを含めて非表示。
- 削除後に取得した同じ seller ID の新作も公開されない。
- 同名の別 platform／別 seller ID は影響を受けない。

### 12.5 サークル復活

- 個別に hidden の作品は復活しない。
- それ以外の取得元 active 作品だけ復活する。
- サークル集計は公開作品だけから再生成される。

### 12.6 競合・障害

- 日次取得と hide を同時実行しても公開漏れしない。
- 再構築失敗時に previous version から削除対象が再表示されない。
- 同じ operationId の再実行でイベントや revision が不正に重複しない。

## 13. 完了条件

削除操作は control を hidden にしただけでは完了としない。次の全条件を満たして `rebuilt` とする。

- 対象 control が期待 revision で hidden
- 全対象作品の `isActive=false` と `visibility.controlRevision` が一致
- 影響セグメントの正本集計・全インデックス・全リストビュー再構築が成功
- 詳細、一覧、検索、サークル、トレンド API、Firestore 公開読み取りの検証が成功
- キャッシュの最大残存時間を超え、旧レスポンスが配信されない

## 14. 製作前再レビュー結果

### 14.1 結論

上記の修正を含めることを条件に、**製作へ移行可**と判断する。初稿のままでは、名称によるサークル特定の誤削除リスクと、公開レスポンスごとの control 読み取りによる性能・課金リスクがあるため、移行不可だった。

### 14.2 既存機能とデグレ

- 現行の主要クエリと派生ビューはすでに `isActive == true` を使っている。新しい条件を各クエリへ追加せず、この既存フラグを実効公開状態として再利用するため、通常時の検索結果、並び順、ページング、複合インデックスへの影響を最小化できる。
- 直接取得、ID 一括取得、古い派生ビュー、トレンド API には現状バイパスがある。Phase 1 で全経路にガードを入れ、control 0 件時の完全一致試験を通すまでは削除操作を有効化しない。
- Firestore Rules の厳格化は、未把握の外部クライアントが raw Firestore を読んでいる場合だけ破壊的変更になり得る。Rules はアプリ変更と分け、アクセスログ確認と段階投入後に適用する。
- 作品削除時はサークル control を変更せず、公開中の残存作品だけで作品数・売上を再集計する。残存作品がある限りサークルは公開を継続する。残存作品が 0 件なら、独立したサークル正本がない現行仕様どおりサークル詳細も 404 になる。

### 14.3 性能

- 通常リクエストで増える処理は、小さな runtime snapshot に対するメモリ内集合判定であり、著しい性能劣化は見込まない。
- Firestore 読み取りは作品ごと・リクエストごとには増やさない。各 Web インスタンスが最大 60 秒に 1 回、1 ドキュメントを読む。
- 取得ジョブもバッチ開始時の 1 読み取りだけを追加する。15,147 作品に対して control を個別照会する実装は禁止する。
- 現行本番ジョブの直近実績は、インデックス再構築が約 2～3 分、リストビュー再構築が約 2 分である。削除／復活の運用完了は検証とキャッシュ消失を含め、おおむね 5 分以上を見込む。これは通常閲覧の遅延ではなく、運用操作の所要時間である。

### 14.4 課金

課金増を完全にゼロにはできないが、通常時は小さい。runtime snapshot の 60 秒キャッシュでは、追加読み取り上限は概算で `稼働インスタンス数 × 1,440 読み取り/日` となる。東京リージョンの無料枠超過後の読み取り単価を $0.03/10 万件として単純計算すると、10 インスタンスで約 $0.00432/日、約 $0.13/月である。

削除／復活 1 回は全再構築を行うため、現状規模では概算 6～8 万読み取り、派生データ約 2,000 書き込みに対象作品更新分が加わる。すべて有料枠としても Firestore 部分は概ね数セントで、別途 Cloud Run Jobs の約 4～5 分分の実行料金が発生し得る。無料枠の利用状況により実請求は変わるため、投入後は Billing とジョブ実績を監視する。

### 14.5 主なデメリットと許容判断

- 非公開の反映保証は runtime cache と CDN の最大残存時間に依存し、標準設定では操作開始から最大約 5 分を見込む。即時性が必要なら CDN TTL を短縮する。
- runtime snapshot と revision、再照合処理が増え、実装と運用は単純な `isActive=false` より複雑になる。ただし、再取得による意図しない復活と古い派生ビューからの漏出を防ぐために必要である。
- 論理削除なのでデータは保持され、既定では内部取得も続く。依頼条件がデータ保有・収集停止まで含む場合、この方式だけでは要件を満たさない。
- hidden 件数が将来大幅に増える場合は runtime snapshot のシャード化が必要になる。現在想定する少数の削除依頼では単一ドキュメントが最も低コストである。

### 14.6 製作開始のゲート

次を満たすまで本番の hide／restore を実行しない。

1. control 0 件時の既存レスポンス完全一致と、主要回帰テストが成功する。
2. 全作品書き込み経路が共通公開判定を通る。
3. active／previous version を含む全公開経路で runtime guard が機能する。
4. 作品削除、サークル削除、重ね合わせ、復活、取得バッチ競合、再構築失敗の試験が成功する。
5. Firestore Rules 変更前に、raw Firestore を利用する既存クライアントがないことを確認する。
6. 1 作品、テスト用サークルの順でカナリア実施し、削除中と復活後の件数・URL・課金・ジョブ時間を確認する。
