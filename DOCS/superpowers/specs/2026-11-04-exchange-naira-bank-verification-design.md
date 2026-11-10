# Exchange Naira Bank Verification Design

## Intent

Make the Cedis-to-naira payout destination use the same trustworthy recipient flow as Send Money: the customer selects a supported Nigerian bank, enters a ten-digit account number, and sees the provider-confirmed account name before continuing.

## Goals

- Replace free-text Nigerian bank and recipient-name inputs with a searchable bank selector and automatic account-name lookup.
- Resolve only after both a bank and a valid ten-digit account number exist.
- Show loading, verified, failure, and retry states without exposing provider payloads.
- Clear verification immediately when the selected bank or account number changes.
- Keep `View transfer account` disabled until the current bank/account pair is verified.
- Preserve immutable saved-attempt recovery without re-resolving or changing its recorded destination.

## Non-goals

- No backend endpoint or database change; reuse the authenticated Paystack bank-list and account-resolution endpoints already used by Send Money.
- No manual recipient-name fallback for new Nigerian payout destinations.
- No change to Ghana bank or MoMo destination flows.

## Constraints

- The verified name is server-derived and read-only.
- The account resolver must reject empty, mismatched-account, or mismatched-bank responses.
- Late responses for an edited bank/account pair must never restore stale verification.
- Existing security, DTO validation, JWT guards, throttling, idempotency, and audit behavior remain authoritative.

## Approaches

1. **Reuse the existing authenticated bank APIs through `ManualExchangeService` (selected).** Add typed bank-list and resolution methods to the exchange service, then render a dedicated Nigerian bank selector and verified-name panel in the existing destination form. This keeps the exchange feature testable and avoids coupling it to the very large Send Money screen.
2. Extract the entire private Send Money bank form into a new shared widget. This promises maximal visual reuse but forces a risky refactor of an unrelated working payment flow for one screen.
3. Keep free-text bank/name inputs and resolve opportunistically. This conflicts with the requirement that the user select a bank and receive an automatically generated name, and it permits unverified payout details.

## Approved Behavior

The user approved mandatory verification before continuing. The bank is chosen first, the account number is limited to ten digits, lookup is automatic after a short debounce, the verified name is read-only, errors can be retried, and any edit immediately invalidates the previous result.
