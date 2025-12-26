ありがとうございます。要件が非常に明確になりました。

**「Interfaceは統一、実装は個別最適（Strategy Pattern）」**、そして**「設定ファイル（playwright.env.json）中心のDX」**という方針で設計します。

達人級の設計として、単なる機能実装だけでなく、**「ユーザーが迷わない型定義」**と**「拡張性（Open-Closed Principle）」**を意識した設計書を作成しました。

---

#Playwright Universal Auth Module 設計書**バージョン**: 1.0.0
**対象**: Firebase (v1), Supabase (v1)
**パターン**: Strategy Pattern / Factory Pattern

##1. コンセプトユーザー（開発者）は、**「どのプロバイダーを使うか」**と**「認証情報（JSON）」**を指定するだけです。
バックグラウンドの複雑な処理（FirebaseのCDN注入や、SupabaseのAPIコールの違い）は、統一されたインターフェースの裏側に隠蔽されます。

###目指す開発者体験 (DX)ユーザーが書くセットアップコードはこれだけです：

```typescript
// tests/global.setup.ts
import { authSetup } from 'playwright-nextjs-auth';

export default async function globalSetup(config: FullConfig) {
  // 環境変数とプロバイダーを指定して実行するだけ
  await authSetup({
    provider: 'firebase', // or 'supabase'
    configPath: './playwright.env.json',
    outputDir: 'e2e/.auth'
  });
}

```

---

##2. アーキテクチャ概要認証ロジックをプロバイダーごとに分離し、共通インターフェース `AuthProvider` を実装させます。

###クラス図```mermaid
classDiagram
    class AuthProvider {
        <<interface>>
        +signIn(page: Page): Promise<void>
    }

    class FirebaseProvider {
        -config: FirebaseConfig
        +signIn(page: Page): Promise<void>
        -injectCDNScripts(page: Page): Promise<void>
    }

    class SupabaseProvider {
        -config: SupabaseConfig
        +signIn(page: Page): Promise<void>
        -fetchSessionViaAPI(): Promise<Session>
    }

    class AuthFactory {
        +create(type: ProviderType, env: EnvConfig): AuthProvider
    }

    FirebaseProvider ..|> AuthProvider
    SupabaseProvider ..|> AuthProvider
    AuthFactory ..> AuthProvider : creates

```

---

##3. インターフェース定義すべての認証プロバイダーは、この契約に従います。

```typescript
/**
 * 全ての認証プロバイダーが実装すべきインターフェース
 */
export interface AuthProvider {
  /**
   * 認証を実行し、ブラウザコンテキスト(Page)に認証状態(Cookie/Storage)をセットする
   * ※ 保存処理(storageState)はこのメソッド内ではなく、呼び出し元が行う
   */
  signIn(page: Page): Promise<void>;
}

```

---

##4. プロバイダー実装詳細###A. Firebase Provider (Legacy/CDN Strategy)前回検証済みの「CDN注入方式」をカプセル化します。

* **入力**: `SERVICE_ACCOUNT` (JSON), `FIREBASE_CONFIG` (API Key等)
* **戦略**:
1. Node.js側でAdmin SDKを使いCustom Tokenを生成。
2. Playwrightの `page` にCDN版SDK (`firebase-app-compat`, `auth-compat`) を `<script>` タグで注入。
3. `page.evaluate` 内で `signInWithCustomToken` を実行。
4. Firebase SDK自体にIndexedDBへの書き込みを行わせる。



###B. Supabase Provider (API Strategy)CDN注入は不要です。REST APIまたはSupabase JS Client (Node.js版) を使用して高速に処理します。

* **入力**: `SUPABASE_URL`, `SUPABASE_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`
* **戦略**:
1. Node.js側で `supabase.auth.signInWithPassword()` を実行。
2. `access_token`, `refresh_token` を取得。
3. Playwrightの `page.context().addInitScript()` または `page.evaluate()` を使い、ブラウザの `localStorage` にSupabase形式のトークン（`sb-<project-ref>-auth-token`）を書き込む。
4. 必要であればCookieもセットする。



---

##5. 設定ファイル (playwright.env.json) のスキーマユーザーには以下のJSONを作成・管理させます（`.gitignore` 推奨）。

```json
{
  "provider": "firebase", // または "supabase"

  // 共通項目
  "testUser": {
    "email": "test@example.com",
    "password": "password123", // Supabase用
    "uid": "test-user-uid"     // Firebase Custom Token用
  },

  // Firebase固有設定
  "firebase": {
    "serviceAccount": { ... }, // admin sdk json
    "clientConfig": {
      "apiKey": "...",
      "authDomain": "...",
      "projectId": "..."
    }
  },

  // Supabase固有設定
  "supabase": {
    "url": "https://xyz.supabase.co",
    "anonKey": "public-anon-key"
  }
}

