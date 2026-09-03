# Youverify Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready Youverify-only KYC flow across TRUSTPAY backend, web, mobile, admin, and deployment checks.

**Architecture:** Normalize Youverify into a strict internal decision contract, reserve submissions transactionally, and accept callbacks into a durable KYC inbox. Both clients consume one typed API contract and explicitly capture consent; admin consumes only whitelisted evidence.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, Next.js 16, React, Axios, Playwright, Flutter, Riverpod, Dio.

**Spec:** `DOCS/superpowers/specs/2026-09-02-youverify-production-readiness-design.md`

## Global Constraints

- Follow `DOCS/SECURITY-RULES.MD` for every change.
- Youverify is the only KYC provider.
- Never log or return full identity numbers, secrets, or raw provider PII.
- Every mutation keeps idempotency, validation, authentication, authorization, rate limiting, and audit coverage.
- Preserve unrelated uncommitted work.

---

### Task 1: Provider contract and stable decisions

**Files:**
- Modify: `BACKEND/src/kyc/providers/youverify.provider.spec.ts`
- Modify: `BACKEND/src/kyc/providers/youverify.provider.ts`

**Interfaces:**
- Consumes: `KycIdentityVerificationRequest`
- Produces: a `KycProviderResult` whose status and `responseHash` depend only on stable provider facts

- [ ] Add a regression test proving `found + dataValidation=true + allValidationPassed=false` yields `REVIEW_REQUIRED`.
- [ ] Run the focused spec and confirm the regression test fails on the existing `OR` branch.
- [ ] Add a contract test requiring `validations: { data: ... }` and prohibiting the singular `validation` field.
- [ ] Run the focused spec and confirm the contract test fails.
- [ ] Change the provider to require explicit `allValidationPassed === true`, send `validations`, and exclude receipt time from hashed checks.
- [ ] Run the provider spec and confirm it passes.

