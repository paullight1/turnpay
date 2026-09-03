# TRUSTPAY Project Guide

Complete project overview, setup instructions, and next steps.

---

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd TRUSTPAY
npm install
cd backend && npm install && cd ..
cd website && npm install && cd ..

# Start databases
npm run docker:up

# Seed database with test data
npm run seed

# Run development servers
npm run dev
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + web dev servers |
| `npm run build` | Build all projects |
| `npm run lint` | Lint all projects |
| `npm run test` | Run backend tests |
| `npm run test:backend:cov` | Run tests with coverage |
| `npm run test:e2e:web` | Run frontend e2e tests |
| `npm run seed` | Seed database with test data |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |
| `npm run db:deploy` | Deploy migrations to production |
| `npm run docker:up` | Start PostgreSQL + Redis |
| `npm run docker:down` | Stop databases |
| `npm run docker:prod` | Build and start production containers |

---

## Test Accounts (After Seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@trustpay.com | AdminPass123! |
| User | user@trustpay.com | UserPass123 |
| User | verified@trustpay.com | UserPass123 |

---

## API Documentation

After starting the backend, visit:
```
http://localhost:3000/api/docs
```

This provides interactive Swagger documentation for all 29 API endpoints.

---

## Routes Summary

### Backend (29 endpoints)
- **Auth:** Register, Login, Refresh, Logout, Change Password, OTP
- **Users:** Profile (get/update)
- **Wallets:** Get balances
- **Exchange:** Get rate, Create quote, Execute exchange
- **Payments:** Fund wallet, Withdraw, List banks, Resolve account
- **VTU:** Providers, Packages, Purchase
- **Transactions:** History, Detail
- **Admin:** Users CRUD, Stats, Transaction management
- **Health:** `/api/health`
- **Docs:** `/api/docs`

### Website (16 pages)
- **Public:** Home, Login, Register, Forgot Password, Reset Password
- **Dashboard:** Overview, Fund, Withdraw, Exchange, VTU, Transactions, Transaction Detail, Profile
- **Admin:** Dashboard

---

## Technology Stack

### Backend
- **Framework:** NestJS 11
- **Database:** PostgreSQL 16 + Prisma ORM
- **Cache:** Redis 7
- **Auth:** JWT (15m access / 7d refresh) + OTP
- **Logging:** Pino (structured JSON)
- **Security:** Helmet, CORS, Rate limiting, Idempotency
- **Monitoring:** Sentry (optional)
- **Docs:** Swagger/OpenAPI

### Frontend (Web)
- **Framework:** Next.js 16 (App Router)
- **UI:** shadcn/ui + Tailwind CSS v4
- **State:** TanStack Query + React Context
- **HTTP:** Axios with JWT interceptor
- **Forms:** React Hook Form + Zod
- **E2E Testing:** Playwright

### Mobile (Planned)
- **Framework:** Flutter
- **State:** Riverpod
- **HTTP:** Dio
- **Routing:** go_router

---

## Security Features

| Feature | Status |
|---------|--------|
| JWT authentication | ✅ Complete |
| Refresh token rotation | ✅ Complete |
| Rate limiting | ✅ Complete |
| Account lockout (5 attempts) | ✅ Complete |
| Idempotency keys | ✅ Complete |
| Webhook signature verification | ✅ Complete |
| Input validation (DTOs) | ✅ Complete |
| CORS with explicit origins | ✅ Complete |
| Helmet security headers | ✅ Complete |
| Password hashing (bcrypt) | ✅ Complete |
| OTP verification | ✅ Complete |
| RBAC guards | ✅ Complete |
| Audit logging | ✅ Complete |
| Graceful shutdown | ✅ Complete |

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │        USER DEVICES          │
                    │  (Mobile App / Web Browser)  │
                    └─────────────┬────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────────┐
                    │        FRONTEND LAYER        │
                    │  Flutter App + Next.js Web   │
                    └─────────────┬────────────────┘
                                  │ API Calls (HTTPS)
                                  ▼
                    ┌──────────────────────────────┐
                    │        BACKEND API           │
                    │    NestJS + Express          │
                    └─────────────┬────────────────┘
                                  │
           ┌──────────────────────┼────────────────────────┐
           ▼                      ▼                        ▼
 ┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ PostgreSQL       │   │ Redis Cache          │   │ External APIs        │
 │ (Users, Wallets, │   │ (OTP, Quotes,        │   │ (Monnify,            │
 │  Transactions)   │   │  Idempotency,        │   │  VTpass, Youverify,  │
 │                  │   │  Circuit Breaker)    │   │  FX)                 │
 └──────────────────┘   └──────────────────────┘   └──────────────────────┘
```

---

## Next Steps

### Immediate (Production Ready)
1. **SMS Integration** — Connect Twilio/Africa's Talking for real OTP
   - See `DOCS/INTEGRATION-GUIDE.MD`
2. **Email Integration** — Connect Resend/SendGrid for password reset
   - See `DOCS/INTEGRATION-GUIDE.MD`
3. **Live Provider Keys** — Configure live Monnify, VTpass, and Youverify credentials
4. **SSL Certificates** — Set up HTTPS for production domains
5. **Sentry Setup** — Create Sentry project and add DSN to `.env`

### Short Term
1. **KYC Implementation** — Document upload + admin review flow
   - See `DOCS/KYC-GUIDE.MD` (to be created)
2. **Withdrawal Limits** — Daily/monthly limits per user tier
3. **Dispute System** — Handle failed transactions and refunds
4. **Frontend Tests** — Expand Playwright e2e coverage
5. **Backend Integration Tests** — Add Supertest tests for all flows

### Medium Term
1. **Mobile App** — Build Flutter app with same API
2. **Push Notifications** — FCM/APNs integration
3. **Multi-language** — i18n for Yoruba, Hausa, etc.
4. **Analytics** — Mixpanel/Amplitude integration
5. **Referral System** — Invite friends, earn rewards

---

## Documentation

| File | Purpose |
|------|---------|
| `README.md` | Project overview, routes, setup |
| `DOCS/SECURITY-RULES.MD` | 15-section security checklist |
| `DOCS/TESTING-GUIDE.MD` | Testing strategy and examples |
| `DOCS/INTEGRATION-GUIDE.MD` | Third-party service integration |
| `DOCS/DEPLOYMENT-GUIDE.MD` | Production deployment guide |
| `DOCS/ARCHITECTURE.MD` | System architecture |
| `DOCS/BUILDPLAN.MD` | Original build plan |
| `DOCS/TASKS.MD` | Detailed task checklist |
| `DOCS/TECHSTACK.MD` | Technology decisions |
| `AGENTS.md` | AI agent guidelines |

---

## Docker

### Development
```bash
npm run docker:up     # Start PostgreSQL + Redis
npm run docker:down   # Stop databases
```

### Production
```bash
npm run docker:prod   # Build and start all services
```

---

## Support

For issues or questions:
- GitHub Issues: `<repo-url>/issues`
- Email: `support@trustpay.com`
- Documentation: `DOCS/` directory

---

*Built with ❤️ for Africa's fintech future*
