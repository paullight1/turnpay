# 📱 Stream 5: Multi-Platform UI, Admin Ops & UX Polish

> **Parallel Stream ID:** `STREAM-UI`
> **Depends On:** Stream 2 (Core Infrastructure) for production backend URL + CI/CD
> **Blocks:** User-facing quality; admin operational capability
> **Target Score:** Multi-Platform 61→90, Admin 50→88, UX across all categories +15-20 points each

---

## Current State

| Category | Score | Root Cause |
|---|---|---|
| Multi-Platform | 61 | Web is mature (27 pages); Flutter has functional foundation but lacks wallet/deposit parity, uses mock data in places |
| Admin & Operations | 50 | Basic pages exist (finance, KYC, support, VTU) but operations not hardened, no rich detail views, no dual-control UI |
| Cross-cutting UX | 54 | Loading/error/empty states inconsistent; Flutter behind web; admin workflows incomplete |

**This Stream Polishes Everything The User Touches.** It takes the functional code from Streams 1-4 and makes it production-quality across web, mobile, and admin surfaces.

---

## Phase 1: Flutter Mobile Parity

### Task 1.1 — Flutter Wallet Detail Screen
- **Action:** Build `WalletDetailScreen`: account number display with copy-to-clipboard, real-time balance (pull-to-refresh), transaction history list (paginated, loaded from API), Send Money + Receive Money CTAs that navigate to the correct flows, virtual account info card (if provisioned).
- **Agent:** `general-purpose` — create screen at `APP/lib/features/home/screens/wallet_detail_screen.dart`, wire to `HomeDataService`, add to router
- **Acceptance:** Navigate from wallet card tap → wallet detail; balance is live; transactions are API-backed; copy works; flutter analyze + widget test pass

### Task 1.2 — Flutter Receive Money Screen
- **Action:** Build receive money flow: virtual account number with copy button and share, bank name display, deposit instructions (what the sender sees), recent deposits list (API-backed), expected arrival time messaging.
- **Agent:** `general-purpose` — create receive money screen, integrate with banking API
- **Acceptance:** Virtual account displayed; copy + share work; deposit instructions clear; deposit history loads from API

### Task 1.3 — Flutter Remove Mock Data
- **Action:** Audit all Flutter screens for hardcoded/mock data. Replace with: real API calls or explicit empty states with helpful messaging. Focus areas: home screen recent transactions, recent recipients, analytics charts, transaction list.
- **Agent:** `general-purpose` — grep for mock data patterns, replace with API calls
- **Acceptance:** Zero mock data displayed to users; empty states show helpful messages; flutter analyze clean; all widget tests pass

### Task 1.4 — Flutter Exchange Screen Parity
- **Action:** Align Flutter exchange screen with web: live quote with countdown timer, fee breakdown, rate source indicator, transaction success screen with shareable receipt, loading skeleton during rate fetch, error state with retry.
- **Agent:** `general-purpose` — enhance money action exchange screen
- **Acceptance:** Flutter exchange matches web feature-for-feature; widget test passes

### Task 1.5 — Flutter KYC & Virtual Account Screens
- **Action:** Build Flutter KYC submission flow: tier status display, document upload (with camera/gallery picker), verification status tracker. Build virtual account management: provision account button, account details view, deposit history.
- **Agent:** `general-purpose` — create KYC and virtual account screens
- **Acceptance:** User can submit KYC from mobile; virtual account can be provisioned and viewed; flutter analyze clean

### Task 1.6 — Flutter Notification Center
- **Action:** Build notification center screen: notification list (API-backed), read/unread indicator, tap to navigate to relevant screen, pull-to-refresh, mark all read, notification badge on bottom nav.
- **Agent:** `general-purpose` — create notification screen + badge, wire to notification API
- **Acceptance:** Notifications load from API; tap navigates correctly; badge shows unread count; pull-to-refresh works

