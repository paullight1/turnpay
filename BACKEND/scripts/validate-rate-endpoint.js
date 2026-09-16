#!/usr/bin/env node

/**
 * TRUSTPAY — Sandbox Rate Fetch & Cache Validation
 * =================================================
 *
 * Validates:
 *   (a) Live rate returned from GET /api/exchange/rate?from=GHS&to=NGN
 *   (b) Repeated valid responses remain consistent and expose an explicit
 *       cache signal before a cache hit is reported
 *   (c) Circuit breaker behaviour is represented in the rate service
 *   (d) Rate-service code integrity
 *
 * Cache-proof limitation: the current rate endpoint does not emit cache
 * metadata. Until it does, repeated payloads and timing only prove response
 * consistency; cache proof is intentionally reported as INCOMPLETE.
 *
 * The validator is non-invasive by default. It probes an existing backend,
 * but only starts one when AUTO_START_BACKEND=true or --start-backend is set.
 * Live checks require an explicit auth token or explicitly supplied test
 * credentials; no default credentials are attempted.
 *
 * Usage:
 *   cd BACKEND
 *   RATE_AUTH_TOKEN='<token>' BACKEND_URL=http://localhost:3000 \
 *     node scripts/validate-rate-endpoint.js
 *
 * Optional environment variables:
 *   RATE_AUTH_TOKEN (also AUTH_TOKEN, ACCESS_TOKEN, or JWT_TOKEN)
 *   TEST_EMAIL and TEST_PASSWORD (only used together, never printed)
 *   BACKEND_URL, PORT, AUTO_START_BACKEND=true
 */

const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const DEFAULT_CONFIG = {
  backendPort: 3000,
  rateEndpoint: "/api/exchange/rate",
  loginEndpoint: "/api/auth/login",
  pollInterval: 1500,
  startupTimeout: 60000,
  requestTimeout: 15000,
  cacheRequests: 4,
  cacheDelay: 200,
};

const C = {
  G: "\x1b[32m",
  R: "\x1b[31m",
  Y: "\x1b[33m",
  B: "\x1b[36m",
  M: "\x1b[35m",
  X: "\x1b[0m",
  BD: "\x1b[1m",
};

const CACHE_SIGNAL_HEADERS = [
  // The current endpoint does not emit these headers; missing metadata is
  // intentionally an incomplete cache-proof result, not a cache failure.
  "x-rate-cache",
  "x-rate-cache-status",
  "x-cache",
  "x-cache-status",
];

