# V1 Hide Money-Out Features Design

## Intent

Ship the Flutter V1 without customer money-out actions. Send Money and Withdraw stay implemented for a future release, but V1 customers must not see or open them. Funding remains available and becomes the wallet card’s single primary action.

## Goals

- Add one centralized Flutter launch-capability switch for money-out features, disabled for V1.
- Hide Send Money and Withdraw entry points across Home, Feature Hub, wallet details, beneficiary shortcuts, onboarding, and other active navigation surfaces.
- Prevent direct navigation to active Send Money and Withdraw action routes while the V1 switch is disabled.
- Keep historical transfer and withdrawal receipts accessible from transaction history.
- Replace the Home wallet card’s two equal actions with one full-width **Add funds** action.
- Rebalance the wallet card’s height, spacing, and hierarchy for the single action at normal and large text sizes.

## Non-goals

- Do not delete or rewrite Send Money or Withdraw implementation code.
- Do not change backend transfer or withdrawal APIs, financial controls, or persisted records.
- Do not hide incoming funding, wallet receiving-account setup, exchanges, VTU, or historical transaction details.
- Do not label incoming transfers as completed before the backend confirms them.

## Constraints

- The future release path must be one deliberate capability change rather than reconstructing removed UI.
- Action routes must fail closed in V1 even if opened from an old bookmark or deep link.
- Receipt/detail routes remain readable so customers can audit previous activity.
- Existing unrelated work in the dirty checkout must remain untouched.

## Approaches Considered

1. **Centralized launch capability (selected).** A single disabled-by-default V1 capability controls entry-point visibility and route access. This best supports a safe future re-enable and avoids deleting implementation.
2. Hide only the Home buttons. This is smaller but fails the requirement because Feature Hub, wallet details, beneficiary shortcuts, and deep links still expose money-out actions.
3. Delete Send Money and Withdraw code and routes. This blocks access but conflicts with the explicit requirement to preserve the features for a future stable release.

## Approved Behavior

For V1, both Send Money and Withdraw are hidden throughout the Flutter UI and their action routes return customers to Home. Historical receipts and transaction details remain available. The Home wallet card shows a single bold, full-width **Add funds** button leading to the existing funding/receiving flow, with spacing adjusted around the account chip, balance, and CTA.

## Exchange Flow Addendum

The user also approved an immersive Exchange transaction journey for V1:

- Hide the main bottom navigation after entering the Exchange panel so tab switching cannot accidentally abandon an in-progress exchange.
- Keep the Exchange chooser reachable from the main navigation, but render chooser and transaction steps outside the tab shell.
- Before a started draft is discarded, Back must show a warning that clearly distinguishes **Keep exchange** from **Cancel exchange**.
- Back from the untouched chooser may return directly without a warning because no transaction state exists yet.
- Use full-width primary CTAs with consistent page-bottom spacing across the Exchange chooser, amount, receiving details, transfer instructions, receipt upload, review, and pending-status surfaces.
- Preserve system back behavior by applying the same discard confirmation instead of allowing an unguarded pop.
- Do not change exchange API, idempotency, retry, receipt recovery, or history semantics.
