-- Notification content/read state is mediated by authenticated NestJS routes.
-- Direct Data API access must not expose broadcast or another customer's data.
ALTER TABLE "payment_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_notification_reads" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "payment_notifications", "payment_notification_reads" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "payment_notifications", "payment_notification_reads" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "payment_notifications", "payment_notification_reads" FROM authenticated;
  END IF;
END $$;