```

---

##6. 実装イメージ（Core Logic）ライブラリ内部のメインロジックです。

```typescript
// src/index.ts (イメージ)

import { chromium } from '@playwright/test';
import { FirebaseProvider } from './providers/firebase';
import { SupabaseProvider } from './providers/supabase';
import fs from 'fs';

export async function authSetup(options: AuthSetupOptions) {
  // 1. 設定ファイルの読み込み
  const config = JSON.parse(fs.readFileSync(options.configPath, 'utf-8'));

  // 2. ブラウザ起動 (Global Setupなのでここで起動)
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 3. プロバイダーの選択と実行 (Factory Logic)
  let provider: AuthProvider;

  switch (config.provider) {
    case 'firebase':
      provider = new FirebaseProvider(config.firebase, config.testUser);
      break;
    case 'supabase':
      provider = new SupabaseProvider(config.supabase, config.testUser);
      break;
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }

  try {
    console.log(`Starting authentication for ${config.provider}...`);

    // ★ ここで各プロバイダー固有の処理が走る
    await provider.signIn(page);

    // 4. 状態の保存 (共通処理)
    // プロバイダーが適切にCookie/Storageをセットしていれば、これで保存される
    await page.context().storageState({
      path: `${options.outputDir}/user.json`,
      indexedDB: true // Firebaseのために必須
    });

    console.log('Authentication successful. State saved.');

  } catch (e) {
    console.error('Authentication failed:', e);
    throw e;
  } finally {
    await browser.close();
  }
}

```

---

##7. ディレクトリ構成モジュールとしての構成案です。

```
playwright-nextjs/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # エントリーポイント (authSetup関数)
│   ├── types.ts           # 型定義 (Config, Interface)
│   ├── utils/
│   │   └── env-loader.ts  # JSON読み込みなどのユーティリティ
│   └── providers/
│       ├── base.ts        # AuthProvider Interface
│       ├── firebase.ts    # Firebase実装 (CDN Injection)
│       └── supabase.ts    # Supabase実装 (API Call)
└── README.md              # ユーザーマニュアル

```

---

##8. 今後の拡張性（Roadmap）この設計であれば、将来的に以下の拡張が容易です。

1. **Auth0 / Cognito 対応**:
* `providers/auth0.ts` を追加し、M2Mトークン取得フローなどを実装するだけで対応可能。メインロジック（`index.ts`）の変更は最小限で済む。


2. **Multi-User 対応**:
* `playwright.env.json` の `testUser` を配列にし、ループで回して `user-admin.json`, `user-general.json` のように複数のStateファイルを生成する機能。


3. **MFA 対応**:
* インターフェースに `verifyMfa()` を追加するか検討（今回はスコープ外）。



---

###次のアクションこの設計書で合意いただければ、まずは**コアとなるディレクトリ構造と、Interface定義、そしてFirebaseの実装（既存コードの移設とリファクタリング）**のコーディングに入ります。いかがでしょうか？
