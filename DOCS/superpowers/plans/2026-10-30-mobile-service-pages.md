# Mobile service pages

Airtime: Recipient → Amount → existing confirmation/PIN.
Data: Recipient → Plan → Payment → existing confirmation/PIN.
Each page has a fixed header, progress, focused scroll region and keyboard-safe bottom action. Preserve input on back. Invalidate plans on network changes; retain request freshness and backend prices. Preserve payment recovery, idempotency, KYC and PIN gates.

KYC: status overview and focused full-page steps retaining account lookup, consent, validation and submission rules.

Verify navigation, stale responses, invalid input, small screens, large text, dark mode and shared financial regressions. No live purchases.

## Implementation and verification

- Core airtime/data now use independent keyed page bodies, fixed progress/header, and keyboard-safe bottom actions. Data plan selection no longer shares the recipient page. Back/system navigation retains input; network changes discard old plans.
- Confirmed terminal orders expose an explicit new-top-up action; pending orders remain locked. Starting over clears amount/plan and reloads current data packages.
- KYC now uses full-screen guided steps and manual-document submission, a concise status overview, real searchable backend banks, foreground validation feedback, separate consents, and guarded navigation during submission.
- 95 focused Flutter tests passed across VTU, KYC, transfers, payment recovery, validation, and extended-service forms. Relevant Dart analysis reported no issues. Preview captures cover light/dark, small/tablet widths, large text, and keyboard insets. Preview data comes from test fixtures only.
- Local backend readiness returned HTTP 200. No live purchase, transfer, or identity submission was made for this UI verification.
