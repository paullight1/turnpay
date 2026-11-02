# Durable exchange notifications — 2 November 2026

The current manual exchange flow now records real in-app notifications. This adds no email, SMS or operating-system push delivery and does not change how money is paid or approved.

| Committed event | Recipient | Meaning |
| --- | --- | --- |
| Customer attaches payment proof | Every admin, with independent read state | A payment was submitted for review; receipt of money is not yet confirmed. |
| Admin confirms an external-payout deposit | Order owner | Payment confirmed; the cedi payout is being prepared. |
| Admin credits the TrustPay wallet | Order owner, one combined update | Payment confirmed and the quoted money was added to the wallet. |
| External payout becomes completed | Order owner | Admin recorded completion of the quoted payout. |

A created request or opened transfer-instructions screen does not create a payment-submitted alert. Claiming/reassigning a payout does not claim that money has been sent. A corrected receipt after a request for more information creates a new admin alert; replaying the same proof does not.

## Delivery and retry guarantees

Notification inserts are in the same Prisma transaction as proof submission or the admin financial/state change. The existing unique `PaymentNotification.eventKey` is the persistent deduplication boundary. Payment-submission keys include the order and proof fingerprint; customer confirmation/completion keys include the order and milestone. `createMany(skipDuplicates)` plus transactional version/idempotency guards prevent repeated approvals, concurrent admins, or lost-response retries from inserting another copy.

The notification record itself is the durable in-app message. Clients poll and render records by ID; they do not send a fresh message each time they refresh. Read receipts are upserted per notification and authenticated actor and retain the original read time. A failed read leaves the card unread and retryable with the same client key.

## Inbox APIs and privacy

- Customer: `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`.
- Admin: `GET /api/admin/notifications`, `GET /api/admin/notifications/unread-count`, `POST /api/admin/notifications/:id/read`.
- The legacy provider admin notification routes remain compatible.

Customer audience is derived exclusively from the authenticated identity (`USER:<userId>`); admins receive the `ADMIN` audience through role-guarded routes. Query/body fields cannot select another user or audience. Read attempts against another audience return not found. Both idempotency header names are accepted; notification IDs are UUID-validated and routes are throttled.

Lists are bounded at 50 and prioritize unread work before recent read history. A separately scoped count covers every unread record, so an older unread alert cannot disappear behind 50 newer read entries or falsely produce a zero badge. As records are read, older unread entries become accessible in the bounded inbox.

Migration **052_private_payment_notifications** enables RLS on notification content and read receipts and revokes direct PUBLIC/anon/authenticated Data API privileges. Access goes through the authenticated NestJS API and its server database connection. Apply this migration before rollout. During implementation it was applied only to the disposable local financial test database, not the production database.

## Admin and customer surfaces

The shared admin header contains a notification bell with an unread count, foreground refresh, loading/error/retry states and persistent read state. Alerts link to the corresponding manual order, VTU oversight or provider exchange screen. Manual-order deep links reset restrictive filters and can find older requests beyond the first cursor page.

The Flutter home bell uses the server unread count. The notification page uses actual server records rather than synthetic transaction cards/local-only dismissals. It supports loading/error/retry, persisted mark-read, safe exchange-order navigation and foreground refresh. Missing endpoints are displayed as an error rather than a false empty inbox. Duplicate API copies render once.

## Verification

Backend verification passed 767 unit tests across 103 suites and 89 isolated PostgreSQL/Redis financial tests across 13 suites. The financial regressions cover repeated and concurrent proof submissions/approvals, corrected proof, cross-user access, independent read state, more than 50 records, RLS under an unprivileged role, and notification-write failure rolling back wallet credit and deposit allocation before a safe retry.

The final targeted Flutter run passed 29 notification/service/home/shell/account tests, and Flutter analysis found no issues. A fresh full Flutter run completed with 450 passing tests and three failures in the existing `kyc_review_visual_test.dart` fixtures (430-light, 320-dark-large and 726-light): the fixtures cannot find “View verification history” after the separate BVN-first KYC changes. Those unrelated fixtures were not changed in this task. An earlier full-run attempt failed from temporary disk exhaustion and is not counted as verification.

Backend production-scope TypeScript and affected ESLint checks passed. Web TypeScript and affected ESLint checks passed. All six final desktop/mobile browser regressions passed. They exercise durable read retries, list deduplication, full unread counts, filtered-order deep links, count outages, and reconciliation after a read commits but its response is lost. One initial browser rerun timed out waiting five seconds for a cold local route; its failure snapshot already showed the expected page after hydration. The readiness assertion now waits for the page before testing notification behavior. Evidence is under `.superpowers/sdd/2026-11-02-exchange-notifications/`.

No live transfer, customer payment, production notification send, production migration, commit or deployment is needed to exercise these tests. Provider/auth/storage boundaries use controlled fixtures. The money flow remains manual external collection, administrator-confirmed wallet credit for GHS→NGN, and manually executed cedi payout for NGN→GHS.
