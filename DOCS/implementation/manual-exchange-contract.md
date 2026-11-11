# Manual exchange implementation contract

Working contract for direct-account NGN→GHS and GHS→NGN exchange; historical wallet orders remain supported. Existing wallet-credit and wallet-funded payout routes retain their semantics. All paths use /api prefix and authenticated ownership; admin routes require ADMIN. Every POST requires Idempotency-Key. Feature gate MANUAL_EXCHANGE_ENABLED defaults false. Dedicated collection account must not be a user virtual account auto-credited by normal funding.

## Customer API
- GET /api/exchange/manual-orders/config → {enabled, sourceCurrency, targetCurrency, availableSourceCurrencies, supportedSourceCurrencies, deliveryPolicyVersion:2, settlementOptions:{GHS:["BANK"],NGN:["MOMO","BANK"]}, exchangeLimitPolicy:"UNLIMITED"}. No collection account exposed until a valid order exists.
- POST /api/exchange/manual-orders → { sourceCurrency: "NGN"|"GHS", deliveryPolicyVersion?:2, amount: decimal string, settlementMode: "WALLET"|"BANK"|"MOMO", destinationInstitution?: string, destinationAccount?: string, destinationName?: string, transactionPin: string }. New GHS orders require deliveryPolicyVersion:2, BANK and ten-digit Nigerian destinationAccount; new NGN orders require BANK or MOMO. All external destination fields are required. WALLET is accepted only as a replay of a previously recorded attempt, without changing its mode. Committed replays are checked before new version/availability rules. Direct exchanges have no per-transaction or daily product cap and are excluded from wallet tier limits and subsequent wallet spending; no wallet is required. A user-row lock serializes duplicate creation and fresh eligibility. Order creation/expiry use database time. Response: Order.
- GET /api/exchange/manual-orders → Order[] (latest 50).
- GET /api/exchange/manual-orders/:id → Order.
- POST /api/exchange/manual-orders/:id/upload-url → {fileName,contentType,fileSize}; response {signedUrl,objectKey,token}. Accept JPEG/PNG/WebP/PDF <=8 MiB. Upload bytes with PUT and Content-Type using a separate transport with no API bearer token, no body/token logging, no redirects. Then attach proof below.
- POST /api/exchange/manual-orders/:id/proof → {objectKey,bankReference}; response Order. Actual stored bytes verified server-side. Proof can be replaced only while awaiting transfer/confirmation or NEEDS_MORE_INFO. Prior keys remain in audit history.
- GET /api/exchange/manual-orders/:id/proof-url → {url} (private expiring link).

## Admin API
- GET /api/admin/exchange/manual-orders?status=... → Order[] (latest 100).
- POST /api/admin/exchange/manual-orders/:id/review → {action,reason,depositReference?,actualAmount?,payoutReference?,payoutAmount?,payoutProofObjectKey?}; reason 10–500 chars. action enum CREDIT_WALLET, CONFIRM_DEPOSIT, REQUEST_INFO, REJECT, CLAIM_PAYOUT, HANDOVER_PAYOUT, MARK_SENT, RECORD_CEDIS_SENT, RECORD_PAYOUT_SENT, COMPLETE.
- CREDIT_WALLET (WALLET only) / CONFIRM_DEPOSIT (BANK/MOMO only): require independently verified depositReference and exact actualAmount. A screenshot alone is insufficient; operator attests actual bank/MoMo inflow with reason. Deposit allocation is unique globally within dedicated collection flow and checked against known wallet funding references.
- CLAIM_PAYOUT reserves PAYOUT_PENDING for one admin. Never automatic lease expiry/reassignment after ambiguous external payment. Owner can continue; another admin cannot mark it sent.
- New ADMIN_EXTERNAL orders require RECORD_PAYOUT_SENT with exact frozen payoutAmount, unique reference and private evidence, only by the claim owner. New ADMIN_CEDIS retains RECORD_CEDIS_SENT. Both complete without wallet writes. MARK_SENT cannot bypass these policies. A supervised ALREADY_SENT handover requires the exact amount/reference/evidence before PAYOUT_SENT, after which COMPLETE confirms settlement.
- Legacy MARK_SENT: require actual unique payoutReference and payoutProofObjectKey from admin upload; actor must own claim. COMPLETE only from PAYOUT_SENT with reason verifying settlement. Never mark success on approval alone.
- REQUEST_INFO/REJECT only before confirmed deposit. A confirmed inflow cannot be erased/rejected; escalate payout/refund via support pending resolution.
- POST /api/admin/exchange/manual-orders/:id/upload-url → same upload request/response, for payout evidence.
- POST /api/admin/exchange/manual-orders/:id/proof-url → {kind:"DEPOSIT"|"PAYOUT"}; response {url}.

## Order
{id,reference,status,settlementMode,payoutWorkflow,sourceCurrency,targetCurrency,amount,targetAmount,rate,fee,collectionAccount:{bankName,accountName,accountNumber,currency,version},expiresAt,createdAt,updatedAt,reviewReason:null|string,destinationInstitution:null|string,destinationAccountMasked:null|string,destinationName:null|string,bankReference:null|string,depositReference:null|string,payoutReference:null|string,payoutClaimedBy:null|string,hasProof:boolean,hasPayoutProof:boolean,events:[{status,reason,createdAt}]}
Admin responses additionally include userId and destinationAccount (unmasked, protected). Customer amount/rate/fee fields are decimal strings; no client financial calculations. Customer actions never change destination/mode after create.

## State
AWAITING_TRANSFER → AWAITING_CONFIRMATION (proof)
AWAITING_CONFIRMATION / NEEDS_MORE_INFO → NEEDS_MORE_INFO / REJECTED (reason)
NEEDS_MORE_INFO → AWAITING_CONFIRMATION (replacement proof)
AWAITING_CONFIRMATION → CREDITED (WALLET atomic credit)
AWAITING_CONFIRMATION → PAYOUT_PENDING (BANK/MOMO deposit verified)
PAYOUT_PENDING → PAYOUT_PROCESSING (claim)
PAYOUT_PROCESSING → COMPLETED (new direct workflows: exact amount, unique reference and private evidence)
PAYOUT_PROCESSING → PAYOUT_SENT (legacy evidence or independently checked ALREADY_SENT handover)
PAYOUT_SENT → COMPLETED (settlement verified)
Late proof remains accepted with a needs-review note; no silent rate change. For expired orders, CREDIT_WALLET / CONFIRM_DEPOSIT additionally require acceptExpiredQuote:true and the operator's reason to explicitly honor the original frozen terms. Without that acknowledgement confirmation fails. Different terms require support resolution; this flow never reprices received funds.

Show Awaiting confirmation; Credited to wallet; Deposit confirmed — payout pending; Payout being processed; Payout sent; Completed; More information needed; Rejected. Poll active detail every 15s while foreground, pause when hidden/disposed. Persist create/attach idempotency keys/account-scoped in secure storage until server outcome; never persist PIN. Reopen from server list after restart. Network errors are unknown, not failure; no automatic financial resubmission.
