<p align="center">
  <img src="https://img.shields.io/badge/Status-Active_Development-brightgreen?style=for-the-badge&logo=github&logoColor=white" alt="Status" />
  <img src="https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge&logo=semantic-release&logoColor=white" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="License" />
  <br />
  <img src="https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white" alt="Flutter" />
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

---

<p align="center">
  <h1 align="center">💳 TRUSTPAY</h1>
  <p align="center">
    <b>Modern Fintech Platform for Currency Exchange, VTU & Bill Payments</b>
  </p>
  <p align="center">
    <i>Send, receive, exchange, and pay bills — all in one secure platform built for Africa.</i>
  </p>
</p>

---

<p align="center">
  🇬🇭 GHS ↔ 🇳🇬 NGN Exchange &nbsp;•&nbsp; 📱 Airtime & Data &nbsp;•&nbsp; 📺 Cable TV &nbsp;•&nbsp; ⚡ Electricity Bills
</p>

---

## Current Implementation Status

Date updated: 2026-09-01

TRUSTPAY is in active development and is **not ready for real-money launch yet**. The backend, web/admin, and Flutter app foundations are implemented, but production activation still requires staging migrations, live secrets, Supabase storage buckets, Monnify KYB/credentials, HTTPS webhook registration, sandbox/live provider validation, reconciliation checks, and launch sign-off.

Current banking direction:

- Monnify only for Nigerian NGN virtual accounts.
- Nomba is not active.
- Monnify is the only payment, virtual-account, and withdrawal provider.
- VTpass is the only VTU provider, and Monnify is the primary Nigerian KYC provider.
- Monnify-verified NGN exchange deposits require admin approval before GHS wallet credit.

Primary status docs:

- `DOCS/TASKS.MD`
- `DOCS/CODEBASE-STATUS-REVIEW.MD`
- `DOCS/PRODUCTION-GUIDES/13-MONNIFY-ONLY-VIRTUAL-ACCOUNTS-STATUS.MD`
- `DOCS/PRODUCTION-GUIDES/14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD`

---

## 📸 App Screenshots

<p align="center">
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Mobile+App+%7C+Splash+Screen" alt="Splash Screen" width="300" />
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Mobile+App+%7C+Login+Screen" alt="Login Screen" width="300" />
  <br />
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Mobile+App+%7C+Dashboard+%26+Wallet" alt="Dashboard" width="300" />
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Mobile+App+%7C+Currency+Exchange" alt="Exchange" width="300" />
  <br />
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Web+App+%7C+User+Dashboard" alt="Web Dashboard" width="300" />
  <img src="https://placehold.co/600x300/0D0E14/E8472A?text=Admin+Panel+%7C+Transaction+Management" alt="Admin Panel" width="300" />
</p>

> 📌 *Replace placeholder images with actual screenshots from your running app.*

---

## ✨ Features

### 💱 Currency Exchange
- [x] Real-time GHS ↔ NGN exchange rates
- [x] Live quote generation with expiry
- [x] Instant wallet-to-wallet conversion
- [x] Transparent fee calculation
- [x] Transaction history with status tracking

### 📱 VTU Services
- [x] Airtime top-up (MTN, Vodafone, AirtelTigo)
- [x] Data bundle purchase
- [x] Cable TV subscription (DSTV, GOtv, StarTimes)
- [x] Electricity bill payment (ECG, NEDCo, PHCN)
- [x] Smart meter number validation

### 💰 Wallet & Payments
- [x] Multi-currency wallet (NGN, GHS)
- [x] Receive NGN through Monnify virtual accounts
- [x] Admin-reviewed NGN to GHS exchange deposit flow
- [x] Bank transfer withdrawals
- [x] Secure balance transactions (no negative balances)
- [ ] Production transaction notifications

### 🔐 Security & Auth
- [x] JWT authentication (15m access / 7d refresh tokens)
- [x] OTP phone verification
- [x] Role-based access control (User, Admin)
- [x] Rate limiting & brute force protection
- [x] Idempotency keys for all financial operations
- [x] Audit logging for all admin actions

### 📊 Admin Panel
- [x] Real-time transaction monitoring
- [x] User management & suspension
- [x] Manual FX rate override
- [x] Revenue & volume dashboards
- [x] Webhook log inspection
- [x] Manual transaction retry for stuck payments

---

## 🏗️ System Architecture

