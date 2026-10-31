# Mobile transfer UX

Improve bank transfers and TrustPay transfers using the existing authenticated lookup and payment endpoints. Keep the existing amount-first bank flow, PIN confirmation, Paystack routing, exact monetary values, idempotency and uncertain-payment recovery. Show real wallet balances, a searchable bank picker, account lookup progress, verified recipient details and clear retry states. Include a direct switch between bank and TrustPay transfers.

This pass adds focused presentation widgets around the existing payment engine and binds recipient verification to the current inputs.

- [x] Regression tests: stale bank/email results after edits, empty results, unavailable bank list and successful review.
- [x] Build transfer amount/recipient cards, searchable bank selector, route switch and keyboard-safe action.
- [x] Bind recipient names to exact current input, immediately invalidate old lookups, block unverified/manual names and freeze details during review.
- [x] Verify existing PIN/idempotency/recovery integration, exact balances and small/large-text light/dark layouts. Export sample-data previews.

Account-number prefixes do not uniquely identify a bank. The user selects a bank; the app automatically resolves the name when ten digits are entered. TrustPay recipient preview remains privacy-preserving and uses the server-provided masked identity.

No backend schema, provider, fee or ledger changes are planned. Preserve concurrent Paystack migration and existing VTU work in this checkout.

Implementation notes:

- Bank names come from the authenticated bank catalog. Resolving an account requires the selected bank and all ten digits. Changing either immediately clears the verified identity and rejects late responses.
- TrustPay previews retain the backend's masked identity. Changing an email immediately invalidates the previous result.
- Available balances come from wallet APIs. Missing or loading balances disable continuation; refresh can recover the form. Amount comparisons and summaries preserve exact decimal values.
- Details, wallet selection and transfer-type tabs freeze during review and submission. A failed security-status check returns the form to a usable state without submitting money.
- Saved beneficiaries collect an amount before review. The existing PIN, encrypted attempt journal, idempotency key and uncertain-payment resolver remain in the flow.
- Visual checks cover 320/390px phone widths, 150% text, dark/light themes, and a keyboard-open bank search/action footer. Screenshots use test recipients and balances; no live funds are moved.

Verification (30 October 2026):

- 73/73 automated tests passed across transfer UX, exact review/keyboard contracts, internal PIN/recovery integration, send entry, payment recovery, amount validation, VTU flow/purchase UX and extended VTU forms.
- The bank submission test verifies that no money request occurs before review and PIN approval, then exactly one Paystack withdrawal carries the verified bank/account/name, exact amount and idempotency key and opens the receipt route.
- Focused Dart analysis reports no errors or new transfer diagnostics. One existing unused funding helper (`_fundingAccountNameParts`) remains outside this pass.
- `git diff --check` passed for changed transfer source/tests.
- Captures: `output/transfer-ui/transfer-preview.png`, individual bank amount/recipient/review screens, internal light/dark screens at 320/390px, and the large-text dark bank recipient screen.

Reproduce from `APP/`:

```sh
TRUSTPAY_TRANSFER_CAPTURE=1 flutter test --no-pub --concurrency=1 test/transfer_ux_test.dart test/internal_transfer_review_test.dart test/internal_transfer_flow_integration_test.dart test/send_money_entry_screen_test.dart test/vtu_money_action_flow_test.dart test/payment_recovery_test.dart test/money_action_validation_test.dart test/vtu_purchase_ux_test.dart test/extended_vtu_form_test.dart
```

Test fixtures use simulated API responses and PINs. Provider production credentials, deployment, and live-money transactions are outside this verification.

The follow-up [real-backend verification](../../TRANSFER-BACKEND-VERIFICATION-2026-10-30.md) records production wiring, server availability fixes, PostgreSQL/Redis checks and the outstanding live-service timeout.