const SOURCE_CHECKS = [
  { label: "Circuit breaker state machine present", pattern: /\bCircuitState\b/ },
  { label: "Failure threshold configured", pattern: /\bCIRCUIT_FAILURE_THRESHOLD\b/ },
  { label: "Recovery timeout configured", pattern: /\bCIRCUIT_RECOVERY_MS\b/ },
  { label: "Circuit OPEN state handling", pattern: /['"]OPEN['"]/ },
  { label: "Half-open recovery probing", pattern: /['"]HALF_OPEN['"]/ },
  { label: "Stale rate flag propagated", pattern: /\bisStale\b/ },
  { label: "60s rate freshness TTL", pattern: /\bRATE_FRESHNESS_TTL_MS\b/ },
  { label: "Circuit-open audit log alert", pattern: /\bFX_RATE_CIRCUIT_OPENED\b/ },
];

let backendProcess = null;

function createReporter({ write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const state = {
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  function log(message, color = "") {
    const timestamp = new Date().toISOString().slice(11, 23);
    write(`${color}[${timestamp}] ${message}${C.X}`);
  }

  function info(message) {
    log(`INFO  ${message}`, C.B);
  }

  function ok(message) {
    log(`PASS  ${message}`, C.G);
    state.passed += 1;
  }

  function fail(message) {
    log(`FAIL  ${message}`, C.R);
    state.failures.push(message);
    state.failed += 1;
  }

  function skip(message) {
    log(`SKIP  ${message}`, C.Y);
    state.skipped += 1;
  }

  function heading(number, title) {
    log("");
    log(`${C.BD}${"=".repeat(64)}${C.X}`, C.M);
    log(`${C.BD}  ${number}. ${title}${C.X}`, C.M);
    log(`${"=".repeat(64)}`, C.M);
  }

  function summary() {
    const status = state.failed > 0
      ? "FAILED"
      : state.skipped > 0
        ? "INCOMPLETE"
        : "PASSED";
    const exitCode = state.failed > 0 ? 1 : state.skipped > 0 ? 2 : 0;
    return {
      ...state,
      failures: [...state.failures],
      status,
      exitCode,
    };
  }

  function printSummary() {
    heading(7, "Results Summary");
    log(`${C.BD}  PASSED: ${C.G}${state.passed}${C.X}`, C.X);
    log(`${C.BD}  FAILED: ${C.R}${state.failed}${C.X}`, C.X);
    log(`${C.BD}  SKIPPED: ${C.Y}${state.skipped}${C.X}`, C.X);

    if (state.failures.length > 0) {
      log(`${C.R}  FAILURES:${C.X}`, C.R);
      for (const failure of state.failures) {
        log(`    ${failure}`, C.R);
      }
    }

    const result = summary();
    if (result.status === "PASSED") {
      log(`${C.G}${C.BD}  ALL CHECKS PASSED${C.X}`, C.G);
    } else if (result.status === "INCOMPLETE") {
      log(`${C.Y}${C.BD}  VALIDATION INCOMPLETE — LIVE CHECKS WERE NOT VERIFIED${C.X}`, C.Y);
    } else {
      log(`${C.R}${C.BD}  ${state.failed} CHECK(S) FAILED${C.X}`, C.R);
    }
    return result;
  }

  return {
    state,
    log,
    info,
    ok,
    fail,
    skip,
    heading,
    summary,
    printSummary,
  };
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--backend-url") {
      options.backendUrl = argv[index + 1];
      index += 1;
    } else if (argument === "--auth-token") {
      options.authToken = argv[index + 1];
      index += 1;
    } else if (argument === "--start-backend") {
      options.startBackend = true;
    } else if (argument === "--no-start") {
      options.noStart = true;
    } else if (argument === "--offline") {
      options.offline = true;
    }
  }
  return options;
}

function normalizeToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const token = value.trim().replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

function resolveAuthToken(env = process.env, argv = []) {
  const args = parseArgs(argv);
  const raw = args.authToken
    || env.RATE_AUTH_TOKEN
    || env.AUTH_TOKEN
    || env.ACCESS_TOKEN
    || env.JWT_TOKEN;
  return {
    token: normalizeToken(raw),
    source: args.authToken
      ? "command line"
      : raw
        ? "environment"
        : null,
  };
}

function resolveConfig(env = process.env, argv = []) {
  const args = parseArgs(argv);
  const port = Number.parseInt(env.PORT, 10) || DEFAULT_CONFIG.backendPort;
  const explicitBackendUrl = args.backendUrl || env.BACKEND_URL || null;
  const backendUrl = String(
    explicitBackendUrl || `http://localhost:${port}`,
  ).replace(/\/+$/, "");

  return {
    ...DEFAULT_CONFIG,
    backendPort: port,
    backendUrl,
    rateEndpoint: env.RATE_ENDPOINT || DEFAULT_CONFIG.rateEndpoint,
    loginEndpoint: env.LOGIN_ENDPOINT || DEFAULT_CONFIG.loginEndpoint,
    autoStart: Boolean(args.startBackend)
      || (!args.noStart && env.AUTO_START_BACKEND === "true" && !explicitBackendUrl),
    offline: Boolean(args.offline),
    authToken: resolveAuthToken(env, argv),
    testEmail: env.TEST_EMAIL,
    testPassword: env.TEST_PASSWORD,
    explicitBackendUrl: Boolean(explicitBackendUrl),
  };
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error("Invalid backend URL"));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        timeout: options.timeout ?? DEFAULT_CONFIG.requestTimeout,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let body = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            // Keep non-JSON response bodies available for status diagnostics.
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
            raw,
          });
        });
      },
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });
    if (options.body !== undefined) {
      request.write(JSON.stringify(options.body));
    }
    request.end();
  });
}

function rateUrl(config, from = "GHS", to = "NGN") {
  return `${config.backendUrl}${config.rateEndpoint}?from=${from}&to=${to}`;
}

async function probeBackend(config) {
  try {
    const response = await httpRequest(rateUrl(config), {
      timeout: Math.min(config.requestTimeout, 3000),
    });
    return { reachable: response.status !== undefined, response };
  } catch {
    return { reachable: false };
  }
}

async function waitForServer(config, timeoutMs = config.startupTimeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await probeBackend(config);
    if (result.reachable) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollInterval));
  }
  return false;
}

