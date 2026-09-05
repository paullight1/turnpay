# Manual exchange implementation contract

Working contract for the approved simple NGN→GHS receipt-based flow. Existing wallet-credit and wallet-funded payout routes retain their semantics. All paths use /api prefix and authenticated ownership; admin routes require ADMIN. Every POST requires Idempotency-Key. Feature gate MANUAL_EXCHANGE_ENABLED defaults false. Dedicated collection account must not be a user virtual account auto-credited by normal funding.

## Customer API
- GET /api/exchange/manual-orders/config → { enabled: boolean, sourceCurrency: "NGN", targetCurrency: "GHS" }. No collection account exposed until a valid order exists.
- POST /api/exchange/manual-orders → { amount: decimal string, settlementMode: "WALLET"|"BANK"|"MOMO", destinationInstitution?: string, destinationAccount?: string, destinationName?: string, transactionPin: string }. WALLET has no destination fields. Response: Order.
- GET /api/exchange/manual-orders → Order[] (latest 50).
- GET /api/exchange/manual-orders/:id → Order.
- POST /api/exchange/manual-orders/:id/upload-url → {fileName,contentType,fileSize}; response {signedUrl,objectKey,token}. Accept JPEG/PNG/WebP/PDF <=8 MiB. Upload bytes with PUT and Content-Type using a separate transport with no API bearer token, no body/token logging, no redirects. Then attach proof below.
- POST /api/exchange/manual-orders/:id/proof → {objectKey,bankReference}; response Order. Actual stored bytes verified server-side. Proof can be replaced only while awaiting transfer/confirmation or NEEDS_MORE_INFO. Prior keys remain in audit history.
- GET /api/exchange/manual-orders/:id/proof-url → {url} (private expiring link).

## Admin API
- GET /api/admin/exchange/manual-orders?status=... → Order[] (latest 100).
- POST /api/admin/exchange/manual-orders/:id/review → {action,reason,depositReference?,actualAmount?,payoutReference?,payoutProofObjectKey?}; reason 10–500 chars. action enum CREDIT_WALLET, CONFIRM_DEPOSIT, REQUEST_INFO, REJECT, CLAIM_PAYOUT, MARK_SENT, COMPLETE.
- CREDIT_WALLET (WALLET only) / CONFIRM_DEPOSIT (BANK/MOMO only): require independently verified depositReference and exact actualAmount. A screenshot alone is insufficient; operator attests real bank/Monnify inflow with reason. Deposit allocation is unique globally within dedicated collection flow and checked against known wallet funding references.
- CLAIM_PAYOUT reserves PAYOUT_PENDING for one admin. Never automatic lease expiry/reassignment after ambiguous external payment. Owner can continue; another admin cannot mark it sent.
- MARK_SENT: require actual unique payoutReference and payoutProofObjectKey from admin upload; actor must own claim. COMPLETE only from PAYOUT_SENT with reason verifying settlement. Never mark success on approval alone.
- REQUEST_INFO/REJECT only before confirmed deposit. A confirmed inflow cannot be erased/rejected; escalate payout/refund via support pending resolution.
- POST /api/admin/exchange/manual-orders/:id/upload-url → same upload request/response, for payout evidence.
- POST /api/admin/exchange/manual-orders/:id/proof-url → {kind:"DEPOSIT"|"PAYOUT"}; response {url}.

## Order
{id,reference,status,settlementMode,sourceCurrency,targetCurrency,amount,targetAmount,rate,fee,collectionAccount:{bankName,accountName,accountNumber,currency,version},expiresAt,createdAt,updatedAt,reviewReason:null|string,destinationInstitution:null|string,destinationAccountMasked:null|string,destinationName:null|string,bankReference:null|string,depositReference:null|string,payoutReference:null|string,payoutClaimedBy:null|string,hasProof:boolean,hasPayoutProof:boolean,events:[{status,reason,createdAt}]}
Admin responses additionally include userId and destinationAccount (unmasked, protected). Customer amount/rate/fee fields are decimal strings; no client financial calculations. Customer actions never change destination/mode after create.

## State
AWAITING_TRANSFER → AWAITING_CONFIRMATION (proof)
AWAITING_CONFIRMATION / NEEDS_MORE_INFO → NEEDS_MORE_INFO / REJECTED (reason)
NEEDS_MORE_INFO → AWAITING_CONFIRMATION (replacement proof)
AWAITING_CONFIRMATION → CREDITED (WALLET atomic credit)
AWAITING_CONFIRMATION → PAYOUT_PENDING (BANK/MOMO deposit verified)
PAYOUT_PENDING → PAYOUT_PROCESSING (claim)
PAYOUT_PROCESSING → PAYOUT_SENT (external evidence)
PAYOUT_SENT → COMPLETED (settlement verified)
Late proof remains accepted with a needs-review note; no silent rate change. For expired orders, CREDIT_WALLET / CONFIRM_DEPOSIT additionally require acceptExpiredQuote:true and the operator's reason to explicitly honor the original frozen terms. Without that acknowledgement confirmation fails. Different terms require support resolution; this flow never reprices received funds.

Show Awaiting confirmation; Credited to wallet; Deposit confirmed — payout pending; Payout being processed; Payout sent; Completed; More information needed; Rejected. Poll active detail every 15s while foreground, pause when hidden/disposed. Persist create/attach idempotency keys/account-scoped in secure storage until server outcome; never persist PIN. Reopen from server list after restart. Network errors are unknown, not failure; no automatic financial resubmission.
