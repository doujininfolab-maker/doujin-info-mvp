# 本番 Firestore データを使ったローカル確認

本番 `doujin-info-prod` の Firestore を読み取り、ローカルの `doujin-info-mvp` エミュレータへ複製する手順です。本番側には書き込みません。

## 固定検証断面

通常のローカル検証では、2026-09-02に本番から読み取り専用で取得し、年次履歴を全件照合した次のスナップショットを使用します。

```text
.emulator-data/production-20260902
```

取得・検証時の件数は次のとおりです。

- 全コピー: 478,769 documents
- products: 15,245 documents
- dailyMetrics: 419,435 documents
- metricYears: 15,245 documents / 419,435 points
- 年次履歴の欠損 / 不一致 / 余分: 0 / 0 / 0
- dailyMetricsの最新日: 20260902

次回以降は、プロジェクトルートから次の専用スクリプトで起動します。古い`.emulator-data`直下の8月4日版は検証に使用しません。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-production-snapshot.ps1
```

別ターミナルで、検証対象コードから事前集計・索引を再生成してから画面/API比較を開始します。

```powershell
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8082"
$env:GOOGLE_CLOUD_PROJECT="doujin-info-mvp"
$env:GCLOUD_PROJECT="doujin-info-mvp"
$env:METRIC_HISTORY_READ_MODE="year"
$env:SEARCH_INDEX_WRITE_MODE="dual"
npm --prefix functions run verify:site-stats:emulator
```

これにより、取得時点の事前集計をそのまま評価するのではなく、9月2日の作品・履歴データを現在のコードで再計算して検証できます。

スナップショットを更新するのは、本番から新しい断面を取得する明示的な依頼があった場合だけです。

## 初回およびデータ更新時

1. Firebase CLI へ、本番プロジェクトを閲覧できるアカウントでログインします。
2. Firestore エミュレータを起動します。本番データ全件は大きいため、スナップショットも作る場合は Java ヒープを増やします。

   ```powershell
   $env:JAVA_TOOL_OPTIONS="-Xmx16g"
   npx -y firebase-tools@latest emulators:start --only firestore --project doujin-info-mvp
   ```

   固定検証断面を使う場合は、上記の`start-local-production-snapshot.ps1`を使用します。

3. 別のターミナルで本番データを複製します。

   ```powershell
   node scripts/clone-production-firestore.mjs
   node scripts/migrate-daily-metrics-to-years.mjs
   npx -y firebase-tools@latest emulators:export .emulator-data/production-YYYYMMDD --project doujin-info-mvp --force
   ```

   移行ツールはループバック上のFirestore Emulatorでしか実行できず、本番Project IDも拒否します。旧`dailyMetrics`は削除せず、全ポイントをハッシュ照合してから成功終了します。再照合だけを行う場合は`--verify-only`、移行だけを行う場合は`--migrate-only`を付けます。

4. `web/.env.local.example` を `web/.env.local` にコピーし、Web を起動します。

   ```powershell
   Set-Location web
   npm run dev
   ```

画面は `http://localhost:3000`、Emulator UI は `http://localhost:4000/firestore` です。

## 注意事項

- 複製開始時にローカル Firestore の既存データを消去します。本番データは変更しません。
- 2026-09-02 断面は約47.9万ドキュメント、エクスポート約1.24GBのため、全件投入・エクスポートには数分と大きめのメモリが必要です。
- 複製データとエクスポートは `.emulator-data/` に保存され、Git 管理対象外です。
- 本番データを含むため、`.emulator-data/` を共有・コミットしないでください。
- コピー対象は本番の全ルートコレクションと、このリポジトリが参照する全サブコレクションです。新しいサブコレクションを追加した場合は、コピー用スクリプトの一覧も更新します。
- ローカルWebは`METRIC_HISTORY_READ_MODE=year`、ローカルバッチは`METRIC_HISTORY_WRITE_MODE=year`で年次形式を使用します。コード上の既定値はどちらも`legacy`のため、環境変数を設定していない本番挙動は変わりません。
