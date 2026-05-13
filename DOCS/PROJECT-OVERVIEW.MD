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
| Phase 3 | External Payments & VTU | ✅ Complete |
| Phase 4 | Frontend Development | ✅ Complete |
| Phase 5 | Admin Panel + Security | ✅ Complete |
| Phase 6 | Missing Core Features | ✅ Complete |
| Phase 7 | Infrastructure & CI/CD | ✅ Complete |
| Phase 8 | Production Deployment | ⏳ Pending |

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
| Payments | Flutterwave / Paystack |

---

## External Tools & Third Parties

### Required (For Full Functionality)

| Service | Purpose | Integration Status |
|---------|---------|-------------------|
| **Flutterwave** or **Paystack** | Payment processing, bank transfers, funding wallets | 📦 Providers coded, need API keys |
| **VTU Aggregator** (Reloadly / TopUp / Shago) | Airtime, data, cable TV, electricity APIs | 📦 Provider coded, need API key |
| **FX Rate API** (Wise / ExchangeRate-API) | Live currency exchange rates (GHS ⇄ NGN) | 📦 Rate service coded, need API key |
| **SMS Provider** (Twilio / Africa's Talking) | OTP delivery for phone verification | 📦 OTP service coded, need API key |

### Infrastructure (For Local Development)

| Service | Purpose | Status |
|---------|---------|--------|
| **PostgreSQL** | Main relational database (financial data) | ✅ Ready via Docker |
| **Redis** | Caching, rate limiting, session storage | ✅ Ready via Docker |
| **Docker** | Containerization for local services | ✅ docker-compose.yml included |

### Production (For Deployment)

| Service | Purpose | Status |
|---------|---------|--------|
| **GitHub** | Code hosting, CI/CD (Actions) | ✅ Connected |
| **Vercel** | Web app + admin panel hosting | 🔜 Needed for Phase 8 |
| **AWS / DigitalOcean** | Backend API + database hosting | 🔜 Needed for Phase 8 |
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

# Payment Gateway (pick one)
FLUTTERWAVE_SECRET_KEY="sk_xxx"
PAYSTACK_SECRET_KEY="sk_xxx"

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
│(Cache) │   │  (Data)  │   │Flutterwave/  │
└────────┘   └──────────┘   │VTU/FX/SMS    │
                            └──────────────┘
```

---

## GitHub Repository

- **Remote:** `https://github.com/paullight1/turnpay.git`
- **Branch:** `main`
- **Status:** ✅ Connected and pushed
