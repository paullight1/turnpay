# Admin exchange before Kora activation

Kora stays disabled. This flow uses the existing manual exchange orders and admin statement checks. No new provider connection is needed to credit a TrustPay wallet or record an externally completed cedi transfer.

## Cedis → chosen Nigerian bank account (new V1 orders)

1. Customer creates **Cedis → Naira**, enters the recipient's Nigerian bank, ten-digit account number and beneficiary name, authorizes with their PIN and pays the dedicated cedi collection account shown on the order.
2. Customer submits proof and the incoming payment reference. Admin independently checks the actual cedi receipt in the collection bank/MoMo statement.
3. Press **Confirm cedis received**, enter the exact received amount, unique deposit reference and verification note. This queues a naira payout; it does not credit a wallet or initiate a bank transfer.
4. Press **Start naira transfer** to claim the order. Check the frozen beneficiary and amount, eligibility, holds and actual banking history before paying.
5. Send the exact frozen NGN amount from the approved business payout account to the chosen Nigerian bank account outside TrustPay.
6. Press **I sent the naira**, enter the exact NGN amount and unique outgoing reference, upload private payment evidence and record the verification note. **Confirm naira sent** completes the order once without a wallet debit/credit or provider dispatch.

Historical WALLET orders retain **Confirm cedis & credit naira** and their original wallet delivery. Never change an existing customer's settlement choice or separately pay an already-credited historical order.

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

New requests offer cedis → Nigerian bank account, and naira → Ghana bank/MoMo. Saved historical attempts retain their original terms.

## Configuration and controls

- `MANUAL_EXCHANGE_ENABLED=true` is required for manual order creation and deposit approval. Keep every `KORA_GHS_*` product flag off until that separate integration is accepted.
- Configure the dedicated NGN collection account with `MANUAL_EXCHANGE_COLLECTION_BANK_NAME`, `...ACCOUNT_NAME`, `...ACCOUNT_NUMBER`, `...VERSION`.
- Configure the dedicated cedi merchant receiving details with `MANUAL_EXCHANGE_GHS_COLLECTION_BANK_NAME`, `...ACCOUNT_NAME`, `...ACCOUNT_NUMBER`, `...VERSION`. Use the actual bank/MoMo receiving details. Do not use an account already attached to a customer virtual account; otherwise one deposit could be counted twice.
- Verified Tier 1 or higher, user transaction PIN, admin roles, exact Decimal quotes, settlement holds, protected evidence, unique references, idempotency and audit trails remain required.
- Confirmation is an admin statement check. A customer screenshot alone is not confirmation that money arrived.
- These code changes do not enable production flags, move live funds or establish merchant/provider approval.

## Direct-exchange rollout — 4 November 2026

Deploy migration `055_manual_direct_account_exchange` before the new backend. It expands the workflow check; it never rewrites historical rows. Deploy the updated app/admin alongside the backend before enabling new GHS→NGN orders. New reverse-bank creation requires deliveryPolicyVersion=2, which the updated app includes; older clients receive an update-required response before payment instructions. Committed historical attempts are recovered before the new version and availability gates, preserving their original keys and details.

The owner confirmed that direct exchanges have no application per-transaction or daily cap. No exchange-limit environment values are required. Dedicated receiving configuration and the feature switch determine direction availability. Direct orders do not require a wallet and do not consume wallet tier spending/balance allowances. KYC, suspension/PIN checks, exact quotes, independent receipt checks, claim ownership, evidence, audit and reconciliation remain required. Positive amounts/rates/payouts must be representable exactly in the existing database money columns; the prior 10,000,000 source-amount cap is removed.

Pausing new creation preserves historical reads, original-key recovery and follow-through on already confirmed external payouts. Never change the mode or destination of an existing order while enabling this release.

Admin external transfers remain manual business-bank/MoMo actions. Actual access, liquidity, account limits, recipient/statement checks and operating authorization must be accepted before enabling real orders. Reconcile incoming deposits, completed payouts and outstanding obligations in each currency daily. An ambiguous external outcome must be investigated before another send; use the existing supervised handover procedure. When an already-sent transfer is handed over, its exact amount and protected evidence are verified during handover before final settlement completion.

Pause new creation before rollback. Keep a workflow-aware backend/admin available to resolve any existing ADMIN_EXTERNAL orders; do not downgrade their settlement evidence requirements.
