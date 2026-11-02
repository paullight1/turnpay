# BVN-first verification and consistent action gates

Date: 2 November 2026
Status: Design for review; application changes have not started.

## Intent and agreed product behavior

The owner wants a calm, minimalist KYC experience across the Next.js website and Flutter app. A successful BVN and linked-bank validation earns Tier 1, starts NGN receiving-account preparation when the customer has consented, and makes supported money actions eligible within Tier 1 limits. A verified NIN in addition to verified BVN earns Tier 2.

The owner explicitly selected: **All transactions within Tier 1 limits**, including transfers, withdrawals, bills and exchange. NIN must not be presented as a universal prerequisite for transacting.

## Approach

Use one progressive verification journey, backed by a shared server eligibility policy and consistent client presentation. A new customer sees BVN as the main action; a Tier 1 customer sees their active status and a quieter NIN upgrade. A pending upgrade does not remove earned Tier 1 access.

A UI-only relabel would leave the current Tier 2 backend restrictions in place. Keeping withdrawals or exchange at Tier 2 conflicts with the owner's selected policy. The progressive journey with matching backend enforcement is therefore the selected approach.

Continue Paystack for BVN plus linked-account validation and NGN account provisioning. Restore Ninja as the NIN verification provider, consistent with the preceding conversation, while retaining auditable manual review for exceptions and existing submissions. No live provider activation, verification of a real identity, reviewer decision, deployment, or account reclassification is part of this implementation.

The Ninja adapter/configuration path is in scope; production enablement is explicitly gated off until current credentials, required business approval and authorized data-access terms are confirmed. Do not switch a live installation from manual review during development. Existing NIN submissions continue through their original review path.

## Current implementation findings

- Paystack BVN submissions already remain pending until a genuine verified provider outcome. Bank-account preparation is a separate process.
- Web KYC is a long page with provider-oriented status messages and separate BVN/NIN panels.
- Mobile shows two equally prominent checks and counts completion out of two, implying that both are needed to start using the product.
- Withdrawals, internal transfers, VTU, wallet exchange and manual exchange still require Tier 2 in the backend. Several mobile screens repeat that requirement; the web's generic gate checks status without tier.
- Existing withdrawal caps and internal-transfer policies are separate. There is no confirmed complete Tier 1 limit configuration covering every action.
- Ninja remains in historical records and the database provider enum, but its application adapter and configuration were removed.
- This checkout contains substantial existing work, including edits to the mobile KYC and transaction screens. Preserve those edits and extend the current files carefully.

## Tier eligibility

| State | Presentation and access |
| --- | --- |
| Unverified | Main action: Verify BVN. Explain that it activates Tier 1 and starts bank-account setup. Money actions remain blocked. |
| BVN pending | Show Checking your BVN, a status action and delayed-check support when supplied by the server. Prevent duplicate submissions. |
| BVN failed or mismatch | Show a specific safe explanation and correction/support action. No tier promotion. |
| BVN verified, bank preparing | Show Tier 1 active and Preparing your bank account independently. Eligible wallet actions may continue within policy; receiving-account details remain unavailable until ready. |
| BVN verified, bank ready | Show Tier 1 active, account navigation and supported actions within configured Tier 1 limits. |
| Tier 1, NIN not submitted | Secondary action: Upgrade to Tier 2. Explain the actual higher limits only when available from the server. |
| Tier 1, NIN pending/exception | Show NIN under review. Preserve Tier 1 transactions; do not show a global unverified banner. |
| BVN and NIN verified | Show Tier 2 active. No repeated submission prompts. |
| Suspended/restricted | Restriction message and support take precedence over upgrade messaging. No suggestion that resubmitting KYC removes a restriction. |

Tier eligibility is server-owned. For new promotions under this policy, NIN alone does not earn Tier 1 and alternative document combinations cannot bypass BVN. Preserve historically earned tiers without a bulk downgrade; new Paystack receiving accounts still require Paystack-specific validation and consent. Keep legacy provider obligations unchanged.

## UI design

Use the existing TRUSTPAY type, colors, buttons, spacing and icon family. Prefer neutral surfaces, restrained borders, generous form spacing, and one strong primary action. Avoid large illustrations, marketing headers, percentage meters, provider status jargon and duplicate notices.

### KYC overview

1. Header: **Identity verification** with one short sentence relevant to the current state.
2. Compact current-tier badge; show actual entitlement rather than a misleading two-check completion score.
3. Primary section: **Tier 1 · Bank verification**. Before submission, explain the benefit and show **Verify BVN**. After confirmation, show the completion state and separate receiving-account preparation/status link.
4. Secondary row: **Tier 2 · NIN verification** with a short explanation and **Upgrade to Tier 2** after Tier 1. Before BVN completes, explain **Available after BVN verification**.
5. Quiet **Verification history** link or disclosure with masked identifiers and readable dates/statuses.

At phone widths use one column and full-width primary controls. Desktop uses a constrained reading/form width with a small tier summary where space allows. Dark mode, keyboard focus, screen-reader labels and large text must remain usable.

### Forms

BVN uses the existing personal-details preflight, linked-bank selection/account input, validation and explicit consent. Show field labels above inputs, preserve safe non-sensitive draft navigation and focus the first invalid field. Explain bank-account creation consent separately from identity sharing. Do not promise immediate account readiness.

