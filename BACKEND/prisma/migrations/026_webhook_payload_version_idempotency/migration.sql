-- Providers may deliver a non-terminal status and later send a terminal status
-- with the same event type and payment reference. Treat only byte-equivalent
-- sanitized payloads as duplicate deliveries.
DROP INDEX IF EXISTS "payment_webhook_inbox_provider_event_reference_key";

CREATE UNIQUE INDEX "payment_webhook_inbox_provider_event_reference_payload_key"
ON "payment_webhook_inbox"("provider", "eventType", "providerReference", "payloadHash");
