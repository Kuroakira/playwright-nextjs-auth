# playwright-nextjs-auth Implementation Roadmap

**Created**: 2024-12-27
**Status**: Phase 1 Complete

---

## Current State (v0.1.0)

### Implemented Features

| Feature | Status | Description |
|---------|--------|-------------|
| Firebase Provider | ✅ | CDN Injection + signInWithCustomToken |
| Supabase Provider | ✅ | REST API + localStorage injection |
| Config Loader | ✅ | JSON file loading with validation |
| Type Definitions | ✅ | Full TypeScript support |
| Build System | ✅ | ESM output with declaration files |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Entry Point                               │
│                        (index.ts)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   authSetup(options)                                            │
│       │                                                          │
│       ├── loadConfig(configPath)                                │
│       │       └── config-loader.ts (validation)                 │
│       │                                                          │
│       ├── createProvider(config)                                │
│       │       ├── FirebaseProvider (CDN Injection)              │
│       │       └── SupabaseProvider (API Call)                   │
│       │                                                          │
│       └── provider.signIn(page)                                 │
│               └── context.storageState() (save)                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure (Current)

```
playwright-nextjs-auth/
├── package.json
├── tsconfig.json
├── playwright.env.json.sample
├── .gitignore
├── claudedocs/
│   ├── playwright-firebase-auth-guide.md   # Technical reference
│   ├── gemini_design.md                    # Original design spec
│   └── implementation-roadmap.md           # This file
├── src/
│   ├── index.ts              # Entry point, authSetup function
│   ├── types.ts              # Type definitions
│   ├── providers/
│   │   ├── base.ts           # AuthProvider interface
│   │   ├── firebase.ts       # Firebase CDN Injection strategy
│   │   └── supabase.ts       # Supabase API strategy
│   └── utils/
│       └── config-loader.ts  # Config loading and validation
└── dist/                     # Build output (ESM)
```

---

## Development Roadmap

### Phase 2: Quality Infrastructure

**Goal**: Establish code quality and testing foundation

#### 2.1 ESLint Configuration
- Add ESLint with TypeScript support
- Configure rules for Node.js + Browser mixed environment
- Add Prettier for formatting consistency

```bash
# Packages to add
eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
eslint-config-prettier prettier
```

#### 2.2 Unit Tests (Vitest)

**Test Coverage Targets**:

| Module | Priority | Test Cases |
|--------|----------|------------|
| config-loader.ts | High | Valid config, missing fields, invalid provider |
| firebase.ts | Medium | Token generation mock, CDN injection mock |
| supabase.ts | Medium | API response mock, localStorage injection |
| index.ts | High | Integration of all components |

**Mock Strategy**:
- Firebase Admin SDK: Mock `createCustomToken`
- Playwright Page: Mock `evaluate`, `addScriptTag`, `goto`
- Supabase API: Mock fetch responses

#### 2.3 E2E Tests (Playwright)

**Test Scenarios**:
1. Firebase auth flow against real/emulator Firebase
2. Supabase auth flow against real/local Supabase
3. Storage state persistence verification
4. NextAuth integration (optional)

---

### Phase 3: Refactoring

**Goal**: Improve maintainability and extensibility through encapsulation

#### 3.1 ConfigManager Class

**Current Problem**:
- Config loading and validation spread across functions
- No centralized config access
- Difficult to extend for new providers

**Proposed Design**:

```typescript
class ConfigManager {
  private config: PlaywrightAuthConfig;

  constructor(configPath: string) {
    this.config = this.load(configPath);
    this.validate();
  }

  // Getters for type-safe config access
  get provider(): ProviderType { ... }
  get testUser(): TestUser { ... }
  getFirebaseConfig(): FirebaseConfig { ... }
  getSupabaseConfig(): SupabaseConfig { ... }

  // Validation
  private validate(): void { ... }
  private validateFirebase(): void { ... }
  private validateSupabase(): void { ... }
}
```

**Benefits**:
- Single Responsibility: Config management in one place
- Type Safety: Getters ensure correct config for provider
- Extensibility: Easy to add new provider validation

#### 3.2 ProviderFactory Class

**Current Problem**:
- Provider creation logic in `createProvider` function
- Direct instantiation makes testing harder
- No dependency injection support

**Proposed Design**:

