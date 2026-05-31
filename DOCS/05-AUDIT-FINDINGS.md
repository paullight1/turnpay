# Multi-Platform & UX Audit Findings

**Generated:** 2026-05-31  
**Scope:** Phase 1 (Flutter Mobile Parity) + Phase 3 (Web UX Polish)  
**Source:** DOCS/PARALLEL-WORKSTREAMS/05-MULTIPLATFORM-ADMIN-UX.md

---

## Phase 1: Flutter Mobile Parity — Audit Report

### 1.1 Flutter Screen Inventory & Current State

| Screen | File | API-Backed | Mock Data | Status |
|---|---|---|---|---|
| Home | `APP/lib/features/home/screens/home_screen.dart` | Yes (HomeDataService) | None visible | PRODUCTION-READY |
| Dashboard Detail (wallets/VA/activity/KYC/notifications) | `APP/lib/features/home/screens/dashboard_detail_screen.dart` | Yes (HomeDataService) | None visible | PRODUCTION-READY |
| Money Action (fund/send/withdraw/exchange/VTU) | `APP/lib/features/home/screens/money_action_screen.dart` | Partial | Hardcoded fallback VTU providers (lines 687-789) | MIXED |
| Wallet Detail | `APP/lib/features/wallet/screens/wallet_detail_screen.dart` | Yes (WalletService) | None | PRODUCTION-READY |
| Transaction Security | `APP/lib/features/security/screens/transaction_security_screen.dart` | Yes (TransactionSecurityService) | None | PRODUCTION-READY |
| Transactions | `APP/lib/features/transactions/screens/transactions_screen.dart` | Yes (extends DashboardTransactionsScreen) | None | PRODUCTION-READY |
| Profile | `APP/lib/features/profile/screens/profile_screen.dart` | Yes (extends DashboardProfileScreen) | None | PRODUCTION-READY |
| Login | `APP/lib/features/auth/screens/login_screen.dart` | Yes | None | PRODUCTION-READY |
| Register | `APP/lib/features/auth/screens/register_screen.dart` | Yes | None | PRODUCTION-READY |
| Analytics | `APP/lib/features/analytics/screens/analytics_screen.dart` | **NO** | **100% hardcoded** (lines 19-47) | BROKEN |
| Home Task / Feature Hub | `APP/lib/features/home/screens/home_task_screen.dart` | N/A (static hub) | N/A | STATIC OK |
| Forgot Password | `APP/lib/features/auth/screens/forgot_password_screen.dart` | Yes | None | PRODUCTION-READY |
| OTP | `APP/lib/features/auth/screens/otp_screen.dart` | Yes | None | PRODUCTION-READY |
| Splash | `APP/lib/features/auth/screens/splash_screen.dart` | Yes | None | PRODUCTION-READY |
| Onboarding | `APP/lib/features/auth/screens/onboarding_screen.dart` | N/A | N/A | STATIC OK |

### 1.2 Specific Gaps vs Web Parity

#### P0 — Launch Blockers

| # | Gap | Flutter State | Web State | File/Line Reference |
|---|---|---|---|---|
| 1 | **Analytics screen is entirely mock data** | Hardcoded `_spendCategories` (4 categories, GH amounts like "GHâ‚µ 6,542.18"), `_weeklyData` array, static "73%" donut center. No API call exists. | Web analytics are API-backed. | `analytics_screen.dart` lines 19-47, 298-301, 464-476 |
| 2 | **No Receive Money screen** | `WalletDetailScreen` navigates to `AppRoutes.receiveMoney` but no route or screen exists for this path. | `/dashboard/fund` has full receive flow (virtual account display, copy, instructions, deposit history). | `wallet_detail_screen.dart` line 115; `app_router.dart` — no receiveMoney route defined |
| 3 | **No KYC document upload** | Flutter KYC is a read-only status display (`_KycBody` — shows tier/status only). No document upload form, no file picker, no camera/gallery integration. | `/dashboard/kyc` has full upload flow with file type validation, upload-to-signed-url, history. | `dashboard_detail_screen.dart` lines 2085-2122 (KycBody) |

