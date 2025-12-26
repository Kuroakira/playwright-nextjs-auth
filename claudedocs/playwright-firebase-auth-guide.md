# Playwright + Firebase Authentication E2E Testing Guide

Firebase 認証を使用したアプリケーションで、Playwright E2E テストを実行するための完全ガイド。

**最終更新**: 2025-12-26
**ステータス**: 動作確認済み

---

## 概要

### 課題

Firebase Authentication を使用したアプリでは、E2E テスト時に以下の課題がある：

1. **Google OAuth などの外部認証フロー**をテストで自動化するのは困難
2. **Firebase SDK はブラウザの IndexedDB** に認証状態を保存するため、単純な Cookie/localStorage 操作では認証できない
3. アプリコードに**テスト用のバックドア**を作りたくない（セキュリティリスク）
4. **IndexedDB 直接注入は Firebase SDK と競合**する（後述）

### 解決策: CDN Injection 方式

**CDN から Firebase SDK を読み込み、ブラウザ内で認証を実行**する方式を採用。

---

## 前提知識: Playwright の基本アーキテクチャ

この方式を理解するには、Playwright の基本的な動作を理解する必要がある。

### 2つの分離された環境

Playwright のテストでは、**2つの完全に分離されたプロセス**が動く：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   ┌─────────────────────────┐    ┌─────────────────────────┐   │
│   │                         │    │                         │   │
│   │   Node.js プロセス      │    │   ブラウザプロセス       │   │
│   │   (テストコード)        │    │   (Chrome など)         │   │
│   │                         │    │                         │   │
│   │   - auth.setup.ts       │    │   - アプリ (Next.js等)  │   │
│   │   - spec.ts ファイル    │    │   - DOM                 │   │
│   │   - npm パッケージ      │    │   - JavaScript          │   │
│   │   - firebase-admin      │    │   - IndexedDB           │   │
│   └───────────┬─────────────┘    └───────────┬─────────────┘   │
│               │                              │                  │
│               │      通信プロトコル          │                  │
│               └──────────────────────────────┘                  │
│                 (Chrome DevTools Protocol)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**重要**: この2つは**メモリを共有していない**。別のプロセスとして動作する。

### page.evaluate の仕組み

`page.evaluate` は Node.js からブラウザにコードを送って実行する仕組み：

```javascript
// Node.js 側のテストコード
const result = await page.evaluate(() => {
  // ← この関数の中身が「文字列として」ブラウザに送られる
  return document.title;
});
```

**内部動作**:

```
1. Node.js: 関数を文字列に変換
   "() => { return document.title; }"

2. Node.js → ブラウザ: 文字列を送信

3. ブラウザ: 受け取った文字列を eval して実行
   document.title → "My Page"

4. ブラウザ → Node.js: 結果を返す
```

### なぜ page.evaluate 内で import が使えないか

```javascript
// Node.js 側
import { getAuth } from "firebase/auth";  // ✅ Node.js では動く

await page.evaluate(() => {
  // ブラウザ側 - この関数は「文字列として」送られる
  import { getAuth } from "firebase/auth";  // ❌ エラー！

  // ブラウザには node_modules がない
  // "firebase/auth" がどこにあるか分からない
});
```

### 変数の受け渡し

Node.js の変数をブラウザに渡すには、引数として明示的に渡す：

```javascript
const token = "abc123";

// ❌ クロージャでは渡せない（別プロセスなので）
await page.evaluate(() => {
  console.log(token);  // ReferenceError: token is not defined
});

// ✅ 第2引数で明示的に渡す
await page.evaluate(
  ({ token }) => {
    console.log(token);  // "abc123"
  },
  { token }  // ← JSON シリアライズされてブラウザに送られる
);
```

### Setup Project と storageState

Playwright の Setup Project 機能を使うと、認証を一度だけ実行して再利用できる：

```
playwright.config.ts:
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "boards", dependencies: ["setup"], storageState: "user.json" }
  ]
```

**実行フロー**:

```
1. setup プロジェクト実行
   ├── auth.setup.ts が実行される
   ├── ブラウザを起動して認証処理
   └── storageState を user.json に保存
       ├── Cookie
       ├── localStorage
       └── IndexedDB (indexedDB: true の場合)

2. boards プロジェクト実行
   ├── 新しいブラウザを起動
   ├── user.json から状態を復元 ← 認証済み状態で開始！
   └── テストを実行
```

---

## なぜこの方式が必要か（問題の本質）

### 問題1: IndexedDB への外部書き込みは競合する

Firebase SDK は認証状態を IndexedDB に保存する。Playwright から直接 IndexedDB に書き込もうとすると：

```
時系列:

1. page.goto("/") でアプリを読み込む
   └── アプリの Firebase SDK が読み込まれる
   └── Firebase SDK が IndexedDB への接続を保持

2. page.evaluate で IndexedDB に書き込もうとする
   └── Firebase SDK が既に接続を持っている
   └── 競合発生！
       ├── トランザクションがブロックされる（30秒タイムアウト）
       ├── 書き込めても Firebase SDK が上書き/クリアする
       └── Firebase SDK は外部からの書き込みを「不正」と判断
```

**Firebase SDK は自分が書いたデータしか信用しない**。

### 問題2: アプリの Firebase SDK に直接アクセスできない

「じゃあアプリに読み込まれてる Firebase SDK を使えばいいのでは？」と思うかもしれないが、これもできない：

```javascript
// アプリのコード（src/lib/firebase.ts など）
import { getAuth } from 'firebase/auth';  // ← モジュールとしてバンドル
const auth = getAuth();                    // ← アプリ内部でのみ使用
```

```javascript
// Playwright の page.evaluate 内
await page.evaluate(() => {
  // アプリの Firebase SDK は存在するけど...
  getAuth();        // ❌ undefined - グローバルに公開されていない
  firebase.auth();  // ❌ undefined - window.firebase は存在しない

  // アプリはモジュールバンドラー（webpack）で全部まとめられている
  // 外部から個別のモジュールを呼び出す方法がない
});
```

### 解決策: CDN から Firebase SDK を追加で読み込む

```javascript
// 1. CDN から Firebase SDK を読み込む（<script> タグで追加）
await page.addScriptTag({
  url: "https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"
});
await page.addScriptTag({
  url: "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js"
});

// 2. これで window.firebase が使えるようになる
await page.evaluate(() => {
  window.firebase.initializeApp(config);
  window.firebase.auth().signInWithCustomToken(token);
  // ↑ Firebase SDK 自身が IndexedDB に書き込む → 競合なし！
});
```

### 図解

```
┌─────────────────────────────────────────────────────┐
│ ブラウザ (page.goto("/") 後)                         │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ Next.js アプリ (バンドル済み)               │     │
│  │                                             │     │
│  │  import { getAuth } from 'firebase/auth'   │     │
│  │  const auth = getAuth()                    │     │
│  │                                             │     │
│  │  ← 外から呼べない（モジュール内部）         │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  page.evaluate(() => { ??? })                       │
│  ← アプリの Firebase SDK にアクセスする方法がない    │
│                                                      │
└─────────────────────────────────────────────────────┘

                    ↓ addScriptTag で CDN から追加読み込み

┌─────────────────────────────────────────────────────┐
│ ブラウザ (addScriptTag 後)                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ Next.js アプリ (バンドル済み)               │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ CDN Firebase SDK (追加で読み込み)           │     │
│  │                                             │     │
│  │  window.firebase = { ... }  ← グローバル！  │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  page.evaluate(() => {                              │
│    window.firebase.auth().signIn...  ← 使える！     │
│  })                                                 │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### CDN Firebase SDK とは

**アプリの Firebase SDK と同じもの**。読み込み方法が違うだけ：

| 方式 | 読み込み方法 | アクセス方法 |
|------|-------------|-------------|
| アプリ | `npm install` → webpack でバンドル | `import { getAuth }` (内部のみ) |
| CDN | `<script>` タグで直接読み込み | `window.firebase` (グローバル) |

CDN 版は `window.firebase` としてグローバルに公開されるため、`page.evaluate` 内からアクセスできる。

### なぜこれで競合しないか

CDN から読み込んだ Firebase SDK も「正規の Firebase SDK」。この SDK が `signInWithCustomToken` を実行すると、**Firebase SDK 自身が IndexedDB に正しい形式で書き込む**。後からアプリの Firebase SDK が読み込んでも、有効なデータとして認識される。

```
❌ 外部注入: Playwright → IndexedDB ← Firebase SDK (競合!)

