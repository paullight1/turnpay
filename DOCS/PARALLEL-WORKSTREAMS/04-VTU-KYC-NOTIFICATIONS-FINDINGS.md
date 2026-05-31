# Stream 4 Findings Report: VTU, KYC & Notifications

**Date:** 2026-05-31
**Scope:** Phases 1, 2, 3 — Research & Audit Pass (no code changes, no external sign-ups)

---

## PHASE 1: VTU Provider Activation

### 1.1 What Already Exists in the Codebase

| Artifact | File Path | Status |
|----------|-----------|--------|
| VTU abstraction layer | `BACKEND/src/vtu/providers/vtu-api.provider.ts` | Complete — handles VTpass (sandbox) with full purchase, requery, validation, package listing |
| Reloadly provider | `BACKEND/src/vtu/providers/reloadly.provider.ts` | Complete — handles international top-ups and utility payments with OAuth token management |
| Provider health types | `BACKEND/src/vtu/providers/provider-health.types.ts` | Complete — `VtuProviderHealth`, `VtuProviderHealthResponse` defined |
| VTU service | `BACKEND/src/vtu/vtu.service.ts` (1381 lines) | Complete — purchase flow, pricing, requery, webhooks, KYC gating |
| Requery cron | `BACKEND/src/vtu/vtu-requery.service.ts` | Running every 5 min, batches 25 pending orders |
| VTU controller | `BACKEND/src/vtu/vtu.controller.ts` | Complete — providers, packages, purchase, order status, requery endpoints |
| Reloadly webhook controller | `BACKEND/src/vtu/reloadly-webhook.controller.ts` | Complete — HMAC signature verification, deduplication, event processing |
| VTU DTO | `BACKEND/src/vtu/dto/vtu.dto.ts` | Complete — validation for all product types and international scopes |
| VTU module | `BACKEND/src/vtu/vtu.module.ts` | Wired with HttpModule (15s timeout), WalletsModule |
| Prisma VtuOrder model | `BACKEND/prisma/schema.prisma` | Complete — all fields (provider, scope, status, requery tracking) |
| Admin VTU page | `WEBSITE/src/app/admin/vtu/page.tsx` (1856 lines) | Extensive — provider health dashboard, stale order detection, requery, reconciliation exceptions, pricing rule management |
| Sandbox credentials (.env) | `BACKEND/.env` | VTpass sandbox credentials present and configured for sandbox.vtpass.com |
| Reloadly sandbox config | `BACKEND/.env` | Reloadly sandbox URLs configured (topups-sandbox, utilities-sandbox) but `RELOADLY_ENABLED=false` |

### 1.2 Provider Comparison Analysis

#### VTpass (Nigeria Local — Primary)

**Strengths:**
- Already fully wired as the default provider (`VTU_PROVIDER=vtpass`)
- Covers all four Nigeria product types: airtime, data, cable (DStv/GOtv/StarTimes), electricity (12 discos)
- Sandbox credentials already present and working
- Built-in balance checking, low-balance alerts, threshold config
- VTpass API uses straightforward API-key + public-key / secret-key pattern
- Request-id generation follows VTpass format (YYYYMMDDHHmm + suffix)
- Status normalization covers all known VTpass codes (099=pending, 016/091=failure, 000=success)

**Weaknesses:**
- No Ghana coverage whatsoever
- No international airtime/data support
- Relies on pre-funded wallet (need to top up in advance)
- Settlement terms require institutional sign-up

#### Reloadly (International — Secondary/Ghana)

**Strengths:**
- Already fully wired with OAuth client-credentials flow
- Token caching via Redis (3600s expiry with 60s buffer)
- Supports international airtime/data top-ups (200+ countries)
- Supports utility bill payments (electricity, including Ghana)
- Has webhook support with HMAC signature verification
- Auto-detect operator by phone number
- Separate sandbox credentials for top-ups and utilities APIs

**Weaknesses:**
- Currently `RELOADLY_ENABLED=false` in .env
- Requires Redis for token caching (already available)
- Pricing markup applied on top of provider cost (less transparent)
- No sandbox credentials yet for Reloadly (client_id/client_secret empty)
- Ghana-specific utility billers (ECG, NEDCo) not explicitly mapped; generic fallback only

#### Recommendation

