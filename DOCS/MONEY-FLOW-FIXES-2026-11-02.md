# Money-flow audit remediation — 2 November 2026

Implements the seven findings in [the audit](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/DOCS/MONEY-FLOW-AUDIT-2026-11-02.md). No live payment, real customer balance adjustment, identity decision, production migration, deployment, commit or push was performed. All database financial tests used the disposable local financial test database and fake external providers.

## Finding disposition

| Finding | Change | Regression evidence |
| --- | --- | --- |
| F1: duplicate withdrawal/VTU after lost replay | Stable per-user, operation and client-key references; business fingerprint stored atomically with the debit/order; concurrent retries recover the original operation. Replay lookup precedes new-work PIN/config gates. Redis reads, writes and lock cleanup cannot erase a committed replay. Both retry-header spellings work. | Actual PostgreSQL concurrent withdrawals, lost completion write/stale lease, lost VTU generic replay, changed-body conflicts, cache failure; HTTP header alias tests. |
| F2: ignored Paystack refund/dispute | Signed events route into durable verified adverse-funding cases. Independent source/customer/domain/currency/amount and refund/dispute identity checks; global outbound hold; separate admin review and audited, explicit refund recovery. Economic duplicates and aggregate recovery are capped; no automatic debit or negative balance. Dedicated FUNDING_RECOVERY type prevents counting recovery as new funding. | Real PostgreSQL partial and duplicate collection, overlapping economic events/concurrent attempts, independent amount, mismatched owner, dispute restriction; provider/webhook unit tests and admin browser cases. |
| F3: PIN hash oracle | PIN omitted from financial business fingerprints; auth/OTP fingerprints use a domain-separated server-keyed HMAC. Migration retires legacy unkeyed database digests without deleting replay rows. Versioned Redis namespace and tested cleanup tool retire old cache hashes. | Secret/key/context changes, financial PIN-independent replay, retired-row fail-closed behavior, exact migration test in a rolled-back database transaction, isolated Redis CLI verification. |
| F4: VTU terminal regression | Transaction-row serialization and guarded transient updates preserve terminal outcomes, metadata and receipts. API returns the committed status after an initial response race. Legacy pending-order/success-transaction mismatch repairs; inverse mismatch requires independent provider success or enters review without an automatic refund. | PostgreSQL callback-before-initial-pending/timeout races preserve success and receipt; legacy contradictory result cannot refund and later fresh success repairs. |
| F5: stranded manual payout owner | Supervised handover with active-admin validation, protected outcome evidence, reason, original reference and version guard. Unknown outcome cannot be reassigned. Already-sent payout requires exact frozen amount/reference/proof and cannot authorize another send. Signed upload credentials stay outside generic replay caches. | PostgreSQL ownership/proof/idempotency boundaries; strict DTO tests; desktop/mobile admin handover browser checks. |
| F6: exhausted VTU disappears | Durable actionRequiredAt plus one admin notification/audit at 12 unresolved checks. Separate bounded normal-check and unmarked-escalation batches prevent starvation. Direct admin exception queries include old unresolved orders. Customer status explains review and warns against replacement purchase; supervised admin requery remains available. | PostgreSQL 31-order queue with batch limit 10: one due/legacy repair completes and all 30 exhausted orders receive exactly one alert/audit. Threshold, customer/admin recovery and terminal-race unit coverage. |
| F7: one-minor-unit drift ignored | Exact Decimal reconciliation flags every nonzero difference. | Tests for +0.01, -0.01 and equality. |

## Operator workflows

### Funding review

Open **Admin → Funding review** (`/admin/payments/adverse-funding`). An active adverse-funding case intentionally pauses **all outbound settlement**, including previously reserved dispatch paths. Incoming credits and compensating refunds remain possible. This conservative global hold prevents value leaving through another product while an adverse event is being investigated.

Review provider verification, original funding reference, refund/dispute identity, case exposure and recovered amount. Cases can overlap: displayed case amounts are not a full merchant settlement statement. The backend independently caps recovery by economic refund identity and the original credited funding amount.

Use **Recheck provider** for an unresolved case when original funding or provider evidence arrived late. It reads stored event evidence and performs independent checks; it never debits a wallet or reopens a resolved decision. Release a hold only after operations has verified the real outcome and entered the required reason. **Collect** is limited to an independently verified processed refund, requires an explicit amount and reason, and cannot collect from an already-reversed original funding transaction. Collection never creates a negative balance. Insufficient funds remain an operations exposure to resolve; they are not silently written off or forced into a negative wallet.

A failed response should be retried with unchanged details and the same attempt key. Changing review details deliberately creates a new attempt. Check the original resolution receipt before taking another financial action.

### Manual exchange payout handover

