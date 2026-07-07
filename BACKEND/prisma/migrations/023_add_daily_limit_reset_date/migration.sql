-- Adds a dedicated daily-reset marker so the daily withdrawal limit resets on a
-- UTC-day boundary, independent of the monthly reset tracked by "limitResetDate".
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dailyLimitResetDate" TIMESTAMP(3);
