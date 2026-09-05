# Simple mobile release: implementation and remaining acceptance

The manual NGN→GHS Exchange flow is implemented in the working tree on `paul/manual-exchange-launch`. The first release supports receipt-based collection followed by **one** settlement path: automatic TrustPay GHS wallet credit after admin approval, or an operator's external bank/MoMo payout. No live feature flag, production deployment, store publication or real payment was performed.

## Implemented locally

| Area | Delivered behavior | Remaining acceptance |
| --- | --- | --- |
| Manual Exchange | Durable order, frozen instructions/rate, protected receipt upload, Awaiting confirmation, private proof views and customer status/history | Actual staging storage upload and complete customer/admin journeys |
| Admin settlement | Verified incoming amount/reference; wallet credit or assigned external payout; sent and completed remain separate; expired terms require explicit acceptance | Real statement matching, operator training and supported payout destinations |
| Financial integrity | Decimal amounts, atomic ledger/status/audit updates, shared deposit allocation across manual/legacy exchange and wallet funding, concurrent approval safety, hourly internal reconciliation | Bank/MoMo statement reconciliation and three clean operating cycles |
| Rate safety | Old database/cache rates retain their original timestamps/expiry; stale rates cannot create executable quotes/deposit instructions | Provider outage rehearsal with actual staging configuration |
| Recovery | Account-scoped encrypted exchange and secondary payment journals; authenticated read-only attempt resolver; uncertainty never means a new payment automatically | Kill/relaunch after a real staging response loss, plus external pending/reversed cases |
| Security | Native biometric setup, app lock/privacy, inactivity handling, normal TLS plus certificate DER pins for API and refresh traffic, local device-risk signals | Physical Android/iPhone tests, actual current/backup pins and rotation rehearsal; local signals are not server attestation |
| Presentation/support | Exact money parsing/formatting, honest unavailable states, transaction-derived activity and saved closure-request status | Accessibility/device review and support/closure operator acceptance |
| Startup/release | Safe startup retry, configured Sentry environment, protected signed Android/iOS workflow and public configuration validator | Protected signing inputs, signed install/start and symbolicated test alert |

## Verification record

This record describes the uncommitted working tree; it is not a signed release-candidate certificate. The results below were obtained on this working tree. The final Flutter integration run passed after the recovery queue cleanup and cross-instance serialization checks. Physical-device acceptance is separate.

- **Flutter: 205 tests passed; full analyzer reported no issues.** Recovery tests cover original-reference resolution after a simulated committed transfer loses its response, with exactly one financial submission.
- Backend build and full lint passed; **70 unit suites / 472 tests passed**.
- **5 isolated PostgreSQL/Redis financial suites / 24 tests passed**. They exercise duplicate approvals, cross-flow reference races, ledger rollback, external payout exclusivity, expired quotes, proof ownership/contents, upload replay and resolver ownership. No live database was used.
- Admin-web build, TypeScript and lint passed.
- Release configuration validator tests passed, including missing/unsafe inputs and secret-field rejection.
- **4 admin browser tests passed** with installed Chromium/Chrome and synthetic data. The harness covers protected proof, stable retry keys, the payout lifecycle and expiry acknowledgement using synthetic data.
- Native iOS simulator Debug build succeeded after installing the updated CocoaPods graph. This proves compilation, not real-device biometric/security behavior or distribution signing.
- Android Debug build could not complete: Maven artifact downloads failed with TLS `bad_record_mac` / `decrypt_error`, including a fresh Gradle process and bounded retry. TLS verification was not disabled. Retry in the configured CI/network environment; Android compilation is not yet verified.
- Production dependency audits for BACKEND and WEBSITE returned zero known vulnerabilities. This does not cover all mobile native dependencies or replace a security assessment.
- Disposable PostgreSQL test database and isolated Redis process were removed/stopped after verification. Temporary iOS derived build artifacts were removed to recover disk space; the build log was retained.
- Physical-device inspection found only macOS and Chrome. No Android/iPhone was available. Local Apple signing identities: zero; Android `key.properties`: absent.

## Scoped readiness assessment

**79/100 — engineering assessment for the simple first release, not permission to launch.** The earlier 64/100 remains the historical baseline. This score reflects implemented controls and local evidence; it is not a probability of safety and cannot certify the excluded international product.

| Original category | Current score | Main remaining evidence |
| --- | --- | --- |
| Authentication/security | 20/25 | Physical biometric/privacy tests and deployed controls |
| Money movement | 21/25 | Staging receipt/settlement, provider and operating reconciliation |
| Reliability/data | 17/20 | Actual process restart/network loss and operational alert delivery |
| Native release | 8/15 | Android build, signing, two-phone acceptance and rotation |
| Product/operations | 13/15 | Named operators, restore rehearsal and controlled pilot |
| **Total** | **79/100** | All launch gates must still pass |

The next improvement comes from closing the evidence gaps above, rather than adding more features. General production access remains a no-go while the checklist has unresolved launch gates.

## Next steps in order

1. **Prepare staging.** Supply the dedicated collection account and version, actual statement access, a fresh rate source, private receipt bucket, a named admin/payout operator and synthetic Tier 2 customers with GHS wallets. Apply migrations 036–038 through the normal deployment process. Follow [manual Exchange operations](manual-exchange-operations.md).
2. **Build signed candidates.** Configure protected `mobile-staging` variables/secrets described in [APP/README](../../APP/README.md). Supply current and backup API leaf-certificate DER fingerprints, Android upload signing and Apple signing/provisioning. Run the workflow against a reviewed commit.
3. **Test the exact candidates on two phones.** Run every enabled journey in [the launch checklist](../MOBILE-LAUNCH-CHECKLIST.md), especially receipt upload/restart, approval replay, external payout uncertainty, wrong PIN, biometric cancel, app-switcher privacy and unavailable network. A simulator or mock test does not satisfy this gate.
4. **Prove operations.** Receive and symbolicate a sanitized Sentry test error, deliver reconciliation alerts to the named support owner, restore a backup into an isolated environment, rehearse the feature kill switch and record three clean statement reconciliations.
5. **Approve a small pilot.** Finish the existing provider/KYC/transfer certification records, privacy/store declarations and accountable release approvals. Then authorize limited live test payments and reconcile them before widening access.

Do not treat an internal wallet credit as a transfer to an external virtual bank account. WALLET updates the in-app GHS ledger. BANK/MOMO requires the assigned operator to send externally and record actual settlement evidence.


## Latest iOS and staging verification

The latest iOS Simulator build is installed and cold-start verified, including
lock-screen accessibility privacy. Full Flutter regression: 213 passing tests;
12 focused final lock tests; analyzer clean. Backend commit `5cf36bd` is published
on `paul/manual-exchange-launch` and deployed to the existing sandbox-backed
Render service. Migrations 036–038 completed. Both API domains report readiness
200 and new protected Exchange routes report 401 without credentials. Render's
admin URL typo and missing readiness health-check setting were corrected.
Specific-commit deployment leaves Render auto-deploy disabled; main was not merged.

The production-readiness assessment remains **79/100**, not a claim that all
financial features passed end to end. Authenticated Exchange, receipt upload,
operator confirmation, wallet credit and external payout are still awaiting
collection details, eligible staging fixtures and admin UI/access. Android is
excluded; physical-iPhone and distribution-build evidence is still outstanding.
See [the detailed QA register](2026-09-05-ios-simulator-qa.md) for results and
remaining acceptance criteria.
