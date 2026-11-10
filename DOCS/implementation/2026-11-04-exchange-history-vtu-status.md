# Exchange history, review reminders and VTU status

The user adds: keep Exchange available for new requests, move exchange progress into the main History tab, let customers reopen pending orders and remind admins, allow multiple accepted exchanges concurrently, and refactor VTU order status UI.

Work is split into independent areas: root owns Flutter exchange history/reminders, backend agent owns the guarded reminder endpoint, and VTU agent owns only the VTU order screen/widget/tests.

- [x] Show exchange history in the main History tab with loading/empty/error states and clear pending status/actions.
- [x] Retain fresh exchange entry while other accepted orders wait for review. Only an unresolved original create intent retains its retry protection.
- [x] Add customer-triggered admin reminder notifications with idempotency, ownership checks, transaction/version protection, audit events and a ten-minute per-order cooldown; no financial status changes.
- [x] Gate reminder UI on additive server capability fields; old hosted deployments must never show a false successful reminder.
- [x] Refactor VTU outcome display with conservative order/transaction reconciliation, status checks, support and collapsed technical details.
- [x] Run focused backend tests, Flutter behavior/layout checks and final analysis/full suite. Do not send a real reminder, requery a genuine purchase, initiate payments or deploy.

## Implementation and verification

Exchange history is consolidated in the main History tab, above ordinary transactions, with independent loading, empty and retry states for manual and provider orders. Pending rows open the original order; proof/review/payout states have distinct actions. The Exchange tab remains focused on starting a new exchange, and every accepted provider order offers “Start another exchange” even while admin review is pending. Only an ambiguous create request with no confirmed order retains its original idempotency key and recovery gate.

`POST /api/exchange/manual-orders/:id/remind` accepts the closed `{ reason: "REVIEW" }` DTO. JWT, UUID validation, owner lookup, proof/state eligibility, rate limiting and an idempotency key are mandatory. A version-checked Prisma transaction records one REVIEW_REMINDER event and one ADMIN payment notification without changing money or payout state. Same-key replays return the original timestamps, even after a state change. The ten-minute per-order cooldown includes the original proof alert. Additive order capability/cooldown fields keep older hosted deployments from offering an unsupported action. Flutter accepts both the shared exception filter's `message.nextAllowedAt` envelope and compatible unwrapped cooldown responses.

Reminder attempts have a separate account-scoped durable key. Lost responses retain it across restarts; confirmed success or definitive cooldown resolves only that reminder attempt. No receipt bytes, PINs or credentials are stored in progress metadata. Receipt retry/reconciliation stays on the original order and never initiates another transfer.

VTU details now show a clear status/amount/recipient hero, compact payment summary, collapsed copyable references, rectangular check/retry and activity/support actions. Both tracked statuses must agree on a final outcome; pending, unknown and conflicting values remain unresolved. Busy actions are disabled, and a failed refresh retains the last known order. Product copy does not suggest another purchase while unresolved.

Verification: the complete Flutter suite passed **603 tests**; `flutter analyze --no-pub` reported no issues. Targeted retry tests reproduced and verified lost reminder responses, wrapped server cooldowns, capability gating, duplicate-tap protection, multiple accepted exchanges and retained VTU details after errors. History layouts passed at 430px light/dark and 320px with 1.6 text; VTU passed at 320px with 2x text in light/dark. History fixture images are in `output/exchange-history-ui/`; preceding receipt-flow fixture images are in `output/v1-exchange-ui/`. Fixtures are synthetic, not live payment evidence.

Backend focused Jest tests passed **29**, TypeScript typecheck and Nest build passed. No schema/migration change is needed for reminders. No live reminder, proof upload, provider requery, payment, balance edit or deployment was submitted during this UI work. The hosted API's last observed manual policy is still version 1 with GHS wallet settlement, so new cedi-to-naira wallet fallback stays disabled until the existing direct-bank policy is released. Reminder UI stays hidden until the hosted backend advertises support.

Independent review found an exhausted-VTU-requery flag that the mobile model had dropped, and a configuration-error path that hid otherwise available exchange history. Both were reproduced with failing regressions and fixed. The VTU model retains `actionRequired`/`customerAction`; unresolved flagged orders show “Support review needed,” use Contact support as the primary action, and offer a read-only details refresh instead of a provider requery. The screen also guards its requery handler. Exchange history now renders independently in the main History tab even when new-exchange configuration is unavailable. The final complete suite and clean analysis include both fixes.

Final live browser inspection confirmed that Exchange contains only the direction choices while the main History tab contains Exchange history above transactions and explains that another exchange can be started during review. The existing unresolved airtime order’s “Support review needed” state remains available with Contact support and read-only Refresh details. Material icons and artwork rendered after restarting the dev server following test asset generation. The preview remains available at `http://127.0.0.1:8080/#/home`; local API forwarding targets the configured hosted backend.
