# Production blocker remediation implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the current chat.

**Goal:** Resolve repository defects from the production checklist, complete interrupted local verification, and identify the remaining external launch decisions.

**Architecture:** Preserve the existing staging deployment. Prepare a separate opt-in production blueprint with protected secrets, release migrations and disabled financial features until provider certification. Use existing application interfaces and security controls; never fabricate provider outcomes or approvals.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, Next.js, Flutter, POSIX deployment scripts.

**Spec:** `DOCS/PRODUCTION-READINESS/2026-11-03-CHECKLIST.md` and the user's instruction to fix repository blockers and rerun interrupted checks.

## Global constraints

- Follow `DOCS/SECURITY-RULES.MD`; preserve unrelated workspace changes.
- No production DDL, external emails, provider mutations, paid provisioning, deployment, or live feature activation.
- Keep internal transfers and unactivated Ghana flows disabled.
- Run heavy checks sequentially, preserve logs under `output/production-remediation-2026-11-03`, and use explicitly disposable PostgreSQL/Redis instances.

## Review focus

- The npm startup command must use the built entry point.
- A production profile must not inherit sandbox endpoints or free ephemeral state.
- Email settings must reach the container without exposing credentials or changing disabled-delivery semantics.
- Strict type fixes must preserve financial and authorization behavior.
- Local test success must not be described as provider or managed-infrastructure certification.

## Task 1 Runtime and compiler configuration

- [x] Reproduce the npm entry-point mismatch and run a strict compiler diagnostic.
- [x] Align `BACKEND/package.json` production startup with `scripts/start-production.sh`.
- [x] Enable strict compiler checks and resolve application/test diagnostics without weakening financial controls.
- [x] Run backend build, lint and the full unit/E2E suites.

## Task 2 Reviewable deployment configuration

- [x] Add a separate `render.production.yaml` using current documented Render settings, controlled migrations, protected secret slots and explicit disabled financial features.
- [x] Pass through the supported transactional-email settings in Render/Compose; retain disabled delivery until configured.
- [x] Extend manifest safety checks and exercise unsafe production fixtures before and after implementation.
- [x] Verify manifest, startup, mobile configuration, secret and encrypted-backup guards.

## Task 3 Complete local verification

- [x] Initialize isolated PostgreSQL and Redis; apply all migrations and check schema drift.
- [x] Run all financial/fault E2E suites and a synthetic financial backup/restore drill.
- [x] Run website lint, build and all available browser projects, provisioning missing browser binaries if needed.
- [x] Run Flutter analysis and full tests without repeating dependency generation against locked generated iOS paths.
- [x] Resolve actual failures at their source and rerun affected checks.

## Task 4 Release evidence and handoff

- [x] Update active operational docs to current Paystack, Ninja, VTpass and email-only OTP policy.
- [x] Update the production checklist with final commands, counts, evidence and residual blockers.
- [x] Review the final diff, verify no secrets or unrelated changes were included, and leave changes reviewable in the current checkout.
- [x] Report exactly which infrastructure, credentials, provider acceptance, release approvals and deployment actions still require the owner.


## Execution record

- Strict backend checking required 163 definite-assignment declarations in validated/serialized DTOs and explicit partial-mock boundaries. No financial service behavior was changed.
- Completed final backend evidence: 875 unit tests in 110 suites, strict type checking, production build/lint, 104 real-database/Redis financial and fault tests, 41 simulated HTTP E2E tests, fresh migration history/schema checks and a synthetic financial restore rehearsal.
- Flutter analysis is clean and all 496 tests pass in the fresh final run. Website lint and dependency audits pass.
- Ruling: preserve `render.yaml` staging and prepare a separate paid production proposal, with financial flags off and secrets supplied privately. No platform or provider activation is inferred from a template.
- Ruling: use Next's default Turbopack for browser QA. The isolated admin case failed with forced Webpack under Node 24 and Node 22, including a 30-second assertion probe, and passed with the default bundler under the original assertion limit. Authorization and QA gating remain intact.
- Browser checks exposed stale test assumptions about the replaced landing page and mobile-only customer authentication. Update their assertions to the current product; seed only the existing non-production QA session for retained customer-flow regressions. An explicit empty header set is required to keep a new Playwright context out of the shared QA bypass.
- The unconfigured password-recovery screen threw during render. A regression reproduced the crash; nullable client initialization and explicit recovery-session checks now produce a safe unavailable state.

- Review follow-up: deployment guards must also protect the recorded Dokploy/Railpack entry, not only Render/Compose. Production now requires explicit core flags and never loads local/example env files; the shell guard independently enforces explicit flags, sandbox off and live KYC/legacy endpoints. Focused runtime/schema regressions pass 49 tests after missing flags and a test KYC key were observed incorrectly accepted.
- Review follow-up: the documented Dokploy release is still an external action. Migration 054 must run in a controlled release job before starting this candidate; no live DDL or platform update was performed.
- Mobile Safari exposed a real duplicated-error-toast obstruction of modal retry buttons. Inline errors remain; the redundant review error toast was removed. All 18 focused WebKit/Mobile Safari regressions now pass without forced clicks or raised assertion limits.

- Final verification: the clean five-project browser matrix passed all 510 cases without skips; website lint/production build passed. Full backend rerun passed 875 unit and 41 HTTP E2E tests plus strict checking/build/lint. Manifest/mobile/release-manifest/backup/helper regressions and official Render schema validation passed. Secret scanning passed. The real candidate gate intentionally fails because required new files remain untracked and the shared checkout is uncommitted.
- Final review: canonical environment-mode mismatches reproduced four failing cases before correction. Shell and runtime now reject noncanonical modes; npm production startup forces production and validates configuration. The independent focused review found no remaining actionable issues and passed 29 tests, scoped lint and manifest negatives.

- Final Flutter rerun includes the concurrent wallet edits: analysis clean and all 496 tests pass. Task-owned Next output/config additions were cleaned; pre-existing file-mode and unrelated source/document changes remain intact. No deployment, live DDL, email, paid resource, commit or push was performed.
