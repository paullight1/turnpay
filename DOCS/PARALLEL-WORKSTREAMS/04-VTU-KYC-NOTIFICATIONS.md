# 📡 Stream 4: VTU, KYC & Notifications — User Services Activation

> **Parallel Stream ID:** `STREAM-VTU-KYC`
> **Depends On:** Stream 2 (Core Infrastructure) for production deployment + Supabase buckets + secrets
> **Blocks:** VTU purchases, KYC verification, user notifications — all user-facing services
> **Target Score:** VTU 58→88, KYC 54→87, Notifications 40→85

---

## Current State

| Category | Score | Root Cause |
|---|---|---|
| VTU & Bill Payments | 58 | Provider abstraction exists but no live credentials, no sandbox tests, Ghana utilities not active |
| KYC & Identity | 54 | ManualKycProvider only; no NIBSS/NIMC integration; no production Supabase bucket |
| Notifications | 40 | SMS OTP coded but no production provider; email not built; push not activated |

**These Are The User-Facing Services.** VTU is the daily revenue driver. KYC is the regulatory gate. Notifications are the trust layer. All three need production providers activated.

---

## Phase 1: VTU Provider Activation

### Task 1.1 — Select & Onboard VTU Provider Per Market
- **Action:** Evaluate VTpass vs Reloadly for Nigeria (airtime, data, cable, electricity). Evaluate options for Ghana (ECG, NEDCo). Select primary provider per market based on: API reliability, pricing, supported products, settlement terms. Obtain sandbox credentials.
- **Agent:** `general-purpose` — research providers, compare APIs, document recommendation
- **Acceptance:** Provider selected for NG; provider identified for GH; sandbox credentials obtained

### Task 1.2 — VTU Sandbox Testing (Nigeria)
- **Action:** Execute low-value test purchases in provider sandbox: MTN airtime (₦100), Airtel data (₦200), DSTV subscription renewal, PHCN electricity (₦500). For each: verify provider API call succeeds, wallet debited, VTU order created, provider reference stored. Verify requery and reversal flows.
- **Agent:** `general-purpose` — run sandbox tests, verify database state at each step
- **Acceptance:** All 4 product types tested; requery returns correct status; reversal restores wallet balance; no double-debit

### Task 1.3 — VTU Failure Handling & Retry
- **Action:** Test failure scenarios: provider timeout (simulate with short timeout), provider error response, insufficient wallet balance, invalid meter/smartcard number. Verify: wallet not debited on failure, user sees clear error message, order marked failed, retry button available for timeout cases.
- **Agent:** `general-purpose` — write and execute VTU failure e2e tests
- **Acceptance:** All 5 failure scenarios handled correctly; no phantom debits; retry idempotent; stale orders (pending >5min) auto-requeried

### Task 1.4 — VTU Admin Operations Hardening
- **Action:** Enhance admin VTU page: provider health dashboard (success rate, avg latency, error breakdown by product), stale order detection (pending >5min), manual requery/retry/reverse buttons, pricing rule management UI.
- **Agent:** `general-purpose` — enhance `WEBSITE/src/app/admin/vtu/page.tsx` with health metrics and ops tools
- **Acceptance:** Admin sees real-time provider health; can manually resolve stuck orders; pricing rules configurable

### Task 1.5 — Ghana VTU Provider Selection (if not yet)
- **Action:** Identify provider for Ghana utilities (ECG electricity, NEDCo electricity). If no provider available, set `VTU_GHANA_UTILITIES_ENABLED=false` flag and update UI to show "Coming Soon" with estimated launch date instead of allowing failed purchases.
- **Agent:** `general-purpose` — research Ghana utility payment providers, implement or gate
- **Acceptance:** Either provider integrated and sandbox tested, or feature flag gates access with clear messaging

---

## Phase 2: KYC Provider Integration

### Task 2.1 — NIBSS/NIMC Provider Onboarding
- **Action:** Complete institutional onboarding with NIBSS Developer Portal for Financial Authentication Service. Request sandbox credentials for: BVN validation, NIN validation, vNIN validation. Confirm contract terms for storing identity attributes.
- **Agent:** `general-purpose` — guide onboarding steps, document requirements, track status
- **Note:** This task requires human action for institutional onboarding. Agent prepares documentation and tracks progress.
- **Acceptance:** NIBSS sandbox credentials obtained; API documentation reviewed; data retention policy confirmed

### Task 2.2 — Implement NIBSS KYC Provider Adapter
- **Action:** Create `NibssKycProvider` implementing the existing `KycProviderGateway` interface. Implement: `verifyBvn(input)` → call NIBSS BVN API → normalize response → store masked identifier + provider reference + match result. Same for `verifyNin` and `verifyVirtualNin`. Add timeout handling, retry, and fallback to `ManualKycProvider` on failure.
- **Agent:** `general-purpose` — create `BACKEND/src/kyc/providers/nibss-kyc.provider.ts`
- **Acceptance:** NIBSS provider returns normalized results; timeouts fall back to manual review; raw payloads redacted before logging; provider credentials from env vars

