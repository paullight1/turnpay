# VTpass VTU Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Nigeria-only VTpass airtime, data, cable, and prepaid/postpaid electricity across the TRUSTPAY backend, website, Flutter app, and admin operations with financially safe recovery and disabled `Coming soon` states for every other market.

**Architecture:** Harden the existing VTU module in place around a typed VTpass adapter, an atomic wallet/order lifecycle, and a durable VTpass callback inbox. Keep provider authority and financial calculations on the NestJS backend; web and Flutter consume the same DTO contract and expose only Nigeria as enabled.

**Tech Stack:** NestJS, TypeScript strict mode, Prisma, PostgreSQL, Redis, Jest, Next.js 16, React, TanStack Query, Playwright, Flutter, Riverpod, Dio, and Flutter Test.

**Spec:** `DOCS/superpowers/specs/2026-09-03-vtpass-vtu-production-completion-design.md`

## Global Constraints

- Read and enforce `DOCS/SECURITY-RULES.MD` for every change.
- VTpass is the only runtime VTU provider; do not restore Reloadly or generic adapters.
- Nigeria (`NG`) and NGN are the only enabled VTU market and currency.
- Other markets may be visible only as disabled `Coming soon` options.
- Every authenticated POST/PUT/PATCH/DELETE uses a stable `Idempotency-Key` for one visible attempt.
- Every wallet debit or credit executes through `LedgerService` inside a Prisma transaction.
- Monetary state and backend calculations use Prisma `Decimal` or canonical two-decimal strings, never floating-point arithmetic.
- Protected routes use `JwtAuthGuard`; admin routes keep role guards and audit logging.
- Provider credentials, transaction PINs, raw identifiers, callback authentication material, and purchased codes never enter logs.
- Do not read, print, generate, or commit provider credentials.
- Preserve unrelated changes in the shared dirty worktree. Before every commit, inspect `git diff --cached` and unstage any pre-existing hunk.

## File Map

### Backend contract and provider

- Modify `BACKEND/src/vtu/dto/vtu.dto.ts`: product-specific DTO validation and normalized Nigeria phone fields.
- Create `BACKEND/src/vtu/dto/vtu.dto.spec.ts`: DTO transformation and rejection coverage.
- Modify `BACKEND/src/vtu/vtu.controller.ts`: body-based customer validation and unchanged guarded user routes.
- Modify `BACKEND/src/vtu/vtu.controller.spec.ts`: controller contract delegation.
- Create `BACKEND/src/vtu/providers/vtpass.types.ts`: VTpass request, response, normalized result, package, and receipt types.
- Modify `BACKEND/src/vtu/providers/vtu-api.provider.ts`: VTpass-only catalog, payloads, circuit breaker, safe normalization, simulation gate, and receipt extraction.
- Modify `BACKEND/src/vtu/providers/vtu-api.provider.spec.ts`: official contract fixtures for every product and status.

### Backend persistence and lifecycle

- Modify `BACKEND/prisma/schema.prisma`: encrypted purchased-code field, provider commission field, and durable VTpass inbox model.
- Create `BACKEND/prisma/migrations/035_vtpass_vtu_production_completion/migration.sql`: additive schema migration and indexes.
- Create `BACKEND/src/vtu/vtu-receipt.service.ts`: purchased-code encryption/decryption and owner-only response shaping.
- Create `BACKEND/src/vtu/vtu-receipt.service.spec.ts`: encryption, missing-key, and redaction coverage.
- Create `BACKEND/src/vtu/vtu-webhook-inbox.service.ts`: idempotent callback recording, claiming, processing, and retry scheduling.
- Create `BACKEND/src/vtu/vtu-webhook-inbox.service.spec.ts`: callback replay and crash-recovery coverage.
- Modify `BACKEND/src/vtu/vtu.service.ts`: server pricing, verification, atomic financial lifecycle, guarded status transitions, safe receipts, and reconciliation fields.
- Modify `BACKEND/src/vtu/vtu.service.spec.ts`: financial and product lifecycle tests.
- Modify `BACKEND/src/vtu/vtpass-webhook.controller.ts`: strict transaction-update DTO normalization and signature-only internal trust boundary.
- Modify `BACKEND/src/vtu/vtpass-webhook.controller.spec.ts`: authentication, malformed input, and acknowledgement tests.
- Modify `BACKEND/src/vtu/vtu-requery.service.ts`: pending-order and callback-inbox recovery.
- Modify `BACKEND/src/vtu/vtu.module.ts`: register receipt and inbox services.

### Configuration, clients, operations, and documentation