async function startBackend(config, reporter) {
  reporter.info("Starting NestJS backend because no existing backend responded...");
  const backendDir = path.resolve(__dirname, "..");
  const env = { ...process.env, PORT: String(config.backendPort) };
  const hasDist = fs.existsSync(path.join(backendDir, "dist", "main.js"));
  const command = hasDist ? "node" : "npx";
  const args = hasDist ? ["dist/main"] : ["nest", "start"];

  backendProcess = spawn(command, args, {
    cwd: backendDir,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });

  const startupError = new Promise((_, reject) => {
    backendProcess.once("error", (error) => reject(error));
  });
  const readiness = waitForServer(config).then((ready) => {
    if (!ready) {
      throw new Error("Backend did not respond within the startup timeout");
    }
    return true;
  });

  try {
    await Promise.race([readiness, startupError]);
    reporter.info("Backend is ready");
    return true;
  } catch (error) {
    stopBackend(reporter);
    throw new Error(error instanceof Error ? error.message : "Backend startup failed");
  }
}

function stopBackend(reporter) {
  if (!backendProcess) {
    return;
  }
  reporter.info("Stopping validator-started backend...");
  backendProcess.kill("SIGTERM");
  backendProcess = null;
}

async function ensureBackend(
  config,
  {
    reporter,
    probeBackend: probe = probeBackend,
    startBackend: start = startBackend,
  } = {},
) {
  const existing = await probe(config);
  const reachable = typeof existing === "boolean" ? existing : existing?.reachable;
  if (reachable) {
    reporter.ok("Existing backend is reachable; no server started");
    return { available: true, started: false };
  }

  if (!config.autoStart) {
    return { available: false, started: false };
  }

  try {
    const started = await start(config, reporter);
    return { available: Boolean(started), started: Boolean(started) };
  } catch (error) {
    reporter.info("Backend could not be started; live checks remain unverified");
    return { available: false, started: false, error };
  }
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateRateResponse(response, { from = "GHS", to = "NGN" } = {}) {
  const errors = [];
  const body = response?.body;

  if (response?.status !== 200) {
    errors.push(`HTTP ${response?.status ?? "no response"}`);
    return { valid: false, body, errors };
  }

  if (body?.from !== from || body?.to !== to) {
    errors.push(`expected currencies ${from}→${to}`);
  }
  if (!isPositiveNumber(body?.baseRate)) {
    errors.push("baseRate must be a finite number greater than zero");
  }
  if (!isNonNegativeNumber(body?.markupPercent)) {
    errors.push("markupPercent must be a finite non-negative number");
  }
  if (!isPositiveNumber(body?.effectiveRate)) {
    errors.push("effectiveRate must be a finite number greater than zero");
  }
  if (body?.isStale === true || response?.headers?.["x-rate-stale"] === "true") {
    errors.push("rate is stale and cannot be used for exchange execution");
  }

  return { valid: errors.length === 0, body, errors };
}

function cacheEvidence(response) {
  const headers = response?.headers || {};
  const entries = Object.entries(headers);
  const signal = entries.find(([name]) => CACHE_SIGNAL_HEADERS.includes(name.toLowerCase()));
  if (!signal) {
    return { status: "UNKNOWN", header: null, value: null };
  }

  const value = Array.isArray(signal[1]) ? signal[1].join(",") : String(signal[1]);
  if (/\bHIT\b/i.test(value)) {
    return { status: "HIT", header: signal[0], value };
  }
  if (/\bMISS\b/i.test(value)) {
    return { status: "MISS", header: signal[0], value };
  }
  return { status: "UNKNOWN", header: signal[0], value };
}

function rateFingerprint(body) {
  return JSON.stringify({
    from: body?.from,
    to: body?.to,
    baseRate: body?.baseRate,
    markupPercent: body?.markupPercent,
    effectiveRate: body?.effectiveRate,
  });
}

function evaluateCacheResponses(responses) {
  const validResponses = [];
  const invalidResponses = [];

  for (const response of responses) {
    const validation = validateRateResponse(response);
    if (!validation.valid) {
      invalidResponses.push({ response, validation });
      continue;
    }
    validResponses.push({
      response,
      body: validation.body,
      durationMs: response.durationMs,
      evidence: cacheEvidence(response),
    });
  }

  const fingerprints = validResponses.map(({ body }) => rateFingerprint(body));
  const consistent = fingerprints.length >= 2
    && fingerprints.every((fingerprint) => fingerprint === fingerprints[0]);
  const evidence = validResponses.map(({ evidence: item }) => item);
  const cacheHitVerified = evidence.some((item) => item.status === "HIT");
  const cacheEvidenceMissing = evidence.length >= 2
    && evidence.every((item) => item.status === "UNKNOWN");

  return {
    validResponses,
    invalidResponses,
    consistent,
    evidence,
    cacheHitVerified,
    cacheEvidenceMissing,
  };
}

async function getAuthToken(config, reporter) {
  if (config.authToken.token) {
    reporter.ok(`Using supplied auth token (${config.authToken.source})`);
    return { token: config.authToken.token, supplied: true };
  }

  if (!config.testEmail || !config.testPassword) {
    reporter.skip("No auth token supplied; login was not attempted");
    return { token: null, supplied: false };
  }

  reporter.info("Obtaining JWT token with explicitly supplied test credentials...");
  try {
    const response = await httpRequest(`${config.backendUrl}${config.loginEndpoint}`, {
      method: "POST",
      headers: { "Idempotency-Key": `rate-validation-login:${Date.now()}` },
      body: { email: config.testEmail, password: config.testPassword },
    });
    if (response.status === 200) {
      const token = normalizeToken(response.body?.accessToken || response.body?.token);
      if (token) {
        reporter.ok("JWT token obtained");
        return { token, supplied: false };
      }
    }
    reporter.fail(`Test credential login did not return a token (HTTP ${response.status ?? "unknown"})`);
  } catch {
    reporter.fail("Test credential login request failed");
  }
  return { token: null, supplied: false };
}

async function testRateEndpoint(auth, config, reporter) {
  reporter.heading(3, "Live Rate Fetch");
  const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  let response;
  try {
    response = await httpRequest(rateUrl(config), { headers });
  } catch {
    reporter.fail("Rate endpoint request failed");
    return null;
  }

  const validation = validateRateResponse(response);
  if (!validation.valid) {
    for (const error of validation.errors) {
      reporter.fail(`Rate endpoint: ${error}`);
    }
    return null;
  }

  reporter.ok("HTTP 200 with a valid rate response");
  reporter.ok("Currencies match GHS→NGN");
  reporter.ok(`Base rate is positive (${validation.body.baseRate})`);
  reporter.ok(`Markup is non-negative (${validation.body.markupPercent}%)`);
  reporter.ok(`Effective rate is positive (${validation.body.effectiveRate})`);

  if (response.headers?.["x-rate-stale"] === "true") {
    reporter.info("X-Rate-Stale: true — response is display-only and not fresh");
  }

  let reverseResponse;
  try {
    reverseResponse = await httpRequest(rateUrl(config, "NGN", "GHS"), { headers });
  } catch {
    reporter.fail("Reverse rate endpoint request failed");
    return validation.body;
  }
  const reverseValidation = validateRateResponse(reverseResponse, {
    from: "NGN",
    to: "GHS",
  });
  if (reverseValidation.valid) {
    reporter.ok("Reverse NGN→GHS rate response is valid");
  } else {
    for (const error of reverseValidation.errors) {
      reporter.fail(`Reverse rate endpoint: ${error}`);
    }
  }

  return validation.body;
}

async function testCacheHitMiss(auth, config, reporter) {
  reporter.heading(4, "Cache Hit/Miss Validation");
  const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  const responses = [];

  for (let index = 1; index <= config.cacheRequests; index += 1) {
    const startedAt = Date.now();
    try {
      const response = await httpRequest(rateUrl(config), { headers });
      responses.push({ ...response, durationMs: Date.now() - startedAt });
    } catch {
      responses.push({ status: undefined, headers: {}, body: null, durationMs: Date.now() - startedAt });
    }

    const latest = responses[responses.length - 1];
    const validation = validateRateResponse(latest);
    if (!validation.valid) {
      for (const error of validation.errors) {
        reporter.fail(`Request ${index}: ${error}`);
      }
    } else {
      reporter.ok(`Request ${index}: valid rate response (${latest.durationMs}ms)`);
    }

    if (index < config.cacheRequests) {
      await new Promise((resolve) => setTimeout(resolve, config.cacheDelay));
    }
  }

  const result = evaluateCacheResponses(responses);
  if (result.validResponses.length < 2) {
    reporter.skip("Cache validation requires at least two valid responses");
    return result;
  }

  if (result.consistent) {
    reporter.ok("Valid responses remained rate-consistent");
  } else {
    reporter.fail("Valid responses returned different rates");
  }

  if (result.cacheHitVerified) {
    reporter.ok("Explicit cache HIT metadata observed");
  } else if (result.cacheEvidenceMissing) {
    reporter.skip("Cache proof unavailable: endpoint currently emits no cache metadata");
  } else {
    reporter.fail("Repeated valid responses did not report a cache HIT");
  }

  const durations = result.validResponses
    .map(({ durationMs }) => durationMs)
    .filter((duration) => typeof duration === "number");
  if (durations.length >= 2) {
    reporter.info("Response timing was observed for diagnostics only; it is not cache-hit evidence");
  }
  return result;
}

function evaluateSourceChecks(source) {
  return SOURCE_CHECKS.map(({ label, pattern }) => ({
    label,
    passed: pattern.test(source),
  }));
}

async function testCircuitBreaker(reporter) {
  reporter.heading(5, "Circuit Breaker Architecture");
  const rateSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "exchange", "providers", "rate.service.ts"),
    "utf-8",
  );
  for (const check of evaluateSourceChecks(rateSource)) {
    if (check.passed) {
      reporter.ok(check.label);
    } else {
      reporter.fail(`${check.label} missing`);
    }
  }
}