#### P1 — Important

| # | Gap | Flutter State | Web State | File/Line Reference |
|---|---|---|---|---|
| 4 | **No notification center** | `/notifications` route shows a static `_EmptyPanel` with "No notifications" text. No API integration, no read/unread, no badge count. | Web likely has notification support (bell icon in layout). | `dashboard_detail_screen.dart` lines 716-723; `app_router.dart` line 74-79 |
| 5 | **Exchange screen missing countdown timer** | `_ExchangeSwapPanel` shows rate but no countdown to expiry. No `rateSource` indicator. | Web shows "Expires at <time>" badge. | `money_action_screen.dart` — no expiry display or timer. Web: `exchange/page.tsx` line 732-735 |
| 6 | **Fee breakdown not shown on exchange** | `_reviewRows` for exchange shows send/receive/rate only. No fee display. | Web shows fee breakdown (`payoutQuote.fee`). | `money_action_screen.dart` lines 1364-1381 |
| 7 | **No exchange success/receipt screen** | After quote creation, user sees generic text "After the quote is created, you will add where the converted payout should be sent." No proper confirmation. | Web has exchange quote execution with confirm step, receipt history table, payout history. | `money_action_screen.dart` lines 1638-1641 |
| 8 | **No loading skeleton for exchange rate** | Uses generic spinner via `_InfoPanel` text ("Loading rate...") rather than a skeleton. | Web uses proper skeleton components. | `money_action_screen.dart` lines 1568-1657 |
| 9 | **No push notification badge** | Home top bar notification button has no badge count. | Web likely shows unread badge. | `home_screen.dart` line 207-211 |
| 10 | **VTU fallback hardcoded data** | When API fails, `_fallbackLocalProviders` returns hardcoded MTN/Airtel/Glo/9mobile for airtime and 10+ hardcoded electricity discos. | Web uses API only (falls to empty state). | `money_action_screen.dart` lines 687-789 |

#### P2 — Nice-to-Have

| # | Gap | Details | Reference |
|---|---|---|---|
| 11 | **No biometric login** | Web likely has biometric support. Flutter has biometric for transaction PIN only. | `transaction_security_screen.dart` |
| 12 | **Exchange quote not auto-refreshed** | Rate fetched once on initState; no periodic refresh or countdown to detect stale rate. | `money_action_screen.dart` lines 142-188 |
| 13 | **No "See all" on wallet detail** | History shown only for deposits (FUND type), capped at 10. No pagination. | `wallet_detail_screen.dart` lines 94-97 |
| 14 | **No exchange rate from/to config** | AppConstants not checked for exchange pairs. | `app_constants.dart` |
| 15 | **No settings/privacy screens** | No dedicated settings or privacy page in Flutter. | Not in router |

### 1.3 Service Layer Assessment

| Service | File | API Endpoints | Status |
|---|---|---|---|
| ApiClient | `services/api_client.dart` | Token auth, refresh, idempotency, logging | ROBUST |
| AuthService | `services/auth_service.dart` | `/auth/login`, `/register`, `/logout`, `/refresh`, `/otp/*`, `/forgot-password`, `/sessions` | ROBUST |
| HomeDataService | `services/home_data_service.dart` | `/auth/bootstrap`, `/transactions`, `/banking/accounts`, `/banking/accounts/provision`, `/support/tickets` | ROBUST |
| WalletService | `services/wallet_service.dart` | `/wallets`, `/wallets/:currency`, `/transactions`, `/transactions/:ref`, `/banking/accounts`, `/banking/accounts/provision` | ROBUST, rich models (ExchangeReceiptData, VtuOrderData, etc.) |
| VtuService | `services/vtu_service.dart` | `/vtu/providers`, `/vtu/packages`, `/vtu/orders/:ref/requery`, `/vtu/orders/:ref` | ROBUST |
| TransactionSecurityService | `services/transaction_security_service.dart` | Local PIN storage, biometric | ADEQUATE |

