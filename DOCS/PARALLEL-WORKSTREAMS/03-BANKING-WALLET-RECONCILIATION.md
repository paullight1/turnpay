# 🏦 Stream 3: Banking, Wallet & Reconciliation — Money Movement Activation

> **Parallel Stream ID:** `STREAM-BANKING`
> **Depends On:** Stream 2 (Core Infrastructure) for production deployment + secrets + Monnify webhook URL
> **Blocks:** Real-money transactions of any kind
> **Target Score:** Wallet 71→90, Banking 49→88, Reconciliation 36→85

---

## Current State

| Category | Score | Root Cause |
|---|---|---|
| Multi-Currency Wallet | 71 | Backend solid, web UI good, but zero production validation; Flutter missing wallet detail parity |
| Banking & Virtual Accounts | 49 | Monnify code complete but no KYB, no credentials, no sandbox/live testing, no Flutter UI |
| Reconciliation & Integrity | 36 | Engine exists but no operator dashboards, exports, or dead-letter visibility |

**This Is The Highest-Risk Stream.** Money movement is where bugs become financial losses. Every flow must be exhaustively tested with real provider sandboxes before a single real Naira moves.

---

## Phase 1: Monnify Provider Activation

### Task 1.1 — Complete Monnify KYB (Know Your Business)
- **Action:** Submit Monnify business registration: company documents, director ID, bank account for settlement, business address verification. Obtain sandbox API key, secret key, and contract code. Request production credentials pending go-live approval.
- **Agent:** `general-purpose` — guide through Monnify dashboard steps, document required documents, track status
- **Note:** This task requires human action (document submission). Agent prepares the checklist and tracks.
- **Acceptance:** Monnify sandbox credentials obtained; contract code assigned; production credentials requested

### Task 1.2 — Register Monnify Webhook URL
- **Action:** In Monnify sandbox dashboard, register `https://<staging-domain>/api/webhooks/monnify`. Set webhook secret. Verify Monnify sends test webhook and backend acknowledges with 200.
- **Agent:** `general-purpose` — configure webhook URL in Monnify dashboard, verify delivery
- **Acceptance:** Webhook registered; test event received; signature validation passes; webhook log entry created

### Task 1.3 — Sandbox Virtual Account Provisioning Test
- **Action:** Create a test Tier 2 user in staging. Call `POST /api/banking/accounts/provision` with `Idempotency-Key`. Verify Monnify sandbox creates a reserved account. Verify account number, bank name returned. Verify duplicate request with same key returns same account.
- **Agent:** `general-purpose` — execute provisioning flow, verify response, check Monnify dashboard
- **Acceptance:** Virtual account provisioned; account details stored in DB; duplicate key returns original; KYC gate blocks unverified users

### Task 1.4 — Sandbox Wallet Funding Webhook Test
- **Action:** Use Monnify sandbox to simulate a bank transfer into the provisioned virtual account. Verify: webhook received, signature validated, provider event stored, NGN wallet credited exactly once, transaction record created, ledger entry written. Then replay the webhook — verify no duplicate credit.
- **Agent:** `general-purpose` — coordinate Monnify sandbox transfer simulation, monitor webhook processing, verify balances
- **Acceptance:** Single webhook → single credit; replayed webhook → idempotent (no double-credit); amount mismatch webhook → rejected; wrong currency webhook → rejected

### Task 1.5 — Sandbox Exchange Deposit Flow (Monnify-Verified)
- **Action:** Full e2e: user creates Monnify exchange deposit intent → receives collection account details → Monnify sandbox transfer arrives → webhook marks deposit provider-verified → deposit appears in admin exchange queue → admin approves → GHS wallet credited once → duplicate review rejected → rejection stores reason, no credit.
- **Agent:** `general-purpose` — execute full flow in staging, verify at each step
- **Acceptance:** Full 10-scenario suite from testing guide passes; GHS credit is atomic; admin audit log written; one provider inflow never credits both NGN and GHS

---

## Phase 2: Withdrawal & Transfer Hardening

### Task 2.1 — Withdrawal Lifecycle E2E Tests
- **Action:** Write backend e2e tests for: valid withdrawal, insufficient balance rejection, transaction PIN required + PIN failure lockout, withdrawal pending→success via Monnify transfer webhook, withdrawal pending→failure via Monnify failure webhook → wallet reversal, duplicate withdrawal attempt with same idempotency key.
- **Agent:** `general-purpose` — create `BACKEND/test/withdrawals.e2e-spec.ts`
- **Acceptance:** All 6 scenarios pass; reversal is idempotent; PIN lockout after 3 failures works

### Task 2.2 — Internal Transfer E2E Tests
- **Action:** Write backend e2e tests for: valid P2P transfer (both wallets update atomically in one transaction), insufficient balance rejection, transfer to self rejection, suspended user cannot send, unverified recipient handling, transaction PIN required, duplicate idempotency key.
- **Agent:** `general-purpose` — create `BACKEND/test/transfers.e2e-spec.ts`
- **Acceptance:** All 7 scenarios pass; atomic transaction verified (both wallets update or neither does)