✅ CDN方式: Playwright → CDN Firebase SDK → IndexedDB
                                              ↑
                         Firebase SDK 自身が書き込むので競合なし
```

---

## 実装要件のまとめ

ここまでの内容を整理すると、以下の実装が必要：

### 制約から導かれる要件

| 制約 | 理由 | 必要な対応 |
|------|------|-----------|
| `page.evaluate` 内で `import` が使えない | Node.js とブラウザは別プロセス | CDN から Firebase SDK を読み込む |
| IndexedDB に外部から書き込めない | Firebase SDK が競合・上書きする | Firebase SDK 自身に認証を実行させる |
| アプリの Firebase SDK にアクセスできない | バンドラーで内部化されている | 別途 CDN から読み込む |
| 認証状態を次のテストで使いたい | テストごとにブラウザは新規起動 | `storageState` で保存・復元 |

### 実装の流れ

```
auth.setup.ts での処理フロー:

[Node.js 側]
1. Firebase Admin SDK でカスタムトークン生成
   └── createCustomToken(uid) を呼び出す

[ブラウザ側 - page.addScriptTag]
2. CDN から Firebase SDK を読み込み
   └── window.firebase が使えるようになる

[ブラウザ側 - page.evaluate]
3. Firebase 認証を実行
   └── signInWithCustomToken(token)
   └── Firebase SDK が IndexedDB に書き込む

[ブラウザ側 - page.evaluate]
4. (アプリ依存) NextAuth セッション作成
   └── /api/auth/callback/credentials を呼び出す
   └── Cookie が設定される

[Node.js 側]
5. 認証状態を保存
   └── context.storageState({ indexedDB: true })
   └── Cookie + IndexedDB がファイルに保存される
```

---

## 認証フローの全体像

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Firebase Admin    │     │      Browser        │     │      Browser        │
│   (Node.js)         │────▶│   (CDN SDK注入)     │────▶│   IndexedDB         │
│                     │     │                     │     │                     │
│ createCustomToken() │     │ signInWithCustom    │     │ Firebase SDK が     │
│                     │     │ Token()             │     │ 自ら書き込み        │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

1. Node.js 側で Firebase Admin SDK を使用してカスタムトークンを生成
2. ブラウザに CDN から Firebase SDK (compat版) を追加読み込み
3. ブラウザ内で `signInWithCustomToken` を実行
4. Firebase SDK が自ら IndexedDB に認証データを書き込む
5. （オプション）NextAuth など別の認証層がある場合は追加でセッション作成

### メリット

- **アプリコード変更不要**: 本番コードにテスト用コードを混入させない
- **セキュリティホールなし**: テスト専用エンドポイント不要
- **Firebase SDK との競合なし**: SDK 自身が IndexedDB に書き込む
- **CI/CD 対応**: 環境変数でクレデンシャルを管理

---

## 前提条件

### 必要なもの

1. **Firebase プロジェクト**
2. **テスト用ユーザー**: Firebase Authentication に登録済みのユーザー
3. **サービスアカウント**: Firebase Admin SDK 用の認証情報
4. **Firebase 設定情報**: API キー、Auth ドメイン、プロジェクト ID

### インストール

```bash
npm install -D @playwright/test
npm install -D firebase-admin
npx playwright install chromium
```

---

## セットアップ

### 1. ディレクトリ構成

```
project/
├── playwright.config.ts
├── playwright.env.json          # 環境変数（gitignore）
├── playwright.env.json.sample   # テンプレート
└── e2e/
    ├── .auth/
    │   └── user.json            # 認証状態保存（自動生成）
    └── tests/
        ├── auth.setup.ts        # 認証セットアップ
        └── boards/
            └── board-basic.spec.ts  # テストファイル
