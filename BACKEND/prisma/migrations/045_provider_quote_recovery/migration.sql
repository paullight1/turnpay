-- Serializably closing an unused expired quote prevents an in-flight retry from consuming it later.
ALTER TABLE "provider_exchange_quotes" ADD COLUMN "cancelledAt" TIMESTAMP(3);