- Modify `BACKEND/src/app.module.ts`: validate VTU feature, simulation, credentials, base URL, webhook secret, and thresholds.
- Create `BACKEND/src/vtu/vtpass-production-config.spec.ts`: deployed configuration validation.
- Modify `BACKEND/.env.example`, `BACKEND/do-app.yaml`, `BACKEND/fly.toml`, `render.yaml`, `docker-compose.prod.yml`, and `BACKEND/scripts/validate-production-config.sh`: consistent VTpass deployment variables and live URL.
- Modify `WEBSITE/src/types/index.ts` and `WEBSITE/src/services/api.ts`: typed shared VTU contract and idempotent validation calls.
- Modify `WEBSITE/src/app/dashboard/vtu/page.tsx`: four complete Nigeria flows, receipt token, and disabled other markets.
- Create `WEBSITE/e2e/vtu.spec.ts`: mocked browser contract and interaction coverage.
- Modify `APP/lib/services/vtu_service.dart`: matching request/response models and idempotent validation calls.
- Modify `APP/lib/features/home/screens/money_action_screen.dart`: remove legacy provider submissions, add meter/cable choices, receipts, and `Coming soon` states.
- Create `APP/test/vtu_service_contract_test.dart`: Dio request contract coverage.
- Create `APP/test/vtu_money_action_flow_test.dart`: widget coverage for supported and unavailable markets.
- Modify `BACKEND/src/admin/admin.service.ts`, `BACKEND/src/admin/admin.service.spec.ts`, and `WEBSITE/src/app/admin/vtu/page.tsx`: provider financial fields, durable callback failures, and safe manual requery visibility.
- Modify `DOCS/PRODUCTION-GUIDES/08-VTU.MD`, `DOCS/VTU-VTPASS-IMPLEMENTATION-TASKS.MD`, `DOCS/TASKS.MD`, and `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`: final operations, sandbox certification, and launch gates.
- Create `BACKEND/test/vtpass-vtu.financial.e2e-spec.ts`: disposable-database idempotency, concurrency, and reversal certification.

---

### Task 1: Lock The Nigeria-Only API Contract

**Files:**
- Modify: `BACKEND/src/vtu/dto/vtu.dto.ts`
- Create: `BACKEND/src/vtu/dto/vtu.dto.spec.ts`
- Modify: `BACKEND/src/vtu/vtu.controller.ts`
- Modify: `BACKEND/src/vtu/vtu.controller.spec.ts`

**Interfaces:**
- Produces: `VtuType`, `VtuMeterType`, and `VtuSubscriptionType` literal unions.
- Produces: `ValidateSmartCardDto { provider, smartCardNumber, subscriptionType, contactPhone }`.
- Produces: `ValidateMeterDto { provider, meterNumber, meterType, contactPhone }`.
- Produces: `PurchaseVtuDto` with `contactPhone`, conditional target fields, `meterType`, and `subscriptionType`.
- Consumes: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and transformation enabled.

- [ ] **Step 1: Write DTO tests that express the new contract**

```ts
const validElectricity = await transformAndValidate(PurchaseVtuDto, {
  type: 'electricity',
  provider: 'ikedc',
  contactPhone: '08031234567',
  meterNumber: '1111111111111',
  meterType: 'prepaid',
  amount: '1000.00',
  transactionPin: '2468',
});
expect(validElectricity.contactPhone).toBe('+2348031234567');

await expectValidationFailure(PurchaseVtuDto, {
  ...validElectricity,
  scope: 'international',
});

await expectValidationFailure(PurchaseVtuDto, {
  type: 'cable',
  provider: 'dstv',
  contactPhone: '+2348031234567',
  smartCardNumber: '1212121212',
  subscriptionType: 'change',
  amount: '6500.00',
});
```

- [ ] **Step 2: Run the DTO tests and verify the contract is absent**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/dto/vtu.dto.spec.ts`

Expected: FAIL because meter type, contact-phone normalization, cable package rules, and legacy-field rejection are not implemented.

- [ ] **Step 3: Implement exact conditional validation**

```ts
export const VTU_TYPES = ['airtime', 'data', 'cable', 'electricity'] as const;
export const VTU_METER_TYPES = ['prepaid', 'postpaid'] as const;
export const VTU_SUBSCRIPTION_TYPES = ['change', 'renew'] as const;

export type VtuType = (typeof VTU_TYPES)[number];
export type VtuMeterType = (typeof VTU_METER_TYPES)[number];
export type VtuSubscriptionType = (typeof VTU_SUBSCRIPTION_TYPES)[number];
```

Use a transform that converts `08031234567` and `2348031234567` to
`+2348031234567`, rejects non-Nigerian numbers, and leaves no unvalidated
cross-product fields. Require `packageId` for data and cable `change`; require
`meterType` for electricity; require `contactPhone` for all products.

- [ ] **Step 4: Move validation POST inputs to request bodies**

```ts
@Post('validate/meter')
@Throttle({ default: { limit: 10, ttl: 60000 } })
validateMeter(@Body() dto: ValidateMeterDto) {
  return this.vtuService.validateMeter(dto);
}
```

Apply the same shape to smart-card validation. Keep the class-level
`JwtAuthGuard`, and add controller assertions that the DTO object is forwarded
unchanged.

- [ ] **Step 5: Run the focused controller and DTO suites**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/dto/vtu.dto.spec.ts src/vtu/vtu.controller.spec.ts`

Expected: PASS.

