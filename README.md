# 同人情報サイト MVP / Node24 / マルチサイト対応版

DLsite女性向けを最初のMVP対象にしつつ、将来のFANZA動画・FANZA電子書籍・FANZA同人・DLsite男性向け・DLsite一般向けへ横展開しやすいように、DBとURLとFunctionsをマルチサイト対応にした版です。

## 1. 技術構成

- Frontend: Next.js + TypeScript
- Hosting: Firebase App Hosting
- DB: Cloud Firestore
- Backend: Cloud Functions for Firebase v2 + TypeScript
- Batch: Scheduled Functions
- Admin処理: Firebase Admin SDK
- Node.js: 24

## 2. 重要な設計変更

旧DLsite女性向け固定の項目は廃止し、以下の軸に変更しています。

```ts
platform: "dlsite" | "fanza";
audience: "female" | "male" | "general" | "adult";
category: "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
affiliateProvider: "dlsite" | "dmm";
sourceUrl: string;
affiliateUrl?: string;
priceCurrent?: number;
priceOriginal?: number;
discountRate?: number;
salesCount?: number;
rating?: number;
latestRankings?: RankingSummary[];
```

## 3. ディレクトリ構成

```text
.
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc.example
├── README.md
├── web/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── [platform]/[audience]/[category]/page.tsx
│   │   ├── [platform]/[audience]/[category]/ranking/page.tsx
│   │   ├── [platform]/[audience]/[category]/new/page.tsx
│   │   ├── [platform]/[audience]/[category]/sale/page.tsx
│   │   ├── [platform]/[audience]/[category]/genre/[genreId]/page.tsx
│   │   └── work/[productId]/page.tsx
│   ├── components/
│   └── lib/
└── functions/
    └── src/
        ├── adapters/
        ├── batch/
        ├── normalizers/
        ├── seed/
        └── index.ts
```

## 4. Firestore構成

```text
products/{productId}
products/{productId}/dailyMetrics/{yyyyMMdd}

rankingSnapshots/{snapshotId}
rankingSnapshots/{snapshotId}/items/{rankItemId}

taxonomies/{taxonomyId}
sellers/{sellerId}
batchRuns/{runId}
```

### productId

```text
{platform}_{category}_{sourceProductId}
```

例:

```text
dlsite_doujin_RJ01100001
fanza_video_abc123
fanza_ebook_xyz789
```

## 5. URL設計

MVP対象:

```text
/
/dlsite/female/doujin
/dlsite/female/doujin/ranking
/dlsite/female/doujin/new
/dlsite/female/doujin/sale
/dlsite/female/doujin/genre/dlsite:tl
/work/dlsite_doujin_RJ01100001
```

将来追加想定:

```text
/dlsite/male/doujin
/dlsite/general/game
/fanza/adult/video
/fanza/adult/ebook
/fanza/adult/doujin
```

## 6. セットアップ

### Node確認

```powershell
node -v
npm -v
```

期待値:

```text
v24.x.x
11.x.x
```

### Firebase CLI

```powershell
npm install -g firebase-tools@latest
firebase login
firebase --version
```

### Firebaseプロジェクト紐付け

```powershell
copy .firebaserc.example .firebaserc
```

`.firebaserc` の `YOUR_FIREBASE_PROJECT_ID` を自分のFirebase Project IDに変更します。

## 7. 依存関係インストール

```powershell
cd functions
npm install
npm run build
```

```powershell
cd ..\web
npm install
npm run typecheck
npm run build
```

## 8. web/.env.local

```powershell
cd web
copy .env.local.example .env.local
```

