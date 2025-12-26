import type { Page } from "@playwright/test";

// =============================================================================
// Provider Types
// =============================================================================

export type ProviderType = "firebase" | "supabase";

// =============================================================================
// Test User Configuration
// =============================================================================

export interface TestUser {
  /** User email address */
  email?: string;
  /** User password (for Supabase email/password auth) */
  password?: string;
  /** User UID (for Firebase custom token) */
  uid?: string;
}

// =============================================================================
// Firebase Configuration
// =============================================================================

export interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain?: string;
}

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export interface FirebaseConfig {
  serviceAccount: FirebaseServiceAccount;
  clientConfig: FirebaseClientConfig;
}

// =============================================================================
// Supabase Configuration
// =============================================================================

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// =============================================================================
// NextAuth Configuration (Optional)
// =============================================================================

export interface NextAuthConfig {
  /** Enable NextAuth credentials sign-in after Firebase auth */
  enabled: boolean;
  /** Callback URL after sign-in (default: "/") */
  callbackUrl?: string;
}

// =============================================================================
// Main Configuration
// =============================================================================

export interface PlaywrightAuthConfig {
  /** Authentication provider type */
  provider: ProviderType;

  /** Test user credentials */
  testUser: TestUser;

  /** Firebase-specific configuration */
  firebase?: FirebaseConfig;

  /** Supabase-specific configuration */
  supabase?: SupabaseConfig;

  /** NextAuth integration (optional) */
  nextAuth?: NextAuthConfig;
}

// =============================================================================
// Auth Setup Options
// =============================================================================

export interface AuthSetupOptions {
  /** Path to playwright.env.json configuration file */
  configPath: string;

  /** Output directory for storage state files (default: "e2e/.auth") */
  outputDir?: string;

  /** Base URL for the application */
  baseURL?: string;

  /** Storage state filename (default: "user.json") */
  storageStateFile?: string;
}

// =============================================================================
// Auth Provider Interface
// =============================================================================

/**
 * Interface that all authentication providers must implement.
 * Each provider handles its specific authentication flow.
 */
export interface AuthProvider {
  /**
   * Execute authentication and set auth state (Cookie/Storage) in the browser context.
   * Note: Storage state saving is handled by the caller, not within this method.
   *
   * @param page - Playwright Page instance
   * @returns Promise that resolves when authentication is complete
   */
  signIn(page: Page): Promise<void>;
}

// =============================================================================
// Sign-in Result (Internal)
// =============================================================================

export interface FirebaseSignInResult {
  success: boolean;
  uid?: string;
  email?: string | null;
  idToken?: string;
  refreshToken?: string;
  error?: string;
}

export interface NextAuthSignInResult {
  success: boolean;
  status?: number;
  error?: string;
}
