# Production readiness remediation implementation plan

> Execute using the debugging, parallel-agent, and verification skills. Preserve the existing working tree and review each independent area before integration.

**Goal:** Correct the concrete findings R1–R16 and related actionable hardening in the 8 September readiness report.

**Architecture:** Keep financial state changes transactional and authorization server-enforced. Isolate provider session operations, make failures explicit, and use fail-closed release configuration. External acceptance evidence remains distinct from local verification.

**Spec:** `DOCS/PRODUCTION-READINESS-DEEP-DIVE-2026-09-08.md`

**Constraints:** Follow `DOCS/SECURITY-RULES.MD`; no live payments, messages, provider configuration changes, or production data mutations. Preserve prior uncommitted work. Do not commit an unrelated working tree. Use focused regression tests before each behavioral fix.

- [ ] Auth/session fixes R1–R3 and explicit admin authorization R5: isolate SDK clients, bind provider session identities, enforce revocation in guards and provider where supported, and test no-op logout/password regressions and direct-refresh bypass. Own auth/supabase/admin session paths and schema additions.
- [ ] VTU R6: query authoritative provider reversal state, validate identity/amount, allow exactly-once compensation after success while rejecting stale failure; test reversal, retries, and concurrency.
- [ ] PIN R7: atomic credential and hold update, consistent verification, interrupted/concurrent reset regression; root integrates AuthService call after auth agent finishes.
- [ ] Reconciliation R8–R9: consistent snapshots plus explicit persisted hold enforcement and audited release workflow; test injected mismatch and outbound settlement rejection. Avoid blocking inbound compensation.
- [ ] Deployment R10–R13/R16: isolate staging providers; preserve backup TLS/private encryption/retention; validate restored financial contents; add migration gate, private origin binding, corrected runbooks, and honest Flutter web compile-only CI classification.
- [ ] Website R14–R15: shared HTTPS validation, checked CSRF cookie cleanup, nonces, canonical legacy withdrawal amounts; static and browser regression checks.
- [ ] Mobile hardening: remove reusable biometric PIN material and preserve biometric app unlock; investigate secure platform approval and attestation prerequisites without claiming unimplemented attestation.
- [ ] OTP R4: resolve existing provider choice, implement real delivery with safe errors/rate limits and tests; require valid configuration before reporting sent. Do not invent credentials or send SMS during verification.
- [ ] Integration: full backend tests/typecheck/lint/build, website checks, locate Flutter SDK and run mobile checks, isolated financial DB tests where safely available; review combined diff and update readiness report with verified outcomes and remaining external gates.

Regression examples: a revoked provider `session_id` is denied even with a refreshed valid JWT; password update uses an authenticated isolated client; a duplicate confirmed VTU reversal increases the customer balance once; PIN reset failure cannot leave the new PIN without a hold; valid concurrent ledger commits do not create reconciliation mismatches; production HTTP API URL fails before credentials are sent; missing CSRF is recovered before cookie deletion.
