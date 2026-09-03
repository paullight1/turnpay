# VTpass VTU Production Completion Design

Date: 2026-09-03
Status: Approved in chat; awaiting written-spec review

## Goal

Complete TRUSTPAY's VTU product end to end using VTpass as the only active
provider. Nigerian NGN wallet users will be able to buy airtime and data, pay
cable subscriptions, and pay prepaid or postpaid electricity bills from the
backend, website, and Flutter app. Unsupported markets remain visible only
where useful for product discovery and must be disabled with a clear
`Coming soon` label.

## Scope

The production-enabled scope is:

- Country: Nigeria (`NG`)
- Currency: NGN
- Provider: VTpass
- Products: airtime, data, cable TV, prepaid electricity, and postpaid
  electricity
- Clients: authenticated NestJS API, Next.js customer dashboard, Flutter app,
  and existing admin VTU operations

All other countries and non-VTpass routes are unavailable. Web and mobile may
display Ghana, Kenya, South Africa, the United States, and the United Kingdom
as disabled `Coming soon` options, but they must never submit unsupported
fields or call a legacy provider route. Legacy enum values and historical
records remain readable for compatibility.

## Architecture

### Backend boundaries

- `VtuController` owns authenticated routing, DTO binding, rate limits, and
  response shaping.
- `VtuService` owns customer eligibility, server-side pricing, customer
  verification, transaction lifecycle, wallet debit/refund orchestration,
  status transitions, receipts, and audit metadata.
- `VtuApiProvider` is the VTpass adapter. It owns VTpass authentication,
  service-ID mapping, variation loading, customer verification, purchase,
  requery, response normalization, timeout classification, and safe provider
  response extraction.
- `VtpassWebhookController` authenticates callbacks, validates payloads,
  durably records them, and acknowledges accepted events promptly.
- `VtuRequeryService` recovers pending or unknown orders and retries durable
  unprocessed callback records.

The implementation will harden the existing module in place. It will not
reintroduce a generic provider abstraction, Reloadly, or client-side provider
credentials.

### API contract

Read endpoints remain protected by `JwtAuthGuard`:

- `GET /api/vtu/providers?type=...`
- `GET /api/vtu/packages?provider=...&type=...`
- `GET /api/vtu/orders/:reference`

State-changing and provider-calling endpoints require rate limiting and an
`Idempotency-Key` through the global interceptor:

- `POST /api/vtu/validate/smartcard`
- `POST /api/vtu/validate/meter`
- `POST /api/vtu/purchase`
- `POST /api/vtu/orders/:reference/requery`

Validation inputs move into DTO-validated request bodies. Query compatibility
is not retained for these POST endpoints because the clients are updated in
the same release.

The purchase DTO contains only fields supported by the selected product:

- Common: `type`, `provider`, `contactPhone`, `amount`, and `transactionPin`
- Airtime: `recipientNumber`
- Data: `recipientNumber` and `packageId`
- Cable: `smartCardNumber`, `subscriptionType` (`change` or `renew`), and a
  `packageId` when changing bouquet
- Electricity: `meterNumber` and `meterType` (`prepaid` or `postpaid`)

Phone input is normalized at the TRUSTPAY boundary and converted to the form
required by VTpass inside the adapter. Data and cable-change prices are
resolved from the current VTpass variation catalogue on the server. Cable
renewal uses the verified renewal amount returned for the decoder and never
trusts a client-supplied renewal price.

## Product Flows

### Airtime

The user selects a Nigerian network, enters a recipient phone and amount,
reviews the total debit, confirms with a transaction PIN, and submits one
idempotent purchase attempt.

### Data

The user selects a network and a live VTpass variation. The client displays
the package price, while the backend reloads or reads a bounded-cache copy of
the variation and verifies the submitted amount before debit.

### Cable TV

The user selects a cable provider, enters a smart-card/IUC number and contact
phone, and verifies the customer before payment. Bouquet change loads a live
package list. Renewal uses the provider-verified renewal amount. The verified
customer details shown to the user are also checked again server-side during
purchase.

