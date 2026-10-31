# Manual Exchange mobile launch checklist

**Scope:** Manual Exchange first: collection account → customer receipt → admin confirms actual deposit → automatic TrustPay wallet credit OR customer bank/MoMo payout, according to the selected mode. This supersedes the earlier Exchange exclusion. Initial corridor assumption: NGN→GHS. Unattended approval, automatic external settlement, additional corridors and native push are deferred. **Current status: local implementation delivered and automated checks pass (205 Flutter, 472 backend unit, 24 financial integration, 4 admin browser tests). Scoped readiness: 79/100. Staging, signed-device and operational launch gates remain open.**

Plan: [Implementation sequence](superpowers/plans/2026-09-05-simple-mobile-production-readiness.md). Baseline: [Readiness review](FLUTTER-PRODUCTION-READINESS-2026-09-05.md). Current evidence: [Implementation delivery record](implementation/2026-09-05-mobile-delivery-status.md).

## How to mark an item complete

Use NOT STARTED → IN PROGRESS → VERIFIED, or EXTERNAL BLOCKER/FAILED. VERIFIED requires evidence from the actual release candidate. Every evidence record must include commit, artifact/build number, environment, date, operator, result and a safe evidence link. A changed dependency invalidates affected evidence. Excluded features are not counted as verified work.

| Gate | Pass condition | Owner | Status |
| --- | --- | --- | --- |
| G01 Manual Exchange | Persistent order, collection instructions, protected proof, awaiting confirmation, admin verification and exclusive wallet-credit or bank/MoMo settlement; no duplicate effect | Engineering | IN PROGRESS: backend, Flutter and admin automated coverage; staging journey pending |
| G02 Native auth/privacy | Android/iOS biometric fallback, PIN, inactivity, cold start and private app-switcher behavior demonstrated | Engineering + device tester | IN PROGRESS: native code and lock tests; iOS simulator compiles; physical tests pending |
| G03 Financial presentation | Exact money; unavailable data never masquerades as empty or zero | Engineering | IN PROGRESS: exact money and error-state tests pass; physical acceptance pending |
| G04 Payment recovery | Lost response plus restart resolves original order/attempt with one deposit allocation and one wallet credit or external payout obligation | Engineering | IN PROGRESS: durable journal and resolver; staging restart evidence pending |
| G05 Backend money safety | Idempotency, concurrency, provider events, limits and ledger/reconciliation evidence pass | Engineering + Finance/Ops | IN PROGRESS: 24 isolated financial tests pass; operating reconciliation pending |
| G06 Platform security | Pinning, rotation and integrity policy enforced and device-tested | Engineering + infrastructure owner | EXTERNAL BLOCKER: transport and local risk controls implemented; actual pins/rotation/device evidence required |
| G07 Release pipeline | Exact signed Android/iOS artifacts install and start with correct environment and symbols | Engineering + store account owner | EXTERNAL BLOCKER: workflow validated; signing unavailable; Android dependency download TLS failure |
| G08 Device journeys | Every enabled financial/auth/KYC flow passes on physical Android and iPhone | Engineering + tester | EXTERNAL BLOCKER: physical Android and iPhone unavailable |
| G09 Observability/support | Test alert received; support/closure lifecycle works; no sensitive telemetry | Engineering + support owner | IN PROGRESS: startup/activity/closure implemented; delivered alert and operator evidence pending |
| G10 Operations | Restore/kill-switch rehearsal and three clean reconciliation cycles | Infrastructure + Finance/Ops | EXTERNAL BLOCKER: restore, kill-switch and three statement reconciliation cycles pending |
| G11 Live/provider gates | Existing transfer certification and Monnify KYC validation records complete; Monnify/VTpass live access and settlement evidence | Accountable owners | EXTERNAL BLOCKER: live approvals unverified |
| G12 Store/pilot | Accurate declarations, release approval, authorized live smoke and controlled rollout evidence | Release owner | NOT STARTED |

## What the owner needs to do

These are access/status requests, not requests to paste secrets. Reuse existing accounts and services. One person may own several duties where existing separation-of-duties rules permit it.