async function testCodeIntegrity(reporter, env = process.env) {
  reporter.heading(6, "Code Integrity Checks");
  const packageJson = require(path.join(__dirname, "..", "package.json"));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const dependency of ["@nestjs/axios", "@nestjs/schedule", "axios", "ioredis", "@prisma/client"]) {
    if (dependencies[dependency]) {
      reporter.ok(`Dependency: ${dependency}`);
    } else {
      reporter.fail(`Missing: ${dependency}`);
    }
  }

  if (env.FX_API_URL) {
    reporter.ok("FX_API_URL supplied to validator environment");
  } else {
    reporter.info("FX_API_URL not supplied to validator environment");
  }
  if (env.FX_API_KEY) {
    reporter.ok("FX_API_KEY supplied to validator environment");
  } else {
    reporter.info("FX_API_KEY not supplied to validator environment");
  }

  const rateSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "exchange", "providers", "rate.service.ts"),
    "utf-8",
  );
  for (const method of ["getRate", "fetchRates", "setManualRate", "getDeviationFromMarket", "getCircuitStatus"]) {
    if (new RegExp(`(?:async\\s+)?${method}\\s*\\(`).test(rateSource)) {
      reporter.ok(`RateService.${method}()`);
    } else {
      reporter.fail(`RateService.${method}() missing`);
    }
  }
}

