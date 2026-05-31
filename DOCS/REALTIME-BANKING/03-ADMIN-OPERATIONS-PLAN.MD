# Admin Operations Plan

## Objective

Give admins enough visibility and control to confirm, review, retry, reverse, and reconcile banking activity without unsafe direct database edits.

## Admin Navigation

Add these admin sections later:

- Banking Overview
- Virtual Accounts
- Deposits
- Withdrawals
- Internal Transfers
- Beneficiaries
- Provider Events
- Reconciliation
- Risk Review
- Audit Logs
- Settings and Limits

## Confirmation Panels

Sensitive admin actions require a confirmation panel with:

- Action summary.
- Transaction or user reference.
- Current status and target status.
- Amount and currency when money is involved.
- Provider reference and latest provider status.
- Required reason field.
- Optional second-admin approval for high-risk actions.
- Clear warning when an action is irreversible.

Actions requiring confirmation:

- Retry provider verification.
- Retry failed webhook processing.
- Reverse a failed withdrawal.
- Release a held transaction.
- Mark a provider event ignored.
- Suspend or unsuspend a user.
- Change user KYC status.
- Change user transaction limits.
- Perform manual wallet adjustment, if this feature is ever added.

## Admin APIs Needed Later

- `GET /admin/banking/overview`
- `GET /admin/banking/virtual-accounts`
- `GET /admin/banking/provider-events`
- `GET /admin/banking/reconciliation`
- `POST /admin/banking/reconciliation/run`
- `POST /admin/banking/transfers/:reference/verify`
- `POST /admin/banking/transfers/:reference/hold`
- `POST /admin/banking/transfers/:reference/release`
- `POST /admin/banking/transfers/:reference/reverse`
- `GET /admin/audit-logs`

All mutation endpoints require `Idempotency-Key`, `JwtAuthGuard`, `RolesGuard`, `ADMIN`, DTO validation, and audit logs.

## Admin Tables

Virtual Accounts:

- User email/phone.
- Account number masked.
- Account name.
- Bank name.
- Provider.
- Currency.
- Status.
- Last provider sync.

Deposits:

- Reference.
- User.
- Amount/currency.
- Provider event id.
- Wallet credit status.
- Match result.
- Webhook timestamp.

Withdrawals:

- Reference.
- User.
- Amount/currency.
- Destination bank and masked account.
- Provider status.
- Local status.
- Reversal status.
- Risk status.

Provider Events:

- Provider.
- Event type.
- Provider reference.
- Processing status.
- Error message.
- Payload hash.
- Received timestamp.

Reconciliation:

- Mismatch type.
- Local reference.
- Provider reference.
- Amount/currency.
- Recommended action.
- Owner.
- SLA age.

## Operational Guardrails

- Admins should not edit `Transaction.status` directly.
- Admin operations should call specific service methods that enforce state transitions.
- Store `adminId`, reason, before/after status, target reference, and metadata in audit logs.
- Do not expose full account numbers in tables or logs.
- All reversal actions must be exactly-once.