### Task 1.7 — Flutter App Store Readiness
- **Action:** Configure: app icon (all sizes), splash screen (branded), app name + bundle ID, iOS provisioning profile, Android keystore, production API base URL in build config, Sentry Flutter SDK with source maps, privacy policy URL, app store screenshots.
- **Agent:** `general-purpose` — configure build settings, generate assets
- **Acceptance:** `flutter build appbundle` (Android) succeeds; `flutter build ipa` (iOS) succeeds; app icon + splash correct; Sentry captures test error

---

## Phase 2: Admin Panel Operations Hardening

### Task 2.1 — Admin User Detail View
- **Action:** Build comprehensive user detail page at `/admin/users/[id]`: profile info, all wallets with balances, KYC tier + status + documents, virtual accounts, recent transactions, support tickets, account status (active/suspended), limits, audit log filtered by user. Add actions: suspend/unsuspend, adjust limits, view full KYC data (audited access).
- **Agent:** `general-purpose` — create user detail page with all data sections
- **Acceptance:** Admin can see complete user picture on one page; all actions audit logged; PII access restricted + logged

### Task 2.2 — Admin Transaction Detail View
- **Action:** Build enriched transaction detail: transaction metadata (amount, currency, type, status, reference), masked provider metadata, linked ledger entries (balance before/after), provider events timeline, admin audit trail for this transaction, action buttons (retry for failed, verify for pending withdrawals).
- **Agent:** `general-purpose` — enhance transaction detail with all linked data
- **Acceptance:** Admin sees complete transaction lifecycle; provider events timeline visible; audit trail visible; retry/verify actions work

### Task 2.3 — Admin Pending Withdrawal Operations
- **Action:** Build dedicated pending withdrawals view at `/admin/withdrawals`: list of pending withdrawals with amount/user/date/bank, filter by status (pending/processing), bulk verify action, individual verify with provider status check, link to transfer attempts.
- **Agent:** `general-purpose` — create withdrawal operations page
- **Acceptance:** Pending withdrawals listed; bulk/inidividual verify works; provider status check integrated; audit logged

### Task 2.4 — Admin Dual-Control UI
- **Action:** Build dual-control approval workflow UI: pending approvals list (shows what needs second approval), approve/reject with reason, approval history, notification when approval is requested. Cover: high-value exchange deposits (>₦1M), high-value withdrawals (>₦5M), manual wallet credits, FX rate changes >5%.
- **Agent:** `general-purpose` — create dual-control UI pages and integrate with admin service
- **Acceptance:** First approver submits; second approver sees pending; both must be different admins; rejection/approval audit logged

### Task 2.5 — Admin Role Segmentation
- **Action:** Implement admin roles beyond `ADMIN`: `SUPPORT` (view users/transactions, manage tickets), `FINANCE` (view financial data, reconcile, approve transactions), `COMPLIANCE` (KYC review, audit logs, user verification), `SUPER_ADMIN` (all access, manage other admins). Gate all admin endpoints by role.
- **Agent:** `general-purpose` — add roles to Prisma schema, implement role guard, update admin UI to show role-appropriate views
- **Acceptance:** Each role sees only authorized pages; role guard blocks unauthorized API calls; super admin can manage roles

### Task 2.6 — Admin Export & Bulk Actions
- **Action:** Add export capability (CSV/PDF) for: transaction list (filtered by date/type/status), user list, reconciliation reports, KYC submissions, VTU orders. Add bulk actions: bulk verify withdrawals, bulk suspend users, bulk retry failed VTU orders. All with confirmation dialog and audit log.
- **Agent:** `general-purpose` — implement export + bulk action endpoints and UI
- **Acceptance:** CSV export downloads with correct data; PDF export formatted; bulk actions process all selected items; audit logged per item

---

## Phase 3: Web UX Polish

### Task 3.1 — Global Loading, Error & Empty State Audit
- **Action:** Audit all 27 web pages for consistent handling of: loading states (skeleton screens, not spinners everywhere), error states (toast + retry + fallback content), empty states (illustration + helpful message + CTA), success states (confirmation + next action). Standardize patterns across all pages.
- **Agent:** `general-purpose` — audit every page, implement consistent state components
- **Acceptance:** No raw spinners; error toasts have retry; empty states guide the user; success states confirm + suggest next step

