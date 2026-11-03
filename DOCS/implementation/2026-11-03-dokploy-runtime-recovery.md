# Dokploy runtime recovery

The owner confirmed Dokploy is the active backend host, served by `api.trustpayhq.com`. The signed-in Dokploy trustpay/production application is `trustpay-backend-r02shu`. Render was inspected read-only before the host clarification; no Render setting/deployment was changed. The local preview proxy is restored to the canonical API hostname.

## Expired-token server errors

A synthetic expired JWT sent to the protected provider-exchange configuration endpoint reproduced HTTP 500. Read-only diagnostics inside the real Dokploy container confirmed user, session, provider-exchange and notification model queries succeed. The container uses Node 22.23.4, production mode and Supabase JS 2.105.3.

The installed auth-js SDK throws ordinary `Error` objects for expired JWTs and missing expiry claims. Its `getClaims()` rethrows those exceptions rather than returning `AuthError`. The production guard consequently passed them to the generic 500 handler. Flutter refreshes access tokens on 401, so it could not recover these requests.

The Supabase adapter now maps known claim-rejection exceptions to `UnauthorizedException`. Signature verification, provider-session validation and all database authorization remain enforced. Malformed token envelopes are rejected before SDK parsing; decoded claims never grant authentication. Unexpected verification/runtime errors remain distinct and are not converted into credential rejection. No raw token, password or provider credential is logged.

The real-SDK regressions failed twice before the fix. All 23 Supabase/authorization tests and scoped lint passed afterward. An isolated backend build contains main plus only the two reviewed authentication files, preserving unrelated shared-checkout work. Hosted post-deployment checks are recorded below when complete. No genuine payment, identity decision, account opening or WhatsApp message was executed.