### Task 2.3 — KYC Sandbox Validation
- **Action:** In staging with NIBSS sandbox credentials: submit BVN verification for test identity → verify NIBSS sandbox returns match → verify KYC record created with masked BVN (`*****1234`) → verify tier upgraded on successful verification → verify admin can see full BVN in review → verify non-admin API response masks BVN.
- **Agent:** `general-purpose` — execute full KYC flow in staging
- **Acceptance:** BVN/NIN verification works end-to-end; PII encrypted at rest; masked in all non-admin responses; audit log created

### Task 2.4 — Supabase KYC Bucket Production Setup
- **Action:** Create `kyc-documents` bucket in production Supabase project. Set as private. Restrict MIME types to `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Set file-size limit to 8 MB. Verify signed upload URL flow and admin signed read URL flow work in production.
- **Agent:** `general-purpose` — create bucket via Supabase dashboard/API, configure rules, test upload flow
- **Acceptance:** Bucket created; MIME/size restrictions enforced; signed upload works; admin read URL expires after TTL; public access denied

### Task 2.5 — KYC Tier Progression UX
- **Action:** Build KYC tier status component showing: current tier with capabilities list, next tier with requirements, progress indicator, upload document button, verification status (pending/in-review/approved/rejected). For admin: add tier progression history to user detail view.
- **Agent:** `general-purpose` — build tier status component for web and Flutter
- **Acceptance:** User sees current tier, capabilities, and upgrade path; rejected KYC shows reason; admin sees full history

---

## Phase 3: Notification Infrastructure

### Task 3.1 — Production SMS Provider Configuration
- **Action:** Select SMS provider (Twilio or Africa's Talking based on Nigerian delivery rates and cost). Obtain production credentials. Configure in secret manager: `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`. Verify OTP delivery to Nigerian phone numbers in <30s.
- **Agent:** `general-purpose` — select provider, configure, test delivery to +234 numbers
- **Acceptance:** OTP delivered <30s to Nigerian numbers; delivery rate >95%; sender ID configured; cost per SMS documented

### Task 3.2 — Transactional Email Implementation
- **Action:** Select email provider (SendGrid, Resend, or AWS SES). Implement email templates for: welcome/registration, OTP alternative delivery, deposit confirmed, withdrawal initiated/completed/failed, exchange completed, KYC status change, suspicious activity alert. Use responsive HTML templates.
- **Agent:** `general-purpose` — set up email provider, create templates, integrate with backend event emitter
- **Acceptance:** All 7 email types sent; templates render on mobile + desktop; unsubscribe link functional; email events logged

### Task 3.3 — Push Notification Activation
- **Action:** Configure Firebase Cloud Messaging (FCM) for both Flutter (Android + iOS) and web. Implement push notification service in backend. Send push for: transaction completed, deposit received, exchange rate alert (from Stream 1 Task 3.3), KYC status update, security alert (new device login).
- **Agent:** `general-purpose` — configure FCM, implement push service, wire to Flutter + web
- **Acceptance:** Push notifications delivered to Android, iOS, and web; notification tap opens relevant screen; notification preferences respected

### Task 3.4 — In-App Notification Center
- **Action:** Build notification center in web (`/dashboard/notifications`) and Flutter: list of notifications with read/unread, type filter (transaction/security/promotion), mark all read, notification preferences toggle (email/push/SMS per type), notification badge count on nav.
- **Agent:** `general-purpose` — create notification center UI + API endpoints
- **Acceptance:** Notifications persist; read state synced across devices; preferences respected at send time; badge count accurate

### Task 3.5 — Notification Preferences & Delivery Pipeline
- **Action:** Build notification routing: user sets preferences (e.g., email for deposits, push for transactions, SMS for security). Backend `NotificationService` routes to correct channel(s) based on preferences. Implement delivery status tracking (sent/delivered/failed). Retry failed deliveries once.
- **Agent:** `general-purpose` — implement notification service with routing, preferences, and delivery tracking
- **Acceptance:** Preferences enforced per-channel per-type; failed delivery retried once; delivery status logged; user can update preferences

---

## Phase 4: VTU Production Go-Live

### Task 4.1 — VTU Production Credentials
- **Action:** Obtain production VTU provider credentials. Store in production secret manager. Set `VTU_ENABLED=true` in production. Configure production webhook URL for Reloadly (if using Reloadly).
- **Agent:** `general-purpose` — update secrets, verify production connectivity
- **Acceptance:** Production VTU API call succeeds; wallet balance checked; products list returns live catalog

### Task 4.2 — VTU Production Smoke Test
- **Action:** Execute minimal real purchases in production: ₦100 MTN airtime, ₦200 Airtel data, validate delivery. Verify: wallet debited correct amount, provider confirms delivery, order marked success, VTU transaction in history, admin VTU dashboard shows the order.
- **Agent:** `general-purpose` — execute smoke tests, monitor admin dashboard
- **Acceptance:** All 2 test purchases succeed; delivery confirmed by provider; wallet balance correct; admin dashboard updated

### Task 4.3 — KYC + VTU Integration Test
- **Action:** Verify Tier 2 KYC gate: unverified user cannot purchase VTU → complete KYC verification → user can purchase VTU. Verify daily VTU limit enforced.
- **Agent:** `general-purpose` — execute gating test
- **Acceptance:** Tier 0/1 blocked from VTU; Tier 2 can purchase; daily limit enforced

---

## Phase 5: Production Go-Live

### Task 5.1 — All Notification Channels Verified
- **Action:** Trigger test notifications via all channels: SMS OTP to test number, welcome email to test address, push notification to test device, in-app notification for test transaction. Verify delivery, content, and timing.
- **Agent:** `general-purpose` — trigger and verify all channels
- **Acceptance:** All 4 channels deliver; content correct; timing <30s for SMS, <5s for push/in-app, <60s for email

### Task 5.2 — KYC Production Readiness
- **Action:** Verify: NIBSS provider active (not ManualKycProvider) in production, Supabase KYC bucket created and restricted, PII_ENCRYPTION_KEY unique per environment, admin KYC review queue functional with production data, masked identifiers in all non-admin responses.
- **Agent:** `general-purpose` — audit KYC production configuration
- **Acceptance:** All 5 checks pass; zero PII leaks in API responses

### Task 5.3 — VTU/KYC/Notifications Go-Live Sign-Off
- **Action:** Complete go-live checklist: VTU provider live + smoke tested, NIBSS KYC provider live, Supabase bucket production-ready, all notification channels verified, feature flags configured correctly, rollback plan documented.
- **Agent:** `general-purpose` — verify each item, produce sign-off report
- **Acceptance:** All items ✅; compliance/ops/engineering sign off

---

## Success Metrics

| Category | Current | Target |
|---|---|---|
| VTU & Bill Payments | 58 | **88** |
| KYC & Identity | 54 | **87** |
| Notifications | 40 | **85** |
| VTU Sandbox Tests Passing | 0% | 100% (4 products + failure cases) |
| KYC Provider Active | Manual only | NIBSS live, manual as fallback |
| SMS Delivery Rate | N/A | >95% to Nigerian numbers |
| Notification Channels Active | 0 of 4 | 4 of 4 (SMS, email, push, in-app) |

---

## Agent Execution Guide

```bash
# Terminal 4: VTU/KYC/Notifications Stream

