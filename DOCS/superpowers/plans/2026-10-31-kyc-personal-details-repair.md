# KYC personal-details repair

Cause: Flutter supplies legal names only to the KYC request; Paystack customer creation reads saved profile name/phone. KYC has no phone input or profile-save step.

- [x] Reproduce missing phone input and profile/KYC mismatch with regression tests.
- [x] Load saved profile with KYC overview; collect/validate legal names and Nigerian phone at step 1, preserve edits, show masked phone and an edit action on review.
- [x] Save changed identity profile via the existing authenticated, audited endpoint before KYC; skip unchanged or already-saved retries, retain server profile-lock rules and idempotency headers. Never start KYC after a failed profile save.
- [x] Show locked-profile guidance before bank/identity collection; recover server validation errors directly in personal details.
- [x] Run Flutter tests, analyzer, responsive/large-text visual QA, and restart the Flutter preview without submitting real identity data.

Additional correctness fixes: save birth year in the same once-only profile update; retain editability for unchanged/unlocked profiles; allow a definitively rejected Paystack check to leave pending without weakening unknown-outcome or webhook safeguards. Large-text QA also fixed the date-picker header overflow.


Verification (2026-10-31):

- Flutter full suite: 376 tests passed (`flutter test --no-pub --concurrency=2`). Earlier cross-feature failures were corrected and rerun; final run has no failures.
- Backend full suite: 88 suites / 618 tests passed (`npm test -- --runInBand`). `npm run build` passed; agent targeted ESLint passed.
- Flutter analyzer: no errors or warnings; four existing style infos remain in the unrelated manual exchange files. KYC files have no analyzer issues.
- `git diff --check` passed.
- Captures: `output/kyc-ui/bvn-personal-details-430-light.png`, `bvn-personal-details-320-dark-large.png`, corresponding review/bank captures, plus `kyc-personal-details-live.png` from the actual preview.
- Restored the stopped local API, health HTTP 200 / ready, and refreshed Flutter at localhost:8080. The browser is left on BVN step 1 with name and phone inputs. No real profile save, identity submission, or account creation was triggered by the agent.
- Fixed an unmatched brace encountered in the concurrently edited exchange entry so the app compiles. Status-only KYC consumers keep their existing API requirements; only the verification screen opts into profile metadata.
