# Production Guide: Admin Ops

## Scope

Use this guide for admin readiness across banking, payments, virtual accounts, withdrawals, reconciliation, user support, and launch control. Production operations require real admin identities, role assignment, audit retention, support policy, and provider dashboard access.

## Required Env Vars

```env
ADMIN_URL=
ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL=
SENTRY_DSN=
LOG_LEVEL=info
BANKING_ENABLED=false
VIRTUAL_ACCOUNTS_ENABLED=false
WITHDRAWALS_ENABLED=false
```

## Sandbox Steps

1. Create admin users for operations, support, finance, compliance, and engineering with least-privilege roles.
2. Verify admin routes require authentication and role guards.
3. Review pending withdrawal, failed webhook, unmatched deposit, failed VTU, and reconciliation mismatch cases.
4. Confirm every admin action writes an audit log.
5. Confirm exported views mask account numbers, tokens, OTPs, BVN, NIN, and provider secrets.
6. Run incident drills for duplicate funding, stuck withdrawal, provider outage, suspicious transfer, and reconciliation mismatch.

## Live Steps

1. Approve named production admins and require MFA where supported.
2. Restrict provider dashboard access to named finance/engineering owners.
3. Configure alert channels and on-call ownership.
4. Publish support macros that never ask users for OTPs, passwords, full account numbers, BVN, NIN, card secrets, or tokens.
5. Keep live feature flags off until support, finance, and compliance sign off.
6. Review the first live transaction of each type in the admin panel and provider dashboard.

## Verification Checklist

- [ ] Admin endpoints require auth and role authorization.
- [ ] Admin actions are audit logged with actor, action, timestamp, target, and before/after status where relevant.
- [ ] Support users cannot trigger money movement without approved role.
- [ ] Sensitive data is masked in tables, logs, exports, and screenshots.
- [ ] Manual review queues have owners and SLAs.
- [ ] Provider dashboard access is separate from application admin access.
- [ ] Incident escalation path includes engineering, finance, compliance, and support contacts.

## Launch Blockers

- Shared admin accounts.
- No audit trail for admin money movement or status changes.
- Support process asks users for secrets or full sensitive identifiers.
- No owner for pending/review queues.
- Feature flags can be enabled without go/no-go approval.
