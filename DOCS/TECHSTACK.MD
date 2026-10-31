# TRUSTPAY Technology Stack

This file records the active production stack. Provider selection is authoritative
in `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`.

## Applications

- Mobile: Flutter, Riverpod, Dio, `go_router`.
- Web and admin: Next.js 16, React, shadcn/ui, TanStack Query.
- Backend: NestJS with TypeScript strict mode.

## Data and infrastructure

- PostgreSQL through Prisma; `Decimal` for all money values.
- Redis for caching, throttling, queues, and idempotency coordination.
- Supabase for authentication and managed PostgreSQL services.
- Docker and CI/CD for repeatable deployments.
- Pino structured logging and Sentry-compatible error monitoring.

## External providers

- Banking and payments: Monnify only.
- VTU and Nigerian bill payments: VTpass only.
- KYC and identity verification: Monnify direct identity API for Nigerian BVN and NIN; no alternate KYC provider is shipped.
- FX rates: configured server-side FX feed.

Provider secrets are backend-only. Mobile and web clients receive only the public
TRUSTPAY API URL and public authentication configuration.

## Security baseline

All implementation must follow `DOCS/SECURITY-RULES.MD`, including mutation
idempotency, Prisma transactions for balances, DTO validation, authentication and
authorization guards, verified/idempotent webhooks, audit logging, encrypted PII,
and no secret values in source or logs.