All services are API-backed via Dio with proper auth interceptors. The data models in `wallet_service.dart` (lines 239-555) are particularly rich, supporting transaction details with ledgers, transfer attempts, exchange receipts/payouts, VTU orders, and disputes — but these models are not utilized by any Flutter screen.

### 1.4 Router Analysis

**File:** `APP/lib/core/router/app_router.dart`

**Routes configured:** splash, home, notifications, kyc, fund, send, withdraw, exchange, exchange/settlement, airtime, data, electricity, wallets, virtual-account, activity, vtu/order/:ref, more, onboarding, login, register, otp, forgot-password, profile-account, profile-appearance, profile-security, transaction-security, profile-support

**Missing routes from web parity:**
- `/receive-money` (referenced in wallet_detail_screen.dart line 115 but not in router)
- `/exchange/receipt` or success screen (only exchange settlement exists)
- `/settings`
- Binded to `AppRoutes.receiveMoney` which is not defined in `AppRoutes` class

---

## Phase 3: Web UX Polish — Audit Report

### 3.1 Page Inventory (26 page.tsx files found)

**Marketing/Public (10 pages):**
`/` (landing), `/features`, `/exchange`, `/vtu`, `/security`, `/support`, `/company`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/not-found`, `/error`

**Dashboard (10 pages):**
`/dashboard`, `/dashboard/wallet/[currency]`, `/dashboard/fund`, `/dashboard/exchange`, `/dashboard/withdraw`, `/dashboard/transactions`, `/dashboard/transactions/[id]`, `/dashboard/vtu`, `/dashboard/kyc`, `/dashboard/profile`, `/dashboard/support`

**Admin (5 pages):**
`/admin`, `/admin/kyc`, `/admin/support`, `/admin/vtu`, `/admin/users` (inlined in admin/page.tsx)

### 3.2 State Handling Audit

#### Pages With Full State Coverage (Loading + Error + Empty + Success):

| Page | Loading | Error | Empty | Success | Notes |
|---|---|---|---|---|---|
| `/dashboard` | Skeleton | Card + retry + msg | Illustration + CTA | Confirmation | Full coverage. Example: `page.tsx` lines 72-86, 298-323, 378-416 |
| `/dashboard/wallet/[currency]` | Skeleton | LightError + retry | CTA + guidance | Toast + state | Full coverage. Lines 229-231, 263-272, 368-403 |
| `/dashboard/fund` | Animation loader | Toast | Provision form | Toast + animation | Full coverage. Lines 280-289, 150-185 |
| `/dashboard/kyc` | Text loader | Error panel + retry | "No documents" | Toast + refetch | Full coverage. Lines 269-314 |
| `/dashboard/vtu` | Partial | Toast | Partial | Toast | VTU order tracking present |
| `/dashboard/support` | Skeleton | Toast | Present | Toast + reset | Full coverage. Lines 50-75 |
| `/admin` | Skeleton | Toast / Error panels | Present | Toast | Comprehensive. Lines 1397-1401, 1574-1577, 2159-2162 |
| `/admin/kyc` | Full-page text | Toast | Present | Toast | Has pagination. Lines 220-223, 134-145 |

#### Pages With Gaps:

| Page | Loading | Error | Empty | Success | Gap |
|---|---|---|---|---|---|
| `/dashboard/exchange` | Partial (no skeleton for quote load) | Toast only | Dashed border placeholder | Toast | Missing: skeleton during quote fetch; no success confirmation screen after execute. Lines 873-876 show basic text for receipt loading. |
| `/dashboard/transactions` | Skeleton | **Missing** | Text "No transactions found" | N/A | **P1**: Error state not present in first 100 lines. If query fails, no visible error recovery. |
| `/dashboard/profile` | Not reviewed in full | | | | Likely has states from layout pattern. |
| `/exchange` (public) | N/A | N/A | N/A | N/A | Static marketing page. |
| Marketing pages | N/A | N/A | N/A | N/A | Static content. |

### 3.3 Responsive Design Observations (Code Review)

**Strengths:**
- All dashboard pages use `mx-auto max-w-5xl` or similar constraints for centering
- Tailwind responsive prefixes used consistently (`sm:`, `md:`, `lg:`, `xl:`)
- Grid layouts degrade gracefully (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`)
- Tables use responsive overflow patterns
- Button groups wrap with `flex-wrap` on mobile
- Admin page uses overflow-x-auto on TabsList (line 1346)

