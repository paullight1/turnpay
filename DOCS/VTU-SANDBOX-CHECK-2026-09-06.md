# VTU sandbox checks — 2026-09-06

## Follow-up corrections and recovery

The earlier electricity probe used a cable fixture incorrectly. Official Ikeja
fixtures are prepaid 1111111111111 and postpaid 1010101010101; both verified with
nonempty customer names. New separate fixture tests:

- Prepaid request 202609061446b196d35476: initial timeout, requery delivered,
  purchased token present (not recorded here).
- Postpaid request 2026090614471d37fe7481: initial timeout, requery delivered.
- Earlier invalid-meter request 2026090614358882ffdfd7: requery now 016/failed.

Source: https://vtpass.com/documentation/ikedc-ikeja-electricity-distribution-company-payment-api/

Expanded real-PostgreSQL test now passes two recovery paths: signed-event
processing and scheduled requery after a provider timeout. Both assert one
purchase, one debit, and one refund with replay protection. Provider responses
remain mocked. Applied existing migration 039_exchange_quote_execution_guard
only to the isolated local test database to match the current Prisma client.
No production database or provider configuration changed.

Only the exact sandbox API host was allowed. Direct provider purchases used
unique request IDs. No live purchase or production configuration change occurred.
These checks bypass the customer app and internal wallet; they are NOT full
end-to-end certification.

## Fresh purchases and requery

| Product | Request ID | Result |
| --- | --- | --- |
| MTN airtime | 20260906143397b9e5db4c | 019 likely duplicate on pay/requery; unverified |
| Airtel airtime | 202609061433b202531935 | 019 on pay/requery; unverified |
| Glo airtime | 202609061433fae34b11af | Delivered, confirmed by requery |
| 9mobile airtime | 2026090614339be447a77f | 019 on pay/requery; unverified |
| MTN data | 202609061433479192ae07 | 019 on pay/requery; unverified |
| Airtel data | 202609061433ad643d246a | Delivered, confirmed by requery |
| Glo data | 202609061433f0b69fec7e | Delivered, confirmed by requery |
| 9mobile data | 202609061434b1311fb81a | Delivered, confirmed by requery |
| DStv change | 2026090614343aec907c29 | Delivered, confirmed by requery |
| GOtv change | 20260906143478d15d8e21 | Delivered, confirmed by requery |
| StarTimes change | 20260906143574c54de967 | Delivered, confirmed by requery |
| Ikeja prepaid | 2026090614358882ffdfd7 | Pay timeout; requery 099/pending; no token |

No ambiguous purchase was resubmitted. Requery the original Ikeja request ID
to resolve it; do not assume failure or create another payment.

## Catalog and verification

Seven catalogs returned variations: MTN 37, Airtel 26, Glo 79, 9mobile 18,
DStv 67, GOtv 7, StarTimes 25. All three TV verification responses returned
customer names but no renewal price. Renewal stays Coming soon. The Ikeja
verification probe with 1212121212 did not return a nonempty Customer_Name;
this does not certify a valid meter-verification flow.

## Automated checks

- 74 backend VTU unit tests passed.
- 16 Flutter VTU/payment-recovery tests passed (mocked APIs).
- Real local PostgreSQL financial test passed: one concurrent debit, idempotent
  replay, one reversal. Provider and PIN are mocked.

## Still required before production recommendation

Authenticated customer-app-to-provider transactions with wallet/ledger/receipt
reconciliation; valid meter verification and token receipt; delayed/unknown
recovery; deployed callback delivery and authentication. Other electricity
billers and postpaid were not purchased in this run. Empty local admin reports
do not certify transactions made directly against the provider.
