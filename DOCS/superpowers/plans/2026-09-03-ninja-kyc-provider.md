# Ninja KYC Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch Nigeria-only NIN and BVN verification through Ninja's ₦100 direct verify API with provider-neutral TRUSTPAY clients and complete, minimal UI states.

**Architecture:** A config-selected `KycProviderGateway` chooses Ninja for synchronous verification while the existing Youverify adapter remains available for rollback and owns its legacy webhook contract. Ninja authenticates server-side, caches its five-minute token in memory, sanitizes every response, and feeds the existing transactional KYC persistence and tier engine. Web and Flutter collect exact date of birth without persisting or displaying it after submission.

**Tech Stack:** NestJS 11, Prisma 6/PostgreSQL, Axios/RxJS, Jest, Next.js 16/React 19/shadcn, Playwright, Flutter/Riverpod/Dio.

**Spec:** `DOCS/superpowers/specs/2026-09-03-ninja-kyc-provider-design.md`

## Global Constraints

- Launch scope is Nigeria-only `NIN` and `BVN` verification.
- Use Ninja `verify` mode; never use registry-record `lookup` mode.
- Verification requires `country: "NG"`, an 11-digit identifier, exact `YYYY-MM-DD` date of birth, and explicit consent.
- A pass requires `found === true`, `verified === true`, and `recommendation === "accept"`.
- Never log or persist Ninja credentials, bearer tokens, raw provider bodies, dates of birth, registry values, photos, phone numbers, addresses, or full identifiers outside the existing encrypted identity-number field.
- Every KYC submission uses the existing idempotency interceptor, transactional reservation, active-attempt uniqueness constraint, audit trail, and masked client responses.
- Direct verification has no Ninja webhook; keep Youverify webhook handling isolated for rollback.
- Use provider-neutral user-facing copy except the explicit consent disclosure naming Ninja.

---

### Task 1: Provider-neutral persistence and gateway selection

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/prisma/migrations/035_ninja_kyc_provider/migration.sql`
- Modify: `BACKEND/src/kyc/providers/kyc-provider.gateway.ts`
- Modify: `BACKEND/src/kyc/providers/youverify.provider.ts`
- Modify: `BACKEND/src/kyc/kyc.module.ts`
- Test: `BACKEND/src/kyc/kyc.service.spec.ts`

**Interfaces:**
- `KycProviderGateway.provider: KycVerificationProvider`
- `KycIdentityVerificationRequest.validation.dateOfBirth?: string`
- The configured gateway is Ninja when `KYC_PROVIDER=ninja`; Youverify remains injectable by class for its webhook path.

- [ ] **Step 1: Write the failing gateway/service tests**

Add assertions that the gateway exposes `provider: "NINJA"`, the reservation persists that provider rather than a literal, and the verification request carries `dateOfBirth`.

- [ ] **Step 2: Run the focused service test and confirm RED**

Run: `npm test -- --runInBand kyc.service.spec.ts`

Expected: FAIL because `NINJA` and `dateOfBirth` are not part of the current contract.

- [ ] **Step 3: Add the provider enum and gateway contract**

Add `NINJA` to `KycVerificationProvider` and migrate PostgreSQL with:

```sql
ALTER TYPE "KycVerificationProvider" ADD VALUE IF NOT EXISTS 'NINJA';
```

Extend the gateway:

```ts
export interface KycProviderGateway {
  readonly provider: KycVerificationProvider;
  verifyIdentity(request: KycIdentityVerificationRequest): Promise<KycProviderResult>;
  verifyCallbackSignature(input: { signature?: string; rawBody?: string }): boolean;
  normalizeCallback(payload: Record<string, unknown>): KycProviderCallbackResult;
}
```

Add `dateOfBirth?: string` to `validation` and set `YouverifyProvider.provider` to `YOUVERIFY`.

- [ ] **Step 4: Select the active gateway by configuration**

Register both concrete providers and use a factory that returns Ninja for `ninja` and Youverify for `youverify`. Do not silently accept any other value.

- [ ] **Step 5: Generate Prisma and run the focused tests**

Run: `npx prisma validate && npx prisma generate && npm test -- --runInBand kyc.service.spec.ts`

- [ ] **Step 6: Commit the task**

```bash
git add BACKEND/prisma BACKEND/src/kyc
git commit -m "refactor: make KYC provider selectable"
```

### Task 2: Ninja direct-verification provider

**Files:**
- Create: `BACKEND/src/kyc/providers/ninja.provider.ts`
- Create: `BACKEND/src/kyc/providers/ninja.provider.spec.ts`

**Interfaces:**
- Consumes `KycIdentityVerificationRequest` and `CircuitBreakerService`.
- Produces sanitized `KycProviderResult` with `provider: NINJA`.
- Authenticates with `POST /auth/session`; verifies with `POST /api/identity/identify`.

- [ ] **Step 1: Write failing provider contract tests**

Cover: consent rejection; Nigeria NIN/BVN request shape; unsupported country/type; cached token reuse; coalesced concurrent authentication; expiry refresh; one fresh-token retry after `401`; strict accept mapping; review and reject mapping; malformed response; timeout/402/429/500 safe errors; no sensitive values in logs or result JSON.

The expected verification payload is:

```ts
{
  idType: 'nin',
  mode: 'verify',
  idNumber: '77777777777',
  firstName: 'James',
  lastName: 'Bond',
  dateOfBirth: '1975-01-01',
  reference: 'document-1',
}
```

- [ ] **Step 2: Run the Ninja provider test and confirm RED**

Run: `npm test -- --runInBand ninja.provider.spec.ts`

Expected: FAIL because `NinjaProvider` does not exist.

- [ ] **Step 3: Implement token acquisition and safe retry**

Cache `{ token, expiresAt }` until 30 seconds before expiry and share a single in-flight authentication promise. On an identity-call `401`, clear the cached token, obtain a fresh one, and retry the same reference exactly once.

- [ ] **Step 4: Implement strict result normalization and redaction**

Persist only this evidence shape:

```ts
{
  providerStatus: 'found',
  found: true,
  verified: true,
  recommendation: 'accept',
  score: 1,
  fields: [{ field: 'first_name', match: 'exact', score: 1 }],
  country: 'NG',
  providerType: 'nin',
  documentType: 'NIN',
  identifierMasked: '*******7777',
  reviewRequired: false,
}
```

Allowlist each field; omit `provided`, `detail`, raw registry data, and unknown properties.

- [ ] **Step 5: Run provider tests until GREEN**

Run: `npm test -- --runInBand ninja.provider.spec.ts`

- [ ] **Step 6: Commit the task**

```bash
git add BACKEND/src/kyc/providers
git commit -m "feat: add Ninja identity verification provider"
```

### Task 3: Provider-neutral KYC service, endpoint, configuration, and readiness

**Files:**
- Modify: `BACKEND/src/kyc/dto/kyc.dto.ts`
- Modify: `BACKEND/src/kyc/kyc.controller.ts`
- Modify: `BACKEND/src/kyc/kyc.controller.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.ts`
- Modify: `BACKEND/src/kyc/kyc.service.spec.ts`
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/src/health/health.controller.ts`
- Modify: `BACKEND/src/health/health.controller.spec.ts`
- Rename or replace: `BACKEND/src/kyc/youverify-production-config.spec.ts`
- Modify: `BACKEND/scripts/validate-production-config.sh`

