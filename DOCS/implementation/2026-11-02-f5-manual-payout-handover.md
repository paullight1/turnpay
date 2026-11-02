# F5 manual payout handover — 2 November 2026

## Scope

This phase adds a supervised recovery path for an externally paid manual exchange that is stuck in `PAYOUT_PROCESSING`. It does not expire a claim, create another order, call a payout provider, resend money, or issue an automatic refund. No Prisma schema or live database was changed.

## Backend contract

- Admin review accepts `HANDOVER_PAYOUT` with a UUID `handoverToAdminId`, a required `payoutOutcome`, a meaningful reason, and protected payout evidence.
- `NOT_SENT` and `CONFIRMED_FAILED` keep the existing order/reference and transfer the one active claim to another active, unsuspended administrator. Settlement holds, customer eligibility, and the PIN-reset hold are checked again before the new owner can act.
- `ALREADY_SENT` requires the exact frozen payout amount, the confirmed external reference, and protected evidence. It records the existing result and advances only to `PAYOUT_SENT`; it does not send money. A later `COMPLETE` is a non-financial status confirmation.
- `UNKNOWN` is intentionally rejected. The current owner and `PAYOUT_PROCESSING` state remain unchanged so an uncertain external outcome cannot be paid twice.
- The transition is guarded by the existing version/status compare-and-update, the existing per-order action idempotency event, and an append-only `AuditLog` entry containing the old/new owner, outcome, order reference and request audit context.
- A separate admin-only protected upload route allows a supervisor to attach outcome evidence without taking over the payout claim first. The final handover still verifies the stored object metadata, bytes and file signature.

## Admin UI/API

The manual orders queue now loads active administrators from the existing admin directory endpoint, offers a supervised handover only when another administrator owns a processing payout, requires an outcome selection and evidence, and explicitly explains that unknown/pending outcomes cannot be reassigned or resent. Idempotency keys are retained for both evidence upload and review retries.

## Verification

- Red/green policy regression: `npm test -- --runInBand src/exchange/manual-exchange.policy.spec.ts` (6 passed).
- HTTP guard/DTO regression: `npm test -- --runInBand src/exchange/manual-exchange.controller.spec.ts` (5 passed).
- Backend production build: `npm run build` (passed).
- Scoped backend ESLint (policy, DTO, service, controller, tests): passed.
- Website production build: `npm run build` (passed).
- Scoped website ESLint (manual-order page, API client, E2E spec): passed.
- Playwright test discovery lists the new handover case. Browser execution was not available because the local Playwright Chromium executable is not installed.
- Real PostgreSQL manual-exchange regressions are included in `BACKEND/test/manual-exchange.financial.e2e-spec.ts`; they require the disposable `FINANCIAL_TEST_DATABASE_URL` and were not run in this environment.

## Remaining boundary

This phase does not add a reviewed compensating-entry/refund workflow for an obligation that cannot ultimately be paid. That needs the adverse-event/refund schema and workflow owner; until integrated, operations must keep the existing claim and escalate through the reviewed support process.
