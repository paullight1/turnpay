# Manual Exchange: staging and operating steps

The first corridor is NGN → GHS. Customers choose TrustPay wallet, bank or MoMo settlement before receiving transfer instructions. Wallet approval credits the in-app GHS balance atomically. BANK/MOMO settlement is performed by the assigned operator outside the app; approval alone never records a completed payout.

## Configure staging

1. Use a staging database, Redis and private Supabase storage project isolated from production. Apply the reviewed migrations using `npx prisma migrate deploy` from `BACKEND`. Never use `migrate reset` on staging or production.
2. Keep `MANUAL_EXCHANGE_ENABLED=false` until configuration and acceptance are checked. Set `MANUAL_EXCHANGE_COLLECTION_BANK_NAME`, `MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NAME`, `MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER` and `MANUAL_EXCHANGE_COLLECTION_VERSION` in the backend environment. Increment the version when collection instructions change; existing orders retain their original snapshot.
3. Use a dedicated collection account with real statement access. It must not be a customer's virtual account or an account automatically credited through wallet-funding webhooks. The server refuses known user virtual accounts and rejects references already associated with provider funding or another exchange settlement.
4. Configure `EXCHANGE_RECEIPT_BUCKET` (default `exchange-receipts`) as **private**, with an 8 MiB upload limit and JPEG, PNG, WebP and PDF content types. Do not add anonymous read/write policies. The server signs order-scoped uploads and verifies ownership, stored size and file signature before attaching evidence. Signed reads expire after five minutes. Test the actual storage API; local financial tests use synthetic storage.
5. Provision synthetic staging customers with VERIFIED KYC and Tier 2, a transaction PIN, and a GHS wallet for wallet settlement. Confirm the legitimate Tier 2 upgrade path before onboarding customers; do not bypass eligibility to make a demo pass.
6. Set up a named ADMIN operator using the existing authorized role-management process. Confirm current NGN→GHS rates are fresh. Enable the feature only in staging and open `/admin/exchange/manual-orders`.

## Process one order

1. Customer creates the order, checks the frozen receive amount and destination, transfers the exact NGN amount to the displayed account, uploads proof and enters the transfer reference. Only server acceptance changes the status to Awaiting confirmation.
2. Admin opens the proof and independently checks the incoming bank statement. Enter the actual deposit reference, exact received amount and a meaningful reason. A screenshot is not confirmation of received money. Underpayment/overpayment stays in review; do not edit the amount to force approval.
3. If instructions expired, explicitly select **honor the original quoted terms**. This records acceptance of the original amount; the system never silently reprices received funds. If the original terms cannot be honored, escalate to support for a documented resolution.
4. For WALLET, approve credit. Deposit allocation, exact GHS ledger credit, customer status and audit event commit together. Refresh after uncertainty; never issue a separate manual credit for the same reference.
5. For BANK/MOMO, confirm the deposit, then claim the payout. Check the recorded beneficiary and the external bank/MoMo history before sending. The claim stays with one operator and has no automatic lease expiry. A timeout is an unknown outcome: check the external provider before taking another action. Never independently pay an order claimed by somebody else.
6. After the external send, upload payout evidence and enter the actual unique payout reference. Mark sent; verify settlement before marking completed. No wallet credit or debit is made for this path.
7. Request information or reject only before deposit confirmation. After confirmed receipt, funds remain an outstanding obligation until settlement or a separately reviewed support/refund process. There is deliberately no arbitrary status edit or automatic refund action in this first release.

## Reconciliation and incidents

- Hourly internal checks record `MANUAL_EXCHANGE` runs in `reconciliation_runs`. Admin API: `GET /api/admin/exchange/manual-orders/reconciliation`. A clean internal run checks recorded allocation, transaction status, wallet credit and payout evidence; it does **not** prove bank/MoMo settlement.
- Route `MANUAL_EXCHANGE_RECONCILIATION_BLOCKED` and `MANUAL_EXCHANGE_RECONCILIATION_FAILED` structured log alerts to the existing incident channel and test delivery in staging.
- Compare the dedicated bank statement to allocated deposits, unmatched deposits, credited wallets and outstanding external payouts every operating day. Compare sent/completed payouts to actual external statements. Review old pending/claimed orders and support cases. Record three clean cycles before expansion.
- On a discrepancy, disable new creation/confirmation with `MANUAL_EXCHANGE_ENABLED=false`. Existing order reads, proof submission and external payout follow-through remain available so already-received funds are not stranded. Stop the disputed payout, preserve references and escalate through existing incident procedures.
- Do not change an order's settlement mode, create a second credit, delete ledger history or release another operator's claim to resolve uncertainty. Investigate and use the reviewed compensating-entry/refund procedure with required approvals.

## Remaining release evidence

Use [the launch checklist](../MOBILE-LAUNCH-CHECKLIST.md) for signed artifacts, actual private-storage uploads, lost-response/restart tests, real Android/iPhone biometrics/privacy, certificate rotation, device integrity, alert delivery, restore rehearsal and provider/operator approvals. Passing local tests is not evidence that these external steps are complete.