| Market | Primary Provider | Rationale |
|--------|-----------------|-----------|
| **Nigeria VTU** (airtime, data, cable, electricity) | **VTpass** | Already integrated, sandbox active, covers all NGN products, pre-funded wallet model, better for local settlement |
| **International airtime/data** | **Reloadly** | Only international option wired; covers 200+ countries; OAuth token management complete |
| **Ghana utilities** (ECG, NEDCo) | **Reloadly** | Already has `payUtilityBill` and `getUtilityBillers` for electricity; need to test sandbox for Ghana biller IDs |
| **Future: Ghana airtime/data** | **Reloadly** | `getOperators` supports countryCode param — sandbox test with "GH" needed |

### 1.3 Gaps Needing Filling

1. **Reloadly sandbox credentials** — `RELOADLY_CLIENT_ID` and `RELOADLY_CLIENT_SECRET` are empty in .env. Need to sign up at reloadly.com and obtain sandbox credentials.
2. **Reloadly webhook secret** — `RELOADLY_WEBHOOK_SECRET` not set. Need to configure webhook URL in Reloadly dashboard.
3. **Ghana electricity sandbox test** — Need to call `getUtilityBillers("GH", "electricity")` in sandbox to verify ECG/NEDCo biller IDs appear. The fallback returns a generic "Ghana Electricity Test Biller" with id "26".
4. **No explicit feature flag** `VTU_GHANA_UTILITIES_ENABLED` — currently gating is implicit (Reloadly must be enabled, then countryCode=GH and type=electricity). A named flag would be cleaner.
5. **VTpass production credentials** — sandbox keys work for testing but real wallet funding and production tokens needed for go-live.
6. **Admin VTU health dashboard** — already built but only shows provider balance and warnings; no per-product success rate, avg latency, or error breakdown. The UI renders provider health cards (see lines 690-736 of admin page) but these metrics come from `getVtpassHealth()` / `getHealth()` which only check balance, not transaction success rates.
7. **Stale order auto-resolution** — cron requeries pending orders every 5 min, but orders exceeding requery limit (12) are not auto-failed.

### 1.4 Sandbox Credentials Required

| Variable | Provider | Purpose | Status |
|----------|----------|---------|--------|
| `RELOADLY_CLIENT_ID` | Reloadly | OAuth client credential | MISSING |
| `RELOADLY_CLIENT_SECRET` | Reloadly | OAuth client credential | MISSING |
| `RELOADLY_WEBHOOK_SECRET` | Reloadly | HMAC webhook verification | MISSING |
| `RELOADLY_WEBHOOK_URL` | Reloadly | Callback URL for status updates | MISSING |
| VTPASS live `API_KEY`/`PUBLIC_KEY`/`SECRET_KEY` | VTpass | Production VTU | MISSING (sandbox present) |

**VTpass sandbox credentials present:** `.env` has valid-looking sandbox keys for `sandbox.vtpass.com/api`.

**Reloadly onboarding:**
1. Register at https://www.reloadly.com/
2. Enable sandbox mode in developer dashboard
3. Obtain `client_id` and `client_secret` from API credentials
4. Configure webhook URL in developer dashboard to point to `https://{domain}/api/webhooks/vtu/reloadly`
5. Note: Reloadly sandbox and production use the same OAuth flow but different base URLs

### 1.5 VTU Failure Handling Audit

| Scenario | Current Handling | Gap |
|----------|-----------------|-----|
| Provider timeout | `HttpService` timeout=15s; sets order to UNKNOWN, schedules requery | Wallet debited before provider call — timeout leaves funds reserved until requery resolves |
| Provider error response | Throws Error("VTU provider result unknown"), order set to UNKNOWN | User sees pending status with "Funds remain reserved" message |
| Insufficient balance | Pre-check `wallet.balance < debitAmount` returns 400 error | No provider wallet balance check before purchase (only in admin health dashboard) |
| Invalid meter/smartcard | Separate `validateMeter()`/`validateSmartCard()` endpoints | Validation is optional — purchase doesn't require prior validation |
| Provider reversal case | `reverseVtuPurchase()` credits wallet exactly once (checks existing reversal via ledger entry source) | Robust — idempotent reversal |
| Duplicate protection | Idempotency key pattern used in admin but not in user-facing purchase | User-facing purchase has no idempotency key validation |
| Requery loop | Max 12 attempts, then stops (no auto-fail) | Orders exceeding 12 attempts remain UNKNOWN indefinitely |
| Webhook dedup | Unique constraint on `WebhookLog.reference` | Complete |

### 1.6 Next Actions (Phase 1)

