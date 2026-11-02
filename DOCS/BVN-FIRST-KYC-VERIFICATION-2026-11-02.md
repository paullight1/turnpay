# BVN-first KYC implementation and verification

Completed locally on 2 November 2026 against the approved design. No deployment, production configuration changes or real identity decisions were performed.

## Delivered behavior

- Successful Paystack BVN validation earns Tier 1. Bank-account preparation remains separately consented and asynchronous.
- All supported transaction types accept Tier 1 within configured limits and existing product restrictions. Shared NGN transaction, daily and wallet-balance caps are enforced in database transactions with wallet row locking.
- Verified BVN plus NIN earns Tier 2. Pending/rejected NIN preserves earned Tier 1; suspension takes precedence over tier access.
- Ninja NIN verification is restored behind explicit readiness checks and fresh consent. The private manual-evidence workflow remains available when automated verification is unavailable.
- Flutter and retained web KYC use a primary BVN step, quieter NIN upgrade, separate bank status, masked history and consistent action prompts. Production customer web remains retired.

## Verification

| Check | Result |
| --- | --- |
| Backend unit suites | 102 suites, 764 tests passed |
| PostgreSQL/Redis financial integration | 13 suites, 85 tests passed |
| Desktop and phone browser KYC scenarios | 20 passed |
| Flutter focused regressions and visual captures | 100 passed |
| Backend build and scoped lint | Passed |
| Web TypeScript and scoped lint | Passed |
| Flutter analysis | No issues found |

Financial tests used an isolated disposable local database and fake providers. They cover shared allowance consumption, concurrency, missing policy, balance caps, compensation, tier promotion and provider-result handling. Browser scenarios cover the BVN form submission, consent/idempotency, pending states, automated NIN rejection and account restriction.

Fresh implementation review identified unsupported Tier 1 GHS wallet receipt acceptance and alternate-document promotion bypasses. Both were reproduced with failing regressions and corrected. Alternate document promotion is restricted to the authoritative Ghana profile; earned historic tiers remain intact. A separate regression preserves Tier 2 externally paid exchange without requiring a source wallet.

An intermittent browser startup failure was traced to generated Playwright reports being scanned by Tailwind, triggering repeated HMR before router initialization. Ignoring the generated report directories resolved it; the final 20-scenario run passed without those runtime errors.

## Live readiness

Operations still needs approved values for `TIER_ONE_NGN_PER_TRANSACTION`, `TIER_ONE_NGN_DAILY` and `TIER_ONE_NGN_MAX_BALANCE`, plus an approved active Tier 1 internal-transfer policy. Missing or invalid policy fails closed. Test fixture amounts are not production recommendations.

Ninja stays disabled until authorized provider access, credentials and applicable data-processing terms are confirmed. Paystack merchant capability, signed callbacks and account provisioning must be checked through the existing activation process. Local test success does not certify regulatory or provider approval.

## Screenshots

- [Flutter Tier 1](../output/kyc-bvn-first/mobile-tier-one.png)
- [Flutter initial state](../output/kyc-bvn-first/mobile-start.png)
- [Flutter dark mode and large text](../output/kyc-bvn-first/mobile-dark-large.png)
- [Retained web Tier 1](../WEBSITE/output/kyc-bvn-first-tier-one.png)
- [Retained web BVN form](../WEBSITE/output/kyc-bvn-first-form.png)

Detailed operating behavior and configuration: [KYC guide](KYC-GUIDE.MD).
