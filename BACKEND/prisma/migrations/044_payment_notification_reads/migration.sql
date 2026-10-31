CREATE TABLE "payment_notification_reads" (
  "notificationId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_notification_reads_pkey" PRIMARY KEY ("notificationId", "adminId"),
  CONSTRAINT "payment_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "payment_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_notification_reads_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payment_notification_reads_adminId_idx" ON "payment_notification_reads"("adminId");
