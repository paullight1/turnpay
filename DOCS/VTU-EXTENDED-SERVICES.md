# Additional VTpass services

The backend and mobile app support these additional catalog entries:

| TRUSTPAY provider | Category | VTpass service ID | Customer input |
| --- | --- | --- | --- |
| `smile-airtime` | airtime | `smile-direct` | Smile email, verified account, plan |
| `foreign-airtime` | airtime | `foreign-airtime` | Destination country, operator, recipient phone, plan |
| `smile` | data | `smile-direct` | Smile email, verified account, plan |
| `glo-sme` | data | `glo-sme-data` | Recipient phone, plan |
| `9mobile-sme` | data | `etisalat-sme-data` | Recipient phone, plan |
| `showmax` | cable | `showmax` | ShowMax phone number, plan |

T2 retains the provider identifiers `9mobile` and `9mobile-sme` for API compatibility.
Smile voice and data use the same VTpass product; both entries load its live plans.

## Client and release compatibility

Updated clients request `GET /api/vtu/providers?type=airtime&catalog=extended`
(and the corresponding category). Omitting `catalog=extended` preserves the
older client catalog, avoiding forms that cannot collect the new service fields.

Release the backend before distributing the updated mobile app. No Prisma
migration is required: the existing order schema already supports international
scope, operator IDs, NGN settlement, encrypted delivery codes and reconciliation.
The website's customer dashboard remains retired and redirects to `/download`.

Production still requires `VTU_ENABLED=true`, valid VTpass production credentials,
a funded VTpass wallet and these services enabled on the VTpass account. Local
unit/widget tests simulate provider responses and do not prove live entitlement
or fulfillment. Do not use a real customer's wallet for smoke tests without
explicit authorization.

## Authenticated API flow

All endpoints below are protected by the existing `JwtAuthGuard`.

1. `GET /api/vtu/international/countries` lists supported destinations.
2. `GET /api/vtu/international/operators?countryCode=GH` lists airtime operators.
   Only mobile top-up product type `1` is used; data and PIN products are excluded.
3. `GET /api/vtu/packages?provider=foreign-airtime&countryCode=GH&operatorId=5`
   loads the operator's live variations. Local package requests need only `provider`.
4. `POST /api/vtu/validate/smile` accepts `{ "smileEmail": "customer@example.com" }`
   and returns the customer's available accounts. Include an `Idempotency-Key`.
5. `GET /api/vtu/quote` accepts `type`, `provider`, `packageId`, plus the international
   destination/operator fields when relevant. Flexible international plans also
   require `faceValue`, denominated in the destination currency. The quote returns
   `amount`, `fee`, `totalDebit` and `currency: "NGN"` as decimal strings.
6. `POST /api/vtu/purchase` uses the existing idempotent purchase endpoint, PIN/KYC
   checks, NGN ledger reservation and provider reconciliation. Include the quoted
   `amount` and `expectedTotal`, plan ID and contact phone. Add `smileEmail` and
   `smileAccountId` for Smile; `recipientNumber` for ShowMax/data/international;
   `countryCode`, `operatorId` and flexible `faceValue` for international airtime.
   The buyer email for international requests comes from the authenticated user.
7. Continue using the existing owner-only order status/requery endpoints for pending
   or unknown outcomes. Never issue a replacement purchase merely after a timeout.

## Pricing and verification controls

- Package prices and fees are resolved again on the server before any debit.
- `expectedTotal` prevents a changed fee from increasing a reviewed charge silently.
- International fixed plans require a positive `charged_amount` in NGN; a foreign
  `variation_amount` is never treated as the wallet charge. Flexible plans use
  provider `variation_rate × faceValue`, with provider bounds when supplied.
- Missing prices, invalid rates and charges requiring fractional kobo are rejected.
- The international recipient's country prefix must match the selected destination.
- Smile email is reverified at purchase time; the selected account must be returned
  by VTpass for that email. Raw account IDs and email are excluded from audit metadata.
- ShowMax uses a phone and plan, without DStv-style smartcard verification or renewal.
- Existing duplicate prevention, settlement holds, pending states, encrypted delivery
  codes and provider-confirmed reversals remain in use.

## Provider references

- [Smile API](https://vtpass.com/documentation/smile-network-payment-api-2/)
- [International airtime API](https://vtpass.com/documentation/foreign-airtime/)
- [GLO SME API](https://vtpass.com/documentation/data-subscription-api/glo-sme-data-api/)
- [T2/9mobile SME API](https://vtpass.com/documentation/9mobile-sme-data-api/)
- [ShowMax API](https://vtpass.com/documentation/showmax-subscription-api/)
