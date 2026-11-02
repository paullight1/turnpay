# Manual exchange activation — 1 November 2026

The disabled Exchange screen was caused by the local manual-exchange switch being absent and both dedicated receiving configurations being unset. This follow-up configures the owner-supplied Zenith NGN and MTN MoMo GHS receiving accounts in the ignored local backend environment. The owner confirmed the exact MoMo merchant name before activation. No receiving numbers or credentials are committed in source, templates or this report.

Both directions are enabled locally. The API was rebuilt and restarted to load the environment, and the actual signed-in Flutter preview now displays Cedis to naira and Naira to cedis. The account configuration lookup found neither number attached to an existing customer virtual account. This is an internal duplicate-settlement check, not independent bank/MoMo account ownership certification.

## Receiving readiness fix

The configuration endpoint now returns `availableSourceCurrencies`, calculated separately for each direction from the existing dedicated-account validation. `enabled` is false when the master switch is off or neither direction has complete receiving details. Public configuration exposes availability only; it does not expose receiving names or numbers.

Flutter validates this optional capability list, preserves compatibility with an older API, disables unconfigured direction cards and prevents swapping into an unconfigured direction. Existing journal recovery, JWT/KYC/PIN checks, Decimal quotes, frozen receiving details, deposit allocation, admin evidence checks, ledger transactions and audits remain unchanged. Kora activation flags are unchanged.

## Verification

- Backend readiness regressions failed before implementation; Flutter direction-selection regression failed before the capability was enforced.
- Full backend suite: 92 suites / 673 tests passed. A test-fixture environment leak observed on the first broad run was fixed by explicitly isolating all synthetic receiving fields from the real environment.
- Full Flutter suite: 417 tests passed; analyzer reported no issues.
- Real PostgreSQL manual exchange financial suite: 20 tests passed on the disposable database.
- Production backend build and scoped ESLint passed.
- The repository-wide `tsc --noEmit` check separately reported existing test-mock type errors in `src/kyc/paystack-kyc-recovery.service.spec.ts` and `src/otp/otp.service.spec.ts`; the production build excludes these test files and passed. They were not changed in this follow-up.
- Read-only live preview verification confirmed both choices and opened the cedi amount screen without creating an order or submitting a payment. Screenshot: `output/exchange-activation-2026-11-01/exchange-choices.png`.

## Rate configuration — superseded by admin rates

The initial activation exposed a missing FX feed and a stale display-only fallback. The owner subsequently chose admin-set prices. The follow-up uses `FX_RATE_SOURCE=admin` by default and never substitutes an API/fallback price for a missing admin rate. No FX API key is needed in this mode.

Authorized admins save each direction through the existing audited **Exchange rate** card. A saved admin price remains active until replaced or explicitly expired; missing prices block order creation. See `DOCS/ADMIN-EXCHANGE-RATES-2026-11-01.md` for setup and verification. No actual commercial rate was selected or saved by the agent.

This activation is local only. Production needs its own private receiving settings and process restart. Incoming payments still require actual admin statement checks; Kora is not enabled. No live funds, genuine identity verification, production configuration, deployment or Git push was performed.
