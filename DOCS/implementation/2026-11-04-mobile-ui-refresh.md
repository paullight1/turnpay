# Mobile UI refresh

The user's three screenshots are the visual specification. Retain TRUSTPAY's red accent, existing light/dark themes and real account data.

## Implementation

- [x] Add a persistent first-entry exchange introduction: explain entering receiving details, transferring to the issued account and payout after confirmation. “Get started” opens the existing exchange. Pending attempts bypass onboarding; order routes remain directly accessible.
- [x] Restructure profile around an editable identity card and grouped Account / Preferences rows, preserving existing security, support, notification, appearance and exchange visibility actions. Reuse the existing referral panel.
- [x] Present view/receive/fund account routes as a dismissible bottom sheet above the current page. Read fresh active Paystack NGN details, support copy, loading/error/retry and unavailable-account states. Retain the existing consent/KYC setup and card-funding routes as explicit secondary actions.
- [x] Standardize filled, elevated, outlined and custom primary CTAs: 56px minimum height, 8px corners, bold labels and full available width for main actions. Preserve focus, loading/disabled semantics and compact icon/navigation controls.
- [x] Run focused behavior/layout checks, Flutter analysis and full Flutter suite. Inspect live exchange intro, profile and account sheet, plus small/large-text and light/dark rendered fixtures.

## Constraints

No financial mutation, provider activation, credential change, production configuration change or backend change is needed. Existing pending-attempt recovery, idempotency, validation, PIN/KYC/consent gates and exact backend money values remain authoritative. The pre-existing changes to manual_exchange_screen.dart and manual_exchange_screen_test.dart belong to other work and must be preserved.

## Verification focus

Intro acknowledgement survives reopening; pending recovery remains accessible; only active NGN Paystack accounts become copyable; unavailable reads never invent account details; long names and large text remain scrollable; all primary actions remain accessible and disabled while busy.

## Verification evidence

The full Flutter run passed 548 tests; the additional rendered layout matrix passed 12 checks across light/dark phone, 320px large text and desktop. Live Flutter browser inspection confirmed the introductory Exchange page, grouped profile, active receiving-account sheet, sheet dismissal back to the same dashboard and Fund wallet modal, with the hosted API still authoritative. Saved screenshots are under output/mobile-ui-refresh/. Independent review is recorded below when complete.

## Review closure and final verification

Independent review identified missing home content under cold account-sheet links. Regression checks reproduced all three cases; account sheets now live under the home route, with redirects preserving the existing /fund, /virtual-account and /receive-money links. Each sheet dismisses to /home. A live browser reload of the legacy receive-money link also confirmed the dashboard underneath and safe dismissal.

The proposed empty-state width regression was disproved: Size.fromHeight(56) already supplies infinite minimum width. A rendered test verifies the existing CTA spans 382px at a 430px viewport; no redundant styling change was made.

Final full Flutter suite: 565 tests passed, including the 12 layout cases and the cold-link/CTA regressions. Final Flutter analysis: no issues found. Local preview remains connected to the hosted backend through the development proxy.

## Feature hub SVG redesign

The Feature Hub now uses a generated, consistent rounded-stroke SVG family for all live services. The main surface is one compact nine-card grid: three rows by three columns at 430px, with the larger SVG icon treatment retained inside smaller cards. Fund, Send, Withdraw, Airtime, Data, Cable TV, Electricity, the NGN account and Wallets are all direct entries; the former More card and bottom sheet are removed. Narrow large-text layouts use two columns to prevent clipping. Coming-soon content is a compact, full-width vertical list with no horizontal swipe interaction. Preview-card service and lock icons are intentionally omitted; each local background image receives a bright, distinct color blend with dark high-contrast copy.

All existing routes and availability behavior are preserved. The regression verifies all nine SVG-backed direct cards, the exact 3×3 430px layout, compact vertical coming-soon cards and the overflow-free 320px layout at 1.6× text. Live browser inspection confirmed the compact grid and full-width preview list. The complete Flutter suite passed 605 tests before this presentation-only follow-up; focused grid/navigation tests and analysis cover the follow-up.

The home notification button now reserves a 48px layout frame around its 44px bell control. Unread badges remain fully inside that frame, including the capped `9+` label, instead of relying on negative offsets outside the header layout. Server unread counts, bounded polling, inbox navigation and read state are unchanged.

## Exchange chooser and recent history

The normal Exchange entry now separates the primary task from recovery: a short “Start a new exchange” introduction leads into two selectable Cedis-to-naira and Naira-to-cedis cards, while a compact Recent exchanges list appears directly below them. The chooser no longer places a blocking payout warning above the cards. When an older hosted configuration omits the direct GHS receiving mode, selecting Cedis-to-naira opens the existing direct-bank form fallback; the backend must still create the order and return a configured collection account before any transfer instructions can appear. All returned server orders are shown as tappable rows with direction, exact source amount and status. A device-local unresolved create is pinned into the same list as an Incomplete exchange; it restores its original draft only after the customer taps Continue saved exchange, and Back returns to the chooser. History loads independently from exchange configuration, so a delayed or failed history read does not remove the new-exchange choices or the saved recovery row.

No exchange mutation, amount calculation, settlement policy, idempotency key, PIN/KYC gate or admin-review behavior changed. Focused exchange, recovery, responsive-layout and history tests pass, and scoped Flutter analysis reports no issues.
