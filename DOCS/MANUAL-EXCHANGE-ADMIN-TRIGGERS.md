# Admin exchange before Kora activation

Kora stays disabled. This flow uses the existing manual exchange orders and admin statement checks. No new provider connection is needed to credit a TrustPay wallet or record an externally completed cedi transfer.

## Cedis → naira wallet

1. Customer creates **Cedis → Naira**, chooses their **TrustPay wallet**, authorizes with their transaction PIN and pays the displayed merchant cedi receiving account. The customer submits the payment reference/proof.
2. Admin opens **Exchange requests**, selects the order and checks the actual incoming cedi payment in the merchant bank/MoMo statement.
3. Press **Confirm cedis & credit naira**. Enter the actual received cedi amount, unique deposit reference and verification note. The amount must match the order; expired quotes require explicit acceptance of the original terms.
4. Confirm. TrustPay credits the frozen naira amount to the customer's NGN wallet once. This does not send a bank transfer. The customer can use the normal naira withdrawal flow afterward.

## Naira → cedis paid by the admin

1. Customer creates **Naira → Cedis** and selects the receiving **bank/MoMo destination**. The customer pays the displayed naira receiving account and submits the payment reference/proof.
2. Admin verifies the actual incoming naira and presses **Confirm naira received**. This queues the cedi payout; it does not transfer cedis or mark the exchange successful.
3. Check that payouts are not on hold. Press **Start cedi transfer** to claim the order. The server checks current customer eligibility, PIN reset hold and settlement holds before assigning it. Only the assigned admin should send the payment, preventing two operators from paying the same request.
4. Send the exact frozen cedi amount to the customer's recorded destination using your bank/MoMo app.
5. Return to the order and press **I sent the cedis**. Enter the actual cedi amount and transfer reference, upload the protected transfer proof and add a verification note. Press **Confirm cedis sent**.
6. TrustPay records the evidence and completes the order once. It does not also credit a cedi wallet.

New naira→cedis external orders use a server-owned completion policy: older Mark sent/Complete API actions cannot bypass the exact cedi amount check. Migration `046_manual_admin_payout_workflow` preserves the legacy workflow on historical rows and must be deployed before this release. It has only been applied to the disposable local test database here.

Historical orders retain the settlement choice the customer authorized. A historical cedi-wallet order must not be silently changed into an external transfer. Historic external naira payouts keep their existing manual evidence workflow.

## Finding requests

The queue loads 50 requests at a time. Use **Load more requests** for older orders; the summary numbers cover the whole queue. Status changes on another operator's screen do not skip the next older request. Refresh slows when more pages are loaded to stay within the API request budget. If refresh fails, the last loaded requests remain visible with a warning; server checks still decide whether an action is permitted.

New requests only offer the receiving methods above: cedis → TrustPay naira wallet, and naira → cedi bank/MoMo. Saved historical attempts retain their original terms.

## Configuration and controls

- `MANUAL_EXCHANGE_ENABLED=true` is required for manual order creation and deposit approval. Keep every `KORA_GHS_*` product flag off until that separate integration is accepted.
- Configure the dedicated NGN collection account with `MANUAL_EXCHANGE_COLLECTION_BANK_NAME`, `...ACCOUNT_NAME`, `...ACCOUNT_NUMBER`, `...VERSION`.
- Configure the dedicated cedi merchant receiving details with `MANUAL_EXCHANGE_GHS_COLLECTION_BANK_NAME`, `...ACCOUNT_NAME`, `...ACCOUNT_NUMBER`, `...VERSION`. Use the actual bank/MoMo receiving details. Do not use an account already attached to a customer virtual account; otherwise one deposit could be counted twice.
- Existing Tier 2 verification, user transaction PIN, admin roles, exact Decimal quotes, settlement holds, protected evidence, unique references, idempotency and audit trails remain required.
- Confirmation is an admin statement check. A customer screenshot alone is not confirmation that money arrived.
- These code changes do not enable production flags, move live funds or establish merchant/provider approval.