```typescript
class ProviderFactory {
  private static providers: Map<ProviderType, ProviderConstructor> = new Map([
    ['firebase', FirebaseProvider],
    ['supabase', SupabaseProvider],
  ]);

  // Register new providers (extensibility)
  static register(type: string, provider: ProviderConstructor): void {
    this.providers.set(type, provider);
  }

  // Create provider instance
  static create(config: ConfigManager): AuthProvider {
    const Provider = this.providers.get(config.provider);
    if (!Provider) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
    return new Provider(config);
  }
}
```

**Benefits**:
- Open/Closed Principle: Add providers without modifying factory
- Testability: Can register mock providers for testing
- Dependency Injection: ConfigManager injected into providers

#### 3.3 Refactored Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Entry Point                               │
│                        (index.ts)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   authSetup(options)                                            │
│       │                                                          │
│       ├── ConfigManager                                         │
│       │       ├── load()                                        │
│       │       ├── validate()                                    │
│       │       └── getXxxConfig()                                │
│       │                                                          │
│       ├── ProviderFactory                                       │
│       │       ├── register() [extensibility]                    │
│       │       └── create(configManager)                         │
│       │               ├── FirebaseProvider                      │
│       │               ├── SupabaseProvider                      │
│       │               └── [Future Providers]                    │
│       │                                                          │
│       └── provider.signIn(page)                                 │
│               └── StorageManager.save()                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Phase 4: Future Enhancements

#### 4.1 Additional Providers
- [ ] Auth0 (M2M token strategy)
- [ ] AWS Cognito
- [ ] Clerk
- [ ] Custom OAuth

#### 4.2 Multi-User Support
- [ ] Multiple storage state files (`user-admin.json`, `user-guest.json`)
- [ ] Role-based test user configuration

#### 4.3 CI/CD Integration
- [ ] GitHub Actions workflow template
- [ ] Environment variable documentation
- [ ] Secret management guide

#### 4.4 Developer Experience
- [ ] CLI tool for config generation
- [ ] Config validation command
- [ ] Debug mode with verbose logging

---

## File Structure (Target)

```
playwright-nextjs-auth/
├── package.json
├── tsconfig.json
├── eslint.config.js          # ESLint flat config
├── vitest.config.ts          # Vitest configuration
├── playwright.config.ts      # E2E test config
├── playwright.env.json.sample
├── .gitignore
├── README.md
├── claudedocs/
│   └── *.md
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # Type definitions
│   ├── config/
│   │   └── ConfigManager.ts  # Config encapsulation
│   ├── providers/
│   │   ├── base.ts           # AuthProvider interface
│   │   ├── ProviderFactory.ts # Factory pattern
│   │   ├── firebase.ts
│   │   └── supabase.ts
│   └── utils/
│       └── logger.ts         # Logging utility
├── tests/
│   ├── unit/
│   │   ├── config-manager.test.ts
│   │   ├── provider-factory.test.ts
│   │   ├── firebase-provider.test.ts
│   │   └── supabase-provider.test.ts
│   └── e2e/
│       ├── firebase.spec.ts
│       └── supabase.spec.ts
└── dist/
```

---

## Implementation Order

| # | Task | Priority | Estimated Effort |
|---|------|----------|------------------|
| 1 | README.md | High | 30min |
| 2 | ESLint setup | High | 30min |
| 3 | Unit tests (config-loader) | High | 1h |
| 4 | Unit tests (providers) | Medium | 2h |
| 5 | E2E tests | Medium | 2h |
| 6 | ConfigManager refactor | Medium | 1h |
| 7 | ProviderFactory refactor | Medium | 1h |

---

## Notes

### Design Decisions

1. **CDN Injection for Firebase**: Required because bundled Firebase SDK doesn't expose `window.firebase`, and direct IndexedDB writes conflict with SDK.

2. **API Strategy for Supabase**: Simpler than Firebase because Supabase uses localStorage (not IndexedDB) and token format is well-documented.

3. **ESM Only**: Modern approach, better tree-shaking, aligns with Playwright's module system.

4. **Playwright Peer Dependency**: Users must install their own Playwright version to avoid version conflicts.

### Known Limitations

1. **MFA Not Supported**: Current implementation assumes direct authentication without multi-factor.

2. **Token Refresh**: Storage state may expire; users need to re-run setup for long test sessions.

3. **Emulator Support**: Not explicitly tested with Firebase/Supabase emulators (should work but unverified).
