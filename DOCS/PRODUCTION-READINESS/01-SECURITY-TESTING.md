# 01 — Security Testing and Sign-off

## Goal

Prove that attackers cannot steal accounts, bypass authorization, alter balances, replay payments, or extract secrets.

## Owner

Security lead, with backend, web, mobile, and infrastructure owners.

## Steps

- [ ] Confirm the repository gates pass:

  ```bash
  cd BACKEND && npm audit --omit=dev --audit-level=high
  npm run lint -- --quiet
  npx tsc --noEmit --pretty false
  npm test -- --runInBand
  npm run test:e2e -- --runInBand
  cd ../WEBSITE && npm audit --omit=dev --audit-level=high && npm run lint && npm run build
  ```

- [ ] Run an external penetration test against staging only.
- [ ] Test authentication, OTP, refresh-token rotation, logout, password reset, PIN lockout, CSRF, IDOR, admin roles, rate limits, and session expiry.
- [ ] Test every money mutation with duplicate requests, missing idempotency keys, replayed webhooks, altered amount/currency, and concurrent requests.
- [ ] Scan Docker images, dependencies, secrets, exposed ports, TLS, headers, CORS, and storage permissions.
- [ ] Wire mobile certificate pinning and device-integrity checks; test invalid certificates, rooted devices, and offline recovery.
- [ ] Record every finding with severity, owner, fix, retest date, and evidence.

## Evidence required

Pen-test report, remediation report, dependency audit output, scan output, test results, and security approval.

## Exit criteria

No open critical/high findings, no exploitable medium findings without written risk acceptance, and the security lead signs the release candidate.