1. **Obtain Reloadly sandbox credentials** — sign up, get client_id/client_secret, add to `.env`
2. **Run sandbox smoke tests** — 4 product types via VTpass (airtime N100, data N200, DSTV renewal, electricity N500)
3. **Test Ghana electricity via Reloadly sandbox** — call `/operators/countries/GH` and `/billers?countryISOCode=GH`
4. **Configure Reloadly webhook** — set RELOADLY_WEBHOOK_URL and RELOADLY_WEBHOOK_SECRET
5. **Add per-product health metrics** to `VtuApiProvider` (success rate, avg latency by product type)
6. **Add auto-fail for stale orders** — mark orders as FAILED after 12 requery attempts with no resolution
7. **Set `VTU_GHANA_UTILITIES_ENABLED` feature flag** for explicit Ghana gating

---

## PHASE 2: KYC Provider Integration

### 2.1 What Already Exists in the Codebase

| Artifact | File Path | Status |
|----------|-----------|--------|
| KycProviderGateway interface | `BACKEND/src/kyc/providers/kyc-provider.gateway.ts` | Complete — `submitVerification(submission)` returns `KycProviderResult` |
| ManualKycProvider | `BACKEND/src/kyc/providers/manual-kyc.provider.ts` | Complete — always returns `REVIEW_REQUIRED` with `external_provider_not_configured` |
| Prisma KYC models | `BACKEND/prisma/schema.prisma` | Complete — `KycDocument`, `KycVerification`, `KycVerificationProvider` enum (MANUAL_REVIEW, NIBSS, MONNIFY) |
| KYC service | `BACKEND/src/kyc/kyc.service.ts` (696 lines) | Complete — upload URL, submit, review, disputes, tier progression |
| KYC controller | `BACKEND/src/kyc/kyc.controller.ts` | Complete — user: upload/submit/documents/disputes; admin: pending/review/document-url |
| KYC DTO | `BACKEND/src/kyc/dto/kyc.dto.ts` | Complete — validation for upload, submit, review, disputes |
| KYC module | `BACKEND/src/kyc/kyc.module.ts` | Wired with `KYC_PROVIDER_GATEWAY` symbol — currently `ManualKycProvider` |
| Supabase service | `BACKEND/src/supabase/supabase.service.ts` | Complete — signed upload URLs, signed read URLs, admin client |
| PII encryption | `BACKEND/src/common/utils/encryption.ts` | Referenced via `encryptSensitiveValue` / `decryptSensitiveValue` |
| Dashboard KYC UI | `WEBSITE/src/app/dashboard/kyc/page.tsx` (320 lines) | Complete — tier status, document upload form, submission history |
| Admin KYC UI | `WEBSITE/src/app/admin/kyc/page.tsx` (456 lines) | Complete — pending list, document viewer, approve/reject with reason |
| .env config | `BACKEND/.env` | `PII_ENCRYPTION_KEY=test-pii-encryption-key` (dev only) |

### 2.2 KYC Architecture Summary

The existing KYC design follows a clean provider-gateway pattern:

```
User submits KYC
  -> KycService.submitKyc()
    -> kycProviderGateway.submitVerification()  [interface]
      -> ManualKycProvider returns REVIEW_REQUIRED
    -> Creates KycDocument (encrypted idNumber)
    -> Creates KycVerification record
    -> Sets user kycStatus = SUBMITTED
  -> Admin reviews via AdminKycController
    -> KycService.reviewKyc()
      -> Updates KycDocument status
      -> Updates KycVerification status
      -> Promotes user KycTier (BVN+NIN=Tier2, BVN|NIN=Tier1)
      -> Creates AuditLog entry
```

Security measures:
- ID numbers encrypted with PII_ENCRYPTION_KEY before storage
- Non-admin API responses always return masked identifiers
- Admin document access logged to AuditLog
- Signed upload URLs (2hr expiry) and signed read URLs (5min TTL)
- Bucket hardcoded as `kyc-documents` (configurable via KYC_DOCUMENT_BUCKET env)

### 2.3 NIBSS Provider Adapter Requirements

The `KycProviderGateway` interface expects a single method:
```typescript
interface KycProviderGateway {
  submitVerification(submission: KycProviderSubmission): Promise<KycProviderResult>;
}
```

Where `KycProviderSubmission = { userId, documentId, type, identifierMasked }` and `KycProviderResult = { provider, status, reference, checks, responseHash }`.

**What a NibssKycProvider adapter needs:**