# Phase 1: VTU activation
claude "Execute Phase 1 of DOCS/PARALLEL-WORKSTREAMS/04-VTU-KYC-NOTIFICATIONS.md — activate VTU providers"
# Phase 2: KYC integration
claude "Execute Phase 2 of DOCS/PARALLEL-WORKSTREAMS/04-VTU-KYC-NOTIFICATIONS.md — integrate KYC provider"
# Phase 3: Notifications
claude "Execute Phase 3 of DOCS/PARALLEL-WORKSTREAMS/04-VTU-KYC-NOTIFICATIONS.md — build notification infrastructure"
# Phase 4: VTU go-live
claude "Execute Phase 4 of DOCS/PARALLEL-WORKSTREAMS/04-VTU-KYC-NOTIFICATIONS.md — VTU production go-live"
# Phase 5: Final go-live
claude "Execute Phase 5 of DOCS/PARALLEL-WORKSTREAMS/04-VTU-KYC-NOTIFICATIONS.md — production sign-off"
```

---

## Dependencies

| Dependency | Stream | Status |
|---|---|---|
| Production backend + database | Stream 2 | 🔜 Required before Phase 2 |
| Production Supabase project + buckets | Stream 2 | 🔜 Required before Phase 2 Task 2.4 |
| Production secrets (VTU, SMS, email keys) | Stream 2 | 🔜 Required before Phase 1/3 |
| Exchange rate alerts (for push notifications) | Stream 1 | 🤝 Parallel — Stream 1 defines alert triggers, Stream 4 delivers them |
| Admin panel (VTU admin page) | Stream 5 | 🤝 Parallel — VTU admin page exists, Stream 4 enhances it |

---

*Last updated: 2026-05-31 | Stream ID: STREAM-VTU-KYC*
