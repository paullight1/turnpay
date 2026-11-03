# Admin FX round-trip safety implementation plan

> For agentic workers: use superpowers:executing-plans for inline execution and a fresh-context final review.

**Goal:** Prevent immediately profitable NGN/GHS round trips while retaining independent administrator prices and units.

**Architecture:** Normalize the two saved administrator inputs and markups with Decimal arithmetic. Reject a pair whose effective-rate product exceeds one. Serialize both directions of admin writes using one transaction advisory lock; validate, save and audit together. Check saved pairs again for new executable quotes. Display blocked pricing to administrators so they can repair it, while customer previews contain no executable rate. Round all newly quoted receive amounts down. Preserve completed/accepted financial history, idempotent replays and existing authorization. No automatic commercial price is chosen.

**Tech stack:** NestJS/Prisma/PostgreSQL, Next.js/TanStack Query, Flutter.

**Ruling:** The user explicitly requested the identified fix while keeping dashboard control; implement the safety invariant without choosing a replacement business price. Existing conflicting prices remain stored but cannot create new executable quotes.

- [x] Write failing regressions for crossed persisted pairs, invalid admin edits, correction, markup/equality boundaries and cent rounding.
- [x] Implement Decimal pair checks, display metadata and transaction serialization in RateService; preserve the existing approval path.
- [x] Return safe unavailable customer previews with repair metadata for admin editors; explain paired-price conflict and prevent unsafe draft saves.
- [x] Test concurrent opposite-direction updates against disposable PostgreSQL. Verify no production price/history mutation.
- [x] Run scoped backend, browser and Flutter checks plus an isolated release build; independent final review.
- [ ] Commit/push only owned changes, deploy to Dokploy, and verify authenticated reads block the currently crossed pair without real financial actions.

**Risk boundary:** This prevents conflicting simultaneous configured prices and rounding-created gains; it does not prohibit legitimate currency gains after later market/admin price movements. Existing accepted orders retain frozen terms and normal settlement review.

**Review ruling:** A live-pair check alone is insufficient for old quotes. First execution must lock pricing inside the money transaction and reject a frozen price above the current own-direction payout. Use shared transaction advisory locks for execution, exclusive for administrator writes, and row locks to detect stale Serializable snapshots. Never fetch a rate API while holding the money transaction.