1. **New file:** `BACKEND/src/kyc/providers/nibss-kyc.provider.ts`
2. **Implement** `KycProviderGateway` with:
   - `verifyBvn(input)` — call NIBSS BVN validation API
   - `verifyNin(input)` — call NIBSS NIN validation API  
   - `verifyVirtualNin(input)` — call NIBSS vNIN validation API
   - Normalize responses into `KycProviderResult`
3. **Config via env vars:**
   - `NIBSS_API_BASE_URL` — NIBSS developer portal API endpoint
   - `NIBSS_CLIENT_ID` — institutional client ID
   - `NIBSS_CLIENT_SECRET` — institutional client secret
   - `NIBSS_SANDBOX_MODE` — boolean for sandbox routing
4. **Behavioral requirements:**
   - Timeout handling: fallback to ManualKycProvider on failure
   - Retry logic for transient failures (2 retries, exponential backoff)
   - Raw payloads redacted before logging (PII stripping)
   - Store: masked identifier + provider reference + match result
   - Support `KycVerificationProvider.NIBSS` (enum already exists in schema)
5. **Module wiring:** Register `NibssKycProvider` in `KycModule` and provide as `KYC_PROVIDER_GATEWAY` implementation (replacing `ManualKycProvider`). Keep `ManualKycProvider` as fallback.

### 2.4 NIBSS Developer Portal Onboarding

From the KYC guide and regulatory references:

**What is needed:**
1. Complete institutional onboarding with NIBSS (this is a human task — cannot be done programmatically)
2. Request access to **Financial Authentication Service** for:
   - BVN validation
   - NIN validation
   - vNIN (virtual NIN) validation
3. Sign contractual terms covering:
   - Data retention policies for identity attributes
   - Permitted use of returned PII
   - Audit and compliance requirements

**Sandbox credentials to expect:**
- NIBSS typically provides API key / client credentials for a sandbox environment
- Test BVN numbers (e.g., 22222222226 as seen in Monnify config)
- Test NIN numbers
- API documentation with endpoint URLs

**Known test BVN:** from `.env`: `MONNIFY_TEST_BVN=22222222226`

**Data retention considerations (from KYC guide):**
- Store the minimum needed for audit and risk decisions
- Never log BVN, NIN, or full identity payloads
- Encrypt all national identifiers at rest
- Return masked identifiers in API responses

### 2.5 Supabase KYC Bucket Setup Status

| Requirement | Status |
|-------------|--------|
| Bucket `kyc-documents` created | NOT YET (production only — sandbox may have it) |
| Bucket set as private | NOT YET |
| MIME restrictions (jpeg/png/webp/pdf) | Enforced in code (`KycService.createDocumentUploadUrl` checks content type) |
| File-size limit (8 MB) | Enforced in DTO (`CreateKycUploadDto.fileSize: 1 to 8*1024*1024`) |
| Signed upload URL flow | Complete in `SupabaseService.createSignedUploadUrl` (uses service role key) |
| Admin signed read URL flow | Complete in `KycService.createAdminDocumentReviewUrl` (creates 5-min signed URL) |
| Public access denied | Handled by private bucket setting (will be enforced when bucket created) |

**Key finding:** The code enforces MIME and size restrictions at the application layer (in `CreateKycUploadDto` and `KycService`), but Supabase bucket-level rules are not yet configured. Both layers should be enforced.

### 2.6 KYC Tier Progression UX Audit

| Feature | Dashboard UI | Admin UI | Status |
|---------|-------------|----------|--------|
| Current tier display | Shows `formatTier(currentTier)` | Shows in user detail panel | Complete |
| Tier capabilities list | Not shown — just shows status/tier/review path | Not shown — only status badges | MISSING |
| Next tier requirements | Not shown — no upgrade path visualization | N/A | MISSING |
| Progress indicator | Not shown | N/A | MISSING |
| Document upload form | Complete with type/ID/file fields | N/A | Complete |
| Verification status badges | Complete with color-coded badges | Complete | Complete |
| Rejection reason display | Not shown on dashboard | Shows in review dialog | MISSING (dashboard) |
| Tier progression history | Not shown | Not shown | MISSING |

### 2.7 Next Actions (Phase 2)

1. **Create `NibssKycProvider` adapter** implementing `KycProviderGateway` with BVN/NIN/vNIN verification
2. **Wire adapter in KycModule** — replace `ManualKycProvider` as primary, keep as fallback
3. **Create Supabase `kyc-documents` bucket** — private, MIME-restricted, 8MB limit
4. **Set `PII_ENCRYPTION_KEY`** in production secret manager (dev key present)
5. **Build tier progression UI** — add capabilities list, upgrade path, progress indicator to dashboard KYC page
6. **Add per-tier requirements** to KYC page (Tier 0->1 needs BVN or NIN, Tier 1->2 needs both)
7. **Complete NIBSS institutional onboarding** (human action required)

