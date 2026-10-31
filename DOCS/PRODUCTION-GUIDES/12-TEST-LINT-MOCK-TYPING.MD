# Test Lint and Mock Typing Guide

## Current status

Production backend source passes strict ESLint with spec files excluded. Full backend lint now uses a test-only override for Jest/Prisma mocks because the existing specs rely on loose mock objects that trigger unsafe `any` rules.

This override is intentionally limited to:

- `**/*.spec.ts`
- `test/**/*.ts`

Do not copy this relaxed rule set into production files.

## Best practice target

Move shared mocks into typed test helpers instead of creating ad hoc `any` objects inside every spec.

Recommended helpers:

- `createPrismaMock()` returning a typed subset of `PrismaService`
- `createLoggerMock()` returning a typed subset of `PinoLogger`
- `createProviderMock()` helpers for Monnify, VTpass, and Supabase providers
- `mockResolvedValueOnce` wrappers typed to the method return value

## Rollout plan

1. Create `BACKEND/src/test-utils/typed-mocks.ts`.
2. Move repeated Prisma delegate mocks there.
3. Update one spec file at a time.
4. Re-enable the unsafe test rules once all specs are typed.
5. Keep `npm run lint` and `npm test` green before merging.

## Why this matters

Typed mocks catch broken service contracts earlier. They also prevent a passing test suite from hiding a production type mismatch around money movement, webhook processing, KYC review, or admin actions.
