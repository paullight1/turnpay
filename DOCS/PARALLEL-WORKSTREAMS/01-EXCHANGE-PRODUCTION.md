# 🔀 Stream 1: Currency Exchange — Production Activation

> **Parallel Stream ID:** `STREAM-EXCHANGE`
> **Depends On:** Stream 2 (Core Infrastructure) for production secrets + deployment
> **Blocks:** Nothing — can go live independently once infra is ready
> **Target Score:** 65 → **92** (Prod: 55→90, UI: 70→85, UX: 60→90, Func: 75→95)

---

## Current State (Score: 65)

| Dimension | Score | Root Cause |
|---|---|---|
| Production Readiness | 55 | No live FX rate provider; no sandbox/live e2e validation; admin rate approval not hardened |
| UI Availability | 70 | Web exchange pages exist; Flutter money-action screen exists; admin rate override exists |
| UX Polish | 60 | Quote/execute flow works but loading, error, and expiry states need refinement |
| Functionality | 75 | Core complete; missing rate alerts, partial exchanges, recurring exchanges |

---

## Phase 1: FX Rate Provider Activation (Target: Prod 55→75)

### Task 1.1 — Select & Integrate Live FX Rate Provider
- **Action:** Evaluate FX rate APIs (exchangerate-api.com, currencyapi.com, Alpha Vantage, XE) for GHS/NGN coverage, latency, and cost. Select one. Configure `FX_API_KEY` and `FX_API_URL` in environment.
- **Agent:** `general-purpose` — research providers, compare pricing/latency/uptime, recommend best fit
- **Acceptance:** Provider selected; env vars documented; rate fetch returns live GHS/NGN rates in <500ms

### Task 1.2 — Implement Rate Caching with Circuit Breaker
- **Action:** Verify Redis caching TTL for FX rates (suggest 60s). Ensure circuit breaker trips on 3 consecutive failures and falls back to last-known-good rate with admin alert.
- **Agent:** `general-purpose` — review `BACKEND/src/exchange/providers/rate.service.ts` and Redis module, verify TTL, add fallback
- **Acceptance:** Rate cached for 60s; circuit opens after 3 failures; fallback rate served with stale-rate header; admin sees alert

### Task 1.3 — Sandbox Rate Fetch & Cache Validation
- **Action:** Start backend locally with real FX API key. Run `curl` against `/api/exchange/rate?from=GHS&to=NGN`. Verify rate freshness, cache hit/miss in Redis, and circuit breaker behavior by killing the provider endpoint.
- **Agent:** `general-purpose` — run backend, execute curl tests, validate Redis keys
- **Acceptance:** Live rate returned; cache hit on second call; circuit opens when provider is unreachable

### Task 1.4 — Admin Rate Override with Approval Workflow
- **Action:** Enhance the admin FX rate override to require a reason and create an audit log entry. If dual-control is implemented (Stream 3), require second approver for rate changes >5% deviation from market.
- **Agent:** `general-purpose` — review `BACKEND/src/admin/` exchange rate endpoints, add audit log + reason requirement
- **Acceptance:** Rate override writes audit log with actor, reason, old rate, new rate; >5% deviation requires dual approval

---

## Phase 2: Exchange Flow E2E Validation (Target: Prod 55→85)

### Task 2.1 — Create Quote E2E Test Suite
- **Action:** Write backend e2e tests covering: valid quote creation, same-currency rejection, expired quote execution rejection, insufficient balance, wrong-user quote theft attempt, concurrent quote execution race condition.
- **Agent:** `general-purpose` — create `BACKEND/test/exchange.e2e-spec.ts` with Jest + Supertest
- **Acceptance:** All 6 scenarios pass; race condition test proves no double-spend

### Task 2.2 — Monnify-Verified Exchange Deposit E2E
- **Action:** Write e2e tests for the admin-reviewed Monnify exchange deposit flow: user creates deposit intent → Monnify webhook marks provider-verified → admin approves → GHS credited once → duplicate review rejected → rejection does not credit.
- **Agent:** `general-purpose` — create `BACKEND/test/exchange-receipts.e2e-spec.ts`
- **Acceptance:** Full 8-scenario suite from `DOCS/TESTING-GUIDE.MD` Monnify exchange deposit section passes

### Task 2.3 — Manual Receipt Upload E2E
- **Action:** Write e2e tests for: valid receipt upload with signed proof URL, duplicate idempotency key returns original, admin review approve/reject/needs-more-info, non-admin rejection, terminal-state re-review rejection.
- **Agent:** `general-purpose` — extend `BACKEND/test/exchange-receipts.e2e-spec.ts`
- **Acceptance:** All 7 scenarios from testing guide pass; proof URL authorization boundaries verified

### Task 2.4 — Web Exchange Flow Playwright Smoke Test
- **Action:** Write Playwright e2e test: login → navigate to `/dashboard/exchange` → enter amount → get quote → verify quote display → execute exchange → verify wallet balances updated → verify transaction appears in history.
- **Agent:** `general-purpose` — create `WEBSITE/e2e/exchange.spec.ts`
- **Acceptance:** Full happy-path test passes on Chromium + Mobile Safari

---

## Phase 3: UX Polish & Feature Completion (Target: UX 60→90, Func 75→95)

