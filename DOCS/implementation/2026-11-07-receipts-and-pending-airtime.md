# Receipts and pending airtime — 7 November 2026

Home recent-transaction rows now open the receipt for the selected reference rather than the activity list. Activity rows also open receipts for non-VTU transactions. Existing transfer/withdrawal receipts remain accessible despite new money-out actions being disabled for V1. Receipt navigation is read-only.

VTU receipts show amount and status first, followed by service, date, provider, fees, total debit and masked recipient. Initial loading reserves receipt sections; refresh retains last-known details, displays progress and blocks duplicate requests. An order and its transaction must still agree before the UI presents a final result. The final failed/reversed message describes the existing atomic refund contract; unresolved responses never imply a refund.

Live protected reads of reference VTU-8b716c94fcf13f99a0bb36afe72966bbda392ca7 confirmed PENDING/PENDING, 50 NGN amount, zero fee, totalDebit 50, 13 requery attempts and actionRequired=true. The last recorded provider check is 4 November 2026 at 17:21:20 UTC. The protected transaction detail shows one VTU_PURCHASE debit, reducing the balance from 500 to 450 NGN; no refund credit is displayed. No financial mutation or provider requery was made during this investigation.

The earlier documented provider trace found POST requery rejected with VTpass code 027 while GET balance worked. That is historical evidence, not a fresh provider result. A request-ID fallback is not evidence of provider fulfillment. Actual Paystack/VTpass/bank cash custody has not been freshly reconciled. Live resolution still requires an authoritative outcome for the original provider request, using the existing audited recovery flow.

Existing backend reverseVtuPurchase credits amount plus fee in the same Prisma transaction as the guarded final status transition. Duplicate callbacks cannot create another credit. The service/provider suite passed 79 tests, including confirmed failure/reversal handling. No backend financial behavior was changed, no deployment was performed, and no manual balance edit or uncertain refund was issued.