```

### 2. 環境変数ファイル

**playwright.env.json.sample**:

```json
{
  "TEST_UID": "",
  "SERVICE_ACCOUNT": {},
  "FIREBASE_API_KEY": "",
  "FIREBASE_AUTH_DOMAIN": "",
  "FIREBASE_PROJECT_ID": ""
}
```

**取得方法**:

| 項目 | 取得場所 |
|------|----------|
| TEST_UID | Firebase Console → Authentication → Users → UID列 |
| SERVICE_ACCOUNT | Firebase Console → プロジェクト設定 → サービスアカウント → 新しい秘密鍵の生成 |
| FIREBASE_API_KEY | Firebase Console → プロジェクト設定 → 全般 → ウェブ API キー |
| FIREBASE_AUTH_DOMAIN | Firebase Console → プロジェクト設定 → 全般 → 認証ドメイン (例: `project-id.firebaseapp.com`) |
| FIREBASE_PROJECT_ID | Firebase Console → プロジェクト設定 → 全般 → プロジェクト ID |

### 3. .gitignore に追加

```gitignore
playwright.env.json
e2e/.auth/
```

---

## 実装

### playwright.config.ts

```typescript
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { defineConfig, devices } from "@playwright/test";

// ESM 環境で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// playwright.env.json を読み込む
const envPath = path.join(__dirname, "playwright.env.json");
if (fs.existsSync(envPath)) {
  const env = JSON.parse(fs.readFileSync(envPath, "utf-8"));
  process.env.SERVICE_ACCOUNT = JSON.stringify(env.SERVICE_ACCOUNT);
  process.env.TEST_UID = env.TEST_UID;
  process.env.FIREBASE_API_KEY = env.FIREBASE_API_KEY;
  process.env.FIREBASE_AUTH_DOMAIN = env.FIREBASE_AUTH_DOMAIN;
  process.env.FIREBASE_PROJECT_ID = env.FIREBASE_PROJECT_ID;
}

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://lo.coten.dev:3050",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    // 認証セットアップ（一度だけ実行）
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    // 認証が必要なテスト
    {
      name: "boards",
      testMatch: /boards\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
```

### e2e/tests/auth.setup.ts

```typescript
import { test as setup } from "@playwright/test";
import admin from "firebase-admin";

// Firebase Admin SDK 初期化（一度だけ）
function initializeFirebaseAdmin() {
  if (admin.apps && admin.apps.length > 0) return;

  const serviceAccountStr = process.env.SERVICE_ACCOUNT;
  if (!serviceAccountStr) {
    throw new Error(
      "SERVICE_ACCOUNT environment variable is not set. " +
        "Please create playwright.env.json from playwright.env.json.sample",
    );
  }

  const serviceAccount = JSON.parse(serviceAccountStr);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

setup("authenticate", async ({ page, context }) => {
  const testUid = process.env.TEST_UID;
  if (!testUid) {
    throw new Error(
      "TEST_UID environment variable is not set. " +
        "Please create playwright.env.json from playwright.env.json.sample",
    );
  }

  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FIREBASE_API_KEY environment variable is not set. " +
        "Please create playwright.env.json from playwright.env.json.sample",
    );
  }

  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  if (!authDomain) {
    throw new Error(
      "FIREBASE_AUTH_DOMAIN environment variable is not set. " +
        "Please add it to playwright.env.json",
    );
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID environment variable is not set. " +
        "Please add it to playwright.env.json",
    );
  }

  initializeFirebaseAdmin();

  // 1. Admin SDK でカスタムトークン生成
  const customToken = await admin.auth().createCustomToken(testUid);
  console.log("Custom token generated for UID:", testUid);

  // 2. ブラウザコンソールログをキャプチャ
  page.on("console", (msg) => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
  });

  // 3. ページに移動
  await page.goto("/", { waitUntil: "networkidle" });

  // 4. CDN から Firebase SDK を注入
  console.log("Injecting Firebase SDK from CDN...");
  await page.addScriptTag({
    url: "https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js",
  });
  await page.addScriptTag({
    url: "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js",
  });

  // 5. ブラウザ内で signInWithCustomToken を実行し、ID Token を取得
  console.log("Executing signInWithCustomToken in browser...");
  const signInResult = await page.evaluate(
    async ({ token, config }) => {
      try {
        console.log("[AUTH] Initializing Firebase app...");
        // 既存のアプリがあるかチェック
        let app;
        if (window.firebase.apps && window.firebase.apps.length > 0) {
          // 既存のアプリを使用
          app = window.firebase.apps[0];
          console.log("[AUTH] Using existing Firebase app");
        } else {
          // 新しいアプリを初期化
          app = window.firebase.initializeApp(config);
          console.log("[AUTH] Initialized new Firebase app");
        }

        const auth = window.firebase.auth(app);
        console.log("[AUTH] Calling signInWithCustomToken...");
        const userCredential = await auth.signInWithCustomToken(token);
        console.log("[AUTH] Sign in successful:", userCredential.user.uid);

        // ID Token を取得
        const idToken = await userCredential.user.getIdToken();
        const refreshToken = userCredential.user.refreshToken;

        return {
          success: true,
          uid: userCredential.user.uid,
          email: userCredential.user.email,
          idToken,
          refreshToken,
        };
      } catch (error) {
        console.error("[AUTH] Sign in failed:", error);
        return {
          success: false,
          error: String(error),
        };
      }
    },
    {
      token: customToken,
      config: {
        apiKey,
        authDomain,
        projectId,
      },
    },
  );

  if (!signInResult.success) {
    throw new Error(`Firebase sign in failed: ${signInResult.error}`);
  }

  console.log("Firebase sign in successful:", signInResult.uid);

  // 6. NextAuth credentials サインインを実行（NextAuth を使用している場合）
  console.log("Executing NextAuth credentials sign in...");
  const nextAuthResult = await page.evaluate(
    async ({ idToken, refreshToken }) => {
      try {
        // CSRF トークンを取得
        const csrfResponse = await fetch("/api/auth/csrf");
        const csrfData = await csrfResponse.json();
        const csrfToken = csrfData.csrfToken;

        // NextAuth credentials サインイン
        const response = await fetch("/api/auth/callback/credentials", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            csrfToken,
            idToken,
            refreshToken,
            callbackUrl: "/",
            json: "true",
          }),
          redirect: "manual",
        });

        console.log("[NEXTAUTH] Response status:", response.status);

        return {
          success: response.status === 200 || response.status === 302,
          status: response.status,
        };
      } catch (error) {
        console.error("[NEXTAUTH] Sign in failed:", error);
        return {
          success: false,
          error: String(error),
        };
      }
    },
    {
      idToken: signInResult.idToken,
      refreshToken: signInResult.refreshToken,
    },
  );

  if (!nextAuthResult.success) {
    console.warn(
      "NextAuth sign in may have failed:",
      nextAuthResult.status || nextAuthResult.error,
    );
  } else {
    console.log("NextAuth sign in successful");
  }

  // 7. 認証状態が IndexedDB に保存されるのを待つ
  await page.waitForTimeout(2000);

  // 8. IndexedDB の状態を確認
  const indexedDBKeys = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const request = indexedDB.open("firebaseLocalStorageDb");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(["firebaseLocalStorage"], "readonly");
        const store = tx.objectStore("firebaseLocalStorage");
        const getAllKeysRequest = store.getAllKeys();
        getAllKeysRequest.onsuccess = () => {
          db.close();
          resolve(getAllKeysRequest.result);
        };
      };
      request.onerror = () => resolve([]);
    });
  });
  console.log("IndexedDB keys after sign in:", JSON.stringify(indexedDBKeys));

  // 9. ページをリロードして認証状態を確認
  await page.reload({ waitUntil: "networkidle" });

  // 10. 認証状態を保存（IndexedDB を含める）
  await context.storageState({
    path: "e2e/.auth/user.json",
    indexedDB: true,
  });

  console.log("Authentication state saved with IndexedDB");
});
```

### e2e/tests/boards/board-basic.spec.ts

```typescript
import { test, expect } from "@playwright/test";

