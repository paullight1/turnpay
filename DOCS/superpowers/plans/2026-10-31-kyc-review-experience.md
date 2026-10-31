# KYC review experience implementation plan

**Goal:** Replace repetitive review messaging with a short submitted confirmation, a clear NIN next step, and one page to track both identity checks.
**Architecture:** Keep the existing authenticated KYC APIs, profile-save protection, idempotency journals, provider outcome rules, polling and manual NIN consent/upload pipeline. Extract presentation widgets and an independent status model; do not change backend approval/tier rules. The server already permits NIN evidence while BVN is pending, so expose that next step after BVN submission.
**Tech:** Flutter, existing flutter_svg, theme tokens, Dio/go_router.

- [x] Reproduce missing tappable status details / NIN continuation with focused widget regressions.
- [x] Add concise BVN/NIN submitted confirmation screens with original theme-aware SVG illustrations. Primary action continues to NIN when appropriate; secondary returns to the status page.
- [x] Replace duplicated banners and progress blocks with two spacious status cards. Each opens its own status, last-update information, safe rejection guidance and serialized status refresh. History opens a dedicated sheet, including honest empty states.
- [x] Preserve authoritative status and tier semantics, retain pending outcomes on refresh failure, and allow manual NIN submission once BVN has been submitted or verified without enabling duplicate submissions.
- [x] Test pending/verified/failed/legacy combinations, accepted-response vs stale-refresh behavior, refresh errors, polling, and manual NIN submission. Run full Flutter tests, analyzer, responsive/light/dark/large-text QA; refresh the actual app preview without submitting real identity data.

Review focus: stale initial status after an accepted submission; existing verified state must not regress; BVN and NIN failures must not be assigned to the wrong document; double status checks/submissions; bottom-sheet/confirmation scrolling at 320px with 150% text.

Read-only review findings were addressed with canonical-reference retry tests, legacy-status/Paystack-eligibility separation, masked NIN entry, and stale-read reconciliation that retains fresh server tiers. Focused functional/model checks and the 430px light, 320px dark/150% text, and 726px light visual matrix have passed. Full Flutter suite and final preview verification are being recorded below after completion.


Final verification (2026-10-31):

- `flutter test --no-pub --concurrency=2`: 400 tests passed.
- `flutter analyze --no-pub --no-fatal-infos`: no issues.
- `git diff --check`: passed.
- Manual upload flow tested at the file-picker/API boundaries: BVN accepted → confirmation → NIN evidence/consent → NIN review → two independent status cards. No real identity submission was sent.
- Rendered and inspected status, per-check details, history and confirmation at 430×932 light, 320×740 dark with 150% text, and 726×804 light. Captures: `output/kyc-review`.
- Actual Flutter dev preview restarted successfully; HTTP 200 and API health HTTP 200 confirmed. The signed-in browser was reopened to KYC status.
- Hand-authored review/identity/verified SVGs include light and dark variants; all six passed XML validation.