**Potential Issues (code review only, no browser testing):**

| # | Issue | Location | Priority |
|---|---|---|---|
| 1 | Transaction table may overflow on 375px | `/admin` line 1403-1449 (Table with 7 columns) | P1 |
| 2 | Exchange page 3-tab TabsList may overflow on mobile | `/dashboard/exchange` line 605-618 | P1 |
| 3 | Some `min-w-0` patterns may cause text overflow | Multiple files | P2 |
| 4 | VTU TabsList with 4+ service types may clip | `/dashboard/vtu` | P1 |
| 5 | Admin KYC table has 6 columns — potential overflow | `/admin/kyc` table | P1 |

### 3.4 Accessibility Observations

Review performed via code audit. Full Lighthouse audit requires browser.

**Strengths:**
- `aria-hidden="true"` on decorative icons — used throughout
- Semantic HTML: `<h1>`, `<p>`, `<button>`, `<form>`, `<nav>` used correctly
- `focus-visible:outline-none` and `focus-visible:ring-2` on interactive elements (e.g., wallet card line 100)
- `aria-label` on icon-only buttons (exchange swap button line 675)
- Labels associated with inputs via `htmlFor`/`id`

**Issues Found:**

| # | Issue | Location | Priority |
|---|---|---|---|
| 1 | Wallet card uses `role="button" tabIndex={0}` with `onClick` but is a `<Card>` not `<button>` | `dashboard/page.tsx` lines 91-99 | P2 |
| 2 | Transaction rows use `<div>` with no keyboard handler | `dashboard/page.tsx` lines 168-193 | P2 |
| 3 | No `aria-live` region for toast notifications | Layout likely missing | P2 |
| 4 | Admin pending withdrawal items use `<button>` with full width but need clearer focus indicators | `admin/page.tsx` lines 1580-1608 | P2 |
| 5 | Some `<Badge>` components use status colors for meaning — no additional text alternative | Multiple | P2 |
| 6 | Exchange "You send" / "You receive" amount display uses `<div>` not live region for dynamic content | `exchange/page.tsx` lines 702-706 | P2 |
| 7 | No skip-to-content link detected in layout | Likely missing | P2 |

### 3.5 Marketing & Public Pages Audit

**Pages reviewed:** `/`, `/features`, `/security`, `/login`, `/register`

**Strengths:**
- Consistent `MarketingShell` wrapper across all public pages
- Clear `PageHero` component with eyebrow, title, description, and CTAs
- CTAs consistently link to `/register` (create wallet/account)
- Metadata/SEO tags set on `/features` (line 18-22) and `/security` (line 18-22)
- Security page has clear checklist of features
- Features page uses `corridorSteps`, `productFeatures`, `serviceRows` from `lib/marketing`

**Issues Found:**

| # | Issue | Location | Priority |
|---|---|---|---|
| 1 | CTAs all link to `/register` — no `/login` CTA for returning users | All marketing pages | P2 |
| 2 | No Lottie/animated hero on landing page (static content only) | `/page.tsx` | P3 |
| 3 | Exchange and VTU public pages not reviewed in full — verify CTA consistency | `/exchange/page.tsx`, `/vtu/page.tsx` | P2 |
| 4 | Support page — verify phone/email contact display | `/support/page.tsx` | P2 |
| 5 | Company page — minimal content likely | `/company/page.tsx` | P3 |
| 6 | No social proof (testimonials, user count) on landing | `/page.tsx` | P3 |

### 3.6 Admin Panel Assessment

**Pages:** `/admin` (comprehensive single-page), `/admin/kyc`, `/admin/support`, `/admin/vtu`

