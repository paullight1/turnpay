# Exchange flow and code review — 31 October 2026

Scope: the customer exchange entry and manual form, the manual exchange API and settlement policy, the operator queue and review actions, and the boundary that chooses manual versus provider-backed exchange. This is a focused exchange review, not a claim that every authentication, KYC or VTU module received a new security audit.

## Critique and implemented changes

| Problem | Effect | Improvement |
| --- | --- | --- |
| All receiving methods were offered in both directions, while the agreed product is cedis → NGN wallet and naira → external cedi payment | Customers could select a different outcome from the admin workflow being described | Server configuration publishes receiving options. New creation validates the same policy; Flutter shows those options, puts Cedis to naira first, and explains the real destination. |
| Claim payout only assigned an operator; reconciliation was checked after the operator might already have paid externally | A blocked or newly ineligible request could enter the paying stage | Claim now rechecks customer verification/suspension, transaction PIN reset hold, and source/target settlement holds in the same transaction before assigning ownership. |
| The manual queue stopped at 100 records, and dashboard numbers counted only returned rows | Older paid obligations disappeared and totals understated work | New ADMIN-only cursor endpoint returns bounded 50-order pages and whole-queue counts from one database snapshot. The UI loads older requests and scopes cached data to the active admin. The old array endpoint remains for existing callers. |
| The Ghana receiving master flag selected the automated exchange screen | Enabling receiving accounts could hide the usable manual flow before exchange approval | Entry uses the exchange-specific enabled flag. Existing provider orders and unknown attempts still keep their recovery screen reachable. |
| A deterministic rejected admin request retained its failed idempotency key even after the form was corrected | The corrected request could keep receiving the cached failure or a body-conflict response | Definitive validation/auth/not-found rejections start a fresh attempt; ambiguous conflicts, rate limits, network errors and server failures retain the original key. Existing database idempotency and status checks remain authoritative. |

The independent review found two additional queue regressions, reproduced with failing tests and corrected: pagination now resolves the immutable creation-time/ID boundary independently of status, so a cursor leaving its filter cannot skip the next request. Live refresh slows with the number of loaded pages (at most six automatic queue requests per minute); window-focus refresh is disabled, and a failed background refresh leaves the loaded queue visible with a warning.

## What remains deliberately intact

- Historical orders retain the exact currency pair, delivery method, rate, amount and recipient that were recorded. Existing create retries are checked before applying the new delivery policy. Saved mobile attempts keep their captured fields and remain locked during recovery.
- Money remains Decimal, with stored quotes, unique deposit allocation, guarded admin actions and transactional/versioned settlement. No balance movement is authorized by a screenshot or a browser return URL alone.
- Customer PINs still authorize order creation. New policy checks do not replace JWTs, roles, KYC requirements, PIN verification, protected evidence or audit records.
- An NGN wallet credit and an externally completed cedi payout remain distinct outcomes. Recording a cedi payout does not also credit a cedi wallet.
- Kora activation and live provider acceptance are unchanged. The manual path still requires properly configured dedicated receiving accounts and actual admin statement checks.

## Architecture assessment

The ledger, receipt allocation and immutable order terms provide useful financial boundaries and should not be rewritten merely to reduce file count. The main weakness was inconsistency at the seams: customer choices, server policy, route activation, operator authorization timing and list pagination did not describe the same product. The changes make the server the source of truth and preserve the established financial aggregates.

Historical/manual/provider-backed aggregates remain separate. Merging live records or replacing the existing API would create unnecessary settlement and migration risk. Remaining work should focus on operational reconciliation, accepted provider fixtures and gradual removal of obsolete callers after migration, with explicit financial regression coverage.

Manual external payment is still a human trust boundary. A claim is an ownership assignment, not a standing authorization to ignore later holds; the admin must respect a newly raised hold before paying outside TrustPay. Checking the provider/bank statement remains required until an approved automated collection/payout connection is enabled.

## Verification

Regression checks cover unsupported new delivery choices without side effects; concurrent GHS order creation and exactly-once NGN credit; migrated order replay; held/suspended/PIN-reset payout claims; an older funded order behind 101 closed requests and a cursor changing status between pages; cursor authorization/validation; whole-queue totals and eight-page refresh budgeting; corrected and uncertain admin retries; provider activation routing; saved mobile attempts; and phone forms at larger text sizes.

Final results: 88 backend suites / 619 tests passed; 20 real PostgreSQL manual financial tests passed; 11 admin browser tests passed. Flutter's full run passed 377 tests, followed by an eight-case manual-screen run including the 150% text phone case. Flutter analysis, backend/web TypeScript, scoped ESLint and whitespace checks passed.

Only disposable local financial data and simulated browser responses are used. No deployment, live wallet movement, provider activation or new production migration is performed. Existing migration 046 from the preceding manual-trigger work is still required when releasing this build.

See [manual operator instructions](MANUAL-EXCHANGE-ADMIN-TRIGGERS.md).
