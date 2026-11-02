# Approved Ninja NIN configuration restored

The owner confirmed Ninja approval on 2 November 2026 and requested restoration as the NIN KYC provider.

Paystack remains the BVN/bank-account provider. New NIN upgrades use the restored strict match-only Ninja adapter after BVN verification, with explicit consent and the existing authenticated, idempotent, audited verification flow. A successful NIN check alongside BVN earns Tier 2. Existing pending/manual evidence is preserved.

The existing local live secret authenticated successfully through `GET /api/wallet/balance` on Ninja's live host (HTTP 200). Only authentication status was recorded; no credential or account response was logged, and no identity verification or billable registry lookup was submitted.

Local `BACKEND/.env` now sets `NINJA_NIN_ENABLED=true`, uses the live base URL, and supplies the existing secret under `NINJA_SECRET_KEY`. The retained old client key/secret entries were not deleted. The Render blueprint now carries the enable flag, live URL and secret-only key entry. No remote configuration change, restart or deployment was performed.

The active backend must load these settings before clients report `ninVerificationAvailable=true`. For deployment, securely install the existing live secret as `NINJA_SECRET_KEY` alongside the blueprint settings. Never put credentials in source control. The current contract uses direct server-side bearer authentication, as documented in [Ninja API docs](https://www.ninja.ng/docs/).

Verification passed: 57 tests across the Ninja provider, KYC service, provider selection and production configuration suites. Instantiating the actual adapter with the restored local configuration reports Ninja NIN ready, passes its production credential checks and preserves `KYC_PROVIDER=paystack`. Whitespace checks passed.