test.describe("Board 基本動作", () => {
  test("Board 一覧ページが表示される", async ({ page }) => {
    await page.goto("/boards");

    // ページURLが /boards であることを確認
    await expect(page).toHaveURL(/\/boards/);
  });

  test("認証済みで新規作成ボタンが表示される", async ({ page }) => {
    await page.goto("/boards");

    // 「歴史ボード」ヘッダーが表示されることを確認（認証済みの証拠）
    await expect(page.locator("h1")).toContainText("歴史ボード", {
      timeout: 10000,
    });

    // 「新規作成」ボタンが表示されることを確認（複数ある場合は最初のもの）
    const createButton = page.getByRole("button", { name: "新規作成" }).first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });
});
```

---

## 仕組みの詳細

### 認証フロー

```
┌────────────────────────────────────────────────────────────────────┐
│                         Node.js 環境                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────┐    createCustomToken(uid)                    │
│  │ Firebase Admin  │ ─────────────────────────────┐               │
│  │ SDK             │                              │               │
│  └─────────────────┘                              ▼               │
│                                          ┌─────────────────┐      │
│                                          │ Custom Token    │      │
│                                          │ (有効期限: 1時間) │      │
│                                          └────────┬────────┘      │
└───────────────────────────────────────────────────┼────────────────┘
                                                    │
                                                    │ page.evaluate に渡す
                                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│                         ブラウザ環境                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. CDN から Firebase SDK (compat) を注入                     │  │