```mermaid
graph TB
    subgraph "📱 Client Layer"
        A[Flutter Mobile App]
        B[Next.js Web App]
        C[Next.js Admin Panel]
    end

    subgraph "🔒 API Gateway"
        D[Auth & JWT Validation]
        E[Rate Limiting (Redis)]
        F[Request Routing]
    end

    subgraph "⚙️ Backend Services (NestJS)"
        G[Auth Service]
        H[Wallet Service]
        I[Exchange Service]
        J[Payment Service]
        K[VTU Service]
        L[User Service]
    end

    subgraph "💾 Data Layer"
        M[(PostgreSQL)]
        N[(Redis Cache)]
    end

    subgraph "🌐 External APIs"
        O[Monnify]
        P[VTpass]
        Q[FX Rate APIs]
        R[SMS/OTP APIs]
    end

    A --> D
    B --> D
    C --> D
    D --> E
    E --> F
    F --> G
    F --> H
    F --> I
    F --> J
    F --> K
    F --> L
    G --> M
    H --> M
    I --> M
    J --> M
    K --> M
    L --> M
    G --> N
    I --> N
    J --> N
    J --> O
    K --> P
    I --> Q
    G --> R
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Mobile** | [![Flutter](https://img.shields.io/badge/Flutter-02569B?style=flat-square&logo=flutter&logoColor=white)](https://flutter.dev) + Riverpod + Dio | Single codebase for iOS & Android, smooth fintech UI |
| **Web** | [![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org) + shadcn/ui + TanStack Query | SEO-ready, fast, scalable |
| **Backend** | [![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com) + Prisma | Structured, testable, fintech-grade |
| **Database** | [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org) | ACID compliance for financial data |
| **Cache** | [![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io) | Fast rate caching, session storage |
| **Auth** | JWT + OTP | Secure, industry standard |
| **Payments** | Monnify for NGN virtual accounts, deposits, bank resolution, and withdrawals | Nigerian payment infrastructure |
| **KYC** | Monnify verification API | Server-mediated Nigerian BVN/NIN verification |
| **VTU** | VTpass | Airtime, data, cable, and electricity |
| **CI/CD** | [![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=github-actions&logoColor=white)](https://github.com/features/actions) | Automated testing & deployment |

---

## 🚀 Getting Started

### 📋 Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | 22+ | Backend & Web runtime |
| [npm](https://www.npmjs.com/) | 10+ | Package management |
| [Flutter SDK](https://flutter.dev/) | 3.19+ | Mobile app development |
| [Docker](https://www.docker.com/) | Latest | Local PostgreSQL + Redis |
| [Git](https://git-scm.com/) | 2.40+ | Version control |

### ⚡ Quick Setup

```bash
# 1️⃣ Clone the repository
git clone https://github.com/paullight1/turnpay.git
cd TRUSTPAY

# 2️⃣ Install dependencies
npm install
cd BACKEND && npm install && cd ..
cd WEBSITE && npm install && cd ..
cd APP && flutter pub get && cd ..

# 3️⃣ Configure environment variables
cp BACKEND/.env.example BACKEND/.env
# Edit BACKEND/.env with your API keys

# 4️⃣ Start local databases
npm run docker:up

# 5️⃣ Run database migrations
npm run db:generate
npm run db:migrate

# 6️⃣ Start development servers
npm run dev
```

### 🎯 View the App

| What to View | Command | URL |
|-------------|---------|-----|
| 📱 **Mobile App** (Web Preview) | `cd APP && flutter run -d chrome` | Opens in Chrome |
| 🌐 **Web App** | `cd WEBSITE && npm run dev` | `http://localhost:3000` |
| 🔧 **Backend API** | `cd BACKEND && PORT=3001 npm run start:dev` | `http://localhost:3001/api` |
| 📊 **Admin Panel** | `cd WEBSITE && npm run dev` | `http://localhost:3000/admin` |

> 💡 **Windows users without Android Studio?** Use `flutter run -d chrome` to preview the mobile app directly in your browser!

---

## ⚙️ Available Scripts

| Command | Description | Scope |
|---------|-------------|-------|
| `npm run dev` | Start backend + web dev servers | All |
| `npm run build` | Build all projects for production | All |
| `npm run lint` | Lint all projects | All |
| `npm run test` | Run all test suites | All |
| `npm run docker:up` | Start PostgreSQL + Redis containers | Infrastructure |
| `npm run docker:down` | Stop all containers | Infrastructure |
| `npm run db:migrate` | Run Prisma database migrations | Database |
| `npm run db:generate` | Generate Prisma client types | Database |
| `dev:backend` | Start NestJS backend only | Backend |
| `dev:web` | Start Next.js web app only | Web |

---

## 🔑 Environment Variables

Create `BACKEND/.env` with the following:

