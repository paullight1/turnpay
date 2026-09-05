# VTpass sandbox check — 2026-09-05

Status: partial certification; do not treat direct provider tests as an authenticated TRUSTPAY wallet-to-receipt test.

## Observed provider results

- Prior direct sandbox purchases: MTN airtime, Airtel data, DStv package change, Ikeja prepaid and postpaid delivered; requery confirmed delivery. Prepaid returned a purchased code (not retained here).
- MTN pending and failed sandbox scenarios remained pending and failed on requery respectively. MTN data returned code 019 once; this is not a successful purchase.
- Current catalog checks: MTN 37, Airtel 26, Glo 79, 9mobile 18, DStv 67, GOtv 7, StarTimes 25 variations.
- Current verification checks: all 12 configured electricity providers tested in prepaid and postpaid modes. 23 responses included a nonempty customer name. Jos prepaid returned code 000 and a Customer_Name field but no nonempty name; delivery is not certified by this check.

## Cable diagnosis

Repeated DStv and GOtv sandbox merchant verification for the documented test card returned code 000 but no Renewal_Amount or current bouquet. Adding subscription_type or type did not supply a price. StarTimes also returned no renewal amount.

A direct DStv sandbox renewal with amount 1850 returned delivered, request 260905195502R9084. This amount was a test input, not a verified renewal quote. Omitting amount returned code 011. Therefore direct renewal transport works, but automatic renewal pricing cannot be certified.

The backend now rejects missing-price renewal at customer verification with an actionable message to select Change package or retry later. The purchase-time price check remains in place. No guessed renewal price or sandbox-price fallback was added.

## Local verification

- VTU backend: 9 suites, 70 tests passed after the change.
- Flutter: installed at /Users/MAC/development/flutter; the selected VTU service and money-action tests passed (8 tests). These use mocked APIs.
- The old website VTU purchase test targets a retired customer dashboard. The current dashboard layout redirects to /download intentionally; customer transactions are mobile-only.
- Follow-up: local PostgreSQL was reachable through Prisma. Created isolated database `trustpay_financial_test_vtu_20260905`, applied all 41 migrations, and passed the VTU financial E2E test: one concurrent debit, original-result replay, and exactly one reversal. Provider calls and PIN verification in this test are mocked; this does not certify authenticated mobile-to-provider delivery.
- Follow-up callback unit checks: 3 suites, 11 tests passed. Public gateway delivery remains untested.

## Follow-up sandbox anomalies

Using unique request IDs and amount 50 against MTN sandbox only:

- Unexpected response: request `202609052004c3053dd5ea`, HTTP 500/code 083; requery code 015.
- No response: request `202609052004fc0b30080f`, HTTP 200/non-JSON body; requery code 015.
- Timeout: request `202609052004799c9db936`, client timed out after 12 seconds; requery code 015.

These were direct provider probes, not wallet purchases. The adapter maps code 015 to pending. No terminal recovery or refund is proved by these responses; investigate provider resolution before certification. No automatic resubmission was made.

## Outstanding certification

1. Obtain a working renewal-price sandbox fixture or provider correction for DStv/GOtv. Provider acceptance of a supplied amount is insufficient.
2. Complete authenticated mobile/API purchases against an isolated database and reconcile wallet, order, ledger, and receipt.
3. Prove deployed callback ingress authentication and delayed/duplicate delivery; unit tests do not certify the gateway.
4. Complete remaining per-biller purchases, unknown/timeout recovery, and low-balance operational checks.

Suggested support request (not sent):

> Sandbox merchant-verify for DStv and GOtv with documented billersCode 1212121212 returns code 000 but omits Renewal_Amount and Current_Bouquet. Your renewal instructions require the verified Renewal_Amount. Please provide a sandbox card that returns these fields or correct the fixture. Direct DStv renew with a test amount delivered (request 260905195502R9084); renew without amount returned 011. We need to certify provider-confirmed pricing before enabling automatic renewal.

References: https://vtpass.com/documentation/dstv-subscription-api/ and https://vtpass.com/documentation/gotv-subscription-api/.
