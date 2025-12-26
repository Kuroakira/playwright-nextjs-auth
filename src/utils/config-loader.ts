import * as fs from "fs";
import * as path from "path";
import type { PlaywrightAuthConfig } from "../types.js";

/**
 * Load and validate configuration from a JSON file
 */
export function loadConfig(configPath: string): PlaywrightAuthConfig {
  // Resolve absolute path
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  // Check file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Configuration file not found: ${absolutePath}\n` +
        `Please create the file from playwright.env.json.sample`
    );
  }

  // Read and parse
  const content = fs.readFileSync(absolutePath, "utf-8");
  let config: PlaywrightAuthConfig;

  try {
    config = JSON.parse(content);
  } catch {
    throw new Error(
      `Failed to parse configuration file: ${absolutePath}\n` +
        `Please ensure the file contains valid JSON`
    );
  }

  // Validate required fields
  validateConfig(config);

  return config;
}

/**
 * Validate configuration structure
 */
function validateConfig(config: PlaywrightAuthConfig): void {
  // Provider type
  if (!config.provider) {
    throw new Error('Configuration must specify "provider" field');
  }

  if (!["firebase", "supabase"].includes(config.provider)) {
    throw new Error(
      `Unknown provider: ${config.provider}. Supported: firebase, supabase`
    );
  }

  // Test user
  if (!config.testUser) {
    throw new Error('Configuration must specify "testUser" field');
  }

  // Provider-specific validation
  if (config.provider === "firebase") {
    validateFirebaseConfig(config);
  } else if (config.provider === "supabase") {
    validateSupabaseConfig(config);
  }
}

/**
 * Validate Firebase-specific configuration
 */
function validateFirebaseConfig(config: PlaywrightAuthConfig): void {
  if (!config.firebase) {
    throw new Error('Firebase provider requires "firebase" configuration');
  }

  if (!config.firebase.serviceAccount) {
    throw new Error('Firebase configuration requires "serviceAccount"');
  }

  if (!config.firebase.clientConfig) {
    throw new Error('Firebase configuration requires "clientConfig"');
  }

  const { clientConfig } = config.firebase;
  const requiredClientFields = ["apiKey", "authDomain", "projectId"];

  for (const field of requiredClientFields) {
    if (!(field in clientConfig)) {
      throw new Error(`Firebase clientConfig requires "${field}"`);
    }
  }

  // Test user needs UID for custom token
  if (!config.testUser.uid) {
    throw new Error('Firebase authentication requires "testUser.uid"');
  }
}

/**
 * Validate Supabase-specific configuration
 */
function validateSupabaseConfig(config: PlaywrightAuthConfig): void {
  if (!config.supabase) {
    throw new Error('Supabase provider requires "supabase" configuration');
  }

  if (!config.supabase.url) {
    throw new Error('Supabase configuration requires "url"');
  }

  if (!config.supabase.anonKey) {
    throw new Error('Supabase configuration requires "anonKey"');
  }

  // Test user needs email and password
  if (!config.testUser.email || !config.testUser.password) {
    throw new Error(
      'Supabase authentication requires "testUser.email" and "testUser.password"'
    );
  }
}

/**
 * Ensure output directory exists
 */
export function ensureOutputDir(outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}