- [ ] **Step 6: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/src/vtu/dto/vtu.dto.ts BACKEND/src/vtu/dto/vtu.dto.spec.ts BACKEND/src/vtu/vtu.controller.ts BACKEND/src/vtu/vtu.controller.spec.ts`

If those paths contain only task-owned hunks, commit with
`feat(vtu): lock Nigeria-only request contract`; otherwise leave them
unstaged and record the passing checkpoint in the final handoff.

### Task 2: Make The VTpass Adapter Contract-Accurate

**Files:**
- Create: `BACKEND/src/vtu/providers/vtpass.types.ts`
- Modify: `BACKEND/src/vtu/providers/vtu-api.provider.ts`
- Modify: `BACKEND/src/vtu/providers/vtu-api.provider.spec.ts`

**Interfaces:**
- Consumes: normalized E.164 Nigeria phones and the DTO literal unions from Task 1.
- Produces: `VtuPackage { id, name, price: string, validity, serviceType }`.
- Produces: `VtuProviderResult { providerRequestId, providerTransactionId, status, message, providerCost?, providerCommission?, purchasedCode?, safeResponse }`.
- Produces: `verifySmartCard`, `verifyMeter`, `purchase`, and `requery` methods guarded by the `vtpass` circuit.

- [ ] **Step 1: Add failing provider fixtures for all products**

```ts
it.each([
  ['airtime', { serviceID: 'mtn', phone: '08031234567' }],
  ['data', { serviceID: 'mtn-data', billersCode: '08031234567' }],
  ['cable', { serviceID: 'dstv', subscription_type: 'change' }],
  ['electricity', { serviceID: 'ikeja-electric', variation_code: 'postpaid' }],
])('builds the VTpass %s payload', async (type, expected) => {
  await provider.purchase(requestFor(type));
  expect(httpService.post).toHaveBeenCalledWith(
    expect.stringMatching(/\/pay$/),
    expect.objectContaining(expected),
    expect.any(Object),
  );
});
```

Add fixtures proving an inner `reversed` status wins over code `000`, code
`099` remains pending, unknown responses remain pending, and
`purchased_code`, `total_amount`, and `commission` are extracted but excluded
from `safeResponse` where sensitive.

- [ ] **Step 2: Run the provider suite and verify expected failures**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/providers/vtu-api.provider.spec.ts`

Expected: FAIL for postpaid payloads, cable renewal, decimal-string packages,
receipt extraction, circuit-breaker calls, and explicit simulation gating.

- [ ] **Step 3: Create focused provider types**

```ts
export type NormalizedVtuStatus =
  | 'success'
  | 'pending'
  | 'failed'
  | 'reversed';

export interface VtuProviderResult {
  providerRequestId: string;
  providerTransactionId: string;
  status: NormalizedVtuStatus;
  message: string;
  providerCost?: string;
  providerCommission?: string;
  purchasedCode?: string;
  safeResponse: Record<string, unknown>;
}
```

- [ ] **Step 4: Implement strict configuration and circuit-breaker execution**

Before every VTpass HTTP call, require `canExecute('vtpass')`; throw
`ServiceUnavailableException` when open. Record success only after a valid
provider response and record failure on transport, timeout, or malformed
response. Permit simulation only when `NODE_ENV` is `development` or `test`
and `VTU_SIMULATION_ENABLED` is exactly true.

- [ ] **Step 5: Implement product payloads and safe normalization**

Convert `+2348031234567` to `08031234567` only inside the adapter. Use
`meterType` as electricity `variation_code`; use `subscriptionType` for cable.
Send canonical two-decimal amount strings. Normalize status from
`content.transactions.status` before response code, retain purchased codes in
the typed result only, and build an allowlisted `safeResponse` containing
codes, masked-free identifiers, status, request ID, provider transaction ID,
provider cost, and commission.

- [ ] **Step 6: Run provider tests and TypeScript build**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/providers/vtu-api.provider.spec.ts && npm run build`

Expected: PASS.

- [ ] **Step 7: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/src/vtu/providers`

If staging would not absorb pre-existing hunks, commit with
`feat(vtu): complete VTpass provider contract`.

### Task 3: Add Encrypted Receipts And Durable Callback Persistence

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/prisma/migrations/035_vtpass_vtu_production_completion/migration.sql`
- Create: `BACKEND/src/vtu/vtu-receipt.service.ts`
- Create: `BACKEND/src/vtu/vtu-receipt.service.spec.ts`
- Create: `BACKEND/src/vtu/vtu-webhook-inbox.service.ts`
- Create: `BACKEND/src/vtu/vtu-webhook-inbox.service.spec.ts`

**Interfaces:**
- Produces: `VtuOrder.purchasedCodeEncrypted` and `VtuOrder.providerCommission`.
- Produces: `VtuWebhookInbox` keyed by a SHA-256 `eventKey`.
- Produces: `VtuReceiptService.encryptPurchasedCode`, `decryptPurchasedCode`, and `toOwnerReceipt`.
- Produces: `VtuWebhookInboxService.record`, `process`, and `retryPending`.

- [ ] **Step 1: Write failing receipt and inbox tests**

```ts
expect(receipts.encryptPurchasedCode('1234-5678')).toMatch(/^enc:v1:/);
expect(receipts.decryptPurchasedCode(encrypted)).toBe('1234-5678');
expect(JSON.stringify(ownerReceipt)).not.toContain('purchasedCodeEncrypted');

await inbox.record(event);
await inbox.record(event);
expect(prisma.vtuWebhookInbox.create).toHaveBeenCalledTimes(2);
expect(secondResult.duplicate).toBe(true);
```

Mock the second create with Prisma `P2002`, and add a retry test that claims
only unprocessed rows whose `nextAttemptAt` is due.

- [ ] **Step 2: Run the new suites and verify missing services/models**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/vtu-receipt.service.spec.ts src/vtu/vtu-webhook-inbox.service.spec.ts`

