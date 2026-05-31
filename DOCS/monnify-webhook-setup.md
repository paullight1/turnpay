# 🔗 Monnify Webhook Setup & Verification

> **Status:** 🔜 Ready for configuration
> **Stream:** STREAM-BANKING — Phase 1, Task 1.2
> **Last Updated:** 2026-05-31

---

## Webhook URL

### Staging
```
https://staging.trustpay.ng/api/webhooks/monnify
```

### Production
```
https://trustpay.ng/api/webhooks/monnify
```

---

## Registration Steps (Monnify Dashboard)

1. Log into [Monnify Dashboard](https://app.monnify.com)
2. Navigate to **Settings → API Keys & Webhooks**
3. Under **Webhook URL**, enter the appropriate URL above
4. Set **Webhook Secret** (generate a strong random string — store in `MONNIFY_WEBHOOK_SECRET` env var)
5. Click **Save**
6. Monnify will send a **test webhook** to verify the URL is reachable
7. Check the backend logs for the test event and confirm it returns HTTP 200

---

## Backend Implementation

### Endpoint
**POST** `/api/webhooks/monnify` (in `BACKEND/src/payments/webhooks/payment-webhook.controller.ts`)

### Headers
| Header | Description |
|---|---|
| `monnify-signature` | HMAC-SHA512 hex digest of the raw request body, signed with the webhook secret |

### Signature Validation Algorithm
```
expected = HMAC-SHA512(webhookSecret, rawRequestBody).digest('hex')
compare using timingSafeEqual(expected, receivedSignature)
```

- Falls back to `MONNIFY_SECRET_KEY` if `MONNIFY_WEBHOOK_SECRET` is not set
- Uses constant-time comparison to prevent timing attacks
- Returns `400 Bad Request` on signature mismatch (before any processing)

### Event Types Handled

| Monnify Event | Payment Status | Action |
|---|---|---|
| `SUCCESSFUL_TRANSACTION` | `PAID` (exchange match) | Route to `ExchangeService.processMonnifyExchangeDepositWebhook` |
| `SUCCESSFUL_TRANSACTION` | `PAID` (no exchange match) | Route to `BankingService.processVirtualAccountDeposit` |
| Other events | — | Logged and acknowledged (HTTP 200), no processing |

### Idempotency
- **Webhook re-delivery protection:** The `providerReference` (Monnify `transactionReference`) combined with the `eventType` is used as a unique key in `provider_events` table
- Monnify may re-send webhooks; the backend MUST handle duplicate deliveries without double-crediting
- The `ProviderEvent` table enforces `@@unique([provider, providerReference, eventType])` — duplicate inserts are rejected at the DB level
- `BankingService.processVirtualAccountDeposit` checks for existing `ProviderEvent` before crediting

### Webhook Logging (Implemented)
Every received Monnify webhook creates a `WebhookLog` entry in the database:
- `provider`: `"MONNIFY"`
- `eventType`: from the webhook body
- `reference`: `transactionReference` from the webhook body
- `payload`: full webhook body as JSON
- `processed`: `true` if successfully processed, `false` if error occurred
- `errorMessage`: error details if processing failed

---

## Testing Webhooks Locally

### Option 1: Monnify Sandbox Test Webhook
After registering the webhook URL in Monnify sandbox, use the "Send Test Webhook" button.

### Option 2: Simulate via curl
```bash
# Generate signature (requires webhook secret)
RAW_BODY='{"eventType":"SUCCESSFUL_TRANSACTION","eventData":{"transactionReference":"TXN-123","paymentReference":"PAY-456","amountPaid":5000,"totalPayable":5000,"currency":"NGN","paymentStatus":"PAID","destinationAccountInformation":{"accountNumber":"9922334455","accountName":"Test User","bankCode":"035","bankName":"Wema Bank"}}}'

SIGNATURE=$(echo -n "$RAW_BODY" | openssl dgst -sha512 -hmac "$MONNIFY_WEBHOOK_SECRET" -hex | awk '{print $2}')

curl -X POST http://localhost:3001/api/webhooks/monnify \
  -H "Content-Type: application/json" \
  -H "monnify-signature: $SIGNATURE" \
  -d "$RAW_BODY"
```

### Option 3: Automated E2E Tests
Run the banking webhook funding e2e test suite:
```bash
cd BACKEND && npm run test:e2e -- banking-webhook-funding
```

---

## Security Notes

- Always validate the HMAC-SHA512 signature **before** processing any webhook
- Use constant-time comparison (`timingSafeEqual`) — never string equality for signatures
- Store the webhook secret in environment variables, never in code
- Monnify's IP whitelist feature should be enabled in production
- Webhook payloads are logged for debugging; ensure PII/PCI redaction if needed

---

## Acceptance Criteria

- [ ] Webhook URL registered in Monnify sandbox dashboard
- [ ] Webhook secret configured and stored securely
- [ ] Monnify test webhook received by backend with HTTP 200
- [x] Signature validation implemented (HMAC-SHA512, constant-time)
- [x] Webhook logging to `webhook_logs` table
- [x] Idempotency protection via `provider_events` unique constraint
- [ ] Webhook error alerting configured (Sentry alerts on processing failures)
