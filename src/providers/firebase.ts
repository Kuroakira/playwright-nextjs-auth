import type { Page } from "@playwright/test";
import admin from "firebase-admin";
import type { AuthProvider } from "./base.js";
import type {
  FirebaseConfig,
  TestUser,
  NextAuthConfig,
  FirebaseSignInResult,
  NextAuthSignInResult,
} from "../types.js";

// Firebase CDN URLs
const FIREBASE_CDN_BASE = "https://www.gstatic.com/firebasejs/10.7.0";
const FIREBASE_APP_COMPAT = `${FIREBASE_CDN_BASE}/firebase-app-compat.js`;
const FIREBASE_AUTH_COMPAT = `${FIREBASE_CDN_BASE}/firebase-auth-compat.js`;

/**
 * Firebase Authentication Provider using CDN Injection strategy.
 *
 * This provider:
 * 1. Generates a custom token using Firebase Admin SDK (Node.js side)
 * 2. Injects Firebase SDK from CDN into the browser
 * 3. Executes signInWithCustomToken in the browser context
 * 4. Optionally handles NextAuth credentials sign-in
 *
 * The CDN injection approach avoids IndexedDB conflicts with the app's
 * bundled Firebase SDK by using the Firebase SDK itself to write auth state.
 */
export class FirebaseProvider implements AuthProvider {
  private config: FirebaseConfig;
  private testUser: TestUser;
  private nextAuth?: NextAuthConfig;

  constructor(
    config: FirebaseConfig,
    testUser: TestUser,
    nextAuth?: NextAuthConfig
  ) {
    this.config = config;
    this.testUser = testUser;
    this.nextAuth = nextAuth;
  }

  /**
   * Initialize Firebase Admin SDK (singleton pattern)
   */
  private initializeAdmin(): void {
    if (admin.apps && admin.apps.length > 0) {
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert(
        this.config.serviceAccount as admin.ServiceAccount
      ),
    });
  }

  /**
   * Inject Firebase SDK scripts from CDN into the page
   */
  private async injectCDNScripts(page: Page): Promise<void> {
    console.log("[Firebase] Injecting Firebase SDK from CDN...");

    await page.addScriptTag({ url: FIREBASE_APP_COMPAT });
    await page.addScriptTag({ url: FIREBASE_AUTH_COMPAT });

    console.log("[Firebase] SDK injection complete");
  }

  /**
   * Execute signInWithCustomToken in the browser context
   */
  private async executeSignIn(
    page: Page,
    customToken: string
  ): Promise<FirebaseSignInResult> {
    const clientConfig = this.config.clientConfig;

    return await page.evaluate(
      async ({ token, config }) => {
        try {
          console.log("[AUTH] Initializing Firebase app...");

          // Check for existing app
          let app;
          // @ts-expect-error - window.firebase is injected via CDN
          if (window.firebase.apps && window.firebase.apps.length > 0) {
            // @ts-expect-error - window.firebase is injected via CDN
            app = window.firebase.apps[0];
            console.log("[AUTH] Using existing Firebase app");
          } else {
            // @ts-expect-error - window.firebase is injected via CDN
            app = window.firebase.initializeApp(config);
            console.log("[AUTH] Initialized new Firebase app");
          }

          // @ts-expect-error - window.firebase is injected via CDN
          const auth = window.firebase.auth(app);
          console.log("[AUTH] Calling signInWithCustomToken...");

          const userCredential = await auth.signInWithCustomToken(token);
          console.log("[AUTH] Sign in successful:", userCredential.user.uid);

          // Get tokens for NextAuth integration
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
      { token: customToken, config: clientConfig }
    );
  }

  /**
   * Execute NextAuth credentials sign-in (optional)
   */
  private async executeNextAuthSignIn(
    page: Page,
    idToken: string,
    refreshToken: string
  ): Promise<NextAuthSignInResult> {
    const callbackUrl = this.nextAuth?.callbackUrl ?? "/";

    return await page.evaluate(
      async ({ idToken, refreshToken, callbackUrl }) => {
        try {
          // Get CSRF token
          const csrfResponse = await fetch("/api/auth/csrf");
          const csrfData = (await csrfResponse.json()) as { csrfToken: string };
          const csrfToken = csrfData.csrfToken;

          // NextAuth credentials sign-in
          const response = await fetch("/api/auth/callback/credentials", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              csrfToken,
              idToken,
              refreshToken,
              callbackUrl,
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
      { idToken, refreshToken, callbackUrl }
    );
  }

  /**
   * Main sign-in flow
   */
  async signIn(page: Page): Promise<void> {
    const uid = this.testUser.uid;
    if (!uid) {
      throw new Error(
        "Firebase authentication requires testUser.uid to be set"
      );
    }

    // 1. Initialize Admin SDK and generate custom token
    this.initializeAdmin();
    const customToken = await admin.auth().createCustomToken(uid);
    console.log("[Firebase] Custom token generated for UID:", uid);

    // 2. Setup browser console logging
    page.on("console", (msg) => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
    });

    // 3. Navigate to the app (required for CDN injection)
    await page.goto("/", { waitUntil: "networkidle" });

    // 4. Inject Firebase SDK from CDN
    await this.injectCDNScripts(page);

    // 5. Execute signInWithCustomToken
    console.log("[Firebase] Executing signInWithCustomToken in browser...");
    const signInResult = await this.executeSignIn(page, customToken);

    if (!signInResult.success) {
      throw new Error(`Firebase sign in failed: ${signInResult.error}`);
    }
    console.log("[Firebase] Sign in successful:", signInResult.uid);

    // 6. NextAuth integration (optional)
    if (this.nextAuth?.enabled && signInResult.idToken && signInResult.refreshToken) {
      console.log("[Firebase] Executing NextAuth credentials sign in...");
      const nextAuthResult = await this.executeNextAuthSignIn(
        page,
        signInResult.idToken,
        signInResult.refreshToken
      );

      if (!nextAuthResult.success) {
        console.warn(
          "[Firebase] NextAuth sign in may have failed:",
          nextAuthResult.status || nextAuthResult.error
        );
      } else {
        console.log("[Firebase] NextAuth sign in successful");
      }
    }

    // 7. Wait for IndexedDB persistence
    await page.waitForTimeout(2000);

    // 8. Verify IndexedDB state
    const indexedDBKeys = await page.evaluate(async () => {
      return new Promise<string[]>((resolve) => {
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
            resolve(getAllKeysRequest.result as string[]);
          };
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log("[Firebase] IndexedDB keys:", JSON.stringify(indexedDBKeys));

    // 9. Reload to verify auth state persists
    await page.reload({ waitUntil: "networkidle" });
    console.log("[Firebase] Authentication complete");
  }
}
