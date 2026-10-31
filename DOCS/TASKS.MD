# TRUSTPAY Task Status And Remaining Work

Date updated: 2026-09-27

This checklist reflects the current codebase after the Monnify-only virtual-account work, exchange deposit review flow, admin finance updates, and dashboard wallet UI improvements. It replaces the older bootstrap checklist that still showed already-implemented foundations as pending.

## Current Build Snapshot

### Implemented In Code

- [x] NestJS backend with strict config validation, global DTO validation, global exception filter, Pino logging, Helmet, CORS allowlist, throttling, Swagger in non-production, and graceful shutdown.
- [x] Prisma/PostgreSQL schema for users, wallets, transactions, ledger entries, idempotency records, provider events, virtual accounts, bank beneficiaries, transfer attempts, VTU orders, pricing rules, audit logs, KYC documents, KYC verifications, support disputes, rates, and webhook logs.
- [x] Global idempotency interceptor for mutation endpoints and provider-specific idempotent webhook handling.
- [x] Auth, users, wallets, transactions, support, KYC, transfers, exchange, payments, banking, VTU, admin, Redis, reconciliation, circuit-breaker, and transaction PIN modules.
- [x] KYC tiering and manual-review provider gateway with signed upload flows for private KYC documents.
- [x] Tier 2 gating for deposits, virtual accounts, withdrawals, beneficiaries, VTU, transfers, and exchange money movement.
- [x] Monnify-only NGN virtual-account provisioning path.
- [x] Monnify webhook signature verification, provider-event storage, duplicate replay protection, and wallet funding credit path.
- [x] Monnify-verified NGN to GHS exchange deposit intent path with admin review before GHS credit.
- [x] Manual exchange receipt upload/review path with signed proof URL support.
- [x] Wallet ledger service for append-only balance movement records.
- [x] Internal transfers with transaction PIN support.
- [x] Withdrawal initiation, beneficiary storage, bank resolution/listing, transfer attempts, and admin verification endpoints.
- [x] Monnify is the only payment, virtual-account, deposit-webhook, bank-resolution, and withdrawal provider.
- [x] VTpass is the only VTU provider, with signed webhook handling, order requery, reversals, and admin operations.
- [x] Admin operations API for users, stats, transactions, virtual accounts, provider events, pending transfers, reconciliation, VTU health, stale VTU orders, VTU pricing, support, KYC, audit logs, and exchange receipt review.
- [x] Next.js website/admin with auth, dashboard, wallet detail screen, Monnify account funding screen, exchange screen, KYC, withdraw, VTU, transactions, support, profile, admin finance, admin KYC, admin support, and admin VTU pages.
- [x] Dashboard wallet cards now expose `Send Money` and `Receive Money`, and click through to wallet detail/history screens.
- [x] Flutter app shell, auth screens, dashboard/home, money actions, VTU service client, transaction security service, biometrics/PIN support, profile, analytics, and transactions screens.
- [x] Focused backend unit coverage for wallets, ledger, idempotency, auth, Monnify KYC and banking, beneficiaries, exchange, payments, support, transfers, VTpass, reconciliation, and admin service.
- [x] Web lint/build currently passes with placeholder environment values.

### Verified Recently

- [x] `WEBSITE npm run lint`
- [x] `WEBSITE npm run build`
- [x] Backend exchange service tests passed during Monnify exchange work.
- [x] Backend build passed during Monnify exchange work.

## Active Product Direction

- [x] Use Monnify only for Nigerian NGN virtual accounts.
- [x] Do not activate Nomba.
- [x] Enforce Monnify as the only banking and payment provider.
- [x] Admin review remains required before a Monnify-verified exchange deposit credits a user's GHS wallet.
- [x] One provider inflow must never credit both NGN wallet funding and GHS exchange settlement.

## P0 Launch Blockers

These must be completed before real-money launch.

- [ ] Apply all Prisma migrations in staging, then production: `cd BACKEND && npx prisma migrate deploy`.
- [ ] Generate Prisma client in each deploy environment: `cd BACKEND && npx prisma generate`.
- [ ] Create private Supabase buckets:
  - [ ] `kyc-documents`
  - [ ] `exchange-receipts`
  - [ ] enforce MIME restrictions and max upload sizes.
- [ ] Configure production secrets only in the deployment secret manager:
  - [ ] Supabase URL, publishable/anon key, service role key, JWT secret.
  - [ ] PostgreSQL URL with SSL/TLS.
  - [ ] Redis host, port, password, TLS/private network rules.
  - [ ] PII and bank-account encryption keys.
  - [ ] Monnify API key, secret key, contract code, webhook secret, base URL, exchange collection account.
  - [ ] VTU provider credentials if VTU will launch.
  - [ ] Sentry DSN or equivalent monitoring key.
- [ ] Complete Monnify KYB and obtain sandbox/live credentials.
- [ ] Register public HTTPS webhook URLs:
  - [ ] `POST /api/webhooks/monnify`
  - [ ] Verify VTpass webhook delivery in the target environment.
- [ ] Run Monnify sandbox reserved-account creation with a verified Tier 2 user.
- [ ] Run Monnify sandbox wallet funding:
  - [ ] low-value transfer succeeds.
  - [ ] duplicate webhook replay does not double-credit.
  - [ ] amount/currency/reference mismatches do not credit.
  - [ ] provider event and ledger entries reconcile.
- [ ] Run Monnify sandbox exchange deposit:
  - [ ] user creates deposit intent.
  - [ ] payment enters the admin queue as provider verified.
  - [ ] admin approval credits GHS exactly once.
  - [ ] rejection does not credit.
  - [ ] duplicate review and duplicate webhook do not double-credit.