### Task 3.1 — Improve Exchange UI Loading & Error States
- **Action:** Audit the web exchange page (`WEBSITE/src/app/dashboard/exchange/page.tsx`). Add: skeleton loader during rate fetch, error toast with retry button on rate fetch failure, countdown timer on quote expiry, disabled submit when quote expired, success animation on exchange completion.
- **Agent:** `general-purpose` — review and enhance exchange page components
- **Acceptance:** All 5 states handled with appropriate UI; manual QA on desktop + mobile viewports

### Task 3.2 — Flutter Exchange Screen Parity
- **Action:** Align Flutter money-action exchange screen with web exchange UX. Add: live quote display with countdown, fee breakdown, rate source indicator, transaction success screen with shareable receipt.
- **Agent:** `general-purpose` — enhance `APP/lib/features/home/screens/money_action_screen.dart`
- **Acceptance:** Flutter exchange matches web parity; flutter analyze passes; widget test passes

### Task 3.3 — Rate Alert Feature (New)
- **Action:** Add optional rate alert: user sets target rate for GHS→NGN or NGN→GHS; backend checks cached rate every 60s; if rate meets/exceeds target, send push notification and in-app alert.
- **Agent:** `general-purpose` — add `RateAlert` model to Prisma schema, create `POST/GET/DELETE /exchange/alerts` endpoints, add alert checker to rate refresh cron
- **Acceptance:** User can create/view/delete rate alerts; alert fires when rate condition met; notification delivered

### Task 3.4 — Exchange Transaction Receipt (Shareable)
- **Action:** Create a shareable receipt view for completed exchanges: rate applied, fees, amounts in both currencies, timestamp, reference number, status. Support screenshot/share on mobile.
- **Agent:** `general-purpose` — add receipt component to both web (`/dashboard/transactions/[id]`) and Flutter
- **Acceptance:** Receipt shows all exchange details; share button works on mobile; receipt is print-friendly on web

---

## Phase 4: Production Go-Live (Target: Prod 85→90)

### Task 4.1 — Production Rate Provider Health Check
- **Action:** Deploy to staging with production-like FX API key. Monitor rate fetch success rate, latency, and cache hit ratio for 48 hours. Verify circuit breaker never false-trips under normal load.
- **Agent:** `general-purpose` — run 48h monitor on staging, review logs
- **Acceptance:** >99.5% rate fetch success; P95 latency <300ms; zero false circuit trips

### Task 4.2 — Exchange Flow Staging Validation
- **Action:** Run the full exchange e2e suite + Playwright smoke test against staging. Execute 100 test exchanges across different amounts and verify all balances reconcile.
- **Agent:** `general-purpose` — run test suites against staging, verify reconciliation
- **Acceptance:** All tests pass; 100/100 exchanges reconcile; no balance discrepancies

### Task 4.3 — Go-Live Checklist
- **Action:** Complete exchange-specific go-live items: FX_API_KEY set in production secret manager, rate cache TTL confirmed, admin rate override tested with dual-control (if active), exchange webhook URLs registered, exchange monitoring dashboard configured.
- **Agent:** `general-purpose` — verify each item
- **Acceptance:** All checklist items ✅; named owner signs off

---

## Success Metrics

| Metric | Current | Target |
|---|---|---|
| Exchange Prod Readiness | 55 | **90** |
| Exchange UI Availability | 70 | **85** |
| Exchange UX Polish | 60 | **90** |
| Exchange Functionality | 75 | **95** |
| **Exchange Category Average** | **65** | **90** |
| E2E Test Coverage | ~30% | >90% |
| Rate Fetch Reliability | N/A (no provider) | >99.5% |
| Exchange Reconciliation Accuracy | Untested | 100% |

---

## Agent Execution Guide

Run this entire stream with:

```bash
# Terminal 1: Exchange Stream
# Phase 1: Provider activation
claude "Execute Phase 1 of DOCS/PARALLEL-WORKSTREAMS/01-EXCHANGE-PRODUCTION.md — activate FX rate provider"
# Phase 2: E2E validation
claude "Execute Phase 2 of DOCS/PARALLEL-WORKSTREAMS/01-EXCHANGE-PRODUCTION.md — write and run e2e tests"
# Phase 3: UX polish
claude "Execute Phase 3 of DOCS/PARALLEL-WORKSTREAMS/01-EXCHANGE-PRODUCTION.md — polish exchange UX"
# Phase 4: Go-live
claude "Execute Phase 4 of DOCS/PARALLEL-WORKSTREAMS/01-EXCHANGE-PRODUCTION.md — production validation"
```

Or run all phases in one agent:
```bash
claude "Read DOCS/PARALLEL-WORKSTREAMS/01-EXCHANGE-PRODUCTION.md and execute all phases in order"
```

---

## Dependencies

| Dependency | Stream | Status |
|---|---|---|
| Production PostgreSQL + Redis deployed | Stream 2 | 🔜 Required before Phase 4 |
| Production secrets configured | Stream 2 | 🔜 Required before Phase 4 |
| Monnify exchange deposit flow validated | Stream 3 | 🤝 Parallel — both streams test the same flow from different angles |
| Notification infrastructure (for rate alerts) | Stream 4 | 🔜 Required for Task 3.3 |

---

*Last updated: 2026-05-31 | Stream ID: STREAM-EXCHANGE*
