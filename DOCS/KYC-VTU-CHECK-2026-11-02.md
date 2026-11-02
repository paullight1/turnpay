# KYC status and VTU country controls — 2 November 2026

## Current account findings

The pending BVN submission was accepted on 31 October 2026. A fresh read of the bound Paystack customer returned HTTP 200 with `identified: false`. The customer used the app's existing authenticated **Check status** action during this check. Its reconciliation completed with `ACTION_REQUIRED`, complete provider event history and no matching terminal identification event. No identification callback exists in the local KYC inbox for this customer. The account remains Tier 0; no approval was fabricated and no second identification request was submitted.

An accepted validation response, including HTTP 202, is not a completed identity check. Paystack documents asynchronous completion through `customeridentification.success` or `customeridentification.failed`: https://paystack.com/docs/identity-verification/validate-customer/.

The NIN submission from 1 November is `SUBMITTED` / `MANUAL_REVIEW` / `REVIEW_REQUIRED`, with no reviewer decision. Read-only storage checks confirmed its PDF exists, has nonzero size and is in a private bucket. The document number, object key, signed links, customer identifiers and credentials are intentionally omitted here.

## Remaining real-account actions

1. Paystack must investigate the original accepted BVN check and deliver its genuine final result. Follow up on the existing support inquiry; do not create a replacement unresolved request or a synthetic callback. The app's BVN status sheet provides the support reference. No new support message was sent in this phase.
2. An authorized reviewer must open **Admin → KYC**, inspect the NIN evidence and personally approve or reject it with a reason. The agent did not make this identity decision. Review operations: [KYC recovery operations](KYC-RECOVERY-OPERATIONS.md).
3. After genuine decisions, refresh the app and verify the resulting tier/account status. Either verified identity check grants the existing Tier 1; both grant Tier 2. Paystack account creation still requires its own provider validation and recorded consent. No receiving account was opened by this phase.

## Product changes

- Home now explains submitted identity checks are in progress and points to BVN/NIN status. Its account setup banner says identity verification is pending and opens KYC instead of asking for a new account request.
- Airtime, Data, Electricity and Cable TV share a compact top-right country control with a flag, country code and dropdown arrow. Inline country rows were removed.
- Unavailable local service countries remain disabled and labeled coming soon. International airtime opens its existing specialist flow; its header lists actual VTpass destinations and updates to the selected flag. Changing destinations still clears the old operator, plan and quote. Selecting the current country preserves the existing purchase step and draft.
- Specialist-service country choices are disabled during loading, submission or unresolved order recovery. Country/header changes do not change PIN approval, quote validation, purchase payloads, idempotency or backend service availability.

## Verification

Evidence and logs: `.superpowers/sdd/2026-11-02-kyc-vtu-header/`.

- Home regression reproduced against the prior component, then passed with the change.
- Selecting the current country initially reset a data payment draft; the extended existing regression reproduced it before a no-op guard fixed it.
- Initial local PostgreSQL test selection used an older disposable database missing Paystack tables. No migration was applied there. The current disposable Kora-era database passed all 9 KYC HTTP scenarios: signed callbacks, duplicate/concurrent recovery, manual review authorization/idempotency, evidence access, decision races and tier promotion.
- Backend unit suite: 686 tests across 94 suites passed.
- Actual customer UI inspection confirmed the revised pending banners, Airtime header and networks, and the international destination menu including Ghana. No quote purchase, PIN submission, payment or identity decision was made.
- Final app and analyzer results are recorded in the phase verification file.

These checks establish application behavior. They do not establish a successful live BVN verification or a completed real NIN review. No production deployment or Git push occurred.