### Electricity

The user selects a DISCO and meter type, enters the meter number, contact
phone, and amount, then verifies the customer before payment. The same meter
type is used for verification and purchase. A successful prepaid purchase
returns the vend token in the owner-only order/receipt response; postpaid
payments show the provider confirmation without a token.

## Financial Lifecycle

1. Validate the DTO, transaction PIN, KYC tier, provider/product combination,
   customer target, and server-owned amount.
2. Calculate fees with Prisma `Decimal` and construct only masked metadata.
3. In one Prisma transaction, create the pending transaction and VTU order,
   conditionally debit the NGN wallet, create the ledger entry, and ensure the
   balance cannot become negative.
4. Call VTpass once using the stored request ID.
5. Map the inner VTpass transaction status before considering the top-level
   response code.
6. Mark a delivered result successful. Mark timeouts, initiated, processing,
   and unclear results pending or unknown for requery. Reverse explicit
   failures or provider reversals exactly once.
7. Persist safe reconciliation fields: TRUSTPAY reference, VTpass request ID,
   provider transaction ID, amount, fee, provider charge/commission when
   returned, normalized status, timestamps, and redacted response evidence.

All terminal transitions use guarded database writes. A late or duplicated
callback cannot turn an already successful order into a refund or credit the
wallet twice. Provider calls never occur inside a long-held database
transaction.

## Idempotency And Recovery

- Every user mutation has a client-generated UUID idempotency key that is
  reused for the same visible attempt and replaced only when the user starts a
  new attempt.
- A repeated key with an identical body returns the original response; a
  repeated key with a different body returns a conflict.
- VTpass request IDs are unique and persisted before the provider call.
- Unknown provider outcomes remain pending and are never automatically retried
  as a new purchase.
- Requery uses the original VTpass request ID.
- Scheduled recovery stops at a configured threshold and exposes stale orders
  to admins for audited manual requery.
- Unprocessed callback inbox records are retried by a scheduled worker so an
  application restart after acknowledgement cannot lose the update.

## Webhook Security

The callback endpoint remains outside `JwtAuthGuard` but fails closed unless
its configured authentication material is present. It accepts only the
documented `transaction-update` payload shape, validates bounded strings and
known statuses, records a payload hash and redacted event before processing,
and is idempotent by VTpass request ID, transaction ID, event type, status,
and payload hash.

The deployment must use the callback authentication mechanism agreed with
VTpass. If VTpass supplies an HMAC signature, TRUSTPAY verifies it against the
raw request body with a timing-safe comparison. If the account supplies only
a dashboard callback URL, the deployment must place a trusted gateway in
front of the endpoint that authenticates VTpass and injects the internal
signature header. A secret query parameter is not a production authentication
mechanism because URLs can be retained in access logs.

## Sensitive Data And Receipts

- Provider keys, transaction PINs, full phone numbers, meter numbers,
  smart-card numbers, vend tokens, and callback authentication material are
  never logged.
- Stored transaction metadata contains masked customer identifiers only.
- Raw provider bodies are reduced to an allowlisted, redacted reconciliation
  snapshot before persistence.
- Electricity tokens and equivalent purchased codes are encrypted at rest
  using the configured PII encryption key. They are decrypted only for the
  authenticated order owner and are excluded from admin list responses and
  generic logs.
- The order response exposes amount, fee, total debit, provider status,
  masked target, receipt reference, and a purchased code only when applicable.

## Configuration

Deployed environments require:

```env
VTU_ENABLED=true
VTU_PROVIDER=vtpass
VTPASS_BASE_URL=https://vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
VTPASS_WEBHOOK_SECRET=
VTPASS_LOW_BALANCE_THRESHOLD=5000
```

Production and staging fail startup validation when VTU is enabled but any
required value is missing, placeholder-like, or the base URL is not HTTPS.
Development may use the VTpass sandbox URL. Simulation is permitted only when
an explicit test/development flag is enabled; missing configuration must not
silently simulate a successful financial purchase.

