# Ghana exchange receiving details

The NGN-to-GHS receiving step first asks the user to choose mobile money or a bank account. It reveals only that destination's form. The converter no longer repeats the PIN helper; transaction-PIN authorization and server-side money controls are unchanged.

## Bank destinations

- Account number precedes the searchable bank picker.
- The picker contains the 23 names in the Bank of Ghana registered-bank directory, with local bank logo assets and readable text labels. Logo failure uses a fallback mark and does not block selection.
- No complete maintained Ghana-specific Flutter/npm logo library was found. `ghicons` contains cultural icons rather than bank logos; the African bank-data package has no Ghana logo assets. The app imports static assets directly instead of adding unrelated runtime code. Sources and per-asset terms are in `APP/assets/images/ghana_banks/SOURCES.md`.
- Bank names are display/selection values, never fabricated provider routing codes. The connected Ghana integration has no bank-number detection or bank-name resolution route. The UI therefore keeps bank choice explicit and explains manual recipient-name entry. Existing administrator-confirmed bank settlement remains available.

## Mobile money destinations

- When the configured Ghana provider exposes operator/name lookup, a valid number plus network automatically triggers a debounced lookup and fills the confirmed name. A manual retry remains available.
- Changing the number, network or method invalidates old names and in-flight results. Disabling or disposing the form invalidates the request as well. The service binds the returned number/operator to the requested destination.
- Unavailable or failed lookup permits clearly labelled manual-review details, preserving the existing manual settlement flow. No missing provider capability is represented as a successful lookup.
- API mutation requests retain the shared client's idempotency header. No lookup changes KYC, balances, exchange rates, settlement status or payout authorization.

## Verification

The complete Flutter suite passed 480 tests after the functional flow and race fixes. The final 44 scoped exchange/converter tests and scoped analysis passed after asset/layout integration, with synthetic captures of the receiving-method choice, bank form and logo picker. All 782 backend tests passed for the associated receiving-account request work. No real exchange, phone lookup, payment, payout or identity decision was submitted during validation.
