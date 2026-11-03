# Send money: balance repair and focused steps

The owner requested destination choice before the form, one task per page, and repair of a funded wallet incorrectly shown as unavailable. The backend `WalletsController` exposes GET /wallets only; the transfer screen incorrectly queried /wallets/NGN and /wallets/GHS and suppressed failures.

Implementation uses the authoritative uncached wallet collection endpoint. No balance is invented, and a failed refresh blocks review until a successful read. The initial destination chooser opens TrustPay or bank transfer, followed by amount, recipient, and the existing review sheet/PIN. Back restores the entered amount; there are no destination tabs alongside the form. Existing server capability flags, KYC checks, Decimal validation, verified recipients, durable attempt keys and server ledger protection remain intact.

No new transfer is sent as part of production verification. Focused regressions cover the real endpoint contract, distinct steps, unavailable/stale balances, recipient edits, navigation, cancellation and replay prevention. Results will be recorded after verification.

Verification: all 532 Flutter tests passed (`.tooling/airtime-ux/full-verified.log`), followed by three mobile/desktop/large-text light/dark step checks after adding the chooser's theme dependency (`steps-final.log`). Flutter analysis and scoped diff whitespace checks passed. Visual captures are under `output/send-money-steps/`. A regression reproduces the old unavailable-balance symptom with the actual collection returning NGN 450 and the unsupported currency URLs returning 404; the repaired screen correctly permits a 20 NGN draft to advance. Existing cancellation, recipient invalidation, wrong-PIN retry, concurrency/recovery and capability-disabled regressions remain passing. The live preview was restarted and still displayed its app-unlock gate during the agent's check; no live transfer success is claimed.


## Bank-transfer availability follow-up

A new owner screenshot still showed the older destination tabs and a retry banner combining explicit backend disablement with failed capability loading. Capability loading now precedes the amount form. An explicitly disabled service offers a focused explanation and support/back actions; a failed read offers Retry and restores the verified-balance form after recovery. Pending original-payment recovery and terminal receipt outcomes remain reachable even while new transfers are unavailable. No feature flag, KYC decision, PIN protection or money endpoint was relaxed.

The signed-in Paystack live Transfers page exposed transfer access, while its available NGN payout balance was0. The account Preferences page showed “Settled next day”. A top-up is not proof that customer deposits are missing; collected funds and available transfer liquidity have different settlement states. Official Paystack documentation supports approved Manual Payouts into a transfer balance; Nigeria requires a partner Manual Payout Account and Paystack support approval. No consent, account request, provider setting change, top-up, transfer or support message was submitted. The owner asked for an explanation before funding, so activation remains pending a settlement/liquidity decision.

Verification:538 full Flutter tests passed,38 focused availability/transfer/recovery tests passed, seven final responsive/light/dark UI checks passed and analysis was clean. Independent review found no important regression. Customer identifiers, provider secrets and financial references were not introduced into the new availability screen. Logs are in `.tooling/airtime-ux/availability-*.log`; visual checks are in `output/send-money-steps/bank-*.png`.

Sources: https://support.paystack.com/en/articles/2131074 (manual payouts); https://paystack.com/docs/transfers/managing-transfers/ (payout balance and fees); https://support.paystack.com/en/articles/2125314 (automatic settlement).
