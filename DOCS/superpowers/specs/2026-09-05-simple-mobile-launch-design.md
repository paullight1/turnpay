# Simple manual-exchange mobile launch design

**Approved scope:** On 5 September 2026 the user clarified that Exchange is the main feature: show a receiving account, accept a transfer receipt, show awaiting confirmation and allow admin-controlled status changes. The user selected bank/MoMo payout and subsequently added automatic wallet credit after admin approval as another settlement option. This supersedes the earlier decision to exclude Exchange. Initial corridor assumption: NGN deposit → GHS bank/MoMo payout, matching the existing backend corridor; additional directions require their own receiving-account and settlement configuration.

**Goal:** Deliver a small, dependable mobile product with evidence for every enabled financial flow. Aim for 95+/100 on a fresh assessment of this limited scope and complete every mandatory launch gate. A score never overrides an unresolved critical/high finding.

**Included and first priority:** manual Exchange, account access/KYC, protected receipt upload, admin deposit verification followed by automatic wallet credit or manual bank/MoMo payout, persistent status/history/receipts, and support. Existing wallet, internal transfer, bank withdrawal and Nigeria VTU services are secondary: keep them only when certified, and do not let optional features delay the core exchange release.

**Deferred:** fully unattended deposit approval and automatic external exchange settlement, additional currency corridors, native push, realtime infrastructure, new rewards systems and broad UI/architecture rewrites. Ghana bank/MoMo payout for the initial corridor is in scope. Existing balances/history must remain accessible to their owners; scope controls must not strand funds.

**Architecture:** Keep Flutter/Riverpod/Dio and the existing NestJS/Prisma/PostgreSQL/Redis backend. Reuse protected upload, admin review, status/history and audit infrastructure, extending it for one externally funded manual exchange order. Each order has one customer-confirmed settlement mode: WALLET, BANK or MOMO. Reuse the existing transactional GHS receipt-credit behavior for WALLET after admin verifies the deposit. BANK/MOMO must not also credit a wallet or debit an unfunded wallet. Add durable attempt recovery and focused financial models. Native code supplies biometric, privacy and transport/integrity controls. No new automatic payment gateway or general workflow platform is needed.

**Customer journey:** amount and settlement choice (TrustPay wallet or bank/MoMo destination) → server-confirmed rate/fees/receive amount → receiving bank, account name/number and unique payment reference → transfer externally → upload receipt and submit → Awaiting confirmation → for WALLET, admin approval atomically credits the destination-currency wallet and records Credited; for BANK/MOMO, Deposit confirmed / Payout pending → Payout sent → Completed only when settlement evidence supports completion. Customer can reopen the same order after restart and see admin notes. Start with refresh-on-open/resume, pull-to-refresh and short polling while the order screen is visible.

**Admin journey:** open pending order and protected proof → compare actual bank/Monnify inflow, amount and reference → confirm deposit or request information/reject with a reason → for WALLET, approve-and-credit the exact quoted amount transactionally; for BANK/MOMO, claim payout for one operator → pay the recorded bank/MoMo destination externally → record payout reference and protected proof → mark sent/completed only with corresponding evidence. Receipt upload alone is never confirmation that money arrived. Rejection after confirmed incoming funds must leave an explicit outstanding refund/settlement obligation.

**Rate policy:** freeze source amount, destination amount, rate, fees and collection-account version on the server before showing transfer instructions. Show the instruction expiry. A late or mismatched deposit enters review; never silently reprice after the customer paid. Any revised terms need customer acceptance before payout.

**State/financial policy:** receipt submission has no spendable wallet effect. Deposit confirmation and payout completion are distinct guarded transitions. An order must have at most one incoming settlement allocation and one settlement outcome (wallet credit OR external payout), with unique provider/bank references and audit records. Duplicate webhook/review/retry cannot create another credit or payout obligation. Preserve an auditable record of funds awaiting payout/refund; Finance must reconcile actual external inflow/outflow to it.

**Global constraints:**

- Follow `DOCS/SECURITY-RULES.MD`; all protected backend routes use JWT authorization, DTO validation and ownership checks.
- Mutations retain idempotency; balance effects remain transactional and Decimal-safe. No negative balances and no client-calculated authoritative fees.
- Mobile storage contains no persisted PIN/OTP. Provider secrets stay backend-only; public build configuration is allowlisted.
- Preserve existing working-copy changes. Review incremental diffs and stage only related files.
- Do not change KYC tiers/limits to make tests pass. Map real Ninja results to the approved eligibility policy and expose required upgrade steps.
- Keep internal transfers disabled in production until the existing transfer certification register is complete.
- Local test success, sandbox success, native build success and production certification are separate evidence states.
- Keep production activation, store publishing and real-money pilot transactions behind the existing operator/release gates. Planning does not mark them approved.

**Acceptance:** Every required row in `DOCS/MOBILE-LAUNCH-CHECKLIST.md` is verified against the release candidate. Disabled capabilities cannot be reached through launch UI or deep links. Enabled flows survive network failure and process restart, reconcile without unexplained drift, and have working support/incident procedures.

**Virtual-account terminology:** In this plan, “credit the virtual account” means update the customer’s TrustPay wallet balance in the correct currency after admin approval. A Monnify virtual bank account is a collection address, not a separate bank balance that a database update can increase. If an actual bank-account transfer is intended, it uses BANK settlement. Never label GHS wallet credit as a transfer to an NGN virtual bank account.

**Settlement exclusivity:** The selected mode is frozen before deposit instructions. Admin cannot silently substitute wallet credit for a bank/MoMo destination. Before settlement, any destination/mode change requires customer confirmation and an audited update; after credit or external payout claim, no in-place mode switch is allowed. A subsequent wallet withdrawal is a new independently authorized transaction, not a second settlement of the original deposit.