### Task 2: Persist consent and serialize active submissions

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/prisma/migrations/034_youverify_production_readiness/migration.sql`
- Modify: `BACKEND/src/kyc/kyc.service.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.ts`

**Interfaces:**
- Produces: consent fields on `KycVerification` and a partial unique index on active `KycDocument` attempts
- Consumes: `CreateYouverifyKycDto.consentAccepted`

- [ ] Add service tests for stored consent evidence, active-attempt reservation, and provider-failure release.
- [ ] Run focused service tests and confirm they fail for the missing behavior.
- [ ] Extend the Prisma model and migration with consent fields and the partial active-attempt unique index.
- [ ] Refactor submission into reserve, provider call, and atomic finalize phases; map unique conflicts to a safe `409` response.
- [ ] Run Prisma validation/generation and focused service tests.

### Task 3: Durable, recoverable KYC webhooks

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Modify: `BACKEND/prisma/migrations/034_youverify_production_readiness/migration.sql`
- Create: `BACKEND/src/kyc/kyc-webhook-inbox.service.ts`
- Create: `BACKEND/src/kyc/kyc-webhook-processor.service.ts`
- Create: `BACKEND/src/kyc/kyc-webhook-inbox.service.spec.ts`
- Create: `BACKEND/src/kyc/kyc-webhook-processor.service.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.ts`
- Modify: `BACKEND/src/kyc/kyc.module.ts`

**Interfaces:**
- Produces: `accept`, `claim`, `complete`, `fail`, `recoverStaleClaims`, and scheduled `processDueEvents`
- Consumes: signature-verified normalized callback payloads and `KycService.applyYouverifyCallback`

- [ ] Add failing tests for stable duplicate acceptance, retry/dead-letter state, claim recovery, and a later success recovering an earlier `FAILED` decision.
- [ ] Implement the inbox using sanitized JSON, payload hashes, a unique replay key, and bounded exponential retry.
- [ ] Split callback signature/normalization from transactional application and accept webhooks before scheduled processing.
- [ ] Register the processor and run all focused KYC tests.

### Task 4: Safe admin evidence

**Files:**
- Modify: `BACKEND/src/kyc/kyc.service.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.ts`
- Modify: `WEBSITE/src/app/admin/kyc/page.tsx`
- Modify: `WEBSITE/src/types/index.ts`

**Interfaces:**
- Produces: `reviewEvidence` and `reviewSource` in pending KYC rows
- Consumes: legacy document URLs only when `reviewSource === 'DOCUMENT'`

- [ ] Add a failing service test that expects whitelisted provider evidence without encrypted/raw values.
- [ ] Implement the safe evidence mapper and return it from pending queries.
- [ ] Change admin selection to open provider evidence directly and request a signed URL only for legacy uploads.
- [ ] Run focused backend tests and website type/lint checks.

### Task 5: Minimal direct web KYC flow

**Files:**
- Modify: `WEBSITE/src/services/api.ts`
- Modify: `WEBSITE/src/app/dashboard/kyc/page.tsx`
- Create: `WEBSITE/e2e/kyc.spec.ts`

**Interfaces:**
- Produces: `kycApi.verifyIdentity(payload)` calling `/api/kyc/youverify/verify`
- Consumes: `/api/kyc/status`, `/api/kyc/documents`, explicit `consentAccepted: true`, and global mutation idempotency

- [ ] Add failing browser coverage for the direct route, explicit consent, Tier 1 next-step copy, loading, success, and error recovery.
- [ ] Replace the upload UI with the approved compact status/form/history layout.
- [ ] Remove the browser Supabase upload dependency from this flow.
- [ ] Run focused lint, type/build, and desktop/mobile Playwright checks.

### Task 6: Mobile Tier 2 progression and consent

**Files:**
- Modify: `APP/lib/services/kyc_service.dart`
- Modify: `APP/lib/features/home/screens/kyc_verification_screen.dart`
- Modify: `APP/test/kyc_verification_screen_test.dart`

**Interfaces:**
- `verifyIdentity` requires a caller-provided `consentAccepted` value
- The screen remains actionable until the required tier is reached

- [ ] Add failing widget/service tests for unchecked consent and submitting the complementary Nigerian identity at Tier 1.
- [ ] Refactor to a compact screen with explicit consent and correct next-step copy.
- [ ] Keep the action available at Tier 1; disable only while submitting or once Tier 2 is reached.
- [ ] Run focused Flutter tests and analyzer checks.

### Task 7: Configuration, health, and third-party isolation

**Files:**
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/src/health/health.controller.ts`
- Modify: `BACKEND/src/health/health.controller.spec.ts`
- Modify: `BACKEND/.env.example`
- Modify: `BACKEND/scripts/validate-production-config.sh`
- Modify: `WEBSITE/src/app/layout.tsx`
- Create: `WEBSITE/src/components/support-widget.tsx`
- Modify: `WEBSITE/next.config.ts`

**Interfaces:**
- Produces: safe `kyc` readiness output and environment validation in staging/production
- Loads support scripts only outside authenticated dashboard/admin routes

- [ ] Add failing configuration/health tests for missing or insecure Youverify settings.
- [ ] Implement staging/production validation for key, URL, webhook secret/URL, and PII key.
- [ ] Move the support widget behind a route-aware client boundary and remove invalid development CSP sources.
- [ ] Run backend config tests and website build/browser console checks.

### Task 8: End-to-end verification and readiness report

**Files:**
- Modify: `DOCS/KYC-GUIDE.MD`
- Create: `DOCS/PRODUCTION-GUIDES/22-YOUVERIFY-PRODUCTION-READINESS.md`

**Interfaces:**
- Produces: repeatable sandbox certification and launch checklist

- [ ] Run Prisma validation, full focused backend KYC tests, backend build/lint, website lint/build/e2e, Flutter tests/analyzer, and production config scripts.
- [ ] Run the opt-in live Youverify sandbox contract check without printing credentials.
- [ ] Document remaining external gates: API-key permissions and dashboard webhook registration.
- [ ] Review the diff against every design requirement and `DOCS/SECURITY-RULES.MD`.
