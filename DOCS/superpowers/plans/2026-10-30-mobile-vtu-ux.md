# Mobile VTU experience implementation plan

**Goal:** Make mobile airtime, data, TV and electricity purchases easy to scan and complete.

**Design:** Keep TRUSTPAY's existing theme and payment approval/recovery flow. Put the recipient before network and plans. Keep four core mobile networks visible with bundled VTpass logos; expose specialist services through a separate picker. Suggest a network from NCC prefixes with a clear ported-number override. Preserve full plan names and prices in searchable, accessible rows. Use compact progress feedback and a single payment action.

**Approaches:** A cosmetic refresh would leave the ordering problem intact. A new purchase engine would duplicate payment safeguards. This pass uses shared presentation widgets around the existing purchase engine.

**Constraints:** Flutter/Riverpod/Dio; VTpass only; no backend/schema changes; server financial totals, idempotency, PIN approval and unresolved payment protection remain authoritative. Existing work in the checkout must be preserved.

## Tasks

- [x] Add regression tests for automatic network suggestion, manual override, international phone paste, and provider catalogs containing specialist services.
- [x] Add shared logo, provider picker, phone input and searchable plan components. Bundle public provider images from VTpass with documented sources.
- [x] Integrate phone-first airtime/data layouts; guard package loading against out-of-order network responses; simplify bill screens.
- [x] Run mobile tests and analyzer, visually inspect light/dark and narrow/large-text screens, and address failures.

## Review focus

- Ported numbers: manual selection persists for the current recipient.
- Rapid network switching: an old response cannot replace the new network's plans.
- International phone paste: +234 and 234 normalize without truncation.
- Expanded provider catalogs: core logos remain visible and all other services remain reachable.
- Long plan names and large fonts: show full distinguishing names without overflow.

## Verification record

Initial network suggestion regression failed before implementation and passed after implementation. Existing airtime flow test now pumps a frame after typing so the enabled footer is rebuilt before tapping. Expanded catalog and manual override checks passed. The delayed network test scrolls to the plan area because the real screen uses a lazy SliverList.

Focused analyzer passed with no issues before final visual refinements. Full suite and final analyzer are running. Initial test compilation was interrupted by a full disk; only disposable outputs from this run were selected for cleanup, and testing resumed when space became available.

Independent review identified a specialist-return network regression, incomplete specialist plan presentation, a missing ShowMax image, and provider/package loading state interference. The implementation now restores the previous core network and manual override, uses the shared full-name plan list for specialist services (including explicit flexible pricing), bundles ShowMax artwork, and tracks provider loading separately from package loading. The airtime fixture now uses the production `smile-airtime` identifier, and a regression covers returning from Smile to an Airtel recipient.

Visual captures: `APP/test/vtu_purchase_ux_test.dart` supports `--dart-define=VTU_CAPTURE=true` with bundled Inter font assets. PNGs are written to `output/vtu-ui/`. Capture fixtures use simulated API responses and make no purchases.

Final focused verification: 40/40 tests passed, covering purchase staging, local/+234 normalization, manual overrides, specialist return navigation, stale provider responses, specialist quote/PIN payloads, amount validation, keyboard positioning, and 320/390/768px layouts. Light/dark captures were inspected with real fonts and provider artwork. A clipped phone helper was corrected to wrap at large text sizes. The visual harness exposed font HTTP dependency, addressed by bundling checksum-verified Inter Regular and Medium (the weights used by the current theme), with the SIL license included. The last focused run disabled runtime font fetching and passed all 40 tests.

The focused widget/test analyzer returned no issues. Full-screen analysis reported one unrelated unused funding helper (`_fundingAccountNameParts`) after concurrent edits to the funding flow; that work was preserved. An initial full-suite compile was stopped after more than 16 minutes under disk/memory pressure.

An additional country-switch regression reproduced loss of a ported-number override before its fix. Returning to Nigeria now preserves an available selected network and only chooses a fallback if that selection is unavailable; automatic suggestions resume when appropriate. The final focused run passed **41/41** tests after this change.

The wider suite completed with **249 passed / 4 failed**. These failures concern concurrently edited funding/KYC surfaces, which this VTU pass did not change:

- `home_screen_test.dart`: `funding hides the account number until complete KYC`
- `home_screen_test.dart`: `funding workflow opens directly from its route`
- `home_screen_test.dart`: `home screen opens the funding workflow from the feature hub`
- `kyc_verification_screen_test.dart`: `submits the identifier and exact date of birth`

The funding failures included a ListTile/Material assertion and missing funding UI expectations. The KYC test found two Checkbox widgets where its selector expected one. Final source analysis still reports only the unrelated unused funding helper above. `git diff --check` passed for the edited tracked VTU files. All 28 bundled provider images decoded successfully. Preview: `output/vtu-ui/vtu-preview.png`.

Commands:

```sh
cd APP
flutter test --no-pub --concurrency=2 test/vtu_purchase_ux_test.dart test/vtu_money_action_flow_test.dart test/extended_vtu_form_test.dart test/money_action_validation_test.dart --dart-define=VTU_CAPTURE=true
flutter test --no-pub --concurrency=2 --dart-define=VTU_CAPTURE=true
dart analyze lib/features/home/screens/money_action_screen.dart lib/features/home/screens/extended_vtu_form.dart lib/features/home/widgets/vtu_phone.dart lib/features/home/widgets/vtu_purchase_widgets.dart test/vtu_purchase_ux_test.dart test/vtu_money_action_flow_test.dart
```
