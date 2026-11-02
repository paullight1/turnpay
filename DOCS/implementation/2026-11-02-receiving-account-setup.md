# Receiving account setup before BVN completion

Users can request a TrustPay NGN receiving account while identity verification is incomplete or pending. The request records consent; it does not issue an account, reveal account details, enable transactions, or claim that Paystack is preparing an account before verification succeeds.

## Behavior

- The wallet eye toggles the authenticated wallet balance independently of whether a receiving account has been issued.
- Receive Money uses a centred, full-height empty state with stronger typography, a full-width action and no enclosing card. It remains scrollable with larger text.
- Account setup and identity checks have separate states and actions. Pending BVN does not hide the setup-request action. Reopening the page restores the saved request.
- `POST /api/banking/accounts/setup-request` requires JWT authentication, validated explicit consent and the global idempotency mechanism. It is rate limited.
- The server locks the user row and writes consent, one unique request and the audit record in a single transaction. Repeated requests return the existing state without resetting preparation or consent. A conflict-safe insert and re-read also handle concurrent provider request creation.
- The existing request table stores `WAITING_FOR_KYC`. Before a Paystack customer exists, `customerCode` is empty and is never treated as a provider identifier. Provider preparation replaces it with the verified binding's real customer code. No schema migration is needed.
- The existing worker considers waiting requests only for active, verified Tier 1/2 users whose Paystack identity is verified. The original provisioning checks and provider lease/requery-before-create remain in force. Saved consent is carried into preparation after these checks. Deterministic preparation failures become actionable; transient failures receive backoff without overwriting newer provider outcomes. An already persisted active account also repairs stale request status.
- Existing BVN, NIN, transaction limits, signature checks and account-number disclosure rules are retained.

## Validation

Regression coverage includes balance toggling without an account, pre-verification consent, duplicate setup requests, suspended users, the actual provisioning gate, worker eligibility, consent recovery after verification, pending BVN with no account request, cancelling consent and restoring saved setup state. Responsive checks cover 430px mobile, 320px with large text and dark theme, and 1024px desktop.

No live identity decision, bank-account opening, consent acceptance or financial action was performed during validation.
