import { chromium } from "@playwright/test";
import { loadConfig, ensureOutputDir } from "./utils/config-loader.js";
import { FirebaseProvider } from "./providers/firebase.js";
import { SupabaseProvider } from "./providers/supabase.js";
import type { AuthProvider } from "./providers/base.js";
import type { AuthSetupOptions, PlaywrightAuthConfig } from "./types.js";
import * as path from "path";

// Re-export types for library consumers
export type {
  AuthSetupOptions,
  PlaywrightAuthConfig,
  ProviderType,
  TestUser,
  FirebaseConfig,
  SupabaseConfig,
  NextAuthConfig,
} from "./types.js";

export type { AuthProvider } from "./providers/base.js";
export { FirebaseProvider } from "./providers/firebase.js";
export { SupabaseProvider } from "./providers/supabase.js";

/**
 * Create an authentication provider based on configuration
 */
function createProvider(config: PlaywrightAuthConfig): AuthProvider {
  switch (config.provider) {
    case "firebase":
      if (!config.firebase) {
        throw new Error("Firebase configuration is required");
      }
      return new FirebaseProvider(
        config.firebase,
        config.testUser,
        config.nextAuth
      );

    case "supabase":
      if (!config.supabase) {
        throw new Error("Supabase configuration is required");
      }
      return new SupabaseProvider(config.supabase, config.testUser);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Main authentication setup function.
 *
 * This function:
 * 1. Loads configuration from the specified JSON file
 * 2. Launches a browser and creates a new page
 * 3. Executes authentication via the appropriate provider
 * 4. Saves the authentication state (cookies, localStorage, IndexedDB)
 *
 * @example
 * ```typescript
 * // In global-setup.ts or auth.setup.ts
 * import { authSetup } from 'playwright-nextjs-auth';
 *
 * export default async function globalSetup() {
 *   await authSetup({
 *     configPath: './playwright.env.json',
 *     outputDir: 'e2e/.auth',
 *     baseURL: 'http://localhost:3000'
 *   });
 * }
 * ```
 */
export async function authSetup(options: AuthSetupOptions): Promise<void> {
  const {
    configPath,
    outputDir = "e2e/.auth",
    baseURL,
    storageStateFile = "user.json",
  } = options;

  // 1. Load and validate configuration
  console.log(`[AuthSetup] Loading configuration from: ${configPath}`);
  const config = loadConfig(configPath);
  console.log(`[AuthSetup] Provider: ${config.provider}`);

  // 2. Ensure output directory exists
  ensureOutputDir(outputDir);
  const storageStatePath = path.join(outputDir, storageStateFile);

  // 3. Launch browser
  console.log("[AuthSetup] Launching browser...");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // 4. Create and execute provider
  const provider = createProvider(config);

  try {
    console.log(`[AuthSetup] Starting ${config.provider} authentication...`);
    await provider.signIn(page);

    // 5. Save storage state (including IndexedDB for Firebase)
    console.log(`[AuthSetup] Saving storage state to: ${storageStatePath}`);
    await context.storageState({
      path: storageStatePath,
      indexedDB: true, // Required for Firebase
    });

    console.log("[AuthSetup] Authentication setup complete!");
  } catch (error) {
    console.error("[AuthSetup] Authentication failed:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Create an auth provider instance for advanced use cases.
 *
 * Use this when you need more control over the authentication flow,
 * such as using a custom browser context or page.
 *
 * @example
 * ```typescript
 * import { createAuthProvider, loadConfig } from 'playwright-nextjs-auth';
 *
 * const config = loadConfig('./playwright.env.json');
 * const provider = createAuthProvider(config);
 *
 * // Use with your own page
 * await provider.signIn(myPage);
 * ```
 */
export function createAuthProvider(config: PlaywrightAuthConfig): AuthProvider {
  return createProvider(config);
}

// Also export loadConfig for advanced usage
export { loadConfig, ensureOutputDir } from "./utils/config-loader.js";
