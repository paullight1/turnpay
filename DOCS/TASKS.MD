# 📋 TRUSTPAY: Comprehensive Task Checklist

This document breaks down the high-level BUILDPLAN into an extremely granular, actionable task list. Every phase is strictly sequenced to ensure maximum security, scalability, and ease of development.

---

## 🟢 PHASE 0: PROJECT SETUP & INFRASTRUCTURE FOUNDATION

### 1. Repository & Version Control
- [ ] Initialize Git repositories (or Monorepo via Nx/Turborepo) for `mobile`, `web`, and `backend`.
- [ ] Configure Git branch strategy (e.g., `main`, `staging`, `dev`, `feature/*`, `hotfix/*`).
- [ ] Setup standard `.gitignore` rules for Node, Flutter, Next.js, and OS files.
- [ ] Implement pre-commit hooks (Husky) to enforce linting and formatting before commits.

### 2. Backend Engine Initialization (NestJS)
- [ ] Bootstrap NestJS application base (`nest new trustpay-api`).
- [ ] Install and configure `@nestjs/config` for strict environment variable validation (Joi or Zod).
- [ ] Set up Docker and `docker-compose.yml` for local development (PostgreSQL + Redis).
- [ ] Configure ESLint and Prettier for strict TypeScript formatting.
- [ ] Setup global Exception Filter to capture and standardise all HTTP error responses.
- [ ] Setup global Validation Pipe with `class-validator` and `class-transformer`.
- [ ] Configure Pino or Winston for structured JSON logging.

### 3. Frontend Initialization (Web/Admin - Next.js)
- [ ] Bootstrap Next.js 14+ with App Router (`npx create-next-app`).
- [ ] Integrate Tailwind CSS and setup global variables (colors, fonts, spacing).
- [ ] Setup a UI component library (e.g., shadcn/ui or Radix UI) for robust accessible components.
- [ ] Configure standard Next.js directory structure (`app`, `components`, `lib`, `hooks`, `store`).
- [ ] Setup API client (Axios or native fetch with TanStack Query).

### 4. Mobile Initialization (Flutter)
- [ ] Create Flutter project base.
- [ ] Configure build environments/flavors (Dev, Staging, Prod) for iOS and Android.
- [ ] Establish directory architecture (`screens`, `widgets`, `services`, `models`, `providers`).
- [ ] Setup State Management framework (Riverpod or BLoC).
- [ ] Configure HTTP client package (e.g., `dio` or `http`) with global interceptors.

---

## 🟢 PHASE 1: CORE BACKEND FOUNDATION

### 1. Database Schema & ORM Setup
- [ ] Initialize PostgreSQL Database.
- [ ] Configure ORM (Prisma/TypeORM) connection pooling.
- [ ] Design and migrate `Users` table (id, email, password, role, phone, KYC status).
- [ ] Design and migrate `Wallets` table for user balances (id, user_id, currency, balance).
- [ ] Design and migrate `Transactions` table (id, user_id, type, amount, status, reference, metadata).
- [ ] Design and migrate `Rates` table for historical tracking of FX conversions.
- [ ] Design and migrate `Services` table (cable, data, airtime providers).
- [ ] Generate typed ORM client.