---

## PHASE 3: Notification Infrastructure

### 3.1 What Already Exists in the Codebase

| Artifact | File Path | Status |
|----------|-----------|--------|
| OTP Service | `BACKEND/src/otp/otp.service.ts` (117 lines) | Generates OTP, stores in Redis, verifies — but **does not actually send SMS** |
| OTP Module | `BACKEND/src/otp/otp.module.ts` | Registered globally |
| NotificationService (stub) | `BACKEND/src/exchange/providers/rate-alert.service.ts` (lines 8-57) | Stub — logs "would send" messages to Pino. Has `sendPushNotification()` and `sendInAppAlert()` |
| RateAlertService | Same file (lines 60-243) | Wired to use NotificationService stub — checks rates every 60s, calls stub methods |
| Exchange Module | `BACKEND/src/exchange/exchange.module.ts` | Provides NotificationService |
| Prisma RateAlert model | `BACKEND/prisma/schema.prisma` (lines 637-654) | Supports rate alerts (userId, from/to currency, targetRate, direction) |
| ExchangePayout.notificationSent | Schema field | Boolean flag for payout notifications |
| Auth sendOtp flow | `BACKEND/src/auth/auth.service.ts` | Calls `otpService.sendOtp()` but SMS delivery is a no-op |

### 3.2 SMS Provider Analysis

#### Current State
- OTP codes are generated and stored in Redis but **never actually transmitted via SMS**
- `OtpService.sendOtp()` logs "OTP generated" but has no SMS provider integration
- Auth registration calls `await this.otpService.sendOtp(phone)` which does not send

#### Provider Recommendations

**Option A: Africa's Talking (Recommended for Nigeria)**

Strengths:
- Strongest Nigerian delivery rates (direct operator connections)
- Supports alphanumeric Sender ID (required for Nigerian SMS)
- Cheaper per-SMS for high volume (~NGN 3-4/SMS)
- Nigerian entity, easier regulatory compliance
- Supports two-way SMS, USSD push, and voice OTP fallback

Considerations:
- Requires account setup with sender ID registration (NCC approval needed for alphanumeric IDs)
- Need to register `TRUSTPAY` sender ID with Nigerian operators

**Option B: Twilio**

Strengths:
- Global reach, mature API, extensive documentation
- Nigerian delivery has improved but historically lower than Africa's Talking
- Supports SMS, WhatsApp, voice
- Easy to set up and test

Considerations:
- More expensive for Nigeria (~$0.0379/SMS ≈ NGN 55)
- Nigerian sender ID registration requires separate process
- Sender ID compliance for Nigeria is more limited

**Recommendation: Africa's Talking** for primary SMS delivery to Nigerian numbers, with Twilio as fallback for international.

### 3.3 Email Provider Analysis

| Provider | Strengths | Considerations | Recommendation |
|----------|-----------|----------------|----------------|
| **SendGrid** (Twilio) | Mature, excellent deliverability, template editor, analytics | Transactional pricing (~$19.95/mo for 50k emails), strong Nigerian delivery | Strong choice |
| **Resend** | Modern API, great DX, React email templates | Newer platform, limited analytics | Good for dev speed |
| **AWS SES** | Cheapest ($0.10 per 1000 emails), production-grade | Requires domain verification, sandbox mode restricts sending initially, complex DKIM/SPF setup | Best for production scale |

**Recommendation: AWS SES** for production (cheapest at scale, already on AWS infrastructure), with **Resend** as development alternative (better DX, simpler setup).

### 3.4 Push Notification Requirements

**Current state:** `NotificationService` is a stub — it logs to Pino but does nothing.

**What needs building for Firebase Cloud Messaging:**

1. **Firebase project setup:**
   - Create/configure Firebase project
   - Enable Cloud Messaging API
   - Download service account JSON for server
   - Add Firebase to Flutter app (Android + iOS)
   - Add Firebase to web app

2. **Backend:**
   - Install `firebase-admin` npm package
   - Create `BACKEND/src/notifications/providers/firebase-push.provider.ts`
   - Implement: `sendToDevice(deviceToken, payload)`, `sendToTopic(topic, payload)`
   - Store device FCM tokens in DB (token + userId + platform + deviceId)
   - Handle token refresh and invalid token cleanup

