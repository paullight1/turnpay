# VTU / VTpass Implementation Tasks

Date: 2026-05-21

## Provider Decision

Use VTpass as the first live VTU provider for TRUSTPAY Nigeria services. Reloadly remains a later adapter for international airtime, international data, digital gift cards, and global rewards because its strongest fit is global coverage rather than Nigeria bill-payment depth.

## Current Backend Slice

The backend now supports `VTU_PROVIDER=vtpass` in the existing VTU provider adapter.

Implemented first:

- Local/international airtime scope on `POST /vtu/purchase`.
- Web airtime toggle: Local uses VTpass, International uses Reloadly fields.
- Mobile airtime toggle: Local uses VTpass, International posts Reloadly fields.
- Country-aware web VTU flow: Nigeria and Ghana are live markets; Kenya, South Africa, US, and UK are visible as coming soon.
- Ghana airtime/data route through Reloadly; Ghana electricity/cable are intentionally coming soon until a Ghana bill-pay provider is integrated.
- Mobile data flow can route Ghana data through Reloadly fields.
- Reloadly provider skeleton with OAuth token caching, country operator loading, and top-up submission.
- `VtuOrder` persistence for provider request IDs, provider transaction IDs, status, requery attempts, and safe receipt metadata.
- Scheduled VTU requery worker for stale pending/unknown orders.
- User-facing VTU order status and manual requery endpoints.
- Web purchase UX now treats pending VTU responses as submitted/pending instead of successful.
- Web pending-order card lets users inspect the recent VTU order and manually trigger a safe status requery.
- Reloadly status tracking stores the Reloadly numeric top-up transaction ID as the provider reference for `/topups/{transactionId}/status`.
- Reloadly operator auto-detect endpoint is exposed at `GET /vtu/operators/auto-detect`.
- VTpass provider/service mapping for airtime, data, cable, and electricity.
- VTpass GET auth headers for service variations: `api-key` and `public-key`.
- VTpass POST auth headers for purchases: `api-key` and `secret-key`.
- VTpass `/pay` purchase payloads for airtime and data, with initial cable/electricity payload mapping.
- VTpass request ID generation with Africa/Lagos timestamp prefix.
- VTpass status normalization into TRUSTPAY `success`, `pending`, and `failed`.
- Pending provider responses now keep TRUSTPAY transactions pending instead of reversing prematurely.
- 9mobile and additional electricity providers added to VTU DTO allowlists.

## Required Environment Variables

```env
VTU_PROVIDER=vtpass
VTPASS_BASE_URL=https://sandbox.vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
RELOADLY_ENABLED=false
RELOADLY_AUTH_URL=https://auth.reloadly.com/oauth/token
RELOADLY_TOPUPS_BASE_URL=https://topups-sandbox.reloadly.com
RELOADLY_AUDIENCE=https://topups-sandbox.reloadly.com
RELOADLY_CLIENT_ID=
RELOADLY_CLIENT_SECRET=
RELOADLY_SENDER_COUNTRY_CODE=NG
```

Production should use:

```env
VTPASS_BASE_URL=https://vtpass.com/api
```

Never expose these values to web or mobile clients.

## Execution Plan

### Phase 1: Sandbox Airtime

- [ ] Create VTpass sandbox account.
- [ ] Configure sandbox API keys in backend environment.
- [ ] Confirm `GET /vtu/providers?type=airtime` returns MTN, Airtel, Glo, and 9mobile.
- [ ] Run one successful sandbox MTN airtime purchase using VTpass test number `08011111111`.
- [ ] Run one pending sandbox purchase using VTpass test number `201000000000`.
- [ ] Run one timeout/unknown sandbox purchase using VTpass test number `300000000000`.
- [ ] Confirm idempotency returns the original response when the same `Idempotency-Key` is reused with the same body.
- [ ] Confirm wallet debit happens once and no reversal occurs while provider status is pending or unknown.

### Phase 2: Sandbox Data

- [ ] Confirm `GET /vtu/packages?provider=mtn` loads VTpass variation codes.
- [ ] Ensure the frontend/mobile amount is always package-derived from backend package price.
- [ ] Test successful data purchase with a VTpass sandbox success number.
- [ ] Test package price mismatch rejection.
- [ ] Test pending and timeout data responses.

### Phase 2B: International Airtime With Reloadly

- [x] Add backend `scope` field for local/international airtime routing.
- [x] Add Reloadly OAuth token retrieval and Redis caching.
- [x] Add Reloadly operator listing by country.
- [x] Add Reloadly top-up submission path.
- [x] Add web Local/International airtime toggle.
- [x] Add mobile Local/International airtime toggle.
- [x] Add Ghana airtime/data routing through Reloadly.
- [x] Add country-aware web market selector with coming-soon markets.
- [x] Add Reloadly top-up requery/status lookup.
- [x] Replace mobile hardcoded Reloadly operator selector with API-backed country/operator loading.
- [x] Add Reloadly operator auto-detection by phone number.
- [ ] Add country search and full country list in web/mobile.
- [ ] Add Reloadly webhook endpoint and idempotent processing.
- [ ] Add Reloadly live low-value smoke tests for two countries.

### Phase 2C: Ghana Bills

- [ ] Select Ghana bill-pay provider for ECG/NEDCo and any supported utility billers.
- [ ] Verify API support for customer lookup, prepaid/postpaid meter validation, token delivery, reversal, and reconciliation.
- [ ] Add provider adapter separate from Reloadly because Reloadly is for airtime/data top-ups, not Ghana electricity bills.
- [ ] Add Ghana electricity DTO fields after provider selection.
- [ ] Enable Ghana electricity only after sandbox/live low-value token tests.