NIN defaults to the authorized Ninja verification flow after Tier 1, with legal identity details sourced from the verified profile and necessary matching inputs. Use verification/match mode and retain only the required minimal evidence. Where provider authorization or configuration is missing, show an honest unavailable state or the existing explicitly labeled manual-review route. Preserve private evidence previews and upload recovery already added in the checkout.

### Gates before money actions

Use the same state-specific content on home, funding/account setup, internal transfer, withdrawal, bills/airtime/data and exchange entry/confirmation screens, plus relevant profile/account status surfaces:

- Unverified: **Verify BVN to continue** — **Activate Tier 1 to [specific action] within your account limits.** Button: **Verify BVN**.
- Pending: **Your BVN check is in progress**. Button: **View verification status**.
- Tier 1 below the requested amount's cap: continue the action; NIN is not required.
- Tier 1 above an applicable cap: show the actual cap and **Upgrade to Tier 2** only if a configured higher-tier policy supports the action/amount. A daily limit reset can also be shown when known.
- Missing policy/provider unavailable: explain temporary unavailability. Do not present NIN as a fix for missing product configuration.
- Account setup pending: show bank preparation separately from identity status.

Return from verification to the initiating safe internal route where practical. Refresh server profile/eligibility/account queries; never automatically submit a transfer or purchase after returning. Keep drafts in memory where already supported and do not expose identifiers in URL parameters.

## Backend and limits

Centralize the minimum tier and entitlement checks for supported actions instead of changing isolated string comparisons. Recheck authoritative eligibility and monetary caps on mutation, inside the relevant transaction for money movement. Client gates are explanatory only.

Introduce explicit per-currency Tier 1 policy configuration for the newly eligible actions and wallet-balance controls, reusing existing versioned policies and reservation/accounting machinery where suitable. Preserve existing Tier 2 limits. Do not reuse the current default NGN 500,000 withdrawal allowance as an implicit Tier 1 allowance, or invent production limit values.

**Missing Tier 1 policy fails closed for that action.** The implementation can be complete with documented configuration fields and synthetic test policy values; live Tier 1 availability requires the approved limits to be configured. Expose only configured limits in the UI. Keep internal-transfer sender/recipient eligibility and limits aligned. Preserve pending reservations, refund handling, ledger atomicity and exactly-once processing.

The owner and licensed financial partner supply and approve production numeric limits; operators install those approved values through the existing audited configuration/release process. No such complete approval or set of values has been established in this chat. Do not represent the code change as provider/regulatory approval, and retain provider/feature activation checks independently of tier eligibility.

For a shared daily cap, all covered debit paths must reserve against the same authoritative usage budget under concurrency. An action's own tighter cap still applies. Inbound provider-confirmed funds above a receiving/balance cap must enter the existing auditable exception/reconciliation process; do not discard provider receipts or falsely mark received money as failed.

NGN is the BVN-first scope. Do not infer Nigerian identity approval grants Ghana product eligibility, activate disabled GHS features or alter cross-border provider requirements. Supported FX actions remain subject to their own availability and regulatory/product controls.

## Security and privacy

Follow DOCS/SECURITY-RULES.MD: DTO validation, JWT/admin guards, sensitive-endpoint throttling, mutation idempotency, encrypted identifiers, signed provider callbacks, auditable provider outcomes/admin actions, Decimal monetary values, no negative balances and transactional money operations.

Paystack request acceptance is never identity success. Retries reuse an unresolved attempt. A client refresh never fabricates a terminal provider result. Ninja failure or unavailability never silently falls back to an unapproved identity success. Do not copy deprecated historical API authentication assumptions without checking the current provider contract.

No live secrets, identity numbers, documents, signed URLs or raw identity payloads in fixtures, logs, documentation or screenshots. Do not install credentials, change live limits, approve manual KYC, or enable live provider products during this work.

## Verification and completion

- Backend regressions: BVN success promotes Tier 1 without NIN; NIN alone cannot newly promote; both promote Tier 2; pending/failed callbacks do not promote; pending/rejected NIN does not remove Tier 1; duplicate/concurrent outcomes remain safe.
- Financial regressions: Tier 0 blocked; Tier 1 supported actions succeed below configured caps; caps and maximum balance are enforced; missing policies and unavailable products fail closed; suspension overrides tiers; concurrent mixed actions cannot exceed a shared allowance; failures/releases/reversals follow existing accounting semantics.
- Web browser checks at desktop and phone widths: all KYC states and action gates, return navigation, validation, duplicate-submission prevention, accessible forms, no clipping, and genuine server refresh after completion.
- Flutter widget/presenter tests and analysis: matching states, Tier 1 action access, upgrade prompts only when appropriate, profile preflight, history/private evidence behavior and pending recovery.
- Update the current provider/KYC/activation documentation and the security phase note to describe the selected policy, Ninja readiness and required limit configuration accurately.
- Report local verification separately from live Paystack/Ninja acceptance. Do not claim live verification or bank-account readiness from UI tests.

## Calls left to implementation

Choose small reusable components/presenters, exact spacing, file boundaries and test fixtures within the existing stack. Reuse installed dependencies. Choose additive schema/policy changes only when the existing models cannot represent required limits. Read database-specific skills before schema changes. Do not bundle unrelated cleanup or overwrite the checkout's existing work.

## Builder check

A fresh reviewer checked the design before handoff. Questions about Ninja activation, production limit ownership, partner acceptance and historical accounts are resolved explicitly above: implement the adapter behind readiness controls, leave approved production amounts to the owner/partner, make no regulatory-approval claim, and preserve existing earned tiers without automatic migration. No additional product choice is needed to plan the code changes.
