# One-click receiving-account retry — 3 November 2026

## Finding and repair

The recorded `ACTION_REQUIRED` failure predates the deployed recovery release. The old provider adapter expected `bank_slug`/`slug`; Paystack's live available-bank response uses `provider_slug`. Commit `7f7b4f8` corrects that parsing, preserves recovery before creation, and is marked Done in Dokploy. Read-only Paystack checks returned HTTP 200 for the available providers and the verified customer's profile. No dedicated account had been assigned at that diagnostic checkpoint.

The remaining Receive Money retry action navigated to a second setup screen without sending an account request. A widget regression reproduced that behavior before the repair.

For a saved request with verified BVN, retry now calls the existing authenticated provisioning endpoint directly, reuses recorded consent, disables repeat submission while pending, and reloads authoritative account and provisioning state. An active result refreshes the wallet views. Transport errors retain the same idempotency key; definitive 400/401/403/404/422 rejections release the client attempt. Uncertain 409/429/server outcomes retain the attempt. New or unverified requests keep the existing consent/verification flow.

No new endpoint, provider permission, identity approval, balance update, account limit, or raw provider error exposure is introduced. Existing server consent, KYC, lease, recovery-before-create and account uniqueness controls remain authoritative. The owner performed the final click and reported that bank details appeared. The observed provisioning response was HTTP 201 with ACTIVE Wema account details; a subsequent HTTP 200 account read confirmed the matching persisted account. The agent did not submit the final financial-account creation action.

## Limit scope

The account provisioning path does not read the Tier 1 transaction-limit policy. Removing a transaction limit would not repair the recorded provider failure.

The CBN July 2021 Mobile Money Guidelines section 16 specify NGN 50,000 daily cumulative outflow and NGN 300,000 cumulative balance for Tier 1. Treating NGN 50,000 as an application per-transaction cap is a conservative product rule, not a separate statutory single-outflow figure in that table. The December 2023 circular requires electronically validated BVN or NIN for Tier 1. These rules do not establish Ghana account limits or independently authorize an FX corridor.

- [CBN Mobile Money Guidelines, July 2021](https://www.cbn.gov.ng/Out/2021/CCD/Framework%20and%20Guidelines%20on%20Mobile%20Money%20Services%20in%20Nigeria%20-%20July%202021.pdf)
- [CBN Tier 1 BVN/NIN circular, December 2023](https://www.cbn.gov.ng/Out/2023/PSMD/Circular%20on%20Tier%201%20Wallets%20%26%20Accounts%2C%20Guidance%20Note%20%26%20Profiling%20of%20Customers%27%20Accounts%20%26%20Wallets.pdf)

The owner subsequently approved configuring Tier 1 maximums and admin controls, then requested clarification of all CBN tiers. The separate deposit recovery applied the previously approved 50,000 NGN transaction/daily and 300,000 NGN balance policy to resolve a real blocked credit; see the deposit recovery report. Full admin policy management remains unimplemented.

## Verification

The single-click regression was observed failing before implementation and passing afterward. Additional cases exercise a disabled duplicate click and retry after an uncertain response with the same idempotency key. Scoped analysis reports no issues. The final full Flutter run passed all 500 tests, including the three retry regressions and the subsequent balance-refresh changes. Scoped wallet analysis reported no issues.
