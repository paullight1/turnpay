# Admin redesign and Exchange verification

## Scope

Customers use the mobile app. The website is an administrative workspace for
oversight, evidence review and audited financial operations.

## Changes

- Calm slate surfaces, consistent tables, stable cards and responsive navigation.
- Direct access to Overview, Transactions & volume, Customers, Exchange requests,
  VTU oversight, Exchange rates, Audit, Support and KYC.
- Overview prioritizes service transaction volumes and review queues. Treasury,
  system health and detailed reports are expandable.
- Fixed Radix tabs using incompatible data attribute selectors. Horizontal tabs
  previously rendered beside content, squeezing forms and creating a large
  empty-looking tab panel. Active-tab styles now use Radix's state attribute.
- Fixed stale tab selection after sidebar navigation by deriving selection from
  URL parameters.
- Session refresh now applies the newly verified profile atomically, preserving
  the existing screen during bootstrap rather than blanking the profile.
- Fixed phone-width header overflow by hiding the desktop workspace badge.

## Verification

- Flutter: 18 manual Exchange service, screen and order-status tests passed.
- Admin automated workflow checks cover protected receipts, idempotent credit
  retry, payout claim/proof/sent/completion and expired-quote acknowledgement.
- All six admin browser tests passed, including desktop (1087px) and mobile
  (390px) queue/overview overflow checks and sidebar/tab navigation regression.
- Session handoff: 15 tests passed against the configured local website, including
  the new delayed-bootstrap refresh regression. The Supabase-specific failed
  persistence test cannot run against the Supabase-disabled isolated fixture;
  it passed against the correctly configured local website.
- Live computer use verified the corrected overview and inspected the iOS app.
- After deployment, computer use confirmed that iOS shows the enabled manual
  Exchange form and distinct bank/MoMo payout destination fields.
- Entering NGN 1,000 and continuing on the simulator displayed the KYC-required
  gate. Dismissing it restored an enabled Continue button and retained the
  amount. No order or money movement was created.
- TypeScript, selected ESLint checks and whitespace validation passed.

## Manual transfer rollout

The user supplied a Zenith NGN receiving account (ending 6770) and an MTN MoMo
GHS receiving account (ending 1076). Do not commit full account details or use
them as fictional test accounts. Store receiving details in protected runtime
configuration; snapshot the correct account and version onto each order.

The current deployed manual flow supports NGN deposits and GHS settlement only.
NGN receiving configuration was saved in Render and activated by redeploying the
existing backend commit b45ed2de8dca5f87fad336ce2b24fc48bfab9b80. Render deployment
dep-dae0dhgn74is73bsc7i0 reported live. GHS deposits/reverse exchanges
are not implemented; do not expose the MTN account as an operational reverse
lane until backend, mobile, ledger and reconciliation support is verified.

Remaining live verification requires a fresh operator-approved exchange rate
and a legitimately Tier 2 verified
customer. No test evidence has been used to assert receipt of real funds. No
real deposit, payout or wallet credit was performed. Automated state-transition
tests are not proof of a live app-to-admin settlement.

V1 uses shared manual receiving instructions, receipt upload and audited admin
confirmation. The app and queue currently poll status every 15 seconds while
foregrounded; this is not instantaneous push delivery. V2 should introduce
admin-provisioned Monnify virtual accounts with verified idempotent webhooks,
reconciliation and prevention of duplicate manual/automatic settlement.

The website redesign remains local and is not production deployed.

## Follow-up: Exchange availability recovery

The reported screenshot showed the prior disabled configuration. Computer use
confirmed the running simulator already displayed the enabled form. The app
nevertheless lacked an obvious retry action and resume-time configuration
refresh, which could leave an open screen showing outdated availability.

Added a Check availability button, foreground-resume refresh, duplicate refresh
protection and preservation of draft fields during refresh. Receipt/order
creation remains server-validated. All 20 focused Flutter Exchange tests pass,
including the two new recovery regressions; selected Flutter analysis is clean.
The live admin queue rendered its empty state correctly. No financial status
was manually changed and no KYC gate was bypassed.