**Interfaces:**
- `CreateIdentityVerificationDto` accepts only `NG`, `BVN | NIN`, 11 digits, `YYYY-MM-DD`, and `consentAccepted: true`.
- `KycService.verifyIdentity(userId, dto)` owns the provider-neutral transactional flow.
- `POST /api/kyc/verify` is the canonical route; `POST /api/kyc/youverify/verify` delegates temporarily.

- [ ] **Step 1: Write failing DTO, controller, service, config, and health tests**

Assert exact-date validation (including invalid calendar dates), Ninja provider persistence/audits, provider-neutral method names, Nigeria-only types, canonical route behavior, live configuration acceptance, sandbox-host production rejection, missing-secret rejection, and safe readiness output.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- --runInBand kyc.controller.spec.ts kyc.service.spec.ts health.controller.spec.ts ninja-production-config.spec.ts`

- [ ] **Step 3: Implement the DTO and provider-neutral transactional service**

Rename Youverify-specific constants/methods/actions to provider-neutral names, take the active provider from `kycProviderGateway.provider`, pass date of birth without storing it, and keep Youverify callback logic bound to the concrete Youverify provider.

- [ ] **Step 4: Implement configuration and readiness**

Support `KYC_PROVIDER=ninja|youverify`. When Ninja is active, require non-empty client credentials and an HTTPS Ninja base URL; in production reject `api.sandbox.ninja.boucloud.io`. Do not require Youverify webhook configuration for Ninja.

- [ ] **Step 5: Run focused tests until GREEN**

Run: `npm test -- --runInBand kyc.controller.spec.ts kyc.service.spec.ts health.controller.spec.ts ninja-production-config.spec.ts`

- [ ] **Step 6: Commit the task**

```bash
git add BACKEND/src BACKEND/scripts/validate-production-config.sh
git commit -m "feat: route KYC through configured provider"
```

### Task 4: Minimal web KYC journey and complete states

**Files:**
- Modify: `WEBSITE/src/services/api.ts`
- Modify: `WEBSITE/src/types/index.ts`
- Modify: `WEBSITE/src/app/dashboard/kyc/page.tsx`
- Create: `WEBSITE/e2e/kyc.spec.ts`

**Interfaces:**
- `kycApi.verifyIdentity` posts `country`, `type`, `idNumber`, `dateOfBirth`, and consent to `/api/kyc/verify` with a UUID idempotency key.
- The page supports initial/empty, loading, load-error, submitting, review, rejection/failure, Tier 1 next-ID, and Tier 2 complete states.

- [ ] **Step 1: Write failing browser contract tests**

Mock the status and verification APIs and assert: Nigeria-only selector; visible BVN/NIN choice; required exact DOB; Ninja consent; disabled duplicate submission; masked history; useful empty state; review message; rejection retry guidance; verified Tier 2 completion state.

- [ ] **Step 2: Run the KYC browser test and confirm RED**

Run: `npx playwright test e2e/kyc.spec.ts --project=chromium`

- [ ] **Step 3: Implement the minimal state-driven page**

Use one compact form card, one status summary, one primary action, restrained icons, plain copy, and a bordered empty state that explains the first action. Avoid gradients, decorative statistics, duplicated headings, and provider marketing language.

- [ ] **Step 4: Run web verification**

Run: `npx playwright test e2e/kyc.spec.ts --project=chromium && npm run lint -- src/app/dashboard/kyc/page.tsx src/services/api.ts && npm run build`

- [ ] **Step 5: Commit the task**

```bash
git add WEBSITE/src WEBSITE/e2e/kyc.spec.ts
git commit -m "feat: complete Ninja KYC web journey"
```

### Task 5: Minimal Flutter KYC journey and complete states

**Files:**
- Modify: `APP/lib/services/kyc_service.dart`
- Modify: `APP/lib/features/home/screens/kyc_verification_screen.dart`
- Modify: `APP/test/kyc_verification_screen_test.dart`

**Interfaces:**
- `KycService.verifyIdentity` requires `dateOfBirth` and returns provider-neutral `KycVerificationResult`.
- The screen is Nigeria-only with BVN/NIN choices and the same state/copy semantics as web.

- [ ] **Step 1: Write failing Flutter service/widget tests**

Assert the canonical route and request fields, DOB/consent validation, Ninja copy, no Ghana option, empty state, loading/error/review/rejected/verified state messaging, Tier 1 NIN/BVN progression, and disabled duplicate submission.

- [ ] **Step 2: Run focused Flutter tests and confirm RED**

Run: `../.tooling/flutter/bin/flutter test test/kyc_verification_screen_test.dart`

- [ ] **Step 3: Implement the service and UI changes**

Rename the result model to `KycVerificationResult`, add a date input with date-picker support and ISO serialization, keep both sensitive fields obscured from logs, and render compact reusable status/empty/history panels.

- [ ] **Step 4: Run Flutter verification**

Run: `../.tooling/flutter/bin/flutter test test/kyc_verification_screen_test.dart && ../.tooling/flutter/bin/flutter analyze lib/services/kyc_service.dart lib/features/home/screens/kyc_verification_screen.dart test/kyc_verification_screen_test.dart`

- [ ] **Step 5: Commit the task**

```bash
git add APP/lib/services/kyc_service.dart APP/lib/features/home/screens/kyc_verification_screen.dart APP/test/kyc_verification_screen_test.dart
git commit -m "feat: complete Ninja KYC mobile journey"
```

### Task 6: Deployment configuration, documentation, and full verification

**Files:**
- Modify: `BACKEND/.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `render.yaml`
- Modify: `BACKEND/do-app.yaml`
- Modify: `BACKEND/fly.toml` when it contains KYC settings
- Modify: `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`
- Modify: `DOCS/KYC-GUIDE.MD`
- Modify: `DOCS/PRODUCTION-GUIDES/00-README.MD`
- Create: `DOCS/PRODUCTION-GUIDES/23-NINJA-KYC-PRODUCTION-READINESS.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Sandbox requires the three Ninja variables and `KYC_PROVIDER=ninja`.
- Production uses `https://api.ninja.boucloud.io` with independent production credentials.

