# Paystack BVN reconciliation and delayed verification recovery

**Goal:** Recover genuine provider results without duplicating identity requests or fabricating KYC approval.

**Architecture:** Guarded reconciliation endpoint, database-backed lease and replay reservation, signed inbox finalization, per-document Flutter recovery guidance.

**Tech stack:** NestJS, Prisma/PostgreSQL, Paystack, Flutter/Riverpod.

Implements the provider requery/recovery requirement in the authorized
2026-10-30 Paystack migration design. The original request predates a working
webhook endpoint. Its provider response was accepted; no terminal event is
currently listed, and the provider customer is not identified. That evidence
does not establish either a successful identity check or a definitive failure.

## Scope and invariants

- Add authenticated, idempotent, rate-limited `POST /api/kyc/paystack/reconcile`
  with no client-supplied identity, customer code, or user ID.
- Query the saved customer's provider state and identification-event history.
  Validate customer identity and full event payload before requesting replay
  of one genuine matching terminal event through Paystack's own resend API.
- Preserve the canonical attempt, fingerprint, consent, KYC status and tier.
  Never manufacture a callback, approve BVN from `identified` alone, or submit
  another identity validation while the original outcome is unresolved.
- Use a short database-backed reconciliation lease and cooldown. Reserve any
  outbound replay before sending it so crashes/timeouts cannot cause repeated
  sends on different client idempotency keys. Normal signed inbox processing
  remains the sole finalization path.
- Store only safe reconciliation metadata and audit the operation. Keep raw
  event payloads, bank/identity numbers and provider secrets out of logs and
  customer responses.
- Expose per-document `recovery` metadata: state, message, supportReference,
  pendingSince, checkedAt and retryAllowed=false. After 24 hours without a
  terminal result, surface ACTION_REQUIRED while retaining PENDING internally.
- Flutter's pending Paystack status action calls reconciliation, then reloads
  local authoritative status. Keep read-only polling local; show delayed-state
  guidance and the original support reference after restart.

## Implementation sequence

1. Write failing recovery-service tests for no event, foreign customer/event,
   real matching replay, timeout, duplicate/re-entrant replay and terminal race.
2. Implement service, DTOs, guarded endpoint and safe status projection without
   a schema migration or any modification of verification/tier policy.
3. Add Flutter parsing/service/UI tests for stale checks, recovery errors,
   preserved status/reference, and BVN pending alongside NIN review.
4. Run focused tests, backend build/lint, Flutter analysis/tests, and financial
   KYC regression coverage. Obtain an independent review of the final patch.
5. Deploy the validated change to the existing services and verify live health
   and authenticated recovery through normal account access. Real BVN approval
   still requires genuine Paystack evidence; provider investigation/reprocessing
   is required if no terminal event exists.

## External investigation

Prepare a provider support inquiry containing merchant/customer reference,
accepted-request timestamp, missing terminal-event evidence and restored webhook
URL. Obtain explicit owner authorization before sending the inquiry. Do not
include full BVN, bank account number, API keys or credentials.

## Verification evidence — 1 November 2026

- [x] New projection and race/correlation regressions observed failing before fixes.
- [x] 665 backend unit tests across 91 suites passed.
- [x] Nine isolated PostgreSQL KYC HTTP scenarios passed, including concurrent replay, signed inbox finalization, manual NIN queue, audited access/decisions, conflicting reviews, rejection/resubmission history and combined tier promotion.
- [x] 63 focused Flutter KYC tests passed; full app analysis clean.
- [x] Live NIN submission has a real PDF in the private bucket; anonymous public access denied. Designated reviewer is active ADMIN. No genuine NIN decision was made by the agent.
- [x] Owner approved and agent sent the exact technical inquiry to Paystack support. No BVN, bank account number or secret was included.
- [ ] Production rollout and normal authenticated recovery acceptance.
- [ ] Paystack delivers the genuine final result for the original pending BVN.
- [ ] Authorized human completes the real NIN decision.
