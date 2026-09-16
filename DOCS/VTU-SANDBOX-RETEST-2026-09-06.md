# VTpass all-service sandbox retest

Direct sandbox API probes only, not TrustPay wallet-to-receipt certification.
Host restricted to https://sandbox.vtpass.com/api. No live payments.
Each attempted purchase has a unique ID and a requery; ambiguous payments are not resubmitted.
TIMEOUT_OR_NON_JSON means the 12-second client deadline or non-JSON response; it is not a decline.
Only delivered results qualify as successful purchase evidence.

## Initial purchase/requery results

| Service | Request ID | Initial outcome |
|---|---|---|
| Airtel airtime | 2026090618376a5659ce766f | Timeout; 099 pending |
| MTN airtime | 202609061837e88e18a9899c | 019 on pay/requery |
| Glo airtime | 202609061837cf0bf836510c | 019 on pay/requery |
| 9mobile airtime | 2026090618376f27e64d68b3 | 019 on pay/requery |
| Airtel data | 2026090618377f48372e92e6 | 019 on pay/requery |
| MTN data | 2026090618374a6be72662c5 | Timeout; 099 pending |
| Glo data | 202609061837ea8ca534504e | 019 on pay/requery |
| 9mobile data | 202609061837931a08e1aecf | 019 on pay/requery |
| Glo SME data | 2026090618373cb36560ab9a | 019 on pay/requery; Best Value form mapping not confirmed |
| DStv change | 202609061837a04cf7bfc189 | Timeout; 099 pending; customer verification passed |
| GOtv change | 202609061838d891ddb45943 | 019 on pay/requery; customer verification passed |
| StarTimes | 20260906183821b5d163c4a1 | 019 on pay/requery; customer verification passed |
| WAEC result checker | 202609061838e97758889425 | Timeout; 099 pending |
| WAEC registration | 20260906183859a34d2e86f2 | 019 on pay/requery |
| Ikeja prepaid | 2026090618380e7836d44711 | Timeout; 099 pending; customer verification passed |
| Eko prepaid | 202609061838230c25e43fcc | Timeout; 099 pending; customer verification passed |
| Abuja prepaid | 202609061838c9943053aea4 | Timeout on pay/requery; customer verification passed |
| Kano prepaid | 20260906183960093ff2c416 | Timeout; 007 initiated; customer verification passed |
| Port Harcourt prepaid | 20260906183912386de77ed5 | Timeout; 099 pending; customer verification passed |
| Jos prepaid | 2026090618394e618d9168b2 | 019 on pay/requery; verification 000 but customer-name check not confirmed |
| Kaduna prepaid | 2026090618390fcd9dfa0b32 | Timeout; 007 initiated; customer verification passed |
| Enugu prepaid | 202609061840373c3e96274e | Timeout; 007 initiated; customer verification passed |
| Ibadan prepaid | 202609061840ac562d2f05cf | Timeout; 007 initiated; customer verification passed |
| Benin prepaid | 202609061840d93a61d5d123 | 019 on pay/requery; customer verification passed |
| Aba prepaid | 2026090618407a8e4a8c6220 | Timeout; 099 pending; customer verification passed |
| Yola prepaid | 202609061841bd6deab1ad43 | Timeout; 007 initiated; customer verification passed |
| Smile airtime | 202609061839b129be522fd6 | Timeout; 099 pending; email verification passed |
| Smile data | 2026090618391e093fc95705 | 019 on pay/requery; email verification passed |
| International airtime | 2026090618393ba03e7f8b3f | Timeout; 007 initiated; exploratory only, catalog caveat below |
| SMSclone | 20260906183957ebbac48a2e | 028 on pay/requery; negative test with synthetic username only |

## Catalog and fixture limitations

- 9mobile SME: variation request for serviceID 9mobile-sme-data returned 011, Service is Not Valid. No purchase ID: catalog blocked purchase construction.
- Smile: documented sandbox email verification returned 000 and customer name.
- International airtime: GH/operator 5 catalog returned zero-priced fixed variations with inconsistent country labels. Any exploratory sandbox purchase does not establish valid live pricing.
- SMSclone requires an existing username. A synthetic invalid username probe is negative testing only, not successful integration certification.

## Final requery results

All 30 original purchase IDs were requeried after the run. 16 returned code 000 with status delivered; 13 returned 019 (LIKELY DUPLICATE TRANSACTION); SMSclone returned 028 (PRODUCT IS NOT WHITELISTED ON YOUR ACCOUNT). No fresh ID was created to replace an ambiguous payment.

### Confirmed delivered IDs

| Form service | Request ID |
|---|---|
| Airtel Airtime VTU | 2026090618376a5659ce766f |
| MTN Data | 2026090618374a6be72662c5 |
| DSTV Subscription (change) | 202609061837a04cf7bfc189 |
| WAEC Result Checker PIN | 202609061838e97758889425 |
| Ikeja Electric Payment (prepaid) | 2026090618380e7836d44711 |
| Eko Electric Payment (prepaid) | 202609061838230c25e43fcc |
| Abuja Electricity (prepaid) | 202609061838c9943053aea4 |
| KEDCO Kano (prepaid) | 20260906183960093ff2c416 |
| PHED Port Harcourt (prepaid) | 20260906183912386de77ed5 |
| Kaduna Electric (prepaid) | 2026090618390fcd9dfa0b32 |
| Enugu Electric (prepaid) | 202609061840373c3e96274e |
| IBEDC Ibadan (prepaid) | 202609061840ac562d2f05cf |
| Aba Electric APLE (prepaid) | 2026090618407a8e4a8c6220 |
| Yola Electric (prepaid) | 202609061841bd6deab1ad43 |
| Smile Network Payment (airtime) | 202609061839b129be522fd6 |
| International Airtime (exploratory; catalog caveat applies) | 2026090618393ba03e7f8b3f |

Customer verification returned 000 with a nonempty customer name for all ten delivered electricity purchases and all three TV services. Jos returned 000 but the customer-name check was not confirmed: do not mark its verification successful based on this probe.

### Not successful in this retest

019: MTN/Glo/9mobile airtime; Airtel/Glo/9mobile/Glo SME data; GOtv; StarTimes; WAEC registration; Jos/Benin electricity; Smile data. Their IDs remain in the initial table for troubleshooting only, not as successful integration IDs.

028: SMSclone is not whitelisted. Its synthetic username is additionally unsuitable for a positive test after whitelisting. No success claimed.

9mobile SME could not proceed beyond catalog lookup. Glo Best Value mapping is not confirmed. These form options are not certified.

This verifies direct provider sandbox delivery only. It does not demonstrate that every listed service is exposed in TrustPay, that PINs/tokens render correctly, or that production wallet accounting and webhook recovery work. Do not tick a product solely because this direct API probe delivered if that product is not actually integrated in the app. No production configuration was changed and no real money was spent.

Sources: https://vtpass.com/documentation/smile-network-payment-api-2/ ; https://vtpass.com/documentation/foreign-airtime/ ; https://www.vtpass.com/find-my-transaction
