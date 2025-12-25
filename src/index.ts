/**
 * playwright-auth-injector
 *
 * Skip authentication UI in Playwright E2E tests by injecting auth state directly
 */

import type { Page } from '@playwright/test';
import type {
  AuthConfig,
  FirebaseConfig,
  SupabaseConfig,
  InjectAuthOptions,
  Provider,
} from './types.js';
import { loadConfig } from './config.js';
import { injectFirebaseAuth } from './firebase.js';
import { ConfigInvalidError } from './errors.js';

/** Provider handler function type */
type ProviderHandler = (
  page: Page,
  config: FirebaseConfig | SupabaseConfig,
  options: { debug?: boolean; waitAfter?: number }
) => Promise<void>;

/** Provider registry */
const providers: Record<Provider, ProviderHandler> = {
  firebase: injectFirebaseAuth as ProviderHandler,
  supabase: async () => {
    throw new ConfigInvalidError(
      'Supabase is not yet implemented. Please use Firebase.',
      'provider'
    );
  },
};

// Re-export types
export type {
  AuthConfig,
  FirebaseConfig,
  SupabaseConfig,
  InjectAuthOptions,
  Provider,
  ProfileOverride,
} from './types.js';

// Re-export errors
export {
  AuthError,
  AuthErrorCode,
  ConfigNotFoundError,
  ConfigInvalidError,
  AuthenticationError,
  TokenExchangeError,
  InjectionError,
} from './errors.js';

/**
 * Type-safe config helper
 *
 * @example
 * ```typescript
 * // playwright-auth.config.ts
 * import { defineConfig } from 'playwright-auth-injector';
 *
 * export default defineConfig({
 *   provider: 'firebase',
 *   firebase: {
 *     serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT!,
 *     apiKey: process.env.FIREBASE_API_KEY!,
 *     uid: process.env.TEST_USER_UID!,
 *   },
 * });
 * ```
 */
export function defineConfig(config: AuthConfig): AuthConfig {
  return config;
}

/**
 * Inject authentication state into the browser
 *
 * @param page - Playwright Page object
 * @param options - Optional settings
 * @throws AuthError - When authentication fails
 *
 * @example
 * ```typescript
 * // e2e/tests/auth.setup.ts
 * import { test as setup } from '@playwright/test';
 * import { injectAuth } from 'playwright-auth-injector';
 *
 * setup('authenticate', async ({ page }) => {
 *   await injectAuth(page);
 *   await page.context().storageState({ path: 'e2e/.auth/user.json' });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With profile
 * await injectAuth(page, { profile: 'admin' });
 * ```
 */
export async function injectAuth(
  page: Page,
  options: InjectAuthOptions = {}
): Promise<void> {
  const config = await loadConfig();

  // Get handler for the specified provider
  const handler = providers[config.provider];
  if (!handler) {
    throw new ConfigInvalidError(
      `Unsupported provider: ${config.provider}`,
      'provider'
    );
  }

  // Get provider-specific config
  const providerConfig = config[config.provider];
  if (!providerConfig) {
    throw new ConfigInvalidError(
      `${config.provider} config is required`,
      config.provider
    );
  }

  // Apply profile override only to the active provider
  const effectiveConfig =
    options.profile && config.profiles?.[options.profile]
      ? { ...providerConfig, ...config.profiles[options.profile] }
      : providerConfig;

  await handler(page, effectiveConfig, {
    debug: config.debug,
    waitAfter: options.waitAfter,
  });
}
