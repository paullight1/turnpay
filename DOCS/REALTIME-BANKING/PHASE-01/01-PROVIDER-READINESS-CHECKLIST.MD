# Phase 01 Provider Readiness Checklist

## Purpose

Confirm provider feasibility before TRUSTPAY builds virtual account, deposit, or withdrawal functionality.

## Sources To Recheck Before Build

- Paystack Dedicated Virtual Accounts: https://paystack.com/docs/payments/dedicated-virtual-accounts/
- Paystack webhooks: https://paystack.com/docs/payments/webhooks/
- Paystack transfers: https://paystack.com/docs/transfers/how-transfers-work/
- Flutterwave Pay With Bank Transfer: https://developer.flutterwave.com/docs/pay-with-bank-transfer
- Flutterwave bank account transfers: https://developer.flutterwave.com/docs/bank-transfer
- Mono docs, optional open banking: https://docs.mono.co/docs

Provider docs change. Recheck these pages before implementation and again before production launch.

## Recommended Launch Provider Order

1. Paystack for first NGN virtual accounts and payouts, if merchant eligibility is approved.
2. Flutterwave as fallback or expansion provider for supported countries/currencies.
3. Mono or Okra later only if TRUSTPAY needs external bank data, account statements, identity enrichment, or open-banking payments.

## Paystack Readiness

| Area | Requirement | Decision |
|---|---|---|
| Business eligibility | Registered business in Nigeria or Ghana and completed go-live. | Block live launch until approved. |
| DVA compliance | Nigerian financial-services businesses may need customer identity validation before DVA generation. | Treat TRUSTPAY as requiring KYC/identity validation. |
| Sandbox testing | Use test secret key and `test-bank` for Nigeria DVA tests. | Sandbox-only until go-live approval. |
| Required customer fields | Email, first name, last name, phone; identity/bank details where validation is required. | Backend must not provision DVA until required KYC fields exist. |
| Deposit webhook | Listen for `charge.success` and validate receiver account, amount, currency, reference, and sender details. | Required before crediting wallet. |
| DVA lifecycle webhook | Handle `customeridentification.*` and `dedicatedaccount.assign.*` events. | Required for admin status visibility. |
| Transfer webhook | Handle `transfer.success`, `transfer.failed`, and `transfer.reversed`. | Required before withdrawals are production-ready. |
| Account name | Usually follows product/customer naming pattern; bank name is provider/partner bank. | Do not display or promise "TrustPay Bank". |
| Requery | DVA requery can trigger webhook for delayed bank transfers. | Admin/support action only. |

Open Paystack questions before build:

- Confirm TRUSTPAY business category and whether Paystack classifies it under financial services for identity validation.
- Confirm live DVA provider banks, naming behavior, and account limit.
- Confirm transfer OTP/approval configuration, transfer limits, settlement balance requirements, and whether additional payout approval is needed.

## Flutterwave Readiness

| Area | Requirement | Decision |
|---|---|---|
| Merchant setup | Dashboard API keys and bank transfer feature access. | Confirm in sandbox first. |
| Supported currencies | PWBT docs currently show NGN and GHS support. | Validate exact merchant/country availability before build. |
| Customer fields | Static virtual accounts require customer name and email; NGN virtual accounts require BVN or NIN. | KYC must collect required identity fields before static account provisioning. |
| Deposit webhook | Flutterwave sends `charge.completed` when a transfer to a virtual account completes. | Verify webhook and then verify transaction before wallet credit. |
| Transfer prerequisites | Payout docs require sufficient Flutterwave balance and may require IP whitelist. | Add DevOps checklist before sandbox transfer tests. |
| Transfer completion | Bank transfer completion/failure is sent to configured webhook URL. | Must be separated from deposit webhook processing. |
| Idempotency | Flutterwave examples use `X-Idempotency-Key` for customer/account creation. | Backend provider client must send unique keys. |
| Account display | Account bank name is provider-issued. | Do not display or promise "TrustPay Bank". |

Open Flutterwave questions before build:

- Select the exact Flutterwave API generation/version before implementation.
- Confirm webhook signature header and HMAC scheme for that selected API version. Current repo code references `flw-signature`, while newer docs may use `flutterwave-signature`.
- Confirm whether static virtual accounts for TRUSTPAY wallet funding require BVN, NIN, or additional identity fields.
- Confirm transfer webhook event names and final status values for the selected API version.

## Mono/Okra Optional Readiness

Do not add open banking in Phase 1 implementation unless product scope changes.

Use later for:

- External account statements.
- External account balance reads.
- Identity enrichment.
- Risk scoring.
- Account-to-account bank payment initiation.

## Provider Blockers

- No live provider credentials.
- No completed provider go-live approval.
- No confirmed KYC requirements for financial-services category.
- No webhook URL and signature verification plan.
- No provider event idempotency plan.
- No admin support path for delayed deposits or pending withdrawals.
- No legal/compliance approval for user-facing bank account wording.
- No selected Flutterwave API version and webhook signature scheme.

## Sandbox Go Criteria

- Sandbox credentials exist only in non-production environment.
- Webhook URLs are configured to a sandbox backend.
- Provider events can be stored before processing.
- All provider money events have normalized local statuses.
- Admin can inspect provider events and account provisioning status.
