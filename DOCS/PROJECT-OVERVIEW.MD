# TRUSTPAY Project Overview

## What Is TrustPay?

TrustPay is a **fintech application** for the African market enabling:
- **GHS ↔ NGN** currency exchange
- **VTU** — Airtime, Data, Cable TV, Electricity bill payments
- **Wallet** — Fund, withdraw, and manage balances
- **Admin Panel** — Monitor transactions, manage users, override rates

---

## Current Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Project Setup & Infrastructure | ✅ Complete |
| Phase 1 | Core Backend Foundation | ✅ Complete |
| Phase 2 | Exchange Engine | ✅ Complete |
| Phase 3 | Monnify NGN Virtual Accounts + Webhooks | ✅ Implemented, needs sandbox/live validation |
| Phase 4 | Exchange Deposit Review Flow | ✅ Implemented, needs provider replay/e2e validation |
| Phase 5 | Web Dashboard + Admin Operations | ✅ Implemented, needs operations hardening |
| Phase 6 | Flutter Mobile App | 🟡 Functional foundation, needs wallet UI parity and QA |
| Phase 7 | Security, Reconciliation, CI/CD | 🟡 Partially complete |
| Phase 8 | Production Deployment | ⏳ Pending |

Current launch position: **not ready for real-money launch yet**. The codebase is ready for staging validation once migrations, production-like secrets, Supabase buckets, Monnify sandbox credentials, and public HTTPS webhook URLs are configured.

---

## Project Structure

```
TRUSTPAY/
├── APP/              # Flutter mobile app
├── BACKEND/          # NestJS API server
├── WEBSITE/          # Next.js web app + admin panel
├── DOCS/             # Architecture, plans, security rules
└── package.json      # Root monorepo scripts
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Mobile | Flutter + Riverpod + Dio + go_router |
| Web/Admin | Next.js 16 + shadcn/ui + TanStack Query |
| Backend | NestJS + Prisma + PostgreSQL + Redis |
| Auth | JWT (15m access / 7d refresh) + OTP |
| Payments | Monnify only for NGN virtual accounts, deposits, bank resolution, and withdrawals |

---

## External Tools & Third Parties

### Required (For Full Functionality)

| Service | Purpose | Integration Status |
|---------|---------|-------------------|
| **Monnify** | NGN virtual accounts, deposit webhooks, exchange deposit verification | ✅ Code implemented; KYB, credentials, webhook dashboard setup, and sandbox/live validation still required |
| **VTU Aggregator** (VTpass) | Airtime, data, cable TV, electricity APIs | 📦 Live credentials and service validation still required |
| **FX Rate API or Admin Rate Ops** | GHS ⇄ NGN rates and quote control | 📦 Rate service/admin paths present; production source and approval workflow still required |
| **SMS Provider** (Twilio / Africa's Talking or Supabase-supported OTP provider) | OTP delivery for phone verification | 📦 OTP service/auth flow present; production provider config required |
| **KYC Provider** (NIBSS/NIMC/approved vendor) | Identity verification beyond manual review | 🟡 Manual review gateway present; approved provider onboarding still required |

### Infrastructure (For Local Development)

| Service | Purpose | Status |
|---------|---------|--------|
| **PostgreSQL** | Main relational database (financial data) | ✅ Ready via Docker |
| **Redis** | Caching, rate limiting, session storage | ✅ Ready via Docker |
| **Docker** | Containerization for local services | ✅ docker-compose.yml included |

### Production (For Deployment)

| Service | Purpose | Status |
|---------|---------|--------|
| **GitHub** | Code hosting / CI/CD | 🔜 CI workflows still need finalization |
| **Vercel** | Web app + admin panel hosting | 🔜 Needed for Phase 8 |
| **AWS / DigitalOcean / Render / Fly.io** | Backend API + managed database hosting | 🔜 Needed for Phase 8 |
| **Sentry.io** | Error tracking & crash analytics | 🔜 Recommended |
| **Playwright MCP** | E2E browser testing automation | ✅ Installed |

---

## How to View the App on Windows (No Android Studio)

### Option 1: Flutter Web in Chrome (Recommended — Easiest)

```bash
cd APP
flutter run -d chrome
```
Opens the mobile app in your Chrome browser.

### Option 2: Flutter Web Server (Access from Phone)

```bash
cd APP
flutter run -d web-server --web-hostname=0.0.0.0 --web-port=8080
```
Then open `http://YOUR_PC_IP:8080` from your phone browser on the same WiFi network.