```env
# ─── Database ──────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/trustpay?schema=public"

# ─── Redis ─────────────────────────────────────────────────
REDIS_URL="redis://localhost:6379"

# ─── JWT Secrets ───────────────────────────────────────────
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-change-in-production"

# ─── Monnify ───────────────────────────────────────────────
MONNIFY_API_KEY="MK_TEST_xxx"
MONNIFY_SECRET_KEY="your-monnify-secret"
MONNIFY_CONTRACT_CODE="your-contract-code"
MONNIFY_BASE_URL="https://sandbox.monnify.com"
MONNIFY_WEBHOOK_URL=""

# ─── VTpass ────────────────────────────────────────────────
VTU_PROVIDER="vtpass"
VTPASS_BASE_URL="https://sandbox.vtpass.com/api"
VTPASS_API_KEY="your-vtpass-api-key"
VTPASS_PUBLIC_KEY="your-vtpass-public-key"
VTPASS_SECRET_KEY="your-vtpass-secret-key"
VTPASS_WEBHOOK_SECRET="your-webhook-secret"

# ─── Monnify KYC ───────────────────────────────────────────
KYC_PROVIDER="monnify"
MONNIFY_API_KEY="your-monnify-api-key"
MONNIFY_SECRET_KEY="your-monnify-secret"
MONNIFY_BASE_URL="https://sandbox.monnify.com"

# ─── FX Rate API ───────────────────────────────────────────
FX_API_KEY="your-fx-api-key"

# ─── SMS/OTP (Twilio or Africa's Talking) ─────────────────
TWILIO_ACCOUNT_SID="ACxxx"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_PHONE_NUMBER="+1234567890"

# ─── Application ───────────────────────────────────────────
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"
NODE_ENV="development"
```

---

## 🌐 API Endpoints

### Authentication
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/register` | Create new user account | ❌ |
| `POST` | `/auth/login` | Login & get JWT tokens | ❌ |
| `POST` | `/auth/refresh` | Refresh access token | ✅ Refresh |
| `POST` | `/auth/otp/verify` | Verify phone OTP | ❌ |
| `POST` | `/auth/logout` | Logout & invalidate tokens | ✅ |

### Wallet
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/wallets` | Get all user wallets | ✅ |
| `GET` | `/wallets/balance` | Get wallet balance | ✅ |

### Exchange
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/exchange/rate?from=GHS&to=NGN` | Get live exchange rate | ✅ |
| `POST` | `/exchange/quote` | Generate locked quote | ✅ |
| `POST` | `/exchange/execute` | Execute currency exchange | ✅ |

### Payments
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/payments/withdraw` | Request bank withdrawal | ✅ |
| `GET` | `/payments/banks` | List supported banks | ✅ |
| `POST` | `/webhooks/monnify` | Monnify webhook handler | 🔒 |

### KYC
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/kyc/verify` | Verify a consented Nigerian BVN or NIN through Monnify | ✅ |

### VTU
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/vtu/providers` | List VTU providers | ✅ |
| `GET` | `/vtu/packages?provider=xxx` | Get available packages | ✅ |
| `POST` | `/vtu/purchase` | Purchase airtime/data/bills | ✅ |

---

## 📊 Development Progress

<p align="center">
  <img src="https://geps.dev/progress/85?dangerColor=grey&successColor=22c55e&title=Project%20Completion" alt="Progress" width="400" />
</p>

| Phase | Name | Status |
|-------|------|--------|
| ✅ Phase 0 | Project Setup & Infrastructure | Complete |
| ✅ Phase 1 | Core Backend Foundation | Complete |
| ✅ Phase 2 | Exchange Engine | Complete |
| ✅ Phase 3 | External Payments & VTU | Complete |
| ✅ Phase 4 | Frontend Development | Complete |
| ✅ Phase 5 | Admin Panel + Security | Complete |
| ✅ Phase 6 | Missing Core Features | Complete |
| ✅ Phase 7 | Infrastructure & CI/CD | Complete |
| ⏳ Phase 8 | Production Deployment | In Progress |

---

## 🔐 Security Features

TrustPay follows enterprise-grade security practices for financial applications:

- ✅ **Idempotency** — All financial operations use idempotency keys
- ✅ **ACID Transactions** — All balance updates use Prisma transactions
- ✅ **Input Validation** — Strict DTO validation on all endpoints
- ✅ **JWT Guards** — All protected routes enforce authentication
- ✅ **Rate Limiting** — Prevents brute force & abuse
- ✅ **Webhook Verification** — Cryptographic signature validation
- ✅ **Audit Logging** — All financial & admin actions logged
- ✅ **No Floats for Money** — Uses Decimal for financial precision
- ✅ **No Negative Balances** — Enforced at database level