│  │    - firebase-app-compat.js                                  │  │
│  │    - firebase-auth-compat.js                                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 2. page.evaluate で signInWithCustomToken 実行               │  │
│  │                                                               │  │
│  │    window.firebase.initializeApp(config)                     │  │
│  │    window.firebase.auth().signInWithCustomToken(token)       │  │
│  │                                                               │  │
│  │         ▼                                                     │  │
│  │    Firebase SDK が自動的に IndexedDB に書き込み               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 3. (オプション) NextAuth credentials サインイン              │  │
│  │                                                               │  │
│  │    fetch("/api/auth/callback/credentials", {                 │  │
│  │      idToken,                                                 │  │
│  │      refreshToken                                             │  │
│  │    })                                                         │  │
│  │                                                               │  │
│  │         ▼                                                     │  │
│  │    NextAuth セッション Cookie が設定される                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 4. context.storageState() で保存                             │  │
│  │    - Cookie                                                   │  │
│  │    - localStorage                                             │  │
│  │    - IndexedDB (indexedDB: true オプション)                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Playwright の IndexedDB 保存機能

Playwright v1.51+ では `storageState` に `indexedDB: true` オプションを指定することで、IndexedDB のデータも保存・復元できる：

```typescript
// 保存
await context.storageState({
  path: "e2e/.auth/user.json",
  indexedDB: true,
});

// 復元（playwright.config.ts で指定）
use: {
  storageState: "e2e/.auth/user.json",
}
```

### CDN compat vs モジュラー SDK

| 形式 | 読み込み方法 | 使用方法 |
|------|--------------|----------|
| compat | `<script>` タグ (CDN) | `window.firebase.auth()` |
| モジュラー | `import` 文 | `import { getAuth } from 'firebase/auth'` |

`page.evaluate` 内では ES モジュールを `import` できないため、CDN からの compat 版を使用する。

---

## 二重認証アーキテクチャ (NextAuth + Firebase)