### Task 3.2 — Responsive Design Audit (Desktop/Tablet/Mobile)
- **Action:** Test every page at 3 breakpoints: 1440px (desktop), 768px (tablet), 375px (mobile). Fix: overflow, touch targets too small (<44px), text truncation, modal/drawer behavior, table horizontal scroll on mobile, bottom nav vs sidebar nav.
- **Agent:** `general-purpose` — manual QA at each breakpoint, fix issues
- **Acceptance:** All pages usable at all 3 breakpoints; no horizontal overflow; touch targets ≥44px; mobile nav works

### Task 3.3 — Web E2E Smoke Tests
- **Action:** Write Playwright tests covering: login → dashboard load, wallet card → wallet detail page, receive-money flow, Monnify exchange deposit intent flow, admin exchange queue review flow, KYC submission flow, VTU purchase flow, support ticket creation. Run on Chromium + Mobile Safari.
- **Agent:** `general-purpose` — create comprehensive smoke test suite
- **Acceptance:** All 8 core flows pass; tests run in CI; visual regression not triggered by expected changes

### Task 3.4 — Accessibility Audit
- **Action:** Audit web pages for: semantic HTML (headings, landmarks, forms), keyboard navigation (tab order, focus indicators), screen reader labels (aria-label on icon buttons, alt text on images), color contrast (WCAG AA minimum), focus management after navigation/modal open.
- **Agent:** `general-purpose` — run axe DevTools or Lighthouse accessibility audit, fix issues
- **Acceptance:** Lighthouse accessibility score ≥90; all interactive elements keyboard-accessible; screen reader can complete core flows

### Task 3.5 — Marketing & Public Pages Polish
- **Action:** Polish public-facing pages: landing page (`/`), features (`/features`), exchange info (`/exchange`), VTU info (`/vtu`), security (`/security`), support (`/support`), company (`/company`). Ensure: consistent branding, clear CTAs linking to register, mobile-responsive, fast load (Lighthouse performance ≥80).
- **Agent:** `general-purpose` — audit and polish all public pages
- **Acceptance:** Landing page loads in <2s; all CTAs functional; consistent brand; mobile-optimized; SEO meta tags present

---

## Phase 4: Cross-Platform Consistency

### Task 4.1 — Design Token Standardization
- **Action:** Audit color, typography, spacing, and component patterns across web (shadcn/ui + Tailwind) and Flutter (Material theme). Document differences. Align on brand colors, button styles, card patterns, form inputs, and status badges. Create a design token reference in `DOCS/DESIGN-TOKENS.md`.
- **Agent:** `general-purpose` — audit both platforms, create token reference, align where practical
- **Acceptance:** Design token doc created; web and Flutter use same brand colors; component patterns documented; known acceptable differences noted

### Task 4.2 — Copy & Messaging Consistency
- **Action:** Audit all user-facing copy across web, Flutter, emails, and notifications. Standardize: product name (TRUSTPAY), Send/Receive Money wording (not Add/Fund where confusing), processing time expectations ("Credits within 1 business day after admin review" not "Instant"), error messages (helpful, not technical), empty states (encouraging, not blank).
- **Agent:** `general-purpose` — audit all copy, create copy guide, fix inconsistencies
- **Acceptance:** Copy guide created; Flutter uses same terminology as web; no misleading instant-credit promises; error messages user-friendly

### Task 4.3 — African Market UX Refinements
- **Action:** Verify: currency formatting (₦ for NGN, GH₵ for GHS) everywhere, Nigerian phone number formatting (+234 XXX XXX XXXX), network/utility names correct and up-to-date, timezone handling (WAT/GMT+1), date formatting locale-appropriate, Ghana utility payments either functional or clearly gated.
- **Agent:** `general-purpose` — audit all UIs for localization correctness
- **Acceptance:** All currencies formatted correctly; phone numbers validated with correct pattern; network names verified; date/times local