- [ ] **Step 1: Update deployment manifests and source-of-truth documentation**

Document exact variable names, sandbox IDs `77777777777`, `55555555555`, and `00000000000`, the live host, secret-manager requirements, wallet funding, business approval, controlled-live-check procedure, rollback, and monitoring thresholds. Change project provider policy from Youverify-only to Ninja-primary with Youverify as temporary rollback compatibility.

- [ ] **Step 2: Run manifest/config verification**

Run: `bash scripts/check-production-manifests.sh`

- [ ] **Step 3: Run full backend verification**

Run: `npx prisma validate && npx prisma generate && npm test -- --runInBand && npm run lint && npm run build`

- [ ] **Step 4: Run full web and focused mobile verification**

Run web: `npm run lint && npm run build`

Run mobile: `../.tooling/flutter/bin/flutter test test/kyc_verification_screen_test.dart && ../.tooling/flutter/bin/flutter analyze lib/services/kyc_service.dart lib/features/home/screens/kyc_verification_screen.dart test/kyc_verification_screen_test.dart`

- [ ] **Step 5: Inspect the final diff for privacy and secret leaks**

Run: `git diff --check && git diff -- BACKEND/src/kyc WEBSITE/src/app/dashboard/kyc APP/lib/features/home/screens/kyc_verification_screen.dart BACKEND/.env.example DOCS/PRODUCTION-GUIDES/23-NINJA-KYC-PRODUCTION-READINESS.md`

- [ ] **Step 6: Commit the task**

```bash
git add AGENTS.md BACKEND/.env.example BACKEND/do-app.yaml BACKEND/fly.toml docker-compose.prod.yml render.yaml DOCS
git commit -m "docs: prepare Ninja KYC launch operations"
```