| When needed | Your action | Proof it is ready |
| --- | --- | --- |
| Now | Confirm the receiving bank/account, who verifies incoming transfers, and which bank/MoMo destinations you can pay | Server-managed collection details, actual statement access and named payout operator |
| Now | Identify the staging backend/domain and give the engineering task access to its deployment configuration | Known staging target with database/Redis isolated from production |
| Now | Confirm Monnify and VTpass account status: sandbox available / live approved / approval outstanding | Provider dashboard access or approval record; secrets installed backend-side |
| Before Task 6 | Identify who controls API TLS/certificates and rotation; make current/backup public pins available through the release configuration | Validated host/pin inventory and tested rotation procedure |
| Before Task 7 | Make Android upload signing and Apple developer/signing access available through protected CI or the approved local keychain | Successful signed artifact on each platform |
| Before Task 7 | Give access to the app's Sentry project and public build configuration | A sanitized test exception arrives and symbolicates |
| Before Task 8 | Provide one real Android and one real iPhone/tester, plus synthetic staging accounts | Recorded device/OS and completed acceptance journeys |
| Before Task 9 | Name the person who answers payment/support incidents and the person who reconciles balances | Test alert acknowledged; sample case resolved; reconciliation signed off |
| Before live pilot | Record approved KYC/limits/retention and required release/privacy/security decisions using the existing registers | Named approvals linked to the release candidate |
| Before store release | Review actual privacy, data-safety, account-deletion and service declarations; authorize publication | Store readiness record and release decision |

## Minimum device acceptance evidence

Run each on the actual staging release, not merely a widget harness.

- [ ] Registration, email verification, login, password recovery and session revocation.
- [ ] First PIN binding, wrong PIN/lockout/reset, biometric success/cancel/fallback and inactivity.
- [ ] KYC approval, review/rejection and provider outage with accurate eligibility.
- [ ] Manual Exchange: create instructions, transfer, upload receipt, restart and see Awaiting confirmation.
- [ ] WALLET: admin verifies incoming funds and approves; exactly one destination-currency credit and Credited status appear together, including after retry/restart.
- [ ] BANK/MOMO: admin verifies actual incoming funds; customer sees Deposit confirmed / Payout pending.
- [ ] A settled or payout-claimed order cannot switch modes or trigger the other settlement route.
- [ ] Admin pays the recorded bank/MoMo destination; stored external reference/proof supports sent/completed status.
- [ ] Duplicate receipt/deposit review/payout claim has no duplicate financial effect or accidental wallet credit.
- [ ] More information, rejection, expired instructions and received-funds refund cases remain traceable.
- [ ] NGN funding account provision and confirmed deposit reflected once, if enabled.
- [ ] NGN internal transfer, receipt and restart after lost response.
- [ ] Bank withdrawal, OTP expiry/resend, pending/failure/reversal and receipt.
- [ ] Each enabled VTU service: success, pending/timeout and failed/reversed result.
- [ ] Missing network, 503, malformed financial response and startup while offline.
- [ ] Support case and account-closure request visible after restart.
- [ ] App-switcher privacy, large text, screen reader and keyboard usability.

## Authoritative existing release records

The existing [receipt flow guide](PRODUCTION-GUIDES/14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD) describes the existing wallet-credit branch. Reuse its transactional controls for WALLET mode and extend the order for exclusive BANK/MOMO settlement. Its existence does not certify either release path.

- [Internal-transfer certification and required approvals](PRODUCTION-GUIDES/20-INTERNAL-TRANSFER-CERTIFICATION.md).
- [Transfer incident/rollback operations](PRODUCTION-GUIDES/19-INTERNAL-TRANSFER-OPERATIONS.md).
- [Monnify KYC launch checks](KYC-GUIDE.MD).
- [Mobile deployment](PRODUCTION-GUIDES/11-MOBILE-WEB-DEPLOYMENT.MD).
- [Reconciliation](PRODUCTION-GUIDES/10-RECONCILIATION.MD).

Current active provider scope is Monnify for banking/payments/KYC and VTpass for VTU. Older provider guides are historical only.

**Go/no-go:** All required gates VERIFIED, no unresolved critical/high issue, and all required release approvals recorded. Otherwise keep the affected feature disabled and continue the next independent task. The plan being complete does not mean the app is production-ready.