Firebase ConsoleでWebアプリを作成し、以下を設定します。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=REPLACE_ME
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=REPLACE_ME
NEXT_PUBLIC_FIREBASE_APP_ID=REPLACE_ME
```

ローカルEmulatorを使う場合:

```env
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1
NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8080
```

本番Firestoreを見る場合は `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` を `false` にするか削除してください。

## 9. Emulator起動

プロジェクトルートで実行します。

```powershell
firebase emulators:start --only firestore,functions
```

Emulator UI:

```text
http://127.0.0.1:4000
```

## 10. ダミーデータ投入

別ターミナルで実行します。

```powershell
curl "http://127.0.0.1:5001/YOUR_FIREBASE_PROJECT_ID/asia-northeast1/seedDummyProducts"
```

投入されるデータ:

- products: 15件
- products/{productId}/dailyMetrics
- rankingSnapshots
- rankingSnapshots/{snapshotId}/items
- taxonomies
- sellers

## 11. ローカル確認

```powershell
cd web
npm run dev
```

確認URL:

```text
http://localhost:3000
http://localhost:3000/dlsite/female/doujin
http://localhost:3000/dlsite/female/doujin/ranking
http://localhost:3000/dlsite/female/doujin/new
http://localhost:3000/dlsite/female/doujin/sale
http://localhost:3000/dlsite/female/doujin/genre/dlsite:tl
http://localhost:3000/work/dlsite_doujin_RJ01100001
```

## 12. 本番デプロイ

Firestore rules / indexes:

```powershell
firebase deploy --only firestore
```

Functions:

```powershell
firebase deploy --only functions
```

本番でseedを使う場合は、`functions/.env` に `SEED_KEY` を設定してください。

```env
SEED_KEY=自分だけが知っている長い文字列
MANUAL_FETCH_KEY=自分だけが知っている長い文字列
```

再デプロイ:

```powershell
firebase deploy --only functions
```

本番seed:

```powershell
curl "https://asia-northeast1-YOUR_FIREBASE_PROJECT_ID.cloudfunctions.net/seedDummyProducts?key=YOUR_SEED_KEY"
```

手動バッチ実行:

```powershell
curl "https://asia-northeast1-YOUR_FIREBASE_PROJECT_ID.cloudfunctions.net/fetchDailyAllSourcesNow?key=YOUR_MANUAL_FETCH_KEY"
```

## 13. App Hosting

Firebase ConsoleでApp Hostingを作成します。

```text
Root directory: web
```

App Hosting側に以下の環境変数を設定してください。

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

## 14. バッチ構成

Scheduled Function:

```text
scheduledFetchDailyAllSources
```

毎日午前3時 Asia/Tokyo に実行されます。

手動実行用HTTPS Function:

```text
fetchDailyAllSourcesNow
```

ダミーデータ投入用HTTPS Function:

```text
seedDummyProducts
```

## 15. Adapter設計

現在有効:

```text
functions/src/adapters/dlsite/dlsiteFemaleDoujinAdapter.ts
```

将来追加用:

```text
functions/src/adapters/fanza/fanzaDummyAdapters.ts
```

FANZAを実装する場合は、以下を個別Adapterとして分離する想定です。

```text
fanzaVideoAdapter.ts
fanzaEbookAdapter.ts
fanzaDoujinAdapter.ts
```

## 16. 取得処理のガード方針

全Adapterで以下を守る前提です。

- ログイン不要の公開ページ/APIのみ対象
- CAPTCHA回避は禁止
- 429/403が返ったら即停止
- 取得間隔を空ける
- 画面表示時に外部サイトへ直接アクセスしない
- 画像ファイルは保存せず、外部画像URLのみFirestoreへ保存
- 商品説明文は必要最低限にする
- 失敗したsourceProductIdは `batchRuns.errorMessages` に記録する

## 17. 次に実装するTODO

### DLsite女性向け取得

```text
functions/src/adapters/dlsite/dlsiteFemaleDoujinAdapter.ts
```

実装対象:

```text
fetchRankingWorkIds
fetchProductDetail
```

### DLsite男性向け追加

```text
functions/src/adapters/dlsite/dlsiteMaleDoujinAdapter.ts
```

`getEnabledFetchTargets()` に追加します。

### FANZA追加

```text
functions/src/adapters/fanza/fanzaVideoAdapter.ts
functions/src/adapters/fanza/fanzaEbookAdapter.ts
functions/src/adapters/fanza/fanzaDoujinAdapter.ts
```

対応するURL:

```text
/fanza/adult/video
/fanza/adult/ebook
/fanza/adult/doujin
```

### 画面側の有効化

```text
web/lib/siteSegments.ts
```

対象セグメントの `enabled` を `true` にします。

## 18. 注意

この版はNode24前提です。Firebase CLIやFunctions runtime側で `nodejs24` が拒否される場合は、Firebase CLIを最新版へ更新してください。

```powershell
npm install -g firebase-tools@latest
```
