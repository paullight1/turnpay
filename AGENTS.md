# TRUSTPAY Agent Guidelines

## Security Rules

**MANDATORY**: Always follow the security checklist at `DOCS/SECURITY-RULES.MD` when generating code.

Every code change must comply with the following critical rules:

1. **Idempotency** — All mutation endpoints MUST support idempotency keys
2. **Race Conditions** — All balance operations MUST use Prisma transactions
3. **Input Validation** — All input MUST be validated via DTOs
4. **Auth Guards** — All protected routes MUST have `JwtAuthGuard`
5. **No Secrets** — Never hardcode or log secrets, keys, or passwords
6. **Financial Integrity** — Use `Decimal` for money, never `Float`; no negative balances
7. **Webhooks** — Always verify signatures and implement idempotent handlers
8. **Audit Logging** — Log all financial transactions and admin actions

See `DOCS/SECURITY-RULES.MD` for the complete 15-section security checklist.

## Tech Stack

- **Backend:** NestJS + Prisma + PostgreSQL + Redis
- **Web/Admin:** Next.js 16 + shadcn/ui + TanStack Query
- **Mobile:** Flutter + Riverpod + Dio + go_router
- **Auth:** JWT (15m access / 7d refresh) + OTP
- **Payments:** Flutterwave / Paystack (planned)

## Code Style

- TypeScript strict mode
- Use `PinoLogger` for logging (not `console.log`)
- DTOs for all inputs/outputs
- Services contain business logic, controllers handle routing
- Global exception filter for error handling
- Rate limiting on all sensitive endpoints

## Project Structure

```
TRUSTPAY/
├── backend/src/
│   ├── auth/          # Authentication module
│   ├── users/         # User management
│   ├── wallets/       # Wallet provisioning & balances
│   ├── exchange/      # FX rates, quotes, exchange execution
│   ├── payments/      # Payment gateways, webhooks, withdrawals
│   ├── vtu/           # Airtime, data, cable, electricity
│   ├── otp/           # OTP service
│   ├── prisma/        # Prisma service & module
│   └── common/        # Guards, decorators, filters
├── website/src/
│   ├── app/           # Next.js App Router pages
│   ├── components/    # React components
│   ├── lib/           # Utilities & config
│   └── services/      # API client
├── app/lib/
│   ├── core/          # Theme, routing, constants
│   ├── services/      # API client (Dio)
│   ├── providers/     # Riverpod providers
│   └── screens/       # App screens
└── DOCS/
    └── SECURITY-RULES.MD  # ← MANDATORY security checklist
```
