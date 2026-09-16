# Exchange release verification — 6 September 2026

Scope: customer mobile exchange, staff exchange operations, quote execution,
manual settlement, rate handling, and shared wallet/ledger infrastructure.
External API integration and deployed-environment acceptance are separate gates.

## Fixes

- Durable, unique quote execution identity protects against retries after Redis
  loss, expired execution leases, and lost responses after database commit.
- Migration 039 backfills historical quote identities and protects older writers
  during rolling deployments. It runs atomically; duplicate historical quote IDs
  cause migration failure and must be reconciled before deployment.
- Stored quote expiry is parsed explicitly; invalid or expired timestamps are
  rejected before money moves. Quotes with a zero destination amount are rejected.
- Concurrent executions return the committed exchange after a uniqueness race.
  A second durable lookup also covers a commit between the initial database
  lookup and removal of the Redis quote.
- Provider responses are validated against the requested currency base, including
  nested and `conversion_rates` payloads. Invalid responses cannot refresh rates.
- Rate and markup precision now agree across database, cache and admin responses.
  Direct admin overrides commit their audit record before publishing cache data.
  Provider failures no longer log potentially credential-bearing error messages.
- Receipt route mocks now include the deposit-allocation and idempotency models
  used by the real service.
- Browser tests follow the current mobile-only customer policy and verify staff
  operations. Test servers use isolated configurable ports and explicit reuse.
- The rate diagnostic no longer reports unauthorized, invalid, stale, or skipped
  live checks as successful. It needs explicit test credentials or an auth token.

## Verified locally

- All 42 migrations applied to a new disposable PostgreSQL 16 database.
- 31 financial tests passed against PostgreSQL and isolated Redis, covering
  exchange, transfers, banking callbacks, VTU, rollback and outage recovery.
- 29 exchange HTTP/controller E2E tests passed.
- Final full backend unit run: 74 suites / 511 tests passed.
- Mobile exchange/amount validation: 33 tests passed in the preceding verification
  round; Flutter analysis was clean. No mobile exchange code changed afterward.
- Staff browser suite: six tests passed, including evidence protection, settlement
  actions and responsive navigation. Customer-web policy: five tests passed.
- Backend lint and production build passed. Website TypeScript and lint passed.
- Rate diagnostic regression tests and production-manifest checks passed.

The financial suites use real SQL transactions and ledger code; provider and
storage boundaries use synthetic test responses. Browser tests use mocked API
responses plus a server-side auth verifier. These results do not certify a live
provider connection or a deployed production environment.

## Repeatable checks

From `BACKEND`, set `FINANCIAL_TEST_DATABASE_URL` to a disposable database named
`trustpay_financial_test_*`, and `FINANCIAL_TEST_REDIS_URL` to an isolated Redis.
Apply migrations using that same test database as `DATABASE_URL` before testing.

```sh
npx prisma migrate deploy
npm run test:financial:e2e -- --no-cache
npx jest --no-cache --runInBand
npm run lint
npm run build
node scripts/validate-rate-endpoint.test.js
```

From `WEBSITE`, use the installed Chrome executable through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if bundled Playwright browsers are absent:

```sh
npx playwright test e2e/admin-manual-exchange.spec.ts e2e/exchange.spec.ts e2e/app-only-customers.spec.ts --project=chromium --workers=1
```

The default test ports are 33100/33101. Override `TRUSTPAY_E2E_AUTH_PORT` and
`TRUSTPAY_E2E_WEB_PORT` for another isolated run. Keep test auth bypass variables
out of production configuration.

## API and deployment acceptance still required

1. Configure and validate the intended external API with its real sandbox
   credentials and response contract. For the current FX adapter the variables
   are `FX_API_URL` and `FX_API_KEY`; the exact API remains a user choice.
2. Verify both currency directions with current provider rates, expiry and outage
   behavior. Fallback rates are display-only and must never authorize exchange.
3. Supply the dedicated collection-account configuration for each enabled manual
   direction. Reverse collection uses `MANUAL_EXCHANGE_GHS_COLLECTION_*`.
4. Apply migration 039 before enabling the updated application and run a deployed
   smoke test from authenticated mobile request through staff settlement to the
   final transaction, wallet and reconciliation evidence.

The rate diagnostic currently reports cache proof as incomplete if the endpoint
does not expose an explicit cache signal; equal values or faster responses alone
are not proof of a cache hit. Cache behavior is also exercised by service tests.

No deployment, real payment, or external account mutation was performed here.

## Verdict

The tested exchange fixes are ready for external API integration and release
acceptance. This is **not an unconditional production go-live approval**: the
API contract, collection configuration, migration and deployed smoke test above
still need verification in the target environment. No external API was selected
or configured by this work.