アプリが NextAuth と Firebase SDK の両方を使用している場合、両方の認証が必要：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    二重認証アーキテクチャ                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  レイヤー1: NextAuth (サーバーサイド)                          │ │
│  │  - JWT Cookie でセッション管理                                 │ │
│  │  - API ルートの認証チェック                                    │ │
│  │  - GraphQL クライアントの認証ヘッダー                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  レイヤー2: Firebase SDK (クライアントサイド)                  │ │
│  │  - IndexedDB で認証状態管理                                    │ │
│  │  - onAuthStateChanged でユーザー状態監視                       │ │
│  │  - RouteProvider での表示制御                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  重要: 両方の認証が必要                                            │
│  - NextAuth Cookie だけでは不十分（Firebase SDK が認識しない）     │
│  - IndexedDB だけでも不十分（API 呼び出しに認証ヘッダーが必要）    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## トラブルシューティング

### よくあるエラー

#### 1. `Cannot read properties of undefined (reading 'length')`

```
TypeError: Cannot read properties of undefined (reading 'length')
  at admin.apps.length
```

**原因**: firebase-admin の ESM インポート問題

**解決策**:
```typescript
// NG
import * as admin from "firebase-admin";

// OK
import admin from "firebase-admin";
```

#### 2. IndexedDB に書き込んだが認証されない

**原因**: Firebase SDK との競合。外部から IndexedDB に書き込んでも、Firebase SDK が上書きまたはクリアする。

**解決策**: CDN injection 方式を使用し、Firebase SDK 自身に書き込ませる（本ガイドの実装）

#### 3. Firebase 認証は成功したが API 呼び出しが失敗

**原因**: NextAuth セッションが必要なアプリで、NextAuth サインインを実行していない

**解決策**: auth.setup.ts で NextAuth credentials サインインも実行する（ステップ6参照）

#### 4. `Failed to resolve module specifier 'firebase/auth'`

**原因**: `page.evaluate` 内で ES モジュールを動的インポートしようとした

**解決策**: CDN から compat 版を使用し、`window.firebase` グローバルを使用する

#### 5. `Strict mode violation: resolved to 2 elements`

**原因**: Playwright のセレクタが複数の要素にマッチした

**解決策**: `.first()`, `.nth(n)` で特定の要素を選択

```typescript
// NG
const button = page.getByRole("button", { name: "新規作成" });

// OK
const button = page.getByRole("button", { name: "新規作成" }).first();
```

---

## テスト実行

```bash
# 全テスト実行
npx playwright test

# セットアップとボードテストのみ
npx playwright test --project=setup --project=boards

# 特定のテストファイル
npx playwright test board-basic.spec.ts

# UI モードで実行
npx playwright test --ui

# デバッグモード
npx playwright test --debug
```

---

## CI/CD 設定例

### GitHub Actions

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npx playwright test
        env:
          SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          TEST_UID: ${{ secrets.FIREBASE_TEST_UID }}
          FIREBASE_API_KEY: ${{ secrets.FIREBASE_API_KEY }}
          FIREBASE_AUTH_DOMAIN: ${{ secrets.FIREBASE_AUTH_DOMAIN }}
          FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
          BASE_URL: ${{ secrets.BASE_URL }}

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

**GitHub Secrets に設定**:
- `FIREBASE_SERVICE_ACCOUNT`: サービスアカウント JSON（1行に整形）
- `FIREBASE_TEST_UID`: テストユーザーの UID
- `FIREBASE_API_KEY`: Firebase Web API キー
- `FIREBASE_AUTH_DOMAIN`: Firebase 認証ドメイン
- `FIREBASE_PROJECT_ID`: Firebase プロジェクト ID
- `BASE_URL`: テスト対象の URL

---

## 参考リンク

- [Playwright Authentication](https://playwright.dev/docs/auth)
- [Playwright Storage State with IndexedDB](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Firebase Auth Custom Token](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [playwright-firebase plugin](https://github.com/nicnocquee/playwright-firebase) - 参考にした実装

---

## 変更履歴

| 日付 | 変更内容 |
|------|----------|
| 2025-12-26 | CDN injection 方式に変更、NextAuth 対応追加、動作確認済み |
| 2025-12-25 | 初版作成（addInitScript 方式、動作せず） |

---

## ライセンス

MIT
