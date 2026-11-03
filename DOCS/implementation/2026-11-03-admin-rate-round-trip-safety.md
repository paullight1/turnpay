# Administrator FX pair safety

The owner requested protection against immediately profitable NGN/GHS round trips while retaining dashboard control over both prices. No commercial price is chosen or automatically replaced.

## Invariant and persistence

Administrator inputs retain their explicit quote basis and four-decimal persistence precision. Reciprocal canonical prices retain six-decimal round-down precision. The pair check applies markups using Decimal arithmetic and rejects an effective forward × reverse product above one, without relying on fees to hide an unsafe spread. A 40-digit Decimal context preserves tiny excesses near the boundary. Equal/below-one pairs remain valid.

Both direct admin changes and the existing approval transaction acquire the same parameterized PostgreSQL transaction advisory lock for a sorted currency pair before reading its reverse row. Validation, mutation and audit share one transaction. Rejected changes do not save a price, audit a success or update caches. Missing/invalid/expired reverse rows cannot issue new quotes; creating/replacing them goes through the same check. No schema migration is required.

## Quote and UI behavior

Executable admin-rate reads validate the saved pair again, protecting against pre-existing or externally written conflicting values. Display reads retain the raw input/basis and safety metadata, but the customer API returns configured:false with no effective rate for a conflict. Admin forms keep the conflicting saved values editable and compare drafts against the opposite price; the server remains authoritative. Customers see a temporary pricing-correction message and cannot continue with a false estimate.

The older wallet quote path now rounds newly calculated received amounts down to cents. Unexecuted cached wallet quotes and unaccepted provider quotes recheck current pair availability before their first debit/reservation. The final check runs inside that money transaction under a shared advisory lock and FOR SHARE locks on both rate rows, and rejects any frozen effective price more generous than the current own-direction price. This also prevents combining two generous historical quotes. A stale Serializable snapshot is rejected with a safe conflict response, without a financial mutation; API refreshes remain outside money transactions. Durable completed/idempotent replays return before that check. Accepted manual/provider orders and historical settled amounts are not repriced. This protects simultaneous configured prices and rounding; it does not prohibit legitimate currency gains after later administrator price movements.

## Verification

Regressions failed before implementation for crossed prices, missing transaction serialization, small-amount upward rounding, admin repair values, customer messaging, and unaccepted old quote execution. The isolated release then passed 104 backend suites / 814 tests, 4 real PostgreSQL financial suites / 54 tests, 3 Chromium admin scenarios, 8 Flutter converter tests, scoped TypeScript/ESLint/Flutter analysis and the backend build. The real PostgreSQL checks cover concurrent first inserts, concurrent opposite edits, existing-transaction approval rejection, safe repair and no partial mutation. Test fixtures use only a newly created database with the enforced trustpay_financial_test prefix.

No production prices, customer balances, real provider requests or identity decisions were changed during testing. Independent review and hosted deployment verification follow below.


Independent review identified frozen-quote and check-to-debit races. New regressions cover these cases, including simultaneous money/admin update locking and stale Serializable snapshots against real PostgreSQL. The production rate source was inspected read-only and is the default administrator mode. No configuration change was required.


Final independent review found no remaining blocker after adding both cached received-amount ceilings. Unaccepted wallet/provider quotes must also fit their frozen rate rounded down to cents; durable accepted replays still retain their original outcomes. All owned final source passes build, lint, unit/financial and UI checks.