Expected: FAIL because the services and Prisma delegate do not exist.

- [ ] **Step 3: Add the additive database model**

```prisma
model VtuWebhookInbox {
  id                    String   @id @default(uuid())
  eventKey              String   @unique
  eventType             String
  providerRequestId     String
  providerTransactionId String?
  providerStatus        String
  payloadHash           String
  payload               Json
  attempts              Int      @default(0)
  nextAttemptAt         DateTime @default(now())
  processedAt           DateTime?
  lastError             String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([processedAt, nextAttemptAt])
  @@index([providerRequestId])
  @@map("vtu_webhook_inbox")
}
```

Add `purchasedCodeEncrypted String? @db.Text` and
`providerCommission Decimal? @db.Decimal(15, 2)` to `VtuOrder`. The SQL
migration must only add these columns/table/indexes and must enable RLS on the
new server-only table using the same role pattern as migration 028.

- [ ] **Step 4: Generate the Prisma client and validate the migration**

Run: `cd BACKEND && npx prisma format && npx prisma generate && npx prisma validate`

Expected: all commands exit 0.

- [ ] **Step 5: Implement receipt encryption and inbox claiming**

Prefix encrypted purchased codes with `enc:v1:` using
`encryptSensitiveValue` and `PII_ENCRYPTION_KEY`. Decrypt only inside an
owner-authorized order response. Compute `eventKey` from event type, request
ID, provider transaction ID, normalized status, and payload hash. Claim rows
with guarded `updateMany({ where: { id, processedAt: null, attempts }, ... })`
so only one worker processes an event.

- [ ] **Step 6: Run the persistence service tests**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/vtu-receipt.service.spec.ts src/vtu/vtu-webhook-inbox.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/prisma BACKEND/src/vtu/vtu-receipt.service.ts BACKEND/src/vtu/vtu-receipt.service.spec.ts BACKEND/src/vtu/vtu-webhook-inbox.service.ts BACKEND/src/vtu/vtu-webhook-inbox.service.spec.ts`

Commit isolated new files and migration with
`feat(vtu): persist secure receipts and webhook inbox` only when the staged
diff contains no unrelated schema changes.

### Task 4: Complete The Financial Purchase And Recovery Lifecycle

**Files:**
- Modify: `BACKEND/src/vtu/vtu.service.ts`
- Modify: `BACKEND/src/vtu/vtu.service.spec.ts`
- Modify: `BACKEND/src/vtu/vtu-requery.service.ts`
- Modify: `BACKEND/src/vtu/vtu.module.ts`
- Create: `BACKEND/test/vtpass-vtu.financial.e2e-spec.ts`
- Modify: `BACKEND/test/jest-financial-e2e.json`

**Interfaces:**
- Consumes: Task 1 DTOs, Task 2 provider results, and Task 3 receipt/inbox services.
- Produces: owner order responses with `fee`, `totalDebit`, and optional `purchasedCode`.
- Produces: guarded `PENDING -> SUCCESS|FAILED|REVERSED` transitions and exactly-once ledger movements.

- [ ] **Step 1: Add failing service tests for server authority and receipts**

```ts
await expect(service.purchase('user-1', cableChangeDto)).rejects.toThrow(
  'Package price mismatch',
);
expect(vtuApi.purchase).not.toHaveBeenCalled();

const response = await service.purchase('user-1', prepaidElectricityDto);
expect(response).toEqual(expect.objectContaining({
  status: 'SUCCESS',
  purchasedCode: '1234-5678-9012-3456-7890',
  totalDebit: '1050.00',
}));
expect(JSON.stringify(prisma.vtuOrder.update.mock.calls)).not.toContain(
  '1234-5678-9012-3456-7890',
);
```

Add cases for cable renewal amount, customer re-verification, unknown provider
result, explicit failure, reversal callback, late failure after success,
duplicate callback, and callback retry after a processing exception.

- [ ] **Step 2: Run the service suite and verify failures**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/vtu.service.spec.ts`

Expected: FAIL for the new provider result shape, cable/electricity inputs,
encrypted receipt handling, and durable callback processing.

- [ ] **Step 3: Refactor purchase into focused private stages**

Implement these exact service boundaries:

```ts
private assertVtuEnabled(): void;
private resolveServerPurchase(dto: PurchaseVtuDto): Promise<ResolvedVtuPurchase>;
private createPendingPurchase(userId: string, purchase: ResolvedVtuPurchase): Promise<PendingVtuPurchase>;
private submitPendingPurchase(pending: PendingVtuPurchase, purchase: ResolvedVtuPurchase): Promise<VtuPurchaseResponse>;
private finalizeProviderResult(orderId: string, result: VtuProviderResult): Promise<void>;
private reversePendingPurchase(orderId: string, result: VtuProviderResult): Promise<boolean>;
```

`createPendingPurchase` performs transaction/order creation and the
conditional `LedgerService.debitWallet` in one Prisma transaction. Remove the
non-authoritative pre-transaction balance rejection; let the conditional
ledger debit decide concurrent sufficiency.

