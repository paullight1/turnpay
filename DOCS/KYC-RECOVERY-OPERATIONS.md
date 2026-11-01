# KYC recovery operations

BVN and NIN are independent checks. A pending BVN must not block a user from
submitting NIN evidence. Existing tier requirements remain unchanged.

## BVN: Paystack owns the decision

The app's BVN **Check status** action calls authenticated
`POST /api/kyc/paystack/reconcile` with `{}` and an `Idempotency-Key`, then
reloads `GET /api/kyc/status`. Background polling reads local status only.

Reconciliation uses the saved customer binding and current consent timestamp.
It checks the provider customer and bounded event history. It validates the
event ID, customer ID/code, domain, category binding, type and timestamp before
requesting one genuine terminal event through Paystack's resend API. Only the
normal signature-verified webhook inbox may finalize BVN and provision a
consented receiving account.

The database lease, cooldown and reserved event prevent concurrent or uncertain
replay requests from repeatedly sending the event. A reserved replay with an
unknown outcome requires support investigation rather than automatic resend.
Submission writes preserve recovery metadata; an explicit, permitted retry of
a definitively failed validation starts a new recovery generation.

`identified=true` alone does not approve BVN. Missing, ambiguous, malformed or
old results fail closed. No final result after 24 hours displays **needs support
review**, while the underlying check remains pending and can still accept its
genuine callback. The stable support reference is `KYC-<document ID>`.

If no final provider event exists, ask Paystack to investigate the original
accepted request and deliver/reprocess its genuine result. Do not manually
approve BVN, construct a synthetic callback, or submit a duplicate unresolved
validation. Never put full identity/bank numbers or secrets in support notes.

## NIN: assigned staff own the decision

Users submit NIN and private evidence with explicit consent. The API verifies
object ownership, actual file size and content type before creating the manual
review record. The app displays NIN review independently and retains history.

An assigned ADMIN signs in at [the KYC queue](https://www.trustpayhq.com/admin/kyc),
opens the NIN submission and reviews its evidence. Document links expire after
five minutes, and each access is audited. The reviewer enters a reason and
personally confirms approve or reject. The API enforces role authorization,
idempotency and one terminal decision under concurrent requests. Provider-owned
BVN records cannot be approved through this manual route.

A rejected NIN may be corrected and resubmitted; its prior decision and reason
remain in history. Verified BVN plus verified NIN grants the existing Tier 2.
Real identity decisions must be made by the authorized human reviewer.

## Acceptance boundaries

Automated tests use synthetic identities, isolated PostgreSQL and explicit
provider/storage/auth test boundaries. They verify orchestration, authorization,
idempotency, race handling and tier rules, not a real provider identity decision.
Live acceptance requires a genuine Paystack result and an authorized NIN review.