- [ ] Define live go/no-go approval with named owner for compliance, operations, engineering, and finance.
- [ ] Create production rollback steps for backend, website/admin, database migration, and provider flags.

## P1 Security And Financial Controls

- [ ] Add backend e2e tests for Monnify duplicate webhook replay.
- [ ] Add backend e2e tests for manual receipt duplicate submit/review attempts.
- [ ] Add backend e2e tests for withdrawal pending/success/failure/reversal provider states.
- [ ] Add backend e2e tests for transaction PIN failure, lockout, and successful money movement.
- [ ] Add concurrency tests for wallet debit/credit paths that attempt simultaneous debits.
- [ ] Review every financial mutation endpoint for explicit `Idempotency-Key` behavior and document any intentional exception.
- [ ] Confirm all admin financial actions write audit logs with actor, reason, before/after, target, and reference.
- [ ] Add dual-control approval for high-value exchange credits and high-value withdrawals.
- [ ] Add configurable transaction limits by KYC tier, currency, route, and time window.
- [ ] Ensure withdrawal limit counters update atomically in the same transaction that reserves/debits funds.
- [ ] Add reconciliation dashboards or exports for:
  - [ ] wallet balance totals.
  - [ ] ledger totals.
  - [ ] Monnify provider events.
  - [ ] exchange deposit receipts.
  - [ ] VTU orders.
  - [ ] pending withdrawals.
- [ ] Add dead-letter or retry queue visibility for provider events that fail processing.

## P1 Admin And Operations

- [ ] Finish admin UI coverage for pending withdrawals and transfer attempts.
- [ ] Add transaction detail views that show masked provider metadata, ledger entries, provider events, and audit trail.
- [ ] Add user detail view with wallets, virtual accounts, KYC, support tickets, limits, and account status.
- [ ] Add export/download for reconciliation reports with date filters.
- [ ] Add admin role segmentation beyond `ADMIN` if operations grows:
  - [ ] support.
  - [ ] finance.
  - [ ] compliance.
  - [ ] super admin.
- [ ] Add admin action confirmation flows for high-risk operations.
- [ ] Add support runbooks for stuck provider events, pending transfers, failed VTU orders, and disputed deposits.

## P1 Web And Mobile Product Work

- [ ] Run manual QA for dashboard wallet UI at mobile, tablet, and desktop sizes.
- [ ] Add web e2e smoke coverage for:
  - [ ] login/dashboard load.
  - [ ] wallet card click-through to `/dashboard/wallet/ngn`.
  - [ ] receive-money path.
  - [ ] Monnify exchange deposit intent path.
  - [ ] admin exchange queue review path.
- [ ] Align Flutter mobile dashboard with the web wallet changes:
  - [ ] show Receive Money instead of Add/Fund wording where applicable.
  - [ ] remove duplicated money action shortcuts from lower sections.
  - [ ] add wallet detail screen with account number and history.
- [ ] Replace remaining mock mobile recipients/transactions with API-backed data or explicit empty states.
- [ ] Run Flutter analyzer and widget tests after mobile parity changes.
- [ ] Review visible copy for regulated-money clarity:
  - [ ] no promise of instant credit where admin review is required.
  - [ ] provider and processing states are explicit.
  - [ ] masked sensitive data is used by default.

## P2 Provider And Feature Expansion

- [x] Remove the legacy payment-link providers and their webhook/config paths.
- [ ] For Monnify production activation:
  - [ ] complete sandbox webhook replay tests.
  - [ ] confirm settlement account, transfer permission, and reversal behavior.
  - [ ] confirm production callback URLs and live credentials.
- [ ] Complete VTU launch readiness:
  - [x] use VTpass as the single VTU provider.
  - [x] complete Nigeria airtime/data/cable/electricity backend, web, mobile, callback inbox, requery, reversal, receipt, and admin flows.
  - [x] keep Ghana, Kenya, South Africa, US, and UK disabled as `Coming soon`.
  - [ ] configure credentials.
  - [ ] run low-value airtime/data/electricity/cable sandbox tests.
  - [ ] verify provider refund/requery paths.
- [x] Keep unsupported VTpass markets marked unavailable until product scope changes.
- [x] Use the Monnify verification API as the only KYC provider; remove all alternate provider runtime paths and deployment settings.
- [ ] Add live FX-rate provider or admin-controlled rate operations with change approval.

## P2 Infrastructure And Release

- [ ] Provision managed PostgreSQL with SSL/TLS, backups, and restore testing.
- [ ] Provision managed Redis with auth and private-network access.
- [ ] Deploy backend behind HTTPS with health checks.
- [ ] Deploy website/admin with production `NEXT_PUBLIC_API_URL`.
- [ ] Configure Sentry or equivalent for backend, web, and mobile.
- [ ] Add CI jobs for:
  - [ ] backend lint/build/test.
  - [ ] website lint/build/e2e smoke.
  - [ ] Flutter analyze/test.
  - [ ] Prisma migration validation.
- [ ] Add dependency vulnerability scanning.
- [ ] Add environment-specific feature flags for banking, virtual accounts, withdrawals, VTU, exchange review, and admin high-value approvals.

## Reference Docs

- Codebase review: `DOCS/CODEBASE-STATUS-REVIEW.MD`
- Security rules: `DOCS/SECURITY-RULES.MD`
- Monnify status: `DOCS/PRODUCTION-GUIDES/13-MONNIFY-ONLY-VIRTUAL-ACCOUNTS-STATUS.MD`
- Manual exchange flow: `DOCS/PRODUCTION-GUIDES/14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD`
- Testing guide: `DOCS/TESTING-GUIDE.MD`