- [ ] **Step 4: Store reconciliation values and encrypted receipts**

Set `costAmount` from the provider charge, `providerCommission` from the
provider result, and `purchasedCodeEncrypted` from `VtuReceiptService`.
Persist only `safeResponse`. Merge transaction metadata instead of replacing
masked purchase metadata during requery/callback status changes.

- [ ] **Step 5: Integrate durable webhook and requery recovery**

Move callback database work to `VtuWebhookInboxService`. Extend the scheduled
job to call both `requeryPendingOrders(25)` and `retryPending(25)`. Retry
transient processing errors with bounded backoff and retain terminal failures
for admin review after the configured maximum.

- [ ] **Step 6: Add disposable-database financial tests**

The e2e suite creates a Tier 2 user with an NGN wallet, then executes two
concurrent purchases against a balance that can fund only one. Assert one
debit ledger entry and non-negative final balance. Replay the same
idempotency key and assert the original transaction/order IDs. Apply the same
reversal event twice and assert one `VTU_REVERSAL` ledger entry.

- [ ] **Step 7: Run unit and financial integration suites**

Run: `cd BACKEND && npm test -- --runInBand src/vtu && npm run test:financial:e2e -- --runTestsByPath test/vtpass-vtu.financial.e2e-spec.ts`

Expected: PASS with one debit, one possible reversal, and no negative wallet.

- [ ] **Step 8: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/src/vtu BACKEND/test/vtpass-vtu.financial.e2e-spec.ts BACKEND/test/jest-financial-e2e.json`

Commit isolated task hunks with
`feat(vtu): finalize VTpass financial lifecycle` when safe.

### Task 5: Harden Callback Authentication And Deployment Configuration

**Files:**
- Modify: `BACKEND/src/vtu/vtpass-webhook.controller.ts`
- Modify: `BACKEND/src/vtu/vtpass-webhook.controller.spec.ts`
- Create: `BACKEND/src/vtu/vtpass-production-config.spec.ts`
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/.env.example`
- Modify: `BACKEND/do-app.yaml`
- Modify: `BACKEND/fly.toml`
- Modify: `render.yaml`
- Modify: `docker-compose.prod.yml`
- Modify: `BACKEND/scripts/validate-production-config.sh`

**Interfaces:**
- Consumes: raw webhook body captured in `main.ts` and Task 3 inbox recording.
- Produces: signature-authenticated `transaction-update` acceptance with `{ response: 'success' }`.
- Produces: `VTU_ENABLED` and `VTU_SIMULATION_ENABLED` fail-closed configuration.

- [ ] **Step 1: Add failing callback and config tests**

```ts
await expect(handle(unsignedRequest)).rejects.toThrow('Missing signature');
await expect(handle(queryTokenRequest)).rejects.toThrow('Missing signature');
await expect(handle(validHmacRequest)).resolves.toEqual({ response: 'success' });
expect(inbox.record).toHaveBeenCalledTimes(1);
expect(inbox.process).not.toHaveBeenCalled();
```

The production-config suite spawns the validation script with
`VTU_ENABLED=true` and each VTpass variable omitted in turn. Assert non-zero
exit and a safe variable-name-only error. Assert
`VTPASS_BASE_URL=https://api-service.vtpass.com` is rejected and
`https://vtpass.com/api` is accepted.

- [ ] **Step 2: Run callback/config suites and verify failures**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/vtpass-webhook.controller.spec.ts src/vtu/vtpass-production-config.spec.ts`

Expected: FAIL because shared query tokens are accepted and deployed Joi
validation does not yet require all VTpass values.

- [ ] **Step 3: Implement the authenticated ingress contract**

Accept one internal signature header, compute HMAC-SHA256 across the raw body,
and compare with `timingSafeEqual`. Remove query-token acceptance. Validate
`type === 'transaction-update'`, provider request ID, provider transaction ID,
and known inner status before recording the inbox event. Return success after
durable recording; scheduled processing owns state mutation.

- [ ] **Step 4: Make environment validation consistent**

Define `VTU_ENABLED`, `VTU_SIMULATION_ENABLED`,
`VTPASS_LOW_BALANCE_THRESHOLD`, and `VTPASS_WEBHOOK_SECRET` in Joi. When
`NODE_ENV` is staging/production and VTU is enabled, require HTTPS base URL,
all credentials, webhook secret, PII encryption key, and Redis. Update every
deployment manifest to the live base `https://vtpass.com/api`; keep sandbox
only in `.env.example` development guidance.

- [ ] **Step 5: Run config, callback, manifest, and build checks**

Run: `cd BACKEND && npm test -- --runInBand src/vtu/vtpass-webhook.controller.spec.ts src/vtu/vtpass-production-config.spec.ts && npm run build`

Run: `bash scripts/check-production-manifests.sh`

Expected: PASS.

