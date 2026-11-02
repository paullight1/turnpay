# Exchange functional QA — 1 November 2026

Scope: current manual exchange, legacy quote/receipt compatibility, provider exchange, Ghana collections, customer Flutter screens/services, and customer/admin website exchange routes. This is functional and financial regression testing, not live provider certification.

## Results

| Layer | Result | Boundary |
| --- | --- | --- |
| Exchange/Kora and settlement-control unit/controller tests | 88 passed in 15 suites | Faked external services; includes guards, validation, frozen quotes, feature gates, recovery and signature handling |
| Financial integration | 37 passed in 4 suites | Real local PostgreSQL, synthetic users/balances, faked provider/storage/cache boundaries |
| Legacy exchange HTTP contracts | 29 passed in 3 suites | NestJS routing/validation/idempotency with mocked authentication and persistence/provider boundaries |
| Flutter exchange and updated home screens | 43 passed; final home-only cleanup rerun 8 passed; analyzer clean | Exact converter arithmetic, manual/provider services and screens, recovery and supported home currencies |
| Customer/admin website | 26 scenarios exercised: 25 passed initially; corrected mobile navigation and final accessible-dialog checks passed in both desktop/mobile reruns | Desktop Chrome and mobile Chrome with simulated authenticated API responses |

Financial cases cover concurrent same-key creation, competing admin approval, exactly-once NGN wallet credit, unique incoming-deposit allocation, transaction rollback, insufficient funds, expired/cross-user quotes, payout ownership, eligibility/PIN-reset/settlement holds, protected receipt evidence and exact payout amount. Provider cases cover direct external MoMo funding without double-crediting the wallet, correct payout corridor, unknown timeout remaining pending, verified failure compensating once, and stale/wrong-recipient events not overwriting success.

Admin browser coverage includes corrected versus uncertain idempotent retries, old requests beyond the first page, whole-queue counts, eight-page polling limits, protected proof access, expired quote acknowledgement, cedi transfer evidence, and duplicate-send prevention. The customer website redirects to the app without creating an exchange.

## Requested home simplification

Removed the unsupported USD/EUR/GBP/ZAR “Other wallets” section and its Manage sheet, preferences and unused card/formatting code. NGN/GHS wallet cards and their existing currency selector remain. Removed tests for deleted UI and preserved the existing balance privacy, account setup, service navigation and transaction-history checks. This changes presentation only; no stored wallet balances or accounts are deleted.

## Browser findings and fixes

The initial mobile admin overview case assumed the desktop sidebar was visible and timed out. It now opens the mobile menu before selecting Transactions and Overview. Both desktop/mobile navigation reruns passed. Opening the real drawer also exposed missing accessible dialog title/description. A named-dialog assertion failed before the product fix and passed afterward. The shared menu now provides a visually hidden title and description, preserving the existing visual layout and access rules. Final targeted browser run: two passed; web type and scoped lint checks passed.

The updated signed-in app was rendered at 390×844 and inspected: Recent transactions follows the KYC banner directly, with no Other wallets section or unsupported currency cards. The live exchange screen explicitly showed “Exchange is currently unavailable,” consistent with the disabled local configuration. No payment was submitted. The local preview and API were restarted and returned HTTP 200; the browser was returned to Home and its temporary viewport override reset. Captures are in `output/exchange-qa-2026-11-01/`.

## Local configuration and live acceptance

The checked local development configuration has no `MANUAL_EXCHANGE_ENABLED` value and no dedicated NGN or GHS manual collection details. Manual exchange therefore remains disabled. Kora Ghana and exchange approval flags are also unset. No flags, receiving details or provider credentials were changed by this test pass.

For manual acceptance, configure the dedicated admin receiving accounts, enable the manual path in the intended non-production environment, and check actual statement-backed receipt confirmation. For automatic collections/payouts, complete Kora/Paystack merchant corridor acceptance, signed sandbox callbacks and independent provider verification before enabling the corresponding products. Passing synthetic tests does not establish that these external services are activated.

## Other observed work

The initial broad backend run observed one in-progress unrelated KYC failure: `KycService › projects delayed BVN recovery per document without exposing private recovery facts` (`src/kyc/kyc.service.spec.ts`, line 1176 in that snapshot). That run had 652 passes and one failure across 91 suites. KYC files were being edited concurrently; they were not changed to make the exchange checks pass. The focused exchange/Kora suite passed independently. The whole backend is not represented as green by this report.

No live money, genuine identity submissions, merchant activation, deployment, commit or push was performed. Detailed commands/output and the starting dirty-worktree manifest are retained in `.superpowers/sdd/2026-11-01-exchange-functional-qa/`.