### 2. Authentication & Identity Service
- [ ] Create `AuthModule` and `UsersModule`.
- [ ] Implement user registration endpoint `/auth/register` (with password hashing using Argon2/Bcrypt).
- [ ] Implement login endpoint `/auth/login`.
- [ ] Setup Passport.js or native JWT generation with strict expiration times (e.g., 15m access, 7d refresh).
- [ ] Implement refresh token rotation mechanism.
- [ ] Create JWT validation Guards (`@UseGuards(JwtAuthGuard)`).
- [ ] Implement Role-Based Access Control (RBAC) decorators (`@Roles('ADMIN')`).
- [ ] Integrate SMS provider (e.g., Twilio / Africa's Talking) for OTP delivery.
- [ ] Implement OTP verification flow for signup and password reset.

### 3. User Profile & Basic Wallet Service
- [ ] Create endpoint to fetch current user profile (`GET /users/me`).
- [ ] Create endpoint to update user details (`PATCH /users/me`).
- [ ] Create trigger/service to automatically provision an empty NGN & GHS Wallet on user registration.
- [ ] Endpoint to fetch wallet balances (`GET /wallets`).

---

## 🟢 PHASE 2: EXCHANGE ENGINE

### 1. FX Rate Management
- [ ] Integrate third-party FX API (e.g., ExchangeRate-API, Wise, or custom admin inputs).
- [ ] Create CRON job service `@nestjs/schedule` to fetch and update live rates hourly.
- [ ] Implement Redis caching layer to cache the current exchange rates (GHS ⇄ NGN) to reduce external API hits.
- [ ] Build internal endpoint to fetch live conversion rate `GET /exchange/rate?from=GHS&to=NGN`.

### 2. Conversion & Fee Logic
- [ ] Create internal formula/service to calculate conversion with application percentage markup.
- [ ] Build "Quote" endpoint: `POST /exchange/quote` -> Returns 'You Send', 'They Receive', 'Fees', 'Rate', and 'Quote Expiry'.
- [ ] Cache generated quotes in Redis with a TTL (e.g., 10 minutes) so users pay the exact quoted amount.

### 3. Internal Transfer / Exchange Execution
- [ ] Create endpoint `POST /exchange/execute` utilizing the locked quote ID.
- [ ] Implement ACID-compliant Database Transactions:
    - Deduct from Source Wallet (GHS).
    - Add to Target Wallet (NGN).
    - Deduct system fee.
    - Write Transaction Record (Status: success).

---

## 🟢 PHASE 3: EXTERNAL PAYMENTS & VTU INTEGRATION

### 1. Payment Gateway Inlets (Funding)
- [ ] Integrate Flutterwave/Paystack initialization API.
- [ ] Create `POST /payments/fund` logic to generate payment link / virtual account.
- [ ] Create specialized Webhook listener `POST /webhooks/paystack` / `flutterwave`.
- **[CRITICAL]** Implement Webhook cryptographic signature verification.
- **[CRITICAL]** Implement Idempotency (prevent duplicate credit if webhook is sent twice via unique transaction IDs).
- [ ] On successful webhook, credit user's database Wallet.

### 2. Payouts (Bank Transfers)
- [ ] Integrate Flutterwave/Paystack Transfer API.
- [ ] Build endpoint to resolve/validate bank account numbers `GET /payments/banks/resolve`.
- [ ] Build endpoint to list all supported banks `GET /payments/banks`.
- [ ] Build endpoint to initiate withdrawal/payout `POST /payments/withdraw`.
- [ ] Implement pending state and update on `transfer.successful` or `transfer.failed` webhook.

### 3. VTU Integration (Airtime / Data / Electricity / Cable)
- [ ] Identify and integrate VTU aggregators APIs (e.g. Reloadly, TopUp, Shago).
- [ ] Build `GET /vtu/providers` (Fetch MTN, Airtel, DSTV, etc.).
- [ ] Build `GET /vtu/packages?provider=xxx`.
- [ ] Build validation for Smart Card numbers / Meter numbers.
- [ ] Build `POST /vtu/purchase`.
    - Check user wallet balance -> Deduct Wallet -> Call VTU API -> If Fail, Reverse Wallet -> Update Transaction object.

---

## 🟢 PHASE 4: FRONTEND DEVELOPMENT (MOBILE)

### 1. Core Structure & Onboarding
- [ ] Setup app routing (e.g. `go_router` or `auto_route`).
- [ ] Build Splash Screen (Loading states).
- [ ] Build Onboarding screens (Swipeable carousel explaining features).
- [ ] Build Login / Register Screens with Form Validation.
- [ ] Build OTP Verification Screen.
- [ ] Implement Secure Auth Service (Storing JWT safely with secure storage layer).

### 2. Dashboard / Home 
- [ ] Develop Main App Shell / Bottom Navigation Bar.
- [ ] Build Dashboard Screen UI (Show Balance, Quick actions, Recent transactions).
- [ ] Integrate `GET /wallets` and `GET /transactions` via Riverpod/BLoC.
- [ ] Build pull-to-refresh logic for the dashboard.

### 3. Exchange Flow (GHS ⇄ NGN)
- [ ] Build Currency Exchange screen (From / To inputs).
- [ ] Implement active debouncing for typing to call `GET /exchange/quote` seamlessly.
- [ ] Build 'Transaction Review / Confirmation' slide-up modal or screen.
- [ ] Build Success / Lottie Animation screen upon completion.

### 4. VTU & Bills Flow
- [ ] Build Services Grid (Airtime, Data, TV, Electricity).
- [ ] Build Data/Airtime selection pages.
- [ ] Build TV/Energy input forms with dynamic validation loaders (validating customer name).
- [ ] Implement Checkout flow using local Wallet balance.

### 5. Profile & Settings
- [ ] Build User Profile visualization.
- [ ] Build 'Change Password' / 'Security' settings.
- [ ] Build Help / Contact Support links.
- [ ] Implement Logout methodology (clearing secure storage + resetting state).

---

## 🟢 PHASE 5: ADMIN PANEL (Next.js)

### 1. Authentication & System Access
- [ ] Setup Next.js Auth flow (restricted to User role = ADMIN).
- [ ] Create login page for admins.
- [ ] Setup App Router protected layouts.

### 2. Dashboard Overviews
- [ ] Build high-level metrics dashboard: Total Volume, Active Users, Revenue from Fees.
- [ ] Implement dynamic charts (e.g., using Recharts or Chart.js).

### 3. Transaction Management
- [ ] Build complete Transactions Data Table (Server-side pagination, sorting, filtering by Date/Status).
- [ ] Build Transaction Details modal (View Webhook logs, raw JSON payloads).
- [ ] Implement manual retry buttons for stuck transactions (Call specific Admin backend APIs).

### 4. User & Rate Management
- [ ] Build Users list with suspension functionality.
- [ ] Build 'Manual FX Rate Override' form.
- [ ] Build logs page for system flags (failed webhook tracking).

---

## 🟢 PHASE 6: SECURITY & SYSTEM STABILITY

### 1. Attack Mitigations
- [ ] Configure `helmet` in NestJS to set secure HTTP headers.
- [ ] Implement CORS cleanly (only allow Web URL and Admin URL origin).
- [ ] Install and configure `nestjs/throttler` (Rate limiter) across Auth and Payment initiation endpoints (e.g., Max 5 OTPs per hour).
- [ ] Audit user inputs against SQLi and XSS (sanitization pipes).

### 2. Logging & Monitoring
- [ ] Set up Sentry.io wrapper for both Backend error tracking and Frontend crash analytics.
- [ ] Inject raw request logging (IP, Route, Status, Latency) to identify bottlenecks.
- [ ] Enable Dead Letter Queues (DLQ) if using microservices or background jobs.

---

## 🟢 PHASE 7: QA & TESTING

### 1. Automated Testing (Backend)
- [ ] Write Unit tests (Jest) for Currency Conversion math logic.
- [ ] Write Unit tests for VTU deduction logic (ensuring negative balances are impossible).
- [ ] Write E2E integration tests for Authentication flow and Wallet provisioning.
- [ ] Write E2E simulated tests for dummy Webhooks hitting the system.

### 2. Manual & Edge Case Testing (Mobile/Web)
- [ ] Test on varying screen sizes (iOS small screens vs Android tablets).
- [ ] Simulate network failures during payments (Handling timeouts gracefully).
- [ ] Stress-test duplicate requests (mashing the 'Pay' button 10 times quickly to ensure idempotency holds).
- [ ] Test the exact behavior of expired JWT tokens and the auto-refresh flow.

---

## 🟢 PHASE 8: CLOUD DEPLOYMENT & LAUNCH

### 1. Server Configuration
- [ ] Provision AWS RDS / DigitalOcean Managed Database (PostgreSQL).
- [ ] Provision managed Redis instance.
- [ ] Deploy NestJS backend (Using AWS ECS, Elastic Beanstalk, or DO App Platform).
- [ ] Issue HTTPS / SSL Certificates.
- [ ] Bind custom Domain (api.trustpay.com).

### 2. Frontend Deployment
- [ ] Deploy Next.js Web App and Admin Dashboard to Vercel (or AWS Amplify).
- [ ] Bind domains (admin.trustpay.com, trustpay.com). 

### 3. App Stores
- [ ] Configure App Store provisioning profiles and certificates.
- [ ] Configure Google Play Console Keystores.
- [ ] Verify App Permissions (Internet, Biometrics).
- [ ] Submit TestFlight (iOS) and Internal Testing (Android) builds.
- [ ] Final compliance check and live store submission.

---
**END OF DOCUMENT**
