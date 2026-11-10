# Dokploy runtime recovery

The owner confirmed Dokploy is the active backend host, served by `api.trustpayhq.com`. The signed-in Dokploy trustpay/production application is `trustpay-backend-r02shu`. Render was inspected read-only before the host clarification; no Render setting/deployment was changed. The local preview proxy is restored to the canonical API hostname.

## Expired-token server errors

A synthetic expired JWT sent to the protected provider-exchange configuration endpoint reproduced HTTP 500. Read-only diagnostics inside the real Dokploy container confirmed user, session, provider-exchange and notification model queries succeed. The container uses Node 22.23.4, production mode and Supabase JS 2.105.3.

The installed auth-js SDK throws ordinary `Error` objects for expired JWTs and missing expiry claims. Its `getClaims()` rethrows those exceptions rather than returning `AuthError`. The production guard consequently passed them to the generic 500 handler. Flutter refreshes access tokens on 401, so it could not recover these requests.

The Supabase adapter now maps known claim-rejection exceptions to `UnauthorizedException`. Signature verification, provider-session validation and all database authorization remain enforced. Malformed token envelopes are rejected before SDK parsing; decoded claims never grant authentication. Unexpected verification/runtime errors remain distinct and are not converted into credential rejection. No raw token, password or provider credential is logged.

The real-SDK regressions failed twice before the fix. All 23 Supabase/authorization tests and scoped lint passed afterward. An isolated backend build contains main plus only the two reviewed authentication files, preserving unrelated shared-checkout work. Hosted post-deployment checks are recorded below when complete. No genuine payment, identity decision, account opening or WhatsApp message was executed.


## Hosted verification

Dokploy deployed `41f2bd976552cedd0613edcfad485243f665a6d9` successfully. A synthetic expired JWT to `/api/exchange/provider/config` now returns HTTP 401 instead of 500. After restarting the Flutter preview, real signed-in bootstrap, banking accounts/beneficiaries, transaction history and notification-count reads all returned HTTP 200 through the canonical Dokploy API proxy.

## Explicit admin rate units

`Rate.quoteBasis` distinguishes `TARGET_PER_SOURCE` multipliers from `SOURCE_PER_TARGET` divisors. The raw administrator input is retained at its existing four-decimal persistence precision. Reciprocal canonical rates round down to six decimals, matching frozen manual quote precision. Both directions remain independently administered; no market-feed price replaces them.

Migration 053 is atomic and marks only the exact legacy admin entries NGN/GHS 87 and GHS/NGN 0.0111 as divisors. It adds two system unit-correction audits and does not rewrite historical quotes/orders. A disposable PostgreSQL database verified migration 000–053, unchanged numeric prices/history, two audits and repeat-deploy idempotence. The production database target was matched to the running Dokploy container using a credential-free database-identity hash. Only migrations through 053 were deployed from an isolated release directory. Read-back confirms both raw values unchanged, both explicit divisor units, and two audit rows.

Dokploy currently uses Railpack with `sh scripts/validate-production-config.sh node dist/src/main.js`; this bypasses the Docker migration startup wrapper even though `RUN_MIGRATIONS_ON_STARTUP=true`. Migration 053 was therefore explicitly deployed before the application release. Future schema releases must run `prisma migrate deploy` explicitly until the Railpack startup command is aligned.


## Rate release verification

Dokploy deployed `577bda01ea40546c9ce152ecaa3addfdbae13f92` successfully, and the Vercel production website is READY on the same commit. The live signed-in Flutter app shows NGN 10,000 → GHS 114.94 and GHS 100 → NGN 9,009.00, using the retained administrator divisors. Both rate reads and manual-order configuration/history reads returned HTTP 200. The two admin Chromium browser scenarios passed, including divisor 115 showing canonical 0.008695 before/after save; TypeScript and scoped ESLint passed. No genuine exchange/payment was executed.

The two existing prices imply a crossed spread (87 NGN per GHS in one direction versus about 90.09 NGN per GHS in the other). The owner was notified to review these business prices before accepting live exchanges. No replacement price or market feed was substituted.

The restarted preview exposed a separate bootstrap routing warning when opening directly at `/#/home`. A widget regression reproduced it. The temporary startup shell now uses MaterialApp's builder instead of owning a Navigator, leaving deep links to the application router. Both startup tests pass, including initialization failure/retry. This does not change authentication or transaction authorization.


The wider GitHub backend check found one unnecessary `as number` assertion in the new rate result. It was removed without changing emitted JavaScript, and scoped ESLint passed. This is a CI lint correction rather than a runtime behavior change.


## Production readiness follow-up

The repository now requires explicit production values for banking, virtual accounts, withdrawals, checkout, VTU and sandbox mode, and deployed configuration ignores local/example env files. Before deploying this candidate to the recorded Dokploy service, populate those decisions in its protected environment and leave uncertified features off. Production KYC requires a live Paystack key even with payments disabled; retained Monnify credentials must target the live endpoint.

Migration 054 is a prerequisite for this candidate. Configure a controlled release task using `npx prisma migrate deploy`, verify `npx prisma migrate status`, then serve with `NODE_ENV=production sh scripts/validate-production-config.sh node dist/src/main.js`. Keep `RUN_MIGRATIONS_ON_STARTUP=false` when migrations are handled by that release job; Railpack's direct command does not consume the Docker wrapper flag. No live DDL, environment update or Dokploy deployment is authorized by these repository edits alone. See the [current migration runbook](../PRODUCTION-GUIDES/20-MIGRATION-RUNBOOK.md).