### Task 2.3 — Beneficiary Management Validation
- **Action:** Test: save beneficiary (account encrypted at rest, masked in response), list beneficiaries (only user's own), delete beneficiary (soft delete), resolve bank account (valid account → returns name, invalid account → error), withdraw using saved beneficiary ID.
- **Agent:** `general-purpose` — write and execute beneficiary e2e tests
- **Acceptance:** Account number encrypted in DB; API responses masked (e.g., `*****1234`); soft delete works; cross-user access blocked

### Task 2.4 — Transaction PIN Concurrency & Lockout Tests
- **Action:** Write tests for: 3 failed PIN attempts locks money movement for 30 minutes, successful PIN resets counter, PIN required for every debit operation, concurrent PIN attempts with correct PIN don't race.
- **Agent:** `general-purpose` — create `BACKEND/test/transaction-pin.e2e-spec.ts`
- **Acceptance:** Lockout works; reset works; concurrent attempts handled correctly

---

## Phase 3: Reconciliation Engine Activation

### Task 3.1 — Reconciliation Report Generation
- **Action:** Implement reconciliation report endpoints: `POST /api/admin/reconciliation/run` (triggers comparison of wallet balances, ledger totals, Monnify provider events, exchange receipt records), `GET /api/admin/reconciliation/reports` (list reports with date filter), `GET /api/admin/reconciliation/reports/:id` (detailed report with discrepancies highlighted).
- **Agent:** `general-purpose` — implement reconciliation service + controller endpoints
- **Acceptance:** Report generates in <30s for 10K transactions; discrepancies flagged with amount, reference, type; report is exportable

### Task 3.2 — Reconciliation Dashboard UI
- **Action:** Create admin reconciliation page at `/admin/reconciliation`: run report button with date range picker, report list with status (running/complete/failed), discrepancy summary (wallet vs ledger vs provider), drill-down to individual discrepancy with transaction details.
- **Agent:** `general-purpose` — build reconciliation page with shadcn/ui components
- **Acceptance:** Admin can run report, view results, drill into discrepancies, export CSV

### Task 3.3 — Automated Daily Reconciliation Job
- **Action:** Create a cron job (backend scheduled task or external cron) that runs reconciliation daily at 02:00 UTC. Compares: total wallet balances = sum of all ledger entries, sum of all Monnify deposit events = total NGN credits, sum of all exchange deposit credits = total GHS credits from exchange. Alert (Sentry + admin notification) on any discrepancy >0.
- **Agent:** `general-purpose` — implement `@Cron` scheduled task in NestJS reconciliation module
- **Acceptance:** Daily report generated; zero-discrepancy report → no alert; non-zero → Sentry alert + admin notification

### Task 3.4 — Dead-Letter Queue & Retry Visibility
- **Action:** Implement: provider events that fail processing move to `DEAD` status with failure reason, admin UI shows dead-letter queue at `/admin/finance` (failed provider events tab), manual retry button re-processes the event (idempotent), alert if dead-letter count >0 for >1 hour.
- **Agent:** `general-purpose` — enhance provider event processing, add admin UI
- **Acceptance:** Failed events visible in admin; retry works idempotently; alert fires if events stuck >1h

---

## Phase 4: Wallet UX & Flutter Parity

### Task 4.1 — Flutter Wallet Detail Screen
- **Action:** Build Flutter `WalletDetailScreen`: account number display with copy-to-clipboard, balance with currency, transaction history list (paginated), Send Money / Receive Money CTAs, virtual account details (if provisioned).
- **Agent:** `general-purpose` — create screen, wire to API, add to app router
- **Acceptance:** Screen accessible from wallet card tap; account number copyable; history paginated; flutter analyze clean

### Task 4.2 — Flutter Receive Money Flow
- **Action:** Build receive money screen: show virtual account number with copy, bank name, deposit instructions, expected arrival time messaging, recent deposits list.
- **Agent:** `general-purpose` — create receive money screen, integrate with banking API
- **Acceptance:** Virtual account displayed; copy works; deposit history visible; flutter analyze clean

### Task 4.3 — Transaction Detail View (Web + Mobile)
- **Action:** Enhance transaction detail page to show: masked provider metadata, ledger entries (balance before/after), provider event status, audit trail (for admin), fee breakdown, retry/resolve button (for failed transactions). Both web (`/dashboard/transactions/[id]`) and Flutter.
- **Agent:** `general-purpose` — enhance both web and Flutter transaction detail views
- **Acceptance:** All transaction metadata visible; admin sees full audit trail; failed transactions show retry option

---

## Phase 5: Financial Controls & Limits

### Task 5.1 — Configurable Transaction Limits
- **Action:** Implement limits by KYC tier: Tier 1 (max ₦50K/day), Tier 2 (max ₦500K/day), Tier 3 (max ₦5M/day). Limits configurable per: currency, route (withdrawal/transfer/VTU/exchange), time window (per transaction, daily, monthly). Limits enforced in the same DB transaction as the debit.
- **Agent:** `general-purpose` — implement limit checking in wallet service, add admin UI for limit configuration
- **Acceptance:** Limits enforced atomically with debit; limit counters reset correctly; admin can configure limits without code change

### Task 5.2 — Dual-Control for High-Value Operations
- **Action:** Require second admin approval for: exchange deposits >₦1M, withdrawals >₦5M, manual wallet credits of any amount, FX rate changes >5%. First approver submits; second approver (different admin) confirms or rejects. Both audit logged.
- **Agent:** `general-purpose` — implement dual-control approval flow in admin service
- **Acceptance:** High-value ops require 2 distinct admins; single-admin attempt rejected; both approvals audit logged

### Task 5.3 — Withdrawal Limit Counter Atomicity
- **Action:** Verify withdrawal limit counters (daily/monthly) update inside the same Prisma transaction as the balance debit. Write concurrency test: 10 simultaneous withdrawals that together exceed the daily limit → only the first N (up to the limit) succeed, the rest rejected.
- **Agent:** `general-purpose` — review withdrawal code, add concurrency test
- **Acceptance:** Limit counters never exceed configured max; concurrent withdrawals respect limits; no race condition

---

## Phase 6: Production Go-Live

### Task 6.1 — Monnify Production Credentials
- **Action:** Once Monnify KYB is approved, obtain production API key, secret key, contract code. Store in production secret manager. Set `BANKING_SANDBOX_MODE=false`. Register production webhook URL.
- **Agent:** `general-purpose` — update secrets, verify production connectivity
- **Acceptance:** Production Monnify API call succeeds; webhook registration confirmed

### Task 6.2 — Production Wallet Funding Smoke Test
- **Action:** With production Monnify credentials, provision a virtual account for an internal test user. Send a minimal real transfer (₦100). Verify webhook received, wallet credited, ledger written, reconciliation matches. Then withdraw ₦100 to verify full circle.
- **Agent:** `general-purpose` — execute and monitor the full cycle
- **Acceptance:** ₦100 in → wallet credited → ₦100 out → wallet debited → reconciliation matches → all audit logs present

### Task 6.3 — Go/No-Go Checklist
- **Action:** Complete the banking go-live checklist from `DOCS/TASKS.MD` P0 Launch Blockers: all Monnify sandbox tests passing, production credentials obtained, webhooks registered, smoke test passed, reconciliation working, limits configured, dual-control active, dead-letter monitoring active, rollback plan documented.
- **Agent:** `general-purpose` — verify each item, produce sign-off report
- **Acceptance:** All P0 items ✅; named owners for compliance/ops/engineering/finance sign off

---

## Success Metrics

| Category | Current | Target |
|---|---|---|
| Multi-Currency Wallet | 71 | **90** |
| Banking & Virtual Accounts | 49 | **88** |
| Reconciliation & Integrity | 36 | **85** |
| Monnify Sandbox Tests Passing | 0% | 100% (15 scenarios) |
| Withdrawal/Transfer E2E Coverage | ~20% | >90% |
| Daily Reconciliation Automated | ❌ | ✅ |
| Dead-Letter Queue Visibility | ❌ | ✅ with alerts |
| Production Money Movement Tested | ❌ | ✅ full circle |

---

## Agent Execution Guide

```bash
# Terminal 3: Banking Stream

# Phase 1: Monnify activation
claude "Execute Phase 1 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — activate Monnify"
# Phase 2: Withdrawal/transfer hardening
claude "Execute Phase 2 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — harden money movement"
# Phase 3: Reconciliation
claude "Execute Phase 3 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — reconciliation engine"
# Phase 4: Wallet UX parity
claude "Execute Phase 4 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — Flutter wallet parity"
# Phase 5: Financial controls
claude "Execute Phase 5 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — limits and dual-control"
# Phase 6: Go-live
claude "Execute Phase 6 of DOCS/PARALLEL-WORKSTREAMS/03-BANKING-WALLET-RECONCILIATION.md — production go-live"
```

---

## Dependencies

| Dependency | Stream | Status |
|---|---|---|
| Production backend + database + Redis | Stream 2 | 🔜 Required before Phase 3 |
| Production secrets (Monnify keys) | Stream 2 | 🔜 Required before Phase 1 |
| Public HTTPS webhook URL | Stream 2 | 🔜 Required before Phase 1 Task 1.2 |
| Notification infrastructure (alerts) | Stream 4 | 🔜 Required for Phase 3/5 alerts |
| Admin panel enhancements | Stream 5 | 🤝 Parallel — reconciliation UI is in this stream |

---

*Last updated: 2026-05-31 | Stream ID: STREAM-BANKING*
