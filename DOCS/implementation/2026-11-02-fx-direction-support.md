# FX direction and WhatsApp support correction

## Cause and pricing contract

A read-only check of the configured hosted database found active admin rates of NGN→GHS `87.0000` and GHS→NGN `0.0111`, both with zero markup. Both the preview and server quote correctly treat the stored rate as **target units per 1 source unit**, so the reversed units produced the reported NGN 10,000 → GHS 870,000 estimate.

Research confirms the currency direction: [XE](https://www.xe.com/en-gb/currencyconverter/convert/?Amount=1&From=GHS&To=NGN) showed approximately 115 NGN per GHS on 2 November 2026. This reference was not adopted as TrustPay business pricing. The owner has been asked to confirm the approved naira-per-cedi price for each direction; no live rate mutation has been performed.

## Changes

- Active admin rate reads reject reversed NGN/GHS units. New admin writes reject NGN→GHS rates ≥1 and GHS→NGN rates ≤1 before persistence, using the current Ghana-pair direction policy.
- The admin editor makes the rate unit visible, disables reversed input and explains how a naira-per-cedi divisor differs from the canonical multiplier.
- Flutter suppresses an inverted server estimate, explains that the rate needs correction and blocks form continuation without a valid rate. No client-only inversion or hardcoded market price is used.
- Historical orders/quotes and wallet amounts are unchanged. Existing four-decimal persisted rate precision and six-decimal manual-quote rounding are retained. Approved reciprocal pricing must respect that precision; a precision migration is outside this correction.
- Default page menus now include Contact support. This opens the published `https://wa.me/233555507240` chat with a generic greeting, without customer/account/transaction details or automatic sending. Launch failure displays the support phone number. The number matches the existing public website support page and footer.

## Verification

The new six backend direction regressions and two Flutter invalid-estimate regressions failed before the fix, then passed. Final focused verification: 69 backend tests; 54 Flutter tests plus 25 follow-up converter/form checks after adding the continuation gate; two isolated admin browser tests at desktop/mobile sizes; backend build; scoped backend/web lint; web TypeScript; scoped Flutter analysis; diff whitespace checks. The first browser attempt encountered a missing bundled Chromium executable; rerunning with the installed official Chrome executable passed both cases. No live exchange, payment, rate update, WhatsApp message or identity action was submitted.

The saved hosted rates still need the owner's approved values via the existing authenticated, idempotent and audited admin rate endpoint. These checks reject reversed units; they do not independently establish market fairness or the approved spread between directions.

## Deployment-check repair

CI exposed an obsolete blanket `NINJA_` manifest ban despite the owner's approved NIN adapter, and two simulated replay fixtures still constructing legacy raw-JSON request hashes. The manifest check now permits the approved Ninja endpoint only with an explicit enable boolean and exactly one server-only `sync: false` secret slot; inline secret values and the old API-key setting are rejected. Existing Paystack BVN, OTP, banking, VTU, proxy, migration and other provider restrictions are retained. Portability and three unsafe endpoint/secret fixtures passed. Both replay fixtures now use the current canonical `business:v2` fingerprint; production replay logic was not changed. Their two suites failed before fixture repair and passed all 16 tests afterward.