## Web And Mobile UX

Both clients implement the same four Nigerian flows and API contract. They:

- load providers and variations from the backend;
- mark every non-Nigerian market as disabled with `Coming soon`;
- never send `scope`, `countryCode`, `operatorId`, or other removed legacy
  provider fields;
- require customer verification for cable and electricity before review;
- support cable change/renew and electricity prepaid/postpaid selection;
- derive package amounts from the selected backend response;
- disable duplicate submission while a request is active;
- preserve the idempotency key through retries of the same attempt;
- distinguish pending from failed and successful states;
- allow safe status refresh using a separate requery idempotency key; and
- display an electricity token prominently on a successful prepaid receipt.

The admin UI continues to show VTpass configuration health, provider balance,
low-balance warnings, stale orders, reconciliation exceptions, masked targets,
pricing rules, and audited manual requery. It never displays provider secrets
or purchased codes.

## Testing

Implementation follows TDD and adds coverage for:

- DTO validation and removal of legacy client fields;
- VTpass service IDs, GET/POST headers, payloads, phone normalization, cable
  modes, meter types, and production configuration;
- variation price enforcement and cable renewal amount enforcement;
- success, pending, timeout, malformed, failed, refunded, and reversed status
  mapping using the inner transaction status;
- duplicate idempotency keys, concurrent wallet debits, insufficient funds,
  exactly-once reversal, late/out-of-order events, and currency mismatch;
- callback authentication, malformed payloads, replay, durable retry, and
  redaction;
- encrypted electricity-token persistence and owner-only receipt access;
- web and mobile catalog, validation, review, submission, pending, receipt,
  and `Coming soon` states; and
- admin health, stale-order, reconciliation, and manual-requery behavior.

Verification includes backend unit/build/lint, focused financial integration
tests against disposable PostgreSQL, website lint/build and VTU browser tests,
Flutter analyze/tests, Prisma migration checks, and provider-contract fixtures.

After implementation, perform a fresh functionality review against this
design and `DOCS/SECURITY-RULES.MD`. The review must trace every product from
client input to VTpass payload, stored financial state, provider update,
receipt, admin visibility, and recovery path. Any critical or high-severity
finding blocks completion and must be fixed and re-tested before handoff.

## Rollout And External Dependencies

1. Deploy the schema/config changes with VTU disabled.
2. Configure VTpass sandbox keys and the authenticated callback path.
3. Seed or configure pricing rules.
4. Run documented sandbox scenarios for success, pending, timeout, malformed
   response, failure, reversal, and callback replay across all four products.
5. Reconcile each sandbox order against wallet, transaction, ledger, VTU
   order, and callback records.
6. Configure live credentials and fund the VTpass wallet.
7. Run one controlled low-value live transaction per product/mode.
8. Enable Nigerian VTU only after reconciliation and support sign-off.

Credential issuance, VTpass account approval, callback/gateway configuration,
provider-wallet funding, and real sandbox/live transactions are human-owned
external steps. The repository will include validation and runbooks for them,
but no credentials will be read, printed, generated, or committed.

## Non-Goals

- International airtime or data
- Ghana utilities or any non-Nigerian bill payment
- Reloadly or another provider fallback
- Automatic failover that could duplicate a purchase
- Client-side fee, package-price, or provider-status authority
- Activating unsupported markets behind the `Coming soon` UI

## References

- VTpass authentication: <https://vtpass.com/documentation/authentication/>
- VTpass variation codes: <https://vtpass.com/documentation/variation-codes/>
- VTpass transaction requery: <https://vtpass.com/documentation/re-query-services/>
- VTpass callback flow: <https://vtpass.com/documentation/callback-api-integration/>
- VTpass transaction-update payload: <https://vtpass.com/documentation/transaction-update-webhook-api/>
- VTpass electricity overview: <https://vtpass.com/documentation/electricity-payment-api/>