- [ ] **Step 6: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/src/app.module.ts BACKEND/src/vtu/vtpass-webhook.controller.ts BACKEND/src/vtu/vtpass-webhook.controller.spec.ts BACKEND/src/vtu/vtpass-production-config.spec.ts BACKEND/.env.example BACKEND/do-app.yaml BACKEND/fly.toml render.yaml docker-compose.prod.yml BACKEND/scripts/validate-production-config.sh`

Commit isolated hunks with `fix(vtu): fail closed on VTpass configuration`.

### Task 6: Complete The Next.js Customer VTU Experience

**Files:**
- Modify: `WEBSITE/src/types/index.ts`
- Modify: `WEBSITE/src/services/api.ts`
- Modify: `WEBSITE/src/app/dashboard/vtu/page.tsx`
- Create: `WEBSITE/e2e/vtu.spec.ts`

**Interfaces:**
- Consumes: Task 1 request DTOs and Task 4 purchase/order response.
- Produces: idempotent validation and purchase requests matching the backend.
- Produces: enabled Nigeria and disabled Ghana/Kenya/South Africa/US/UK market options.

- [ ] **Step 1: Write failing browser tests with mocked backend routes**

```ts
await page.getByRole('tab', { name: 'Electricity' }).click();
await page.getByLabel('Country').click();
await expect(page.getByRole('option', { name: /Ghana.*Coming soon/ })).toHaveAttribute('aria-disabled', 'true');
await page.getByLabel('Meter type').click();
await page.getByRole('option', { name: 'Prepaid' }).click();
```

Mock provider, package, validation, purchase, and order endpoints. Assert cable
loads package variations, validation POSTs a JSON body with an idempotency
header, purchase uses the same key through a retry, pending is distinct from
success, and a prepaid success renders the returned electricity token.

- [ ] **Step 2: Run the VTU browser test and verify missing interactions**

Run: `cd WEBSITE && npx playwright test e2e/vtu.spec.ts --project=chromium`

Expected: FAIL for country availability, cable packages, validation, meter
type, subscription mode, and purchased-code rendering.

- [ ] **Step 3: Update typed API helpers**

```ts
export type VtuPurchaseRequest = {
  type: 'airtime' | 'data' | 'cable' | 'electricity';
  provider: string;
  contactPhone: string;
  amount: string;
  transactionPin: string;
  recipientNumber?: string;
  packageId?: string;
  smartCardNumber?: string;
  subscriptionType?: 'change' | 'renew';
  meterNumber?: string;
  meterType?: 'prepaid' | 'postpaid';
};
```

Make validation helpers accept bodies and required idempotency keys. Treat
package prices as strings until display formatting.

- [ ] **Step 4: Implement one state model for all four products**

Keep one selected market fixed to enabled Nigeria and render the other
markets disabled with `Coming soon`. Load packages for both data and cable.
Require successful customer verification before cable/electricity review.
Add cable mode and meter type controls, contact phone, safe review summaries,
pending tracking, and owner receipt purchased code.

- [ ] **Step 5: Verify website behavior and production build**

Run: `cd WEBSITE && npx playwright test e2e/vtu.spec.ts --project=chromium && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 6: Review the isolated diff and checkpoint**

Run: `git diff --check -- WEBSITE/src/types/index.ts WEBSITE/src/services/api.ts WEBSITE/src/app/dashboard/vtu/page.tsx WEBSITE/e2e/vtu.spec.ts`

Commit isolated task hunks with `feat(web): complete VTpass VTU flows` when
safe.

### Task 7: Complete The Flutter VTU Experience

**Files:**
- Modify: `APP/lib/services/vtu_service.dart`
- Modify: `APP/lib/features/home/screens/money_action_screen.dart`
- Create: `APP/test/vtu_service_contract_test.dart`
- Create: `APP/test/vtu_money_action_flow_test.dart`
- Modify: `APP/test/support/trustpay_test_api.dart`

**Interfaces:**
- Consumes: the same Task 1 request shapes and Task 4 receipt response used by web.
- Produces: `VtuPurchaseRequest`, `VtuValidationRequest`, and receipt models without international provider fields.
- Produces: enabled Nigeria and disabled `Coming soon` market tiles.

- [ ] **Step 1: Add failing Dio contract tests**

```dart
expect(captured.path, '/api/vtu/validate/meter');
expect(captured.headers['Idempotency-Key'], startsWith('vtu-validate-'));
expect(captured.data, {
  'provider': 'ikedc',
  'meterNumber': '1111111111111',
  'meterType': 'prepaid',
  'contactPhone': '+2348031234567',
});
expect(captured.data, isNot(contains('scope')));
expect(captured.data, isNot(contains('operatorId')));
```

Add purchase assertions for airtime, data, cable change/renew, and both meter
types. Parse `fee`, `totalDebit`, and `purchasedCode` from success responses.

- [ ] **Step 2: Add failing widget tests**

Render each money action with the test API. Assert Nigeria is enabled, Ghana
and remaining markets say `Coming soon` and cannot advance, cable package
selection follows verification, electricity requires meter type, pending
status is not shown as success, and prepaid receipt displays the token.

- [ ] **Step 3: Run focused Flutter tests and verify failures**

Run: `cd APP && ../.tooling/flutter/bin/flutter test test/vtu_service_contract_test.dart test/vtu_money_action_flow_test.dart`

Expected: FAIL because the current screen still sends `scope`, `countryCode`,
and `operatorId` and does not implement the complete receipt contract.

- [ ] **Step 4: Implement the typed service contract**

Move purchase calls into `VtuService`, require caller-supplied idempotency keys,
send validation inputs in JSON bodies, parse decimal values as strings, and
model purchased code as nullable owner-only receipt data.

