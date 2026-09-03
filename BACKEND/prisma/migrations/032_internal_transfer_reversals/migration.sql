CREATE TYPE "InternalTransferReversalStatus" AS ENUM (
  'PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'BLOCKED'
);

CREATE TABLE "internal_transfer_reversals" (
    "id" TEXT NOT NULL,
    "originalAttemptId" TEXT NOT NULL,
    "originalTransferReference" TEXT NOT NULL,
    "originalSenderTransactionId" TEXT NOT NULL,
    "originalRecipientTransactionId" TEXT NOT NULL,
    "reversalReference" TEXT,
    "reversalSenderTransactionId" TEXT,
    "reversalRecipientTransactionId" TEXT,
    "status" "InternalTransferReversalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "requesterAdminId" TEXT NOT NULL,
    "approverAdminId" TEXT,
    "reviewerAdminId" TEXT,
    "requestReason" TEXT NOT NULL,
    "reviewReason" TEXT,
    "idempotencyKeyHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "requestId" VARCHAR(128),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(256),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfer_reversals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "internal_transfer_reversals_positive_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "internal_transfer_reversals_distinct_users_check" CHECK ("senderUserId" <> "recipientUserId"),
    CONSTRAINT "internal_transfer_reversals_key_hash_length_check" CHECK (length("idempotencyKeyHash") = 64),
    CONSTRAINT "internal_transfer_reversals_request_hash_length_check" CHECK (length("requestHash") = 64)
);

CREATE UNIQUE INDEX "internal_transfer_reversals_originalAttemptId_key"
ON "internal_transfer_reversals"("originalAttemptId");
CREATE UNIQUE INDEX "internal_transfer_reversals_reversalReference_key"
ON "internal_transfer_reversals"("reversalReference");
CREATE INDEX "internal_transfer_reversals_status_requestedAt_idx"
ON "internal_transfer_reversals"("status", "requestedAt");
CREATE INDEX "internal_transfer_reversals_originalTransferReference_idx"
ON "internal_transfer_reversals"("originalTransferReference");
CREATE INDEX "internal_transfer_reversals_requestId_idx"
ON "internal_transfer_reversals"("requestId");
CREATE UNIQUE INDEX "internal_transfer_reversals_requesterAdminId_idempotencyKey_key"
ON "internal_transfer_reversals"("requesterAdminId", "idempotencyKeyHash");

ALTER TABLE "internal_transfer_reversals"
ADD CONSTRAINT "internal_transfer_reversals_originalAttemptId_fkey"
FOREIGN KEY ("originalAttemptId") REFERENCES "internal_transfer_attempts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "internal_transfer_reversals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "internal_transfer_reversals" FROM anon, authenticated;
