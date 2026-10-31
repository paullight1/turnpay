# Mobile identity and receiving accounts

Goal: make the Flutter account-request entry functional, clarify KYC progress and recovery, and run the app in the in-app browser.

Use the existing Flutter services, backend-enforced eligibility, Paystack identity validation, and audited NIN review. Preserve existing tiers, provider boundaries and work in progress. No live identity submissions or financial operations are needed for automated verification.

- Reproduce the read-only account request dead end with widget tests.
- Add a focused receiving-account setup screen, reached by the existing virtual-account entry. Read identity/account/provisioning state, require explicit consent before provisioning, retain an idempotency key across uncertain retries, refresh pending requests and recover from errors.
- Refresh Receive Money after setup returns; keep loading/errors distinct from empty state.
- Improve the KYC summary, eligibility guidance, neutral incomplete states and validation recovery. Keep BVN and NIN workflows separate.
- Repair compile blockers preventing local preview. Run focused tests, the Flutter suite, analyzer and web compilation; verify the visible Flutter app in the in-app browser.

Review follow-up: separate NIN upload/submission attempts and reuse uploaded evidence after uncertain submission; bound storage uploads to 30 seconds; refresh masked accounts after KYC return; guard async controller cleanup; clear stale provisioning errors on successful refresh. Focused flow checks and new retry tests passed before the final suite rerun. The exchange recovery fixture also needed its newly added pending-mutation API stub; its focused test passes.

Final verification: `flutter test --no-pub --concurrency=2 --dart-define=KYC_CAPTURE=true` passed all 318 tests (log: `/tmp/trustpay-identity-confirmed-tests.log`). `flutter analyze --no-pub --no-fatal-infos` reports no issues (log: `/tmp/trustpay-identity-confirmed-analyze.log`). `git diff --check` passed. The Flutter development web compiler completed a hot restart; preview `http://localhost:8080` and API `/api/health` returned HTTP 200. The in-app browser displays the actual Flutter app; its saved session expired and it is left at login. Desktop rendering and narrow/dark/large-text widget screenshots were inspected. Live provider identity submissions/account issuance were not performed.
