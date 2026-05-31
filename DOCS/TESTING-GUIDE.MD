# TRUSTPAY Testing Guide

Complete testing strategy for the TRUSTPAY fintech platform.

---

## Table of Contents
1. [Testing Strategy](#testing-strategy)
2. [Backend Unit Testing](#backend-unit-testing)
3. [Backend Integration Testing](#backend-integration-testing)
4. [Backend E2E Testing](#backend-e2e-testing)
5. [Frontend Unit Testing](#frontend-unit-testing)
6. [Frontend E2E Testing](#frontend-e2e-testing)
7. [Security Testing](#security-testing)
8. [Performance Testing](#performance-testing)
9. [Running Tests](#running-tests)

---

## Testing Strategy

### Pyramid
```
        /\
       /  \      E2E Tests (Few)
      /----\
     /      \    Integration Tests (Some)
    /--------\
   /          \  Unit Tests (Many)
  /------------\
```

### Coverage Targets
- **Unit tests:** > 80% line coverage
- **Integration tests:** All critical paths (auth, payments, exchange)
- **E2E tests:** All user-facing flows

### Current Manual Receipt And Monnify Status

- Monnify-only NGN virtual account provisioning and deposit webhook crediting are implemented backend paths.
- Manual NGN to GHS receipt submission and admin review are implemented backend/admin paths under `/api/exchange/receipts` and `/api/admin/exchange/receipts/:receiptId/review`.
- Remaining test gaps: backend e2e coverage for the manual receipt flow, receipt upload/proof URL authorization, duplicate `Idempotency-Key` behavior, duplicate admin review attempts, non-admin denial, missing idempotency keys, and duplicate Monnify webhook replay.
- Remaining production gaps that tests should not hide: private receipt bucket setup, live environment setup, collection-account display configuration, and reconciliation against bank or Monnify settlement evidence.

---

## Backend Unit Testing

### Setup
Tests use Jest + NestJS TestingModule. Mock all external dependencies.

### Test File Pattern
```
src/{module}/{service}.spec.ts
```

### Example: Service Test
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExchangeService } from './exchange.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateService } from './providers/rate.service';
import { RedisService } from '../redis/redis.service';

describe('ExchangeService', () => {
  let service: ExchangeService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
    wallet: { findFirst: jest.fn(), update: jest.fn() },
    transaction: { create: jest.fn() },
  };

  const mockRateService = {
    getRate: jest.fn().mockResolvedValue({ rate: 3.1746, markup: 2.5 }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        ExchangeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RateService, useValue: mockRateService },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it('should throw error if from and to currencies are the same', async () => {
    await expect(
      service.createQuote('user-1', { from: 'GHS', to: 'GHS', amount: 100 }),
    ).rejects.toThrow('Source and destination currencies must be different');
  });
});
```

### Key Tests to Write

| Module | Test Cases |
|--------|-----------|
| **AuthService** | Register (success, duplicate email, duplicate phone), Login (success, wrong password, locked account), Refresh tokens (valid, expired, revoked), Change password (valid, wrong current) |
| **WalletsService** | Provision wallets (success, already exists), Get balances, Get single wallet |
| **ExchangeService** | Create quote (valid, same currency), Execute quote (valid, expired, insufficient balance, wrong user), Upload manual receipt proof (valid, KYC failure, invalid file type/size), Submit manual receipt (valid, KYC failure, duplicate bank reference, invalid receipt proof), Admin review receipt (approve-and-credit, reject, needs more info, terminal-state retry) |
| **BankingService** | Provision Monnify virtual account (success, KYC failure, suspended user, unsupported provider), Process Monnify webhook (valid, invalid signature, duplicate reference, amount/currency mismatch) |
| **PaymentService** | Fund wallet (Paystack, Flutterwave), Verify payment, Webhook processing (idempotency, amount mismatch), Withdraw (success, insufficient balance, transfer failure, reversal) |
| **VtuService** | Purchase (success, insufficient balance, provider failure, reversal) |
| **OtpService** | Send OTP, Verify (valid, expired, max attempts, wrong code) |
| **RateService** | Fetch rates (API success, API failure, fallback), Manual override, Cache expiry |
| **AdminService** | Get users (pagination, filters), Update user, Suspend/unsuspend, Get stats |

---

## Backend Integration Testing

### Setup
Uses real PostgreSQL + Redis via Testcontainers or Docker Compose.

### Prerequisites
```bash
# Start test databases
docker-compose -f docker-compose.test.yml up -d
```

### Example: Integration Test
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await app.close();
  });

  it('/api/auth/register (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        phone: '+2348012345678',
        password: 'TestPass123',
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(response.body.user.email).toBe('test@example.com');
  });

  it('/api/auth/login (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'TestPass123',
      })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
  });
});
```

### Key Integration Tests

| Flow | Test |
|------|------|
| **Auth Flow** | Register → Login → Refresh → Change Password → Logout |
| **Wallet Flow** | Register → Verify wallets created → Check balances |
| **Exchange Flow** | Submit manual NGN receipt → Admin approve-and-credit → Verify GHS ledger credit and audit log |
| **Monnify Virtual Account Flow** | Provision Monnify account → Simulate signed webhook → Verify one NGN wallet credit → Replay webhook → Verify no duplicate credit |
| **Payment Flow** | Initiate payment → Webhook simulation → Verify wallet credited |
| **VTU Flow** | Fund → Purchase airtime → Verify balance deducted → Failure reversal |
| **Admin Flow** | Login as admin → Get users → Update user → Get stats |

---

## Backend E2E Testing

### Setup
Uses Jest + Supertest with full NestJS app.

### Test File Location
```
test/
  auth.e2e-spec.ts
  exchange.e2e-spec.ts
  exchange-receipts.e2e-spec.ts
  banking-monnify.e2e-spec.ts
  payments.e2e-spec.ts
  vtu.e2e-spec.ts
  admin.e2e-spec.ts
```

### Monnify-Verified Exchange Deposit E2E Cases Still Required

| Flow | Expected Coverage |
|------|-------------------|
| **User deposit instruction** | Authenticated Tier 2 user calls `POST /api/exchange/monnify-deposit-intents` with amount and `Idempotency-Key`; response includes pending receipt, generated reference, collection/virtual-account details, fixed rate, and expected GHS credit |
| **Monnify match** | Valid signed Monnify webhook with matching amount/reference marks the receipt provider verified and does not credit NGN or GHS automatically |
| **Monnify fallback** | Valid signed Monnify webhook that does not match an exchange intent continues to normal NGN wallet funding when it maps to a user virtual account |
| **Duplicate submit** | Reusing the same `Idempotency-Key` returns the original response; reusing the same bank reference cannot create a second creditable receipt |
| **Admin credit verified** | Admin with role guard credits a Monnify verified deposit with reason and `Idempotency-Key`; receipt becomes `CREDITED`, transaction becomes `SUCCESS`, GHS wallet is credited once, and audit log is written |
| **Duplicate admin review** | Reusing the same review key returns the original response; a different review attempt after terminal status is rejected and does not credit again |
| **Reject / needs more info** | Admin reason is stored, user-visible status changes, and no wallet credit occurs |
| **Auth boundaries** | Missing token, user token on admin route, and missing/short reason are rejected |
| **Credit guard** | A Monnify exchange deposit cannot be credited while provider verification is missing or mismatched |
| **Proof access** | Owner can open proof through `GET /api/exchange/receipts/:receiptId/proof-url`; admin can open proof through audited `POST /api/admin/exchange/receipts/:receiptId/proof-url`; another user cannot open it |

### Monnify E2E Cases Still Required

| Flow | Expected Coverage |
|------|-------------------|
| **Provisioning** | Verified, active user provisions a Monnify-only NGN virtual account; unsupported providers are rejected |
| **Signed webhook credit** | Valid Monnify webhook creates one provider event, transaction, ledger entry, and NGN wallet credit |
| **Webhook replay** | Duplicate Monnify reference or replayed webhook does not duplicate wallet credit |
| **Webhook rejection** | Invalid signature, wrong currency, and amount mismatch are rejected or routed to review without wallet credit |

### Example: E2E Auth Flow
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshToken: string;

  const testUser = {
    email: `test-${Date.now()}@example.com`,
    phone: `+234${Date.now().toString().slice(-10)}`,
    password: 'TestPass123',
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'test-' } } });
    await app.close();
  });

  it('Full auth flow: register → login → refresh → logout', async () => {
    // Register
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    accessToken = registerRes.body.accessToken;
    refreshToken = registerRes.body.refreshToken;

    // Get profile
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // Refresh
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(200);

    const newAccessToken = refreshRes.body.accessToken;

    // Logout
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(200);

    // Verify token is revoked
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${refreshRes.body.refreshToken}`)
      .expect(401);
  });
});
```

---

## Frontend Unit Testing

### Setup
Uses Vitest + React Testing Library.

### Install
```bash
cd website
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

### Configure (vite.config.ts)
```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

### Example: Component Test
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth-provider';
import LoginPage from '@/app/login/page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('LoginPage', () => {
  it('renders login form', () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows forgot password link', () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  });
});
```

---

## Frontend E2E Testing

### Setup
Uses Playwright.

### Install
```bash
cd website
npm init playwright@latest
```

### Configure (playwright.config.ts)
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Example: E2E Test
```typescript
import { test, expect } from '@playwright/test';

test('user can register and see dashboard', async ({ page }) => {
  // Go to homepage
  await page.goto('/');
  await expect(page).toHaveTitle(/TrustPay/i);

  // Click Get Started
  await page.click('text=Get Started');
  await expect(page).toHaveURL(/register/);

  // Fill registration form
  const timestamp = Date.now();
  await page.fill('input[type="email"]', `test-${timestamp}@example.com`);
  await page.fill('input[type="tel"]', `+234${timestamp.toString().slice(-10)}`);
  await page.fill('input[type="password"]', 'TestPass123');

  // Submit
  await page.click('text=Create Account');

  // Should redirect to dashboard
  await expect(page).toHaveURL(/dashboard/);

  // Should see welcome message
  await expect(page.getByText(/welcome back/i)).toBeVisible();
});

test('exchange quote renders', async ({ page }) => {
  // Login first
  await page.goto('/login');
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'TestPass123');
  await page.click('text=Sign In');

  // Go to exchange
  await page.goto('/dashboard/exchange');

  // Enter amount
  await page.fill('input[type="number"]', '100');

  // Get quote
  await page.click('text=Get Quote');

  // Should show quote details
  await expect(page.getByText(/you send/i)).toBeVisible();
  await expect(page.getByText(/exchange rate/i)).toBeVisible();
});

// TODO: add customer manual receipt submission E2E. It should upload proof,
// submit with one stable Idempotency-Key, and show submitted/reviewed receipt
// states.

test('mobile navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/dashboard');

  // Should see hamburger menu
  const menuButton = page.getByRole('button', { name: /open menu/i });
  await expect(menuButton).toBeVisible();

  // Open menu
  await menuButton.click();

  // Should see navigation links
  await expect(page.getByText('Fund')).toBeVisible();
  await expect(page.getByText('Withdraw')).toBeVisible();
  await expect(page.getByText('Exchange')).toBeVisible();
});
```

---

## Security Testing

### Automated
| Test | Tool | Command |
|------|------|---------|
| Dependency vulnerabilities | `npm audit` | `npm audit --production` |
| Static analysis | `npm run lint` | `npm run lint` |
| Secret scanning | Gitleaks | `gitleaks detect --source .` |

### Manual Checklist
- [ ] Webhook signature verification works
- [ ] JWT tokens expire correctly (15m access, 7d refresh)
- [ ] Rate limiting blocks after threshold
- [ ] Account locks after 5 failed attempts
- [ ] Idempotency prevents duplicate transactions
- [ ] CORS rejects unauthorized origins
- [ ] XSS: User input is sanitized
- [ ] SQL injection: All queries use Prisma ORM
- [ ] No secrets in code or logs
- [ ] HTTPS enforced in production

### Penetration Testing
1. Test auth bypass (missing token, expired token, invalid role)
2. Test privilege escalation (user accessing admin endpoints)
3. Test payment manipulation (negative amounts, overflow)
4. Test webhook forgery (missing/invalid signature)
5. Test race conditions (concurrent exchange execution)

---

## Performance Testing

### Load Testing
Tool: k6 or Artillery

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
};

export default function () {
  const res = http.get('http://localhost:3000/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(1);
}
```

### Targets
| Endpoint | Target Response Time |
|----------|---------------------|
| Health check | < 50ms |
| Login | < 200ms |
| Get wallets | < 100ms |
| Create quote | < 300ms |
| Execute exchange | < 500ms |
| Process webhook | < 100ms |

---

## Running Tests

### Backend
```bash
# Unit tests
cd backend && npm run test

# Watch mode
cd backend && npm run test:watch

# Coverage
cd backend && npm run test:cov

# E2E tests
cd backend && npm run test:e2e
```

### Frontend
```bash
# Unit tests
cd website && npx vitest run

# Watch mode
cd website && npx vitest

# E2E tests
cd website && npx playwright test

# E2E with UI
cd website && npx playwright test --ui
```

### CI
```bash
# Run all checks
npm run lint && npm run test && npm run build
```

---

## Test Data

### Seed Script
```bash
cd backend
npx ts-node prisma/seed.ts
```

### Test User Accounts
| Role | Email | Password |
|------|-------|----------|
| User | test@trustpay.com | TestPass123 |
| Admin | admin@trustpay.com | AdminPass123! |

---

## Continuous Integration

All tests run automatically on:
- Push to `main` or `dev`
- Pull requests to `main` or `dev`

See `.github/workflows/ci.yml` for configuration.
