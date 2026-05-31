# Phase 01 Data Privacy Readiness

## Purpose

Define sensitive-data handling requirements before virtual accounts, beneficiaries, provider events, or enhanced KYC fields are implemented.

## Data Classification

| Field | Classification | Storage Requirement | API/UI Requirement | Logging Requirement |
|---|---|---|---|---|
| `accountNumber` | Sensitive financial identifier | Do not store raw unless strictly required; prefer encrypted value plus masked value. | Return masked by default. Full value only when authenticated owner has a valid need. | Never log full value. |
| `accountNumberEncrypted` | Sensitive encrypted data | Encrypt with app-level key; track key version. | Never return directly. | Never log. |
| `accountNumberMasked` | Limited sensitive | Store for display, e.g. `******1234`. | Safe for user/admin display. | Safe if needed. |
| `accountName` | Personal data | Store only when required by provider/account resolution. | Show to owner/admin as needed. | Avoid in high-volume logs. |
| `bankName` | Low sensitivity | Store plain. | Safe to display. | Safe. |
| `bankCode` | Low sensitivity | Store plain. | Safe to display. | Safe. |
| `providerCustomerId` | Sensitive operational identifier | Store with restricted access; encrypt if provider risk review requires it. | Do not expose to users. Admin only when needed. | Avoid logging except hashed/reference context. |
| `providerReference` | Operational financial identifier | Store plain for reconciliation/idempotency. | Prefer TRUSTPAY reference for user display. | Safe if not combined with PII-heavy payloads. |
| `BVN`, `NIN`, `idNumber` | Highly sensitive identity data | Must be encrypted or tokenized before banking expansion. Current raw `KycDocument.idNumber` is not acceptable for expanded banking. | Never return full value. Admin display masked only unless break-glass permission exists. | Never log. |
| `documentUrl` | Sensitive identity document pointer | Store private object key/URL only. Use signed short-lived access. | Admin-only, audited access. | Never log full signed URLs. |
| `email`, `phone` | Personal data | Store plain if needed for auth/account operation. | Mask in admin tables where full value is unnecessary. | Avoid full values in financial logs. |
| `webhook payload` | Mixed sensitive data | Store raw only if encrypted/redacted, or store redacted payload plus payload hash. | Admin view should be redacted. | Do not log raw payload. |
| `metadata` | Unknown/mixed | Treat as sensitive by default. | Redact provider/customer fields. | Do not log blindly. |

## Required Controls

- Define field-level classification before adding `VirtualAccount`, `BankAccount`, `ProviderEvent`, or `TransferAttempt`.
- Add `PII_ENCRYPTION_KEY` and key rotation/versioning before storing bank account or national ID values.
- Mask account numbers everywhere by default.
- Admin tables must default to masked account and KYC values.
- Full sensitive value access, if ever allowed, must require elevated permission, reason, audit log, and short-lived display.
- Exports containing account/KYC data must be permissioned, audited, encrypted, and minimized.
- Retention policy must be defined for rejected KYC documents, old provider payloads, webhook raw bodies, and deleted beneficiaries.

## Tests Required Later

- Account-number masking in API responses.
- KYC identifier masking in admin responses.
- No full account number, BVN, NIN, OTP, token, or secret in logs.
- Provider payload redaction before admin display.
- Encryption key version is stored with encrypted sensitive values.
- Deleted beneficiaries remain unavailable for withdrawal while preserving auditability.

## Phase 1 Blockers

- Do not implement virtual accounts or beneficiaries until encryption and masking strategy is implemented.
- Do not store raw provider webhook payloads unless encrypted or redacted.
- Do not expose KYC document URLs without short-lived signed access and audit logging.