Open the claimed order in **Admin → Exchange requests → Supervised handover**. Check the actual bank/MoMo outcome and attach private evidence before selecting the receiving admin.

- **Not sent / confirmed failed:** reassigns the original claim and reference. It creates no replacement order or payment.
- **Already sent:** records exact frozen amount, actual reference and protected proof as payout sent; finish the original order rather than sending again.
- **Unknown:** reassignment is refused. Reconcile the original external attempt first.

### VTU recovery

At 12 unresolved provider checks, the original debit stays reserved and the order remains in **Admin → VTU Ops** with action-required guidance. No automatic refund, resend or replacement purchase occurs at the threshold. An admin may run the existing audited provider requery with a reason. Genuine verified callbacks can still settle the order. A contradictory legacy success remains held until independent provider evidence or a separately reviewed operational resolution establishes the real result.

## Rollout requirements

Apply migrations **047–051** before starting the new backend. They add adverse-funding cases and protected indexes/constraints/RLS, retire unsafe legacy database hashes, add FUNDING_RECOVERY, and persist the VTU escalation marker. They have been applied only to the disposable financial test database during this task.

Keep IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY stable across instances and restarts. The existing deployed-environment startup guard requires this key. Key rotation needs the existing encrypted-replay retention policy.

During cutover, drain old application instances, deploy the versioned interceptor and database retirement migration, then retire the old Redis idempotency namespace. With an explicitly selected deployment REDIS_URL, from BACKEND run:

```sh
npx ts-node scripts/retire-legacy-idempotency-cache.ts
npx ts-node scripts/retire-legacy-idempotency-cache.ts --apply
```

For a deployed installation without development tooling, use the compiled `node dist/scripts/retire-legacy-idempotency-cache.js` entry point with the same optional `--apply` flag.

The first command inspects only; the second unlinks pre-v2 cache keys. It preserves `idempotency:v2:*`, unrelated application data and database replay records, and prints counts without credentials or cache keys. SCAN may repeat candidates; the actual removed count reflects Redis removals. The CLI was verified against an isolated disposable Redis instance. No production cleanup was run.

Older requests whose unsafe hashes are retired fail closed with a status-check message. Check History/provider status before initiating a new financial attempt; do not delete replay rows to make an old key run again.

New Paystack checkouts default to **bank_transfer** through PAYSTACK_FUNDING_ALLOWED_CHANNELS; allowed channels are frozen per checkout and verified on confirmation. Enable other supported merchant channels deliberately after the adverse-funding operations process is ready. Existing credited funding remains eligible for independently verified adverse review. This does not activate Ghana automation or alter the admin-set directional exchange prices.

## Verification

Fresh final verification:

- **745 backend unit tests, 100 suites passed.**
- **81 financial tests, 12 suites passed** against isolated PostgreSQL and a dedicated disposable Redis instance, with fake payment/VTU/auth/storage boundaries.
- **426 Flutter tests passed**; full Flutter analysis found no issues. This task did not change Flutter application code.
- **32 relevant desktop/mobile Chromium browser cases passed**: 30 combined exchange/funding/VTU-boundary cases and two provider-recheck cases.
- Production website build, backend production-scope TypeScript, website TypeScript, affected backend-module lint and complete website source/e2e/config lint passed. `git diff --check` passed.
- Independent review identified replay-before-gates, header-alias and legacy VTU mismatch gaps; their regressions failed before fixes and passed afterward. The reviewer then found no remaining P1/P2 blocker in the reviewed scope.
- Legacy Redis retirement CLI dry run and apply were exercised only against isolated Redis: old namespace removed, current replay and unrelated keys preserved. The temporary Redis process was stopped after testing.

Earlier failures were investigated and resolved: two handover database fixtures uploaded evidence as one admin but reviewed as another; the production proof-owner guard was retained and fixtures corrected. The already-sent reference assertion now follows existing uppercase normalization. Initial browser failures were stale upload-route and customer-web assumptions; mocks now recognize the handover upload route and VTU coverage preserves the existing app-only redirect. The first unscoped website lint scanned generated isolated Next output; the final source/e2e/config check excludes generated artifacts and passes. Other intermediate red runs are intentional regression reproductions or documented setup/fixture corrections, not accepted passes.

Evidence is retained locally under `.superpowers/sdd/2026-11-02-money-flow-fixes/`. No source was committed or pushed during this task.

## Remaining live acceptance boundary

Automated checks do not certify live callback delivery, merchant permissions/channels, liquidity, bank/MoMo execution, settlement fees/statements or production deployment parity. Before unrestricted rollout, perform supervised low-value funding, exactly-once credit, withdrawal success/failure/reversal, both manual exchange directions and VTU delivery/recovery, matching internal ledger and provider/bank evidence. No live financial action was taken to claim acceptance here.