See [`DOCS/SECURITY-RULES.MD`](DOCS/SECURITY-RULES.MD) for the complete 15-section security checklist.

---

## 🌿 Branch Strategy

```
main ────────────────┐  Production-ready code
                     ├── staging ────────┐  Pre-release testing
                     │                   ├── dev ──────────┐  Integration branch
                     │                   │                 ├── feature/auth
                     │                   │                 ├── feature/exchange
                     │                   │                 ├── feature/payments
                     │                   │                 └── hotfix/critical-fix
```

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production-ready code | 🔒 Protected |
| `staging` | Pre-release testing | 🔒 Protected |
| `dev` | Integration branch | ✅ Auto-deploy |
| `feature/*` | New features | ✅ Open |
| `hotfix/*` | Critical fixes | ✅ Open |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [`DOCS/PROJECT-OVERVIEW.MD`](DOCS/PROJECT-OVERVIEW.MD) | 📋 Full project overview & setup guide |
| [`DOCS/ARCHITECTURE.MD`](DOCS/ARCHITECTURE.MD) | 🏗️ System architecture & data flow |
| [`DOCS/BUILDPLAN.MD`](DOCS/BUILDPLAN.MD) | 🗺️ Step-by-step build plan |
| [`DOCS/TASKS.MD`](DOCS/TASKS.MD) | ✅ Detailed task checklist |
| [`DOCS/TECHSTACK.MD`](DOCS/TECHSTACK.MD) | ⚙️ Technology decisions & rationale |
| [`DOCS/SECURITY-RULES.MD`](DOCS/SECURITY-RULES.MD) | 🔐 Complete security checklist |

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please ensure your PR:
- Follows the existing code style
- Includes appropriate tests
- Updates documentation if needed
- Passes all CI checks

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🗺️ Routes

### Backend API
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | Public | User registration |
| POST | `/api/auth/login` | Public | User login |
| POST | `/api/auth/refresh` | Refresh Token | Refresh tokens |
| POST | `/api/auth/logout` | Bearer | Revoke refresh tokens |
| POST | `/api/auth/change-password` | Bearer | Change password |
| POST | `/api/auth/otp/send` | Public | Send OTP |
| POST | `/api/auth/otp/verify` | Public | Verify OTP |
| GET | `/api/users/me` | Bearer | Get current user |
| PATCH | `/api/users/me` | Bearer | Update user |
| GET | `/api/wallets` | Bearer | Get wallet balances |
| GET | `/api/exchange/rate` | Bearer | Get FX rate |
| POST | `/api/exchange/quote` | Bearer | Create exchange quote |
| POST | `/api/exchange/execute` | Bearer | Execute exchange |
| POST | `/api/payments/fund` | Bearer | Fund wallet |
| POST | `/api/payments/withdraw` | Bearer | Withdraw to bank |
| GET | `/api/payments/banks` | Bearer | List banks |
| POST | `/api/payments/banks/resolve` | Bearer | Resolve bank account |
| GET | `/api/vtu/providers` | Bearer | List VTU providers |
| GET | `/api/vtu/packages` | Bearer | Get VTU packages |
| POST | `/api/vtu/purchase` | Bearer | Purchase VTU |
| GET | `/api/transactions` | Bearer | User transaction history |
| GET | `/api/transactions/:ref` | Bearer | Single transaction |
| GET | `/api/admin/users` | Admin | List users |
| PUT | `/api/admin/users/:id` | Admin | Update user |
| GET | `/api/admin/stats` | Admin | Dashboard stats |
| GET | `/api/admin/transactions` | Admin | All transactions |
| POST | `/api/admin/transactions/:ref/status` | Admin | Update transaction |
| GET | `/api/health` | Public | Health check |
| GET | `/api/docs` | Public | Swagger API docs |

### Website Pages (16 routes)
| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/login` | Login |
| `/register` | Registration |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/dashboard` | Dashboard with wallet balances |
| `/dashboard/fund` | Fund wallet |
| `/dashboard/withdraw` | Withdraw to bank |
| `/dashboard/exchange` | Currency exchange |
| `/dashboard/vtu` | Airtime, data, cable, electricity |
| `/dashboard/transactions` | Transaction history |
| `/dashboard/transactions/[id]` | Transaction detail |
| `/dashboard/profile` | Profile & password change |
| `/admin` | Admin dashboard |

---

<p align="center">
  <b>Built with ❤️ for Africa's fintech future</b>
  <br />
  <sub>
    <a href="https://github.com/paullight1/turnpay">GitHub</a> •
    <a href="mailto:support@trustpay.com">Contact</a> •
    <a href="https://trustpay.com">Website</a>
  </sub>
</p>
