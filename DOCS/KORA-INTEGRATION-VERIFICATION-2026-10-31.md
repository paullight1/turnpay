# Kora integration verification — 31 October 2026

Local implementation is complete. No deployment, live merchant setup or real money movement was performed. Paystack remains the NGN provider; new GHS activity uses Kora only when explicitly enabled. Product flags default false, and readiness remains UNCONFIRMED.

## Verified behavior

- GHS wallet funding and order-specific MoMo charges are separate. Permanent receiving-account deposits cannot also fund an external exchange order.
- Incoming notifications require Kora's data-object HMAC signature, validated event identifiers and a durable inbox. An authenticated query verifies reference, amount, currency and account binding before any ledger movement.
- Frozen Decimal quotes, transaction PIN authorization, tier/hold checks, source-specific limits and serializable reservations protect exchange creation. GHS cash-out is a separate wallet reservation.
- Admin release makes one immutable provider attempt. Approval/dispatch stays pending. Settlement or exactly-once compensation requires a matching provider query, including destination evidence. Unknown outcomes remain reserved.
- Customer Flutter flow prioritizes Cedis to naira, supports balance/MoMo, verifies recipients, displays fee/total, preserves unknown attempts, and distinguishes confirmed funding from Sent. Pending Ghana accounts expose no dummy receiving numbers.
- Web admin provides a server-filtered, paginated queue, Send naira/cedis actions, payment-status recovery and persistent per-admin notification read state. Phone and desktop screenshots were inspected.

## Test evidence

| Check | Result |
| --- | --- |
| Full backend unit suite | 88 suites, 609 tests passed (`--runInBand --testTimeout=30000`) |
| Backend project lint | Passed |
| Backend source typecheck | Passed (`tsc --noEmit -p tsconfig.build.json`) |
| Real PostgreSQL financial checks | All 45 cases passed across the final suite and the affected-suite retry; 12 cover Kora collection/exchange/cash-out |
| Flutter regression suite | 29 tests passed, including existing manual exchange and shell tests |
| Final focused Flutter checks | 8 tests passed after the review recovery fixes and final fixture cleanup |
| Flutter analysis | No issues found |
| Web typecheck and focused lint | Passed |
| Admin browser flow | Passed at 390px/1440px, one dispatch, pending state, notification read state and no horizontal overflow |
| Prisma | Validated/generated; additive migrations 042–045 applied only to the disposable test database |
| Whitespace | `git diff --check` passed |

Financial tests used `trustpay_financial_test_kora_20261031`, with a separate temporary Redis instance for fault tests. An initial all-financial run had a missing Redis setting and a transient local PostgreSQL connection error; the configured rerun passed seven suites, and the remaining internal-transfer suite passed all five tests on retry. No financial assertion failure remains. One backend PIN test exceeded its original five-second timeout during machine load; the complete suite passed with a 30-second test timeout. A shared Turbopack cache panic was avoided with a separate temporary QA cache, which was removed afterward.

## Independent review

Fresh reviewer: `kora_final_review`, GPT-6 Astra, high reasoning. No Critical findings. Five Important findings were fixed with failing-then-passing regressions:

1. Recover the original charge's verified OTP/STK/redirect next action after a lost or rejected authorization response. Mismatched query details cannot restore authorization.
2. Rotate pending recovery batches even when queries fail; filter ordinary cash-out attempts before applying the batch limit.
3. Recover an existing order or serializably close an unused expired quote before clearing its mobile attempt. A pending unknown is never discarded merely because time passed.
4. Replay an existing fingerprint-matched collection before applying new-charge eligibility/expiry checks, and acknowledge the recovered owned order's MoMo attempt in the app.
5. Filter and paginate admin queues on the server so an older funded obligation remains discoverable behind newer orders.

No minor findings were prioritized or deferred. The reviewer did not independently duplicate the executor's full test suite.

## Decisions and costs

- Reused the approved shared checkout with a source snapshot; this preserves ongoing work but requires coordination where edits overlap.
- Left shared-file changes uncommitted; this avoids committing unrelated work, but no standalone implementation commit/PR is supplied.
- Added a separate provider-backed exchange aggregate; historical manual obligations retain their settlement rules, at the cost of an additional aggregate and client entry point.
- Preserved the customer web app-download redirect; customer self-service is mobile-only.
- Kept real Kora signature/recipient/payout compatibility behind signed sandbox acceptance; local verification cannot substitute for merchant activation.
- Kept contradictory/unsupported provider queries unresolved; this protects money but may require support/provider reconciliation.
- Scoped independent review to this integration; unrelated preexisting Paystack/VTU/mobile work has no new review claim here.
- Retained executor test evidence rather than asking the reviewer to repeat every suite; the whole-suite result has one execution source.

## Remaining activation gates

Follow [the setup guide](KORA-GHANA-SETUP.md). Create and verify a Kora merchant account; the existing merchant MoMo wallet is separate and is not automatically monitored. Obtain both providers' approval for the actual exchange model, enable approved GHS products, configure positive GHS limits and approved redirect hosts, prefund the separate provider payout balances, register HTTPS webhooks/server payout IPs, and validate actual signed sandbox collection/authorization/payout fixtures before enabling live flags.

Ghana bank payouts are unavailable. Failed externally funded outgoing payments remain reconciliation obligations rather than invented wallet refunds. Provider dispatch crash gaps and query responses lacking recipient evidence remain reserved until independently resolved. No live readiness is claimed.
