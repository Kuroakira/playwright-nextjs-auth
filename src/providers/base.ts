import type { Page } from "@playwright/test";

/**
 * Base interface for all authentication providers.
 *
 * Each provider implements its specific authentication strategy:
 * - Firebase: CDN injection + signInWithCustomToken
 * - Supabase: API call + localStorage injection
 *
 * The provider is responsible for:
 * 1. Executing the authentication flow
 * 2. Setting auth state (Cookie/IndexedDB/localStorage) in the browser
 *
 * The caller is responsible for:
 * 1. Saving the storage state via context.storageState()
 */
export interface AuthProvider {
  /**
   * Execute authentication and set auth state in the browser context.
   *
   * @param page - Playwright Page instance with an active browser context
   * @throws Error if authentication fails
   */
  signIn(page: Page): Promise<void>;
}