The admin panel is surprisingly mature:
- `/admin/page.tsx` at 2708 lines is highly comprehensive with Tabs for Finance, Users, Exchange, Currencies
- Stats dashboard with live querying
- Transaction drilldown with ledger entries, transfer attempts, VTU orders
- User drilldown with masking
- Pending withdrawal management
- Reconciliation reports
- Exchange deposit queue with review actions
- Payout approval workflow
- VTU reconciliation
- KYC review with document URL access and verify/reject actions
- Pagination support

**Admin gaps:**
- Detailed user `suspend/unsuspend` CTA not visible in code (individual user action missing)
- No dedicated `/admin/users/[id]` detail page (user drilldown is inline modal)
- No bulk actions (bulk verify, bulk suspend)
- No CSV/PDF export
- No dual-control UI (approvals are single-admin)
- No roles beyond ADMIN check

---

## Priority Summary

### Phase 1 — P0 (Launch Blockers)

1. **Analytics screen hardcoded** — Replace all mock data in `analytics_screen.dart` with API-backed data from dashboard bootstrap.
2. **No Receive Money screen** — Build `/receive-money` route and screen. Router already references `AppRoutes.receiveMoney` but it's not defined.
3. **No KYC document upload** — Build document upload with file picker integration. Current KYC body is read-only.

### Phase 1 — P1 (Important)

4. **No notification center** — Wire `/notifications` route to API, add read/unread, badge count on bell.
5. **Exchange parity gaps** — Add countdown timer, fee breakdown, rate source indicator, success receipt screen, loading skeleton.
6. **VTU hardcoded fallback** — Replace `_fallbackLocalProviders` with proper empty states.
7. **No notification badge on bell icon** — Add unread count indicator.

### Phase 1 — P2 (Nice-to-Have)

8. Auto-refresh exchange rate to detect stale quotes.
9. Add full transaction history (not just deposits) to wallet detail screen.
10. Add pagination to wallet detail history.

### Phase 3 — P1

1. **`/dashboard/transactions` error state missing** — Add error handling for failed transaction query.
2. **Table overflow on mobile** for admin 7-column transactions table and exchange 3-tab TabsList.
3. **Accessibility**: Add `aria-live` region for toasts, keyboard handlers for clickable rows.

### Phase 3 — P2

4. Wallet card semantic element improvement (div vs button).
5. Add skip-to-content link.
6. Add returning-user `/login` CTA on marketing pages.
7. Add deposit confirmation/receipt screen after exchange execution on web.
8. Add admin bulk actions, CSV export, dual-control UI.

---

## File Reference Index

### Key Flutter Files
| File | Path |
|---|---|
| Home Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/home/screens/home_screen.dart` |
| Money Action Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/home/screens/money_action_screen.dart` |
| Dashboard Detail Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/home/screens/dashboard_detail_screen.dart` |
| Wallet Detail Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/wallet/screens/wallet_detail_screen.dart` |
| Transactions Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/transactions/screens/transactions_screen.dart` |
| Analytics Screen | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/features/analytics/screens/analytics_screen.dart` |
| App Router | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/core/router/app_router.dart` |
| ApiClient | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/services/api_client.dart` |
| HomeDataService | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/services/home_data_service.dart` |
| WalletService | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/services/wallet_service.dart` |
| VtuService | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/services/vtu_service.dart` |
| AuthService | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/APP/lib/services/auth_service.dart` |

### Key Web Files
| File | Path |
|---|---|
| Dashboard | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/page.tsx` |
| Wallet Detail | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/wallet/[currency]/page.tsx` |
| Exchange | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/exchange/page.tsx` |
| Fund Wallet | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/fund/page.tsx` |
| KYC | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/kyc/page.tsx` |
| Transactions | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/transactions/page.tsx` |
| Admin | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/admin/page.tsx` |
| Admin KYC | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/admin/kyc/page.tsx` |
| Support | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/support/page.tsx` |
| Withdraw | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/dashboard/withdraw/page.tsx` |
| Features | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/features/page.tsx` |
| Security | `/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/security/page.tsx` |
