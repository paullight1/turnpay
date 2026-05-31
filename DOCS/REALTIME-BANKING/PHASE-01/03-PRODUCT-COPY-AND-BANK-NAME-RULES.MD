# Phase 01 Product Copy And Bank Name Rules

## Core Rule

Do not call TRUSTPAY a bank, and do not show "TrustPay Bank" as the issuing bank unless a licensed bank or Banking-as-a-Service partner contract explicitly permits that display.

## Safe Terms

Use:

- TRUSTPAY wallet
- Wallet balance
- Virtual account
- Account for bank transfers
- Provider-backed account
- Partner bank
- Bank name
- Account name
- Deposit account details

Avoid:

- TrustPay Bank
- Your TrustPay bank account
- Open a bank account with TRUSTPAY
- Bank-grade account, unless legally approved
- Deposit insurance language, unless legally verified
- Guaranteed instant bank credit

## User-Facing Copy Patterns

Virtual account display:

```text
Use these account details to fund your TRUSTPAY wallet by bank transfer.
Bank name: {providerBankName}
Account name: {accountName}
Account number: {accountNumber}
```

Provider disclosure:

```text
This virtual account is issued through our payment provider and partner bank. Transfers to this account fund your TRUSTPAY wallet after confirmation.
```

Pending deposit:

```text
We are waiting for confirmation from the payment provider. Most bank transfers are confirmed within a few minutes.
```

Withdrawal pending:

```text
Your withdrawal has been submitted and is being processed by our payment provider. We will update the status when the bank confirms the result.
```

Failed withdrawal:

```text
The withdrawal could not be completed. If your wallet was debited, the amount will be reversed once the failed transfer is confirmed.
```

Admin/support explanation:

```text
The bank name shown belongs to the provider or partner bank that issued the virtual account. TRUSTPAY is the wallet platform, not the issuing bank.
```

## Required UI Labels

| UI Area | Required Label |
|---|---|
| User account details | `Bank name`, `Account name`, `Account number` |
| Deposit CTA | `Fund wallet by bank transfer` |
| Transaction history | `Wallet funding`, `Internal transfer`, `Withdrawal` |
| Pending provider state | `Pending provider confirmation` |
| Admin provider event | `Provider event`, `Provider reference`, `Processing status` |

## Copy Review Checklist

- No "TrustPay Bank" claim.
- No promise that virtual account is a full bank account.
- No promise of instant external bank settlement.
- Account number and account name are shown only where needed.
- Provider/partner bank naming is preserved exactly as provider returns it.
- Failed and pending states are explained without blaming user or provider.