- [ ] **Step 5: Simplify the screen to VTpass-only enabled behavior**

Remove all runtime international provider loading and submission branches.
Retain country discovery as disabled `Coming soon` UI. Add cable mode, live
package selection, contact phone, meter type, verified customer state,
attempt-key lifecycle, pending status refresh, and purchased-code receipt.

- [ ] **Step 6: Run Flutter verification**

Run: `cd APP && ../.tooling/flutter/bin/flutter test test/vtu_service_contract_test.dart test/vtu_money_action_flow_test.dart test/money_action_validation_test.dart && ../.tooling/flutter/bin/flutter analyze`

Expected: PASS with no analyzer findings.

- [ ] **Step 7: Review the isolated diff and checkpoint**

Run: `git diff --check -- APP/lib/services/vtu_service.dart APP/lib/features/home/screens/money_action_screen.dart APP/test/vtu_service_contract_test.dart APP/test/vtu_money_action_flow_test.dart APP/test/support/trustpay_test_api.dart`

Commit isolated task hunks with `feat(mobile): complete VTpass VTU flows` when
safe.

### Task 8: Finish Admin Operations And Reconciliation Visibility

**Files:**
- Modify: `BACKEND/src/admin/admin.service.ts`
- Modify: `BACKEND/src/admin/admin.service.spec.ts`
- Modify: `WEBSITE/src/types/index.ts`
- Modify: `WEBSITE/src/app/admin/vtu/page.tsx`

**Interfaces:**
- Consumes: provider cost/commission and callback-inbox state from Tasks 3 and 4.
- Produces: masked admin order/reconciliation responses and audited manual requery.

- [ ] **Step 1: Add failing admin service tests**

```ts
expect(result.orders[0]).toEqual(expect.objectContaining({
  costAmount: '970.00',
  providerCommission: '30.00',
  fee: '0.00',
}));
expect(JSON.stringify(result)).not.toContain('purchasedCodeEncrypted');
expect(result.callbackFailures[0]).toEqual(expect.objectContaining({
  providerRequestId: 'REQ-1',
  attempts: 5,
}));
```

Assert manual requery requires a non-empty reason, uses idempotency, changes no
terminal order, and creates an audit entry with masked metadata.

- [ ] **Step 2: Run the admin suite and verify missing fields**

Run: `cd BACKEND && npm test -- --runInBand src/admin/admin.service.spec.ts`

Expected: FAIL for provider commission and durable callback failure output.

- [ ] **Step 3: Implement safe operational responses**

Expose provider charge, commission, fee, current status, attempts, and callback
failure counts. Do not expose encrypted receipts, raw callback bodies, or full
targets. Preserve existing role checks and audit-log writes.

- [ ] **Step 4: Update the admin page**

Add compact columns/cards for provider cost, commission, customer fee, margin,
callback retry state, and terminal/manual-requery controls. Keep all target
values masked and `purchasedCode` absent from the admin type.

- [ ] **Step 5: Run backend and website checks**

Run: `cd BACKEND && npm test -- --runInBand src/admin/admin.service.spec.ts && npm run build`

Run: `cd WEBSITE && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 6: Review the isolated diff and checkpoint**

Run: `git diff --check -- BACKEND/src/admin/admin.service.ts BACKEND/src/admin/admin.service.spec.ts WEBSITE/src/types/index.ts WEBSITE/src/app/admin/vtu/page.tsx`

Commit isolated task hunks with `feat(admin): complete VTU operations view`
when safe.

### Task 9: Write The Operations And Sandbox Certification Runbook

**Files:**
- Modify: `DOCS/PRODUCTION-GUIDES/08-VTU.MD`
- Modify: `DOCS/VTU-VTPASS-IMPLEMENTATION-TASKS.MD`
- Modify: `DOCS/TASKS.MD`
- Modify: `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`

**Interfaces:**
- Consumes: exact environment, callback, status, product, and receipt behavior from Tasks 1-8.
- Produces: operator-executable activation, rollback, requery, reversal, and reconciliation instructions.

- [ ] **Step 1: Replace outdated provider and endpoint guidance**

Document sandbox `https://sandbox.vtpass.com/api`, live
`https://vtpass.com/api`, the authenticated gateway requirement, safe
configuration checks, `VTU_ENABLED` rollout, provider wallet threshold, and
the fact that non-Nigerian markets are UI-only `Coming soon` states.

- [ ] **Step 2: Add an exact sandbox scenario matrix**

Include one row per airtime, data, cable change, cable renew, prepaid
electricity, and postpaid electricity case. For each row record expected local
transaction/order status, ledger count, wallet effect, VTpass request and
transaction references, callback/requery result, and receipt/token behavior.
Use documented VTpass sandbox numbers only; include no credentials.

- [ ] **Step 3: Add recovery and rollback instructions**

Operators disable `VTU_ENABLED`, leave pending orders available to the requery
worker, never resubmit a provider purchase, use audited admin requery, compare
ledger/order/provider references, and escalate orders beyond the retry limit.
Rollback must not remove additive columns or inbox data.

- [ ] **Step 4: Verify documentation consistency**

