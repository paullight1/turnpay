#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  createReporter,
  evaluateCacheResponses,
  evaluateSourceChecks,
  ensureBackend,
  resolveAuthToken,
  validateRateResponse,
} = require('./validate-rate-endpoint');

function silentReporter() {
  return createReporter({ write: () => {} });
}

function validResponse(overrides = {}) {
  return {
    status: 200,
    headers: {},
    body: {
      from: 'GHS',
      to: 'NGN',
      baseRate: 3.2,
      markupPercent: 2.5,
      effectiveRate: 3.12,
      ...overrides,
    },
  };
}

async function run() {
  const valid = validateRateResponse(validResponse());
  assert.equal(valid.valid, true, 'a complete rate response should validate');

  const invalid = validateRateResponse(validResponse({ baseRate: 0 }));
  assert.equal(invalid.valid, false, 'an invalid rate must fail validation');
  assert.match(invalid.errors.join(' '), /baseRate/i);

  assert.equal(validateRateResponse(validResponse({ isStale: true })).valid, false,
    'display-only stale fallback must not pass live execution readiness');

  const cacheResult = evaluateCacheResponses([
    validResponse({ baseRate: 3.2 }),
    validResponse({ baseRate: 0 }),
    validResponse({ baseRate: 3.2 }),
  ]);
  assert.equal(cacheResult.validResponses.length, 2, 'invalid rates must not enter cache observations');
  assert.equal(cacheResult.invalidResponses.length, 1);
  assert.equal(cacheResult.cacheHitVerified, false);
  assert.equal(cacheResult.consistent, true);

  const timingOnlyResult = evaluateCacheResponses([
    { ...validResponse(), durationMs: 20 },
    { ...validResponse(), durationMs: 1 },
  ]);
  assert.equal(timingOnlyResult.cacheHitVerified, false, 'timing must not prove a cache hit');
  assert.equal(timingOnlyResult.cacheEvidenceMissing, true);

  const explicitHitResult = evaluateCacheResponses([
    { ...validResponse(), headers: { 'x-rate-cache': 'MISS' } },
    { ...validResponse(), headers: { 'x-rate-cache': 'HIT' } },
  ]);
  assert.equal(explicitHitResult.cacheHitVerified, true, 'an explicit cache signal should prove a hit');

  const sourceChecks = evaluateSourceChecks('CircuitState CIRCUIT_FAILURE_THRESHOLD CIRCUIT_RECOVERY_MS');
  assert.ok(sourceChecks.some((check) => !check.passed), 'missing source markers must be reported as failures');

  const reporter = silentReporter();
  reporter.skip('live endpoint unavailable');
  const summary = reporter.summary();
  assert.equal(summary.status, 'INCOMPLETE');
  assert.notEqual(summary.exitCode, 0, 'incomplete validation must be nonzero');

  assert.equal(resolveAuthToken({ RATE_AUTH_TOKEN: 'explicit-token' }, []).token, 'explicit-token');
  assert.equal(resolveAuthToken({ AUTH_TOKEN: 'Bearer supplied-token' }, []).token, 'supplied-token');
  assert.equal(resolveAuthToken({}, []).token, null);

  let started = false;
  const existing = await ensureBackend(
    { autoStart: true },
    {
      reporter: silentReporter(),
      probeBackend: async () => true,
      startBackend: async () => {
        started = true;
        return true;
      },
    },
  );
  assert.equal(existing.available, true);
  assert.equal(existing.started, false);
  assert.equal(started, false, 'an existing backend must not be started again');

  process.stdout.write('validate-rate-endpoint focused tests passed\n');
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
