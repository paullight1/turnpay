# TRUSTPAY

Fintech application for currency exchange (GHS ↔ NGN), VTU (airtime/data), and bill payments (cable TV, electricity).

## Project Structure

```
TRUSTPAY/
├── backend/       # NestJS API (Node.js)
├── website/       # Next.js web app + admin panel
├── app/           # Flutter mobile app
├── admin/         # (Reserved for standalone admin)
├── docs/          # Architecture, build plan, tasks, tech stack
└── package.json   # Root monorepo scripts
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Mobile | Flutter (Riverpod, Dio, go_router) |
| Web/Admin | Next.js (shadcn/ui, TanStack Query) |
| Backend | NestJS (Prisma, PostgreSQL, Redis) |
| Auth | JWT + OTP |
| Payments | Flutterwave / Paystack |

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Flutter SDK (for mobile)
- Docker (for local PostgreSQL + Redis)

### Setup

```bash
# Install dependencies
npm install
cd backend && npm install && cd ..
cd website && npm install && cd ..

# Start local databases
npm run docker:up

# Setup database
npm run db:generate
npm run db:migrate

# Run development servers
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + web dev servers |
| `npm run build` | Build all projects |
| `npm run lint` | Lint all projects |
| `npm run test` | Run all tests |
| `npm run docker:up` | Start PostgreSQL + Redis |
| `npm run docker:down` | Stop databases |
| `npm run db:migrate` | Run Prisma migrations |

## Branch Strategy

- `main` — Production-ready code
- `dev` — Integration branch for features
- `feature/*` — New features
- `hotfix/*` — Critical fixes

## Phase Progress

- [x] Phase 0: Project Setup & Infrastructure
- [x] Phase 1: Core Backend Foundation
- [x] Phase 2: Exchange Engine
- [x] Phase 3: External Payments & VTU
- [x] Phase 4: Frontend Development
- [x] Phase 5: Admin Panel + Security Hardening
- [x] Phase 6: Missing Core Features
- [x] Phase 7: Infrastructure & Reliability (Redis, circuit breakers, CI/CD, tests)
- [ ] Phase 8: Production Deployment

## Documentation

See the `DOCS/` directory for:
- `ARCHITECTURE.MD` — System architecture
- `BUILDPLAN.MD` — Step-by-step build plan
- `TASKS.MD` — Detailed task checklist
- `TECHSTACK.MD` — Technology decisions