### Option 3: Next.js Web App

```bash
cd WEBSITE
npm install
npm run dev
```
Access at `http://localhost:3000`

### Option 4: Backend API (Swagger)

```bash
cd BACKEND
npm install
npm run start:dev
```
Access API docs at `http://localhost:3000/api` (if Swagger is enabled).

---

## Quick Start Commands

### Run Everything

```bash
# Install all dependencies
npm install
cd BACKEND && npm install && cd ..
cd WEBSITE && npm install && cd ..

# Start databases (PostgreSQL + Redis)
npm run docker:up

# Run database migrations
npm run db:generate
npm run db:migrate

# Start backend + web app
npm run dev
```

### Individual Commands

```bash
# Mobile app preview
cd APP && flutter run -d chrome

# Web app development
cd WEBSITE && npm run dev

# Backend development
cd BACKEND && npm run start:dev

# Stop databases
cd BACKEND && docker-compose down

# Build all projects
npm run build

# Run linters
npm run lint

# Run tests
npm run test
```

---

## Environment Variables

Create `BACKEND/.env` from the template:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/trustpay"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-secret-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"

# Monnify NGN virtual accounts
BANKING_ENABLED="true"
VIRTUAL_ACCOUNTS_ENABLED="true"
BANKING_PROVIDER_PRIMARY="monnify"
BANKING_PROVIDER_FALLBACK=""
SUPPORTED_BANKING_CURRENCIES="NGN"
MONNIFY_BASE_URL="https://sandbox.monnify.com"
MONNIFY_API_KEY="xxx"
MONNIFY_SECRET_KEY="xxx"
MONNIFY_CONTRACT_CODE="xxx"
MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER="xxx"

# Optional payment providers if enabled later
MONNIFY_API_KEY=""
YOUVERIFY_API_KEY=""
VTPASS_API_KEY=""

# VTU Provider
VTU_API_KEY="xxx"
VTU_API_URL="https://api.vtu-provider.com"

# FX Rates
FX_API_KEY="xxx"

# SMS/OTP
TWILIO_ACCOUNT_SID="xxx"
TWILIO_AUTH_TOKEN="xxx"
TWILIO_PHONE_NUMBER="+xxx"

# App
API_URL="http://localhost:3000"
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│           USER DEVICES                  │
│  (Flutter Mobile / Next.js Web)         │
└──────────────┬──────────────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────────────┐
│           BACKEND (NestJS)              │
│  Auth │ Exchange │ Payments │ VTU       │
└───┬──────────────┬──────────────┬───────┘
    │              │              │
    ▼              ▼              ▼
┌────────┐   ┌──────────┐   ┌──────────────┐
│ Redis  │   │PostgreSQL│   │External APIs │
│(Cache) │   │  (Data)  │   │Monnify       │
└────────┘   └──────────┘   │VTU/FX/SMS    │
                            └──────────────┘
```

---

## Current Reference Docs

- `DOCS/TASKS.MD` — current task status and remaining work.
- `DOCS/CODEBASE-STATUS-REVIEW.MD` — codebase status review.
- `DOCS/PRODUCTION-GUIDES/13-MONNIFY-ONLY-VIRTUAL-ACCOUNTS-STATUS.MD` — Monnify-only decision and operational checklist.
- `DOCS/PRODUCTION-GUIDES/14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD` — exchange deposit review flow.

## GitHub Repository

- **Remote:** `https://github.com/paullight1/turnpay.git`
- **Branch:** `main`
- **Status:** ✅ Connected and pushed
