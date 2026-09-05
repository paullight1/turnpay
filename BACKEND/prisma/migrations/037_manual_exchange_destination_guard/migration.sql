ALTER TABLE "manual_exchange_orders"
ADD CONSTRAINT "manual_exchange_destination_not_blank"
CHECK (
  "settlementMode" = 'WALLET'
  OR (
    length(btrim("destinationInstitution")) > 0
    AND length(btrim("destinationName")) > 0
    AND length(btrim("destinationAccount")) > 0
  )
);
