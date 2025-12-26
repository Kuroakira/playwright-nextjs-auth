import type { Page } from "@playwright/test";
import type { AuthProvider } from "./base.js";
import type { SupabaseConfig, TestUser } from "../types.js";

/**
 * Supabase Authentication Provider using API strategy.
 *
 * This provider:
 * 1. Authenticates via Supabase REST API (Node.js side)
 * 2. Injects session tokens into browser localStorage
 *
 * Unlike Firebase, Supabase doesn't require CDN injection because:
 * - Auth state is stored in localStorage (not IndexedDB)
 * - Token format is simple and well-documented
 * - No SDK initialization conflicts
 */
export class SupabaseProvider implements AuthProvider {
  private config: SupabaseConfig;
  private testUser: TestUser;

  constructor(config: SupabaseConfig, testUser: TestUser) {
    this.config = config;
    this.testUser = testUser;
  }

  /**
   * Authenticate via Supabase REST API
   */
  private async authenticateViaAPI(): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt: number;
    user: Record<string, unknown>;
  }> {
    const { email, password } = this.testUser;

    if (!email || !password) {
      throw new Error(
        "Supabase authentication requires testUser.email and testUser.password"
      );
    }

    const authUrl = `${this.config.url}/auth/v1/token?grant_type=password`;

    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.config.anonKey,
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Supabase authentication failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      expires_at: number;
      user: Record<string, unknown>;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: data.expires_at,
      user: data.user,
    };
  }

  /**
   * Extract project ref from Supabase URL
   * e.g., "https://xyz.supabase.co" -> "xyz"
   */
  private getProjectRef(): string {
    const url = new URL(this.config.url);
    const hostname = url.hostname;

    // Handle standard Supabase URLs (xyz.supabase.co)
    if (hostname.endsWith(".supabase.co")) {
      return hostname.replace(".supabase.co", "");
    }

    // Handle self-hosted or custom domains
    // Use full hostname as ref
    return hostname.replace(/\./g, "-");
  }

  /**
   * Inject Supabase session into browser localStorage
   */
  private async injectSession(
    page: Page,
    session: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      expiresAt: number;
      user: Record<string, unknown>;
    }
  ): Promise<void> {
    const projectRef = this.getProjectRef();
    const storageKey = `sb-${projectRef}-auth-token`;

    // Supabase stores session in this format
    const sessionData = {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.expiresIn,
      expires_at: session.expiresAt,
      token_type: "bearer",
      user: session.user,
    };

    await page.evaluate(
      ({ key, data }) => {
        localStorage.setItem(key, JSON.stringify(data));
        console.log("[SUPABASE] Session injected into localStorage:", key);
      },
      { key: storageKey, data: sessionData }
    );
  }

  /**
   * Main sign-in flow
   */
  async signIn(page: Page): Promise<void> {
    console.log("[Supabase] Starting authentication...");

    // 1. Authenticate via API
    console.log("[Supabase] Authenticating via REST API...");
    const session = await this.authenticateViaAPI();
    console.log("[Supabase] API authentication successful, user:", session.user.email);

    // 2. Setup browser console logging
    page.on("console", (msg) => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
    });

    // 3. Navigate to the app (required to set localStorage on correct origin)
    await page.goto("/", { waitUntil: "networkidle" });

    // 4. Inject session into localStorage
    console.log("[Supabase] Injecting session into browser...");
    await this.injectSession(page, session);

    // 5. Reload to apply session
    await page.reload({ waitUntil: "networkidle" });

    // 6. Verify localStorage state
    const projectRef = this.getProjectRef();
    const storageKey = `sb-${projectRef}-auth-token`;

    const storedSession = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, storageKey);

    if (!storedSession) {
      throw new Error("Supabase session was not persisted in localStorage");
    }

    console.log("[Supabase] Authentication complete");
  }
}
