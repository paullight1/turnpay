# Automatic transfer approval

Goal: a verified user authorizes a bank transfer with their transaction PIN; staff do not enter Paystack OTPs for routine payments.

Implementation plan:
- [x] Test and implement a short-lived approval intent persisted before POST /transfer. Bind reference, exact kobo, NGN currency, balance source and provider recipient to the existing withdrawal reservation. Seal the intent with an internal HMAC using the server key.
- [x] Test and implement POST /api/webhooks/paystack/transfer-approval. Match the documented initiation payload against the sealed intent; reject missing, changed, expired, refunded, suspended or terminal reservations. Serialize decisions with settlement/refund transitions and audit the first approval. Approval never credits/debits money or marks success.
- [x] Wire preparation into the provider and expose deployment readiness separately from user recipient preparation. Preserve signed settlement webhooks, independent provider verification, PIN, KYC, limits, idempotency and reconciliation holds.
- [x] Exercise duplicate/concurrent callbacks and terminal/refund cases using disposable PostgreSQL; run backend checks.
- [x] Inspect the signed-in user's live send preparation flow against production data without submitting a payout.
- [ ] Deploy and activate the live approval setting after PT liquidity is available. The owner performs the final live transfer.

Paystack documents approval POSTs as the original initiation payload, with HTTP 200/400 decisions; it does not document a provider signature on this particular request. Do not assume event-webhook headers exist on approval callbacks. The authorization is an exact match to a server-sealed, already PIN-authorized reservation, not trust in arbitrary incoming instructions. Signed settlement event verification remains mandatory. Never use the approval response as evidence that money was delivered.

Activation: deploy and verify the endpoint, register the live approval URL, then replace merchant OTP confirmation with server approval. Keep execution disabled until approval is activated and the PT payout balance covers transfers plus provider fees. The live financial test is completed by the account owner.

Source: https://paystack.com/docs/transfers/managing-transfers/

## Verification and activation record

- Full backend suite: 114 suites / 924 tests passed.
- Real disposable PostgreSQL: 15 financial tests passed, including concurrent approval callbacks during the initiating request, failed/blocked/reversed refunds, unsent setup failure, duplicate-reference ambiguity, authenticated not-found recovery for an expired never-approved intent, provider-lookup outages, disabled approval rejecting before any reservation, durable replay and metadata redaction. No live funds were moved.
- Flutter transfer UI/integration: 25 tests passed, including recipient preparation with execution disabled and safe compatibility with the existing Paystack capabilities response. Dart analysis passed; backend typecheck and build passed.
- Flutter restarted on port 8080; HTTP 200 verified. Its local API proxy forwards to https://api.trustpayhq.com. Live browser inspection confirmed the correct test account at NGN 450, a NGN 50 draft, and the provider bank list. The final payout action remained disabled while production execution and PT liquidity are pending.
- Before dispatch, recipient/setup/persistence failures are definitive unsent failures and release the reservation. After POST /transfer, timeouts stay pending until provider verification; never blindly retry or refund them.
- User receipt output omits the approval seal. Unknown callbacks cannot mint an intent. Matching callbacks cannot create a second debit, submit another transfer, extend expiry, or approve refunded/terminal transactions.
- Provider retries return approval only while the exact instruction is still pending and authorized. Terminal or refunded instructions deliberately return HTTP 400; they are never re-armed merely to make a late retry return 200.

Deployment configuration:

1. Deploy this implementation with `WITHDRAWALS_ENABLED=false` and `PAYSTACK_TRANSFER_APPROVAL_ENABLED=false`.
2. Probe `POST https://api.trustpayhq.com/api/webhooks/paystack/transfer-approval` with an unknown synthetic reference: expect HTTP 400, never 200. Confirm health and existing signed webhook processing remain available.
3. Register that HTTPS URL in Paystack's **live Transfer Approval** settings. Keep rejection behavior **Do Nothing**, so a callback outage does not blacklist an innocent recipient.
4. With owner confirmation, replace merchant OTP approval with server approval. Never retrieve staff OTPs automatically or expose them to customers. Restrict secret-key requests to the backend's confirmed outbound IP in Paystack.
5. Verify available Paystack payout balance covers the planned transfer plus fees. The user wallet ledger and Paystack available payout balance are separate checks.
6. Enable `PAYSTACK_TRANSFER_APPROVAL_ENABLED=true` and `WITHDRAWALS_ENABLED=true`, redeploy/restart, and confirm capabilities. Only explicitly enabled execution is allowed; recipient preparation can remain available beforehand.
7. Owner completes one small live transfer to their chosen recipient. Verify matching approval audit, exactly one withdrawal debit, provider success, recipient receipt and no merchant OTP prompt. A matching callback alone is not proof of delivery.

Rollback: set `WITHDRAWALS_ENABLED=false` first; preserve settlement webhooks and reconciliation for pending obligations. Do not switch back to merchant OTP while continuing to advertise self-service execution.