async function main({ env = process.env, argv = process.argv.slice(2), reporter = createReporter() } = {}) {
  const config = resolveConfig(env, argv);
  reporter.log("");
  reporter.log(`${C.BD}TRUSTPAY — Sandbox Rate Fetch & Cache Validation${C.X}`, C.B);
  reporter.log(`${"=".repeat(64)}`, C.B);

  await testCodeIntegrity(reporter, env);
  await testCircuitBreaker(reporter);

  let started = false;
  try {
    reporter.heading(1, "Backend Availability");
    if (config.offline) {
      reporter.skip("Backend availability check (--offline)");
      reporter.skip("Rate endpoint live test (--offline)");
      reporter.skip("Cache hit/miss test (--offline)");
    } else {
      const availability = await ensureBackend(config, { reporter });
      started = availability.started;
      if (!availability.available) {
        reporter.skip("Rate endpoint live test (backend not reachable)");
        reporter.skip("Cache hit/miss test (backend not reachable)");
      } else {
        const auth = await getAuthToken(config, reporter);
        if (!auth.token) {
          reporter.skip("Rate endpoint live test (auth token unavailable)");
          reporter.skip("Cache hit/miss test (auth token unavailable)");
        } else {
          const rateBody = await testRateEndpoint(auth, config, reporter);
          if (rateBody) {
            await testCacheHitMiss(auth, config, reporter);
          } else {
            reporter.skip("Cache hit/miss test (primary rate response was invalid or unavailable)");
          }
        }
      }
    }
  } finally {
    if (started) {
      stopBackend(reporter);
    }
  }

  return reporter.printSummary().exitCode;
}

module.exports = {
  DEFAULT_CONFIG,
  createReporter,
  ensureBackend,
  evaluateCacheResponses,
  evaluateSourceChecks,
  getAuthToken,
  main,
  resolveAuthToken,
  resolveConfig,
  testCacheHitMiss,
  testCodeIntegrity,
  testCircuitBreaker,
  testRateEndpoint,
  validateRateResponse,
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write("Rate validator aborted unexpectedly\n");
    stopBackend(createReporter());
    process.exitCode = 1;
  });
}
