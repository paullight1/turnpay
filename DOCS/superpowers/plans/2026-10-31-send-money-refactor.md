# Send money UI and recovery implementation plan

Goal: make Flutter TrustPay and NGN bank sending easy to review, authorize and reconcile, with exact amounts in words and reusable receipts.

Architecture: retain the existing MoneyActionScreen payment engine and authenticated endpoints; extract focused presentation widgets and exact amount helpers. Confirmation uses the existing server-verified transaction PIN, as explicitly selected by the user. Preserve provider-owned pending states, the encrypted attempt journal, existing KYC tiers, and all backend money controls.

- [x] Add exact naira/kobo and cedi/pesewa words plus safe grouped decimal entry, with boundary tests.
- [x] Refactor amount/review UI and add reviewed amount/recipient context to PIN confirmation; keep keyboard and large-text layouts usable.
- [x] Add reusable internal transfer receipts from authoritative responses, with status refresh and PDF/JPG export, without exporting wallet balance.
- [x] Fix partial wallet-load failure and payment-preflight storage failure so sending recovers without crashing or bypassing protection.
- [x] Verify wrong/cancelled PINs never send, review freezes the payload, duplicate taps do not duplicate transfers, uncertain attempts resolve safely, and receipts reflect pending/failed/reversed outcomes.
- [x] Run focused and whole Flutter tests, analysis, and phone/dark/large-text visual QA; refresh the actual Flutter preview.

No live transfer, deployment, financial account creation, backend fee invention, or provider OTP workaround is part of this task. The existing Paystack bank flow does not use a merchant OTP as a customer confirmation code.


Verification (2026-10-31):

- `flutter test --no-pub --concurrency=4`: 359 tests passed.
- `flutter analyze --no-pub --no-fatal-infos`: no issues.
- `git diff --check`: passed.
- Focused regressions cover exact words/formatting, partial wallet outages, journal preflight failure, wrong/cancelled PINs, disabled in-flight keypad, restart terminal outcomes, preflight recovery, reversed receipt status, history navigation, and shared VTU preflight recovery.
- Visual QA: 390×844 light and 320×740 dark at 150% text; full PIN keypad fits. Captures are in `output/send-money`.
- Flutter dev server hot-restarted successfully on localhost:8080; HTTP 200 confirmed and in-app browser left at sign-in. No live money moved.