### Phase 3: Requery Worker

- [x] Add `VtuOrder` table or equivalent provider-order persistence.
- [x] Store `providerRequestId`, `providerTransactionId`, `provider`, `serviceType`, target masked value, and raw status.
- [x] Add `VtuRequeryService` scheduled job for pending/unknown VTU transactions.
- [x] Call VTpass `/requery` by `request_id`.
- [x] Add Reloadly top-up status requery by provider transaction ID.
- [x] Mark delivered transactions `SUCCESS`.
- [x] Reverse failed/refunded transactions exactly once via `LedgerService`.
- [x] Stop automated requery after a configured max attempt threshold.
- [x] Add user-facing web pending-order status/requery UX.
- [ ] Add admin stale-order escalation queue after max requery attempts.

### Phase 3B: Mobile VTU Parity

- [x] Add mobile VTU API/service layer for providers, packages, order status, and manual requery.
- [x] Replace hardcoded Reloadly operator IDs with `GET /api/vtu/providers?scope=international&type=airtime|data&countryCode=GH`.
- [x] Add local data package loading from `GET /api/vtu/packages?provider=...` and send backend-owned `packageId`.
- [x] Normalize mobile airtime/data around one local/international country/operator model.
- [x] Disable Ghana electricity/cable in mobile with coming-soon copy until a Ghana bill-pay adapter is selected.
- [x] Add mobile post-purchase pending status panel and manual "Check status" action.
- [x] Add tap-through from mobile transaction history to `GET /api/vtu/orders/:reference` for VTU transactions.
- [x] Include VTU in mobile KYC/money-action gating copy before PIN confirmation.

### Phase 4: Webhooks

- [ ] Add VTpass callback endpoint outside `JwtAuthGuard`.
- [ ] Validate provider callback authenticity according to final VTpass dashboard configuration.
- [ ] Store every callback in `ProviderEvent` or a VTU-specific provider event table before processing.
- [ ] Process callbacks idempotently by provider, event type, and provider/request reference.
- [ ] Do not trust top-level response code only; inspect inner transaction status.

### Phase 5: Cable And Electricity

- [ ] Add DTO fields required by VTpass for electricity, especially meter type where required.
- [ ] Replace generic validation routes with VTpass customer verification endpoints.
- [ ] Require customer verification before electricity and cable purchase.
- [ ] Store verified customer name/status in masked transaction metadata.
- [ ] Test each supported DISCO and cable provider separately before enabling it in production.

### Phase 6: Admin And Reconciliation

- [ ] Add admin filters for `PENDING` VTU transactions older than 10 minutes.
- [ ] Show provider request ID and provider transaction ID to support staff.
- [ ] Add manual requery action for admins with audit logging.
- [ ] Add daily reconciliation report: TRUSTPAY ledger debit, VTpass provider charge, commission, refunds, unresolved pending count.
- [ ] Alert on provider error-rate spikes, high pending count, and low VTpass wallet balance.

### Phase 7: Reloadly Adapter Later

- [ ] Add `ReloadlyProvider` only after VTpass Nigeria flow is stable.
- [ ] Use Reloadly for global airtime/data, diaspora use cases, gift cards, and rewards.
- [ ] Keep routing explicit: local Nigeria bill payment uses VTpass; international top-up uses Reloadly.
- [ ] Never retry a purchase through another provider unless the first provider is confirmed failed.

## Profit Model

### Revenue Streams

1. Airtime margin: provider discount/commission plus any TRUSTPAY service fee.
2. Data margin: markup above provider package cost.
3. Cable/electricity fee: fixed convenience fee or small percentage.
4. FX revenue: margin on GHS to NGN conversion before VTU purchase.
5. Retention value: VTU increases wallet usage frequency and keeps balances inside TRUSTPAY.

### Recommended Pricing Rules

- Airtime: keep user price close to face value. Profit mostly from provider commission. Avoid high user fees because users compare airtime prices easily.
- Data: use package-level margin, for example provider cost plus 2% to 8%, depending on market price.
- Electricity: use a transparent flat fee, for example NGN 50 to NGN 150, because bill amount can be high.
- Cable: use a small flat fee or 1% to 2% margin if provider discount allows.
- FX-to-VTU: show a quote with FX markup included, then let users buy VTU from NGN wallet.

### Example Unit Economics

If TRUSTPAY sells NGN 1,000 airtime and provider cost after commission is NGN 970:

- User pays: NGN 1,000
- Provider cost: NGN 970
- Gross profit: NGN 30
- Gross margin: 3%

If TRUSTPAY sells a data bundle for NGN 1,100 and provider package cost is NGN 1,000:

- User pays: NGN 1,100
- Provider cost: NGN 1,000
- Gross profit: NGN 100
- Gross margin: 9.09%

### Controls For Profit Protection

- Refresh VTpass packages regularly; stale package prices can create losses.
- Server must own final package amount; clients must not submit trusted package prices.
- Disable providers/packages with high failure or refund rates.
- Set daily VTU limits by KYC tier and account risk.
- Track margin per provider, service type, and package.
- Reconcile provider wallet balance daily.

## Launch Criteria

- [ ] Sandbox airtime and data complete.
- [ ] Pending/timeout behavior verified.
- [ ] Requery worker implemented.
- [ ] Exactly-once refund verified.
- [ ] VTpass wallet top-up and low-balance alert process documented.
- [ ] Admin support can requery and inspect provider references.
- [ ] Live low-value airtime smoke test completed.
- [ ] Data enabled after separate live smoke test.
- [ ] Cable/electricity enabled only after verification and refund paths are proven.
