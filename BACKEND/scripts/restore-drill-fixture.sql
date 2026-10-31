-- Synthetic, deterministic evidence for the CI restore drill only.
-- This file must never be run against staging or production.
BEGIN;

INSERT INTO users (id, email, phone, password, "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000901',
  'restore-drill-user@synthetic.invalid',
  '+2348000000901',
  'restore-drill-placeholder',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallets (id, "userId", currency, balance, "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  'NGN',
  1234.56,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (
  id,
  "userId",
  "walletId",
  type,
  amount,
  currency,
  status,
  reference,
  "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000903',
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  'FUND',
  1234.56,
  'NGN',
  'SUCCESS',
  'RESTORE-DRILL-FUND-0903',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (
  id,
  "transactionId",
  "walletId",
  direction,
  amount,
  currency,
  "balanceBefore",
  "balanceAfter",
  reference,
  source
)
VALUES (
  '00000000-0000-4000-8000-000000000904',
  '00000000-0000-4000-8000-000000000903',
  '00000000-0000-4000-8000-000000000902',
  'CREDIT',
  1234.56,
  'NGN',
  0,
  1234.56,
  'RESTORE-DRILL-FUND-0903',
  'RESTORE_DRILL'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_logs (id, action, "targetType", "targetId", reason)
VALUES (
  '00000000-0000-4000-8000-000000000905',
  'RESTORE_DRILL_FIXTURE',
  'Transaction',
  '00000000-0000-4000-8000-000000000903',
  'synthetic CI evidence'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO provider_events (
  id,
  provider,
  "eventType",
  "providerReference",
  payload,
  "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000906',
  'MONNIFY',
  'RESTORE_DRILL',
  'RESTORE-DRILL-PROVIDER-0906',
  '{"synthetic":true}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_webhook_inbox (
  id,
  provider,
  "eventType",
  "providerReference",
  payload,
  "payloadHash",
  "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000907',
  'MONNIFY',
  'RESTORE_DRILL',
  'RESTORE-DRILL-WEBHOOK-0907',
  '{"synthetic":true}'::jsonb,
  'restore-drill-payload-hash-0907',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO vtu_orders (
  id,
  "transactionId",
  provider,
  scope,
  "serviceType",
  "providerRequestId",
  status,
  amount,
  currency,
  "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000908',
  '00000000-0000-4000-8000-000000000903',
  'VTPASS',
  'LOCAL',
  'AIRTIME',
  'RESTORE-DRILL-VTPASS-0908',
  'SUCCESS',
  1234.56,
  'NGN',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
