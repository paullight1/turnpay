# V1 manual exchange and recovery UI

The user clarified that V1 pays to user-supplied bank/MoMo receiving details. Customers transfer to the order's collection account, choose a receipt, confirm that they paid and await admin review. New orders must not offer TrustPay wallet credit. Existing orders retain their recorded financial contract.

Runtime evidence: the hosted API currently advertises deliveryPolicyVersion1 and GHS:[WALLET]. Local backend source advertises version2 and GHS:[BANK]. UI must fail closed for unsupported new receiving methods rather than inventing successful support.

- [x] Remove wallet fallback from new exchanges; respect server direct-payout capability and retain legacy-order recovery.
- [x] Add an explicit Transfer / Receipt / Admin review flow, receipt confirmation and safe network-failure copy.
- [x] Persist only receipt-step/order metadata under the existing authenticated account scope. Retain receipt bytes only in memory; after restart ask the customer to select the file again.
- [x] Surface an existing active exchange before new directions; allow original-order recovery even when exchange configuration is unavailable.
- [x] Verify retry/restart/account isolation, legacy contract preservation and no premature success/credit with fake services; render light/dark/large-text views and inspect live non-mutating steps.

No live payment, proof upload, admin financial action or deployment is authorized for verification. API order/proof idempotency, server validation, JWT/PIN/KYC and audited admin settlement remain authoritative.

## Verification

The V1 phase completed with 584 passing Flutter tests, including offline recovery, provider/manual handoff, historical contract and 9 rendered transfer/receipt/review layout cases at phone light/dark and 320px large text. Flutter analysis reported no issues. The lost-response regression was observed failing before the reconciliation fix and passing after it. Existing create/proof payloads, idempotency journals and recorded legacy-order contracts were preserved. Metadata records the most recent accepted order and receipt-stage preference; on returning from the created order, the old draft clears before another new exchange.

Hosted rollout dependency: the last observed authenticated production configuration still returned deliveryPolicyVersion1 and GHS:[WALLET]. The UI therefore prevents new cedi-to-naira wallet fallback; the existing source backend's direct-account policy must be released before that direction is enabled. No live order, bank transfer, proof upload or admin payout was submitted. Rendered screenshots use synthetic fixture orders.

The subsequent history/VTU phase completed with 602 passing Flutter tests and clean analysis; see `2026-11-04-exchange-history-vtu-status.md`. Accepted pending exchanges remain independently openable while new exchanges can begin.
