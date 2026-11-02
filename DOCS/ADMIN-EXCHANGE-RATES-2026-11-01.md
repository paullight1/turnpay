# Admin exchange rates — 1 November 2026

TrustPay uses admin-set prices by default (`FX_RATE_SOURCE=admin`). No external FX API is required. Each direction has its own price; setting one does not calculate or enable the other.

## Set the prices

1. Sign in with an authorized admin account and choose **Exchange rates** from the admin menu. The **Exchange rate** card is also available on Overview.
2. In **Cedis to naira**, **Customer sends** shows **1 GHS**. Edit **Customer gets (NGN)** to set the naira paid for that cedi. Click that form's **Save rate** and wait for **Saved**.
3. In **Naira to cedis**, **Customer sends** shows **1 NGN**. Edit **Customer gets (GHS)** to set the cedis paid for that naira. Click that form's **Save rate** and wait for **Saved**.

Both editors use the customer converter layout, with large amounts, fixed currency badges and separate save controls. The sending unit is fixed at one to define the price; the receive amount is editable. Check the compact `1 SOURCE = price TARGET` line before saving. The naira-to-cedis field measures cedis per naira, not naira per cedi. Neither form copies or replaces the other direction's price.

The cedi-to-naira editor also shows how many cedis cover at least **1 NGN** at that direction's price. This is a read-only comparison, rounded up to a two-decimal send amount so it agrees with the server's round-down receive rule. It does not use the naira-to-cedis price. Stored rates have four decimal places, so repeating-decimal prices are approximate; review the resulting customer amount before accepting a payment.

The entered rate is the customer rate; this card saves zero additional markup. Review each direction carefully before saving. These instructions do not prescribe a commercial price.

## What customers and operators see

Saved admin prices remain active until replaced or explicitly expired. The server reads the saved price for new quotes, so a process-local cache cannot hide another admin's update. Existing orders retain their frozen conversion rate and payout amount after a price change.

An unset, expired or invalid admin price shows **This exchange rate is not set yet** on the customer converter. Admins see **Not set** and can enter the first price. The server rejects financial creation without an active price; API values and old fallback estimates cannot substitute for one in admin mode. Other database/provider failures retain their normal error handling.

The existing settlement process remains: GHS→NGN credits the customer's TrustPay naira wallet after an admin checks receipt; NGN→GHS requires the admin's external cedi transfer and completion evidence. Saving a rate does not confirm a deposit or transfer money. Follow `DOCS/MANUAL-EXCHANGE-ADMIN-TRIGGERS.md` for settlement.

## Security and configuration

The existing rate mutation retains JWT/admin guards, validated DTOs, throttling and idempotency. Rate changes and their financial audit records remain transactional. Financial amounts continue through Decimal quote/ledger calculations. No receiving-account details or credentials are included in this guide.

`FX_RATE_SOURCE=api` explicitly selects the existing external-feed behavior with its original freshness and circuit-breaker rules. In admin mode, startup and scheduled jobs do not overwrite prices with provider/fallback rates. The local backend uses admin mode. Prices were left unset during the initial implementation and are saved through the audited admin editor after the owner confirms their units.

## Verification

- New rate-source, empty-state and admin browser regressions were observed failing before the implementation and passing afterward.
- Full backend suite: **92 suites / 683 tests passed**; production backend build and scoped ESLint passed.
- Full Flutter suite: **419 tests passed**; analyzer reported no issues. A final consumer rerun after the legacy screen guard also passed.
- Real PostgreSQL financial tests: **26 tests passed** on the disposable test database. The new lifecycle case saves a synthetic admin price, ages it seven days, creates an order, changes the price, and verifies that approval/replay credits only the original frozen amount with override audits.
- Admin first-price setup passed on desktop and mobile browsers using mocked responses and synthetic prices. Final web TypeScript and scoped ESLint checks passed.
- At initial implementation, before the owner entered prices, a read-only lookup found neither local direction had an active admin price. The rebuilt API and restarted Flutter preview displayed the missing-rate message without a fallback number. Screenshot: `output/admin-exchange-rates-2026-11-01/customer-rate-not-set.png`.
- The initial implementation performed no live payment, actual rate save, genuine identity submission, production deployment or Git push. The previously documented whole-backend test-mock TypeScript errors are outside the production build and this change.

Evidence logs are under `.superpowers/sdd/2026-11-01-admin-exchange-rates/` locally.

The subsequent direction-clarity browser regression passed separately on desktop and Mobile Chrome with clean runner exits. It verifies that saving one price leaves the opposite input empty and unset, then saves a different price for the other pair. Web TypeScript, scoped ESLint and actual admin desktop/phone inspection passed. Screenshot: `output/admin-rate-direction-clarity-2026-11-01/separate-prices.png`. No live price was submitted by the agent during that UI phase.

After the owner confirmed both directions, the reverse price was saved through their signed-in admin session using the existing protected, idempotent mutation and audit trail. Four-decimal rate storage and round-down receive rules remain in effect. Read-only checks of the actual backend quote calculation and customer previews confirmed both directions; no order or payment was created.

The comparison regression checks an input price that requires rounding the source amount up, plus a high-price case where the smallest source unit already exceeds the target. It failed against the previous UI and passed on both desktop and Mobile Chrome. Web TypeScript and scoped ESLint passed. Final evidence is under `.superpowers/sdd/2026-11-01-confirmed-exchange-prices/` locally.