Run: `rg -n "Reloadly|generic provider|api-service\.vtpass\.com|VTU_API_" DOCS/PRODUCTION-GUIDES/08-VTU.MD DOCS/VTU-VTPASS-IMPLEMENTATION-TASKS.MD DOCS/TASKS.MD DOCS/PROVIDER-SOURCE-OF-TRUTH.MD BACKEND/.env.example BACKEND/do-app.yaml BACKEND/fly.toml render.yaml docker-compose.prod.yml`

Expected: no active instruction or runtime configuration references a legacy
provider or obsolete live endpoint; historical notes must be explicitly
labelled archived.

- [ ] **Step 5: Review the isolated diff and checkpoint**

Run: `git diff --check -- DOCS/PRODUCTION-GUIDES/08-VTU.MD DOCS/VTU-VTPASS-IMPLEMENTATION-TASKS.MD DOCS/TASKS.MD DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`

Commit isolated documentation hunks with
`docs: add VTpass VTU launch runbook` when safe.

### Task 10: Perform The Independent Functionality And Security Review

**Files:**
- Create: `DOCS/VTU-VTPASS-FUNCTIONAL-REVIEW-2026-09-03.md`
- Modify only files containing findings that block completion.

**Interfaces:**
- Consumes: every deliverable from Tasks 1-9 and `DOCS/SECURITY-RULES.MD`.
- Produces: evidence-backed pass/fail matrix with no unresolved critical or high-severity finding.

- [ ] **Step 1: Trace each product end to end**

For airtime, data, cable change, cable renew, prepaid electricity, and postpaid
electricity, record the client fields, DTO result, VTpass payload, pending
database state, ledger entry, final provider state, owner receipt, admin view,
and requery/reversal behavior. Mark each row `PASS` only with a test or source
reference.

- [ ] **Step 2: Run the security checklist against changed code**

Verify idempotency, concurrent debit protection, DTO validation, auth guards,
rate limits, secret handling, Decimal arithmetic, non-negative balances,
callback authentication and replay protection, audit logging, error safety,
PII masking/encryption, and deployment fail-closed behavior.

- [ ] **Step 3: Search for forbidden regressions**

Run: `rg -n "console\.(log|debug)|RELOADLY_|VTU_API_|scope.*international|operatorId|VTPASS_(API|PUBLIC|SECRET)_KEY.*=" BACKEND/src WEBSITE/src APP/lib BACKEND/.env.example`

Expected: no production logger violations, legacy runtime VTU routes, client
secrets, or hardcoded credential values. Example environment values must be
clearly non-secret templates.

- [ ] **Step 4: Fix every critical or high-severity finding test-first**

For each finding, add the smallest failing regression test, run it to observe
the failure, implement the correction, rerun the focused suite, and update the
review row with the test command and result. Do not mark completion while any
critical or high finding remains open.

- [ ] **Step 5: Save and verify the review report**

The report starts with an executive result, lists findings by severity with
file/line evidence, includes the end-to-end trace matrix, and records commands
and exit codes. Run `git diff --check -- DOCS/VTU-VTPASS-FUNCTIONAL-REVIEW-2026-09-03.md`.

### Task 11: Run The Full Verification Matrix

**Files:**
- Modify only code or tests required to resolve verification failures caused by this feature.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: final reproducible verification evidence and a clear list of external sandbox/live steps that require human credentials.

- [ ] **Step 1: Verify Prisma and production configuration**

Run: `cd BACKEND && npx prisma format && npx prisma validate && npx prisma generate`

Run: `bash scripts/check-production-manifests.sh`

Expected: PASS.

- [ ] **Step 2: Run backend quality gates**

Run: `cd BACKEND && npm run lint && npm test -- --runInBand && npm run build`

Expected: PASS with zero test failures and no TypeScript build errors.

- [ ] **Step 3: Run financial integration certification**

Run: `cd BACKEND && npm run test:financial:e2e`

Expected: PASS against the disposable PostgreSQL test database. If Docker or
the disposable database is unavailable, report the exact infrastructure
blocker and do not describe financial e2e as verified.

- [ ] **Step 4: Run website quality gates**

Run: `cd WEBSITE && npm run lint && npm run build && npx playwright test e2e/vtu.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 5: Run Flutter quality gates**

Run: `cd APP && ../.tooling/flutter/bin/flutter analyze && ../.tooling/flutter/bin/flutter test`

Expected: PASS; the known Swift Package Manager warning may be reported but
must not hide analyzer or test failures.

- [ ] **Step 6: Run repository diff and secret-safety checks**

Run: `git diff --check`

Run: `git status --short`

Inspect changed VTU/config/docs paths and confirm no credential value, raw
customer identifier, transaction PIN, or purchased code fixture derived from
real data is present.

- [ ] **Step 7: Run provider sandbox certification only with human-supplied authorization**

Use the runbook against VTpass sandbox after the operator confirms credentials,
provider wallet state, callback gateway, and disposable TRUSTPAY test user.
Never run live purchase mutations as part of automated verification. Record
provider request IDs and masked outcomes without printing credentials.

- [ ] **Step 8: Final checkpoint**

If the staged changes can be isolated from the pre-existing dirty worktree,
commit with `feat: complete VTpass VTU services end to end`. Otherwise leave
implementation changes unstaged and hand off the exact changed-file list,
verification evidence, and reason no mixed commit was created.
