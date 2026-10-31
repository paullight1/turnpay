# Paystack and Flutter verification — 30 October 2026

This follow-up checks the migration after the backend environment was configured. It preserves the shared checkout's other changes. No deployment, production database mutation, live charge, transfer, or customer identity submission is part of this verification.

## Development tooling

- Existing Flutter SDK at `/Users/MAC/development/flutter` confirmed operational: Flutter 3.44.6, Dart 3.12.2.
- Flutter and Dart added to the local user's login-shell PATH. CI now pins Flutter 3.44.6, matching the release workflow.
- `flutter pub get` completed without upgrading the project dependency constraints.
- Android SDK and Xcode are installed. Android licenses still require acceptance; no physical-device acceptance or signed native release was performed.

## Fixes checked

- Mobile checkout destinations restricted to the Paystack HTTPS checkout host, without embedded credentials or unexpected ports. The regression suite rejected four previously accepted unsafe destinations after the fix; all eight model tests passed.
- Mobile checkout recovery persists an account-scoped payment key and reference in secure storage; a restored pending payment is checked through the backend. Hosted checkout can be reopened from its saved validated link. Pending references are visible and copyable; unresolved payments without a link retain support guidance after status refresh.
- KYC form tests select verification consent and optional dedicated-account consent separately and assert the BVN-linked bank details sent to the service.
- Unused UI declarations and receipt-test analyzer findings removed.
- Backend payment and legacy exchange tests isolated from local `.env` and process configuration so a live key cannot change mocked test behavior.

## Verification results

- Final whole Flutter suite: **290 tests passed**, including KYC submission, checkout restart recovery, uncertain initialization, and reference copying with and without a checkout link. Earlier fixture failures were corrected and the entire suite rerun.
- Final Flutter analyzer: no issues found.
- Backend final verification: 79 suites, 582 tests passed; Nest build and ESLint exited 0. Prisma validation and production manifest checks passed.
- Release-mode Flutter web compilation passed using synthetic CI defines (`--no-wasm-dry-run`). The synthetic web artifact was removed after the check; it is not a deployable TRUSTPAY release.

## Activation findings

These environment findings refer to the local `BACKEND/.env`; no deployed secret store was inspected.

- A live Paystack secret is already configured locally. Read-only requests to `/bank`, `/dedicated_account/available_providers`, and `/balance` all returned HTTP 200 with accepted response envelopes. No response bodies, balances, credentials or customer identities are recorded here. These requests establish API connectivity, not successful live charges, transfers, or BVN verification.
- The configured Supabase database has exactly one pending Prisma migration: `041_paystack_kyc_and_account_state`. The migration must be applied through the release procedure before the new customer/account state can be used. It was not applied by this task.
- Local configuration lacks a Redis endpoint, `IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY`, its `IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID`, and `SUPABASE_SERVICE_ROLE_KEY`. Supply production values in the backend secret store before deployment; keep existing encryption keys and legacy-provider credentials intact.
- Dashboard webhook configuration, applicable merchant permissions, payout liquidity, and controlled live acceptance remain to be confirmed. The successful read-only checks do not establish these.
- An initialization timeout without a saved checkout link remains unresolved. The UI exposes a copyable reference and support guidance; operations must reconcile it before a replacement payment. It does not create another charge automatically.

Follow the [activation procedure](PAYSTACK-ACTIVATION.md) for deployment and acceptance. No database migration, deployment or live money operation was performed.


## Final check evidence

- Flutter: `flutter test --no-pub --concurrency=2 --reporter expanded` — 290 passed; log `/tmp/trustpay-flutter-final-confirmed-tests.log`.
- Flutter analyzer: no issues; log `/tmp/trustpay-flutter-final-confirmed-analyze.log`.
- Flutter web release compilation: exit 0; log `/tmp/trustpay-flutter-final-confirmed-build.log`.
- Backend: 79 suites / 582 tests; log `/tmp/trustpay-paystack-followup-backend-final-final-test.log`.
- Backend build and lint: exit 0; logs `/tmp/trustpay-paystack-followup-build-final-final.log` and `/tmp/trustpay-paystack-followup-lint-final-final.log`.
- Prisma schema validation, production manifest checks and `git diff --check`: passed.

The final code review found that the pending reference was hidden and support guidance could be replaced by generic status copy. Both were corrected, demonstrated by failing widget assertions, and verified again in the focused and whole app suites. No source changes followed the final passing run.
