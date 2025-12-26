# playwright-nextjs-auth

Universal authentication module for Playwright E2E tests with Firebase and Supabase support.

## Features

- **Firebase Authentication**: CDN injection strategy for seamless IndexedDB handling
- **Supabase Authentication**: REST API strategy with localStorage injection
- **NextAuth Integration**: Optional support for NextAuth credentials flow
- **TypeScript First**: Full type definitions included
- **Zero App Modifications**: No test backdoors required in your application

## Installation

```bash
npm install playwright-nextjs-auth
```

**Peer Dependencies**:
```bash
npm install -D @playwright/test
```

## Quick Start

### 1. Create Configuration File

Create `playwright.env.json` in your project root:

```json
{
  "provider": "firebase",
  "testUser": {
    "uid": "your-test-user-uid"
  },
  "firebase": {
    "serviceAccount": {
      "type": "service_account",
      "project_id": "your-project-id",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...",
      "client_email": "firebase-adminsdk@your-project.iam.gserviceaccount.com"
    },
    "clientConfig": {
      "apiKey": "your-api-key",
      "authDomain": "your-project.firebaseapp.com",
      "projectId": "your-project-id"
    }
  }
}
```

### 2. Setup Global Authentication

Create `e2e/global-setup.ts`:

```typescript
import { authSetup } from 'playwright-nextjs-auth';

export default async function globalSetup() {
  await authSetup({
    configPath: './playwright.env.json',
    outputDir: 'e2e/.auth',
    baseURL: 'http://localhost:3000'
  });
}
```

### 3. Configure Playwright

Update `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    storageState: 'e2e/.auth/user.json',
  },
});
```

### 4. Write Your Tests

```typescript
import { test, expect } from '@playwright/test';

test('authenticated user can access dashboard', async ({ page }) => {
  // Already authenticated via storageState
  await page.goto('/dashboard');
  await expect(page.locator('h1')).toContainText('Dashboard');
});
```

## Configuration

### Firebase

```json
{
  "provider": "firebase",
  "testUser": {
    "uid": "firebase-user-uid"
  },
  "firebase": {
    "serviceAccount": { /* Firebase Admin SDK service account JSON */ },
    "clientConfig": {
      "apiKey": "...",
      "authDomain": "...",
      "projectId": "..."
    }
  },
  "nextAuth": {
    "enabled": true,
    "callbackUrl": "/"
  }
}
```

### Supabase

```json
{
  "provider": "supabase",
  "testUser": {
    "email": "test@example.com",
    "password": "your-password"
  },
  "supabase": {
    "url": "https://your-project.supabase.co",
    "anonKey": "your-anon-key"
  }
}
```

## API Reference

### authSetup(options)

Main function to set up authentication.

```typescript
interface AuthSetupOptions {
  configPath: string;        // Path to playwright.env.json
  outputDir?: string;        // Output directory (default: "e2e/.auth")
  baseURL?: string;          // Application base URL
  storageStateFile?: string; // Output filename (default: "user.json")
}
```

### createAuthProvider(config)

Create a provider instance for advanced use cases.

```typescript
import { createAuthProvider, loadConfig } from 'playwright-nextjs-auth';

const config = loadConfig('./playwright.env.json');
const provider = createAuthProvider(config);

// Use with your own page
await provider.signIn(myPage);
```

### Exported Types

```typescript
import type {
  AuthSetupOptions,
  PlaywrightAuthConfig,
  ProviderType,
  TestUser,
  FirebaseConfig,
  SupabaseConfig,
  NextAuthConfig,
  AuthProvider,
} from 'playwright-nextjs-auth';
```

## How It Works

### Firebase (CDN Injection Strategy)

1. Generate custom token using Firebase Admin SDK (Node.js)
2. Inject Firebase SDK from CDN into the browser
3. Execute `signInWithCustomToken` in browser context
4. Firebase SDK writes auth state to IndexedDB
5. Save storage state including IndexedDB

This approach avoids conflicts with your app's bundled Firebase SDK.

### Supabase (API Strategy)

1. Authenticate via Supabase REST API (Node.js)
2. Inject session tokens into browser localStorage
3. Reload page to apply session
4. Save storage state

## Security

**Important**: Add these to `.gitignore`:

```gitignore
playwright.env.json
e2e/.auth/
```

For CI/CD, use environment variables or secrets management.

## Requirements

- Node.js 18+
- Playwright 1.51+ (for IndexedDB support in storageState)
- Firebase/Supabase project with test user

## License

MIT