3. **Notification types to support:**
   - Transaction completed (deposit confirmation)
   - Exchange rate alert (already wired in RateAlertService, just needs real delivery)
   - KYC status update (approved/rejected)
   - Security alert (new device login)
   - VTU purchase confirmation

### 3.5 Notification Preferences & Delivery Pipeline Architecture

**Current Prisma schema gap:** No notification tables exist. Need to add:

```prisma
model NotificationPreference {
  id        String   @id @default(uuid())
  userId    String
  channel   String   // "EMAIL" | "SMS" | "PUSH" | "IN_APP"
  type      String   // "TRANSACTION" | "SECURITY" | "PROMOTION" | "KYC" | "VTU"
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, channel, type])
  @@map("notification_preferences")
}

model Notification {
  id        String   @id @default(uuid())
  userId    String
  type      String
  title     String
  body      String
  channel   String   // Delivery channel used
  status    String   // "SENT" | "DELIVERED" | "FAILED"
  readAt    DateTime?
  metadata  Json?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, readAt, createdAt(sort: Desc)])
  @@map("notifications")
}
```

**Delivery pipeline architecture:**

```
Event occurs (transaction, KYC, security alert)
  -> NotificationService receives event
    -> Reads user NotificationPreference for event type
    -> Routes to channel(s):
       SMS  -> Africa's Talking API  (with retry once)
       Email -> AWS SES / Resend      (with retry once)
       Push -> Firebase FCM           (with retry once)
       In-App -> Insert into Notification table + WebSocket broadcast
    -> Records delivery status in Notification model
    -> On failure: retry once, log failure
```

### 3.6 Gaps Needing Filling

1. **No actual SMS sending** — OtpService creates OTPs but never transmits them
2. **No email infrastructure** — sendPasswordResetEmail and resendConfirmationEmail are referenced but not implemented with a real provider
3. **NotificationService is a stub** — just logs to Pino, no real push or in-app delivery
4. **No Prisma models for notifications** — need Notification and NotificationPreference tables
5. **No notification preferences UI** — no page for users to toggle email/SMS/push per type
6. **No FCM integration** — not even firebase-admin dependency installed
7. **No in-app notification center** — rate alerts create notifications that only exist in logs
8. **No notification badge** — no unread count indicator in navigation
9. **No device token management** — no table or API for registering FCM device tokens

### 3.7 Next Actions (Phase 3)

1. **Add Prisma models:** `Notification` and `NotificationPreference` — run migration
2. **Create `NotificationModule`** at `BACKEND/src/notifications/` — move NotificationService here from exchange module
3. **Implement SMS provider** (Africa's Talking): create `BACKEND/src/notifications/providers/sms.provider.ts`
   - Wire into OTP service for actual SMS delivery
   - Set `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` env vars
4. **Implement email provider** (Resend for dev, AWS SES for prod): create `BACKEND/src/notifications/providers/email.provider.ts`
   - Create email templates for 7 types (welcome, OTP, deposit, withdrawal, exchange, KYC status, security alert)
5. **Implement push notification provider** (Firebase FCM): create `BACKEND/src/notifications/providers/push.provider.ts`
6. **Add FCM device token management** — new table + API endpoints for register/unregister tokens
7. **Build notification preferences** — API + UI page at `/dashboard/notifications`
8. **Build in-app notification center** — read/unread, type filter, mark-all-read, badge count
9. **Wire NotificationService into existing events** — rate alerts (already wired), KYC status changes, VTU completions, deposits
10. **Add delivery retry** — retry failed deliveries once, log delivery status

---

## Summary: Target Scores & Critical Path

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| VTU & Bill Payments | 58 | 88 | Needs Reloadly sandbox credentials, Ghana testing, per-product health metrics |
| KYC & Identity | 54 | 87 | Needs NIBSS provider adapter, Supabase bucket creation, tier progression UX |
| Notifications | 40 | 85 | Needs all 4 channels built from scratch (only stub exists) |

**Critical path dependencies:**
1. NIBSS institutional onboarding (human task, required for >54 KYC score)
2. Reloadly sandbox signup (human task, required for international VTU and Ghana)
3. Africa's Talking account setup (human task, required for SMS delivery)
4. Firebase project setup (human task, required for push notifications)

**Code work order (no external sign-ups needed yet):**
1. Add Prisma notification models (blocks all notification development)
2. Create NibssKycProvider adapter code (can be built with config-based sandbox mode)
3. Build notification delivery pipeline architecture
4. Add tier progression UX components
5. Enhance VTU admin health metrics