---

## Phase 5: Production Validation

### Task 5.1 — Flutter Production Build & Distribution
- **Action:** Build production APK + AAB (Android) and IPA (iOS). Set up: Google Play Console listing, App Store Connect listing, Internal Testing track (Android) + TestFlight (iOS). Distribute to internal testers. Verify: app installs, auth works against production backend, core flows functional.
- **Agent:** `general-purpose` — build, set up store listings, distribute
- **Acceptance:** App installs on test devices; connects to production backend; auth, dashboard, transactions work

### Task 5.2 — Admin Smoke Test in Production
- **Action:** As super admin in production: view dashboard stats, search for user, view user detail, review a KYC submission, view transaction detail, verify a pending withdrawal (if any), run reconciliation report, check VTU health dashboard, view audit logs.
- **Agent:** `general-purpose` — execute admin smoke test checklist
- **Acceptance:** All admin operations functional; stats display real data; audit log captures admin actions

### Task 5.3 — Full Cross-Platform User Journey Test
- **Action:** Execute complete user journey on both web and mobile: register → verify OTP → set PIN → complete KYC (Tier 2) → provision virtual account → fund wallet → exchange GHS→NGN → purchase VTU → send money to another user → withdraw to bank → view transaction history → check notifications.
- **Agent:** `general-purpose` — execute full journey on both platforms, document results
- **Acceptance:** Complete journey succeeds on both platforms; any platform-specific issues documented; all states handled gracefully

### Task 5.4 — Final Sign-Off
- **Action:** Produce launch readiness report covering: all 5 streams completed, P0 blockers resolved, security audit passed, load test passed, reconciliation verified, backup/restore tested, rollback plan documented, monitoring active, feature flags configured, named owners signed off.
- **Agent:** `general-purpose` — compile final report
- **Acceptance:** All streams ✅; go/no-go decision documented; launch date set

---

## Success Metrics

| Category | Current | Target |
|---|---|---|
| Multi-Platform | 61 | **90** |
| Admin & Operations | 50 | **88** |
| Cross-cutting UX (all cats) | 54 avg | **82 avg** |
| Flutter Screens at Production Parity | ~60% | 100% |
| Web Pages with Proper State Handling | ~40% | 100% |
| Admin Operations Complete | ~50% | 100% |
| Accessibility Score | Unknown | ≥90 Lighthouse |
| Responsive Design QA | Not done | All 3 breakpoints pass |

---

## Agent Execution Guide

```bash
# Terminal 5: Multi-Platform UI & Admin Stream

# Phase 1: Flutter parity
claude "Execute Phase 1 of DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md — Flutter mobile parity"
# Phase 2: Admin hardening
claude "Execute Phase 2 of DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md — admin operations hardening"
# Phase 3: Web UX polish
claude "Execute Phase 3 of DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md — web UX polish"
# Phase 4: Cross-platform consistency
claude "Execute Phase 4 of DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md — cross-platform consistency"
# Phase 5: Production validation
claude "Execute Phase 5 of DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md — production validation"
```

---

## Dependencies

| Dependency | Stream | Status |
|---|---|---|
| Production backend URL (for Flutter + web config) | Stream 2 | 🔜 Required before Phase 5 |
| Banking API (for wallet detail, virtual accounts) | Stream 3 | 🤝 Parallel — Stream 5 builds UI, Stream 3 builds API |
| Notification API (for notification center) | Stream 4 | 🤝 Parallel — Stream 4 builds API, Stream 5 builds UI |
| Exchange API (for Flutter exchange screen) | Stream 1 | 🤝 Parallel — Stream 1 builds API, Stream 5 builds UI |
| CI/CD (for Flutter builds + Playwright) | Stream 2 | 🔜 Required before Phase 5 |

---

*Last updated: 2026-05-31 | Stream ID: STREAM-UI*
