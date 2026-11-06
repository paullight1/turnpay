# KYC status read recovery — 6 November 2026

The authenticated recipient KYC page returned HTTP 500 from GET /api/kyc/status. Reproducing the deployed service isolated AES-GCM authentication failure while decrypting an older stored identifier solely to mask it for display. The current encryption key cannot authenticate that ciphertext. This was a status-read failure, not a newly rejected Paystack submission.

Status projection now prefers the masked identifier recorded during submission. It accepts only a masked numeric value; malformed/unmasked values are omitted from review evidence. If a legacy identifier cannot be decrypted for display, it returns null and emits a fixed operational warning without ciphertext, identifier, key or raw exception. Original ciphertext is retained for controlled key recovery. This does not restore old encryption keys or rewrite identity evidence.

Provider status, retry eligibility, canonical fingerprint binding, fresh consent, cooldown, retry bounds, signed callbacks, JWT, DTO validation, idempotency and audit controls remain unchanged. No KYC approval, provider dispatch, balance change or financial transaction is performed by status projection.

Three regression cases reproduced the original failure using ciphertext encrypted under a different key. All 114 backend suites / 932 tests, TypeScript checking, scoped ESLint and Nest build passed. Read-only live Paystack checks still showed an unidentified customer, no identification events and zero resubmissions before deployment. Live retry submission and the subsequent two-user transfer must be verified separately.
