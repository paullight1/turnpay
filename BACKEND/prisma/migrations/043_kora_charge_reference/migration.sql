ALTER TABLE "kora_collection_intents" ADD COLUMN "providerReference" TEXT;
CREATE UNIQUE INDEX "kora_collection_intents_providerReference_key" ON "kora_collection_intents"("providerReference");
