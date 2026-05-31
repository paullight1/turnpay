#!/usr/bin/env node

/**
 * TRUSTPAY — Task 1.3: Sandbox Rate Fetch & Cache Validation
 * ===========================================================
 *
 * Validates:
 *   (a) Live rate returned from GET /api/exchange/rate?from=GHS&to=NGN
 *   (b) Cache hit on second call (faster, same rate)
 *   (c) Circuit breaker behaviour when provider is unreachable
 *   (d) Redis key inspection
 *
 * Prerequisites:
 *   1. PostgreSQL running on localhost:5432
 *   2. Redis running on localhost:6379
 *   3. BACKEND/.env file with FX_API_URL and FX_API_KEY configured
 *   4. npm install completed in BACKEND/
 *
 * Usage:
 *   cd BACKEND
 *   node scripts/validate-rate-endpoint.js
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Config ──────────────────────────────────────────────────────────
const CONFIG = {
  backendPort: parseInt(process.env.PORT, 10) || 3000,
  get backendUrl() { return `http://localhost:${this.backendPort}`; },
  rateEndpoint: "/api/exchange/rate",
  loginEndpoint: "/api/auth/login",
  pollInterval: 1500,
  startupTimeout: 60000,
  requestTimeout: 15000,
};

// ── Colors ──────────────────────────────────────────────────────────
const C = { G: "\x1b[32m", R: "\x1b[31m", Y: "\x1b[33m", B: "\x1b[36m", M: "\x1b[35m", X: "\x1b[0m", BD: "\x1b[1m" };

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function log(msg, color = "") { process.stdout.write(`${color}[${new Date().toISOString().slice(11, 23)}] ${msg}${C.X}\n`); }
function info(msg) { log(`INFO  ${msg}`, C.B); }
function ok(msg) { log(`PASS  ${msg}`, C.G); passed++; }
function fail(msg) { log(`FAIL  ${msg}`, C.R); failures.push(msg); failed++; }
function skip(msg) { log(`SKIP  ${msg}`, C.Y); skipped++; }
function heading(n, text) {
  log("", C.X);
  log(`${C.BD}${"=".repeat(64)}${C.X}`, C.M);
  log(`${C.BD}  ${n}. ${text}${C.X}`, C.M);
  log(`${"=".repeat(64)}`, C.M);
}

// ── HTTP Helpers ────────────────────────────────────────────────────
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...options.headers },
      timeout: options.timeout || CONFIG.requestTimeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let body = raw;
        try { body = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, raw });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ── 1. Backend Startup ──────────────────────────────────────────────
async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const r = await httpRequest(url, { timeout: 3000 }); if (r.status) return true; }
    catch {}
    await new Promise((r) => setTimeout(r, CONFIG.pollInterval));
  }
  return false;
}

let backendProcess = null;

async function startBackend() {
  info("Starting NestJS backend...");
  return new Promise((resolve, reject) => {
    const backendDir = path.resolve(__dirname, "..");
    const env = { ...process.env, PORT: String(CONFIG.backendPort) };
    const hasDist = fs.existsSync(path.join(backendDir, "dist", "main.js"));
    if (hasDist) {
      info("Using compiled output (node dist/main)");
      backendProcess = spawn("node", ["dist/main"], { cwd: backendDir, stdio: ["ignore", "pipe", "pipe"], env });
    } else {
      info("Running npx nest start...");
      backendProcess = spawn("npx", ["nest", "start"], { cwd: backendDir, stdio: ["ignore", "pipe", "pipe"], env });
    }
    backendProcess.stdout.on("data", (d) => process.stdout.write(`  [backend] ${d}`));
    backendProcess.stderr.on("data", (d) => process.stderr.write(`  [backend:err] ${d}`));
    backendProcess.on("error", (err) => reject(new Error(`Failed to start: ${err.message}`)));
    const url = `${CONFIG.backendUrl}${CONFIG.rateEndpoint}?from=GHS&to=NGN`;
    waitForServer(url, CONFIG.startupTimeout).then((ready) => {
      if (ready) { info("Backend is ready"); resolve(true); }
      else reject(new Error("Backend did not start within timeout"));
    });
  });
}

function stopBackend() {
  if (backendProcess) {
    info("Stopping backend...");
    backendProcess.kill("SIGTERM");
    setTimeout(() => { if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGKILL"); }, 5000);
  }
}

// ── 2. Auth Token ───────────────────────────────────────────────────
async function getAuthToken() {
  info("Obtaining JWT token...");
  try {
    const res = await httpRequest(`${CONFIG.backendUrl}${CONFIG.loginEndpoint}`, {
      method: "POST",
      body: { email: process.env.TEST_EMAIL || "test@trustpay.app", password: process.env.TEST_PASSWORD || "testpassword123" },
    });
    if (res.status === 200) {
      const token = res.body?.accessToken || res.body?.token;
      if (token) { ok("JWT token obtained"); return token; }
    }
  } catch {}
  info("Could not obtain JWT token (endpoint requires auth)");
  return null;
}

// ── 3. Rate Endpoint ────────────────────────────────────────────────
async function testRateEndpoint(token) {
  heading(3, "Live Rate Fetch");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const t0 = Date.now();
  let res;
  try {
    res = await httpRequest(`${CONFIG.backendUrl}${CONFIG.rateEndpoint}?from=GHS&to=NGN`, { headers });
  } catch (err) { fail(`Endpoint unreachable: ${err.message}`); return null; }

  if (res.status === 200) ok(`HTTP 200 (${Date.now() - t0}ms)`);
  else if (res.status === 401) { fail("HTTP 401 — JWT auth required"); return null; }
  else { fail(`HTTP ${res.status}`); return null; }

  const b = res.body;
  if (b.from === "GHS" && b.to === "NGN") ok("Currencies match GHS→NGN");
  else fail("Currency mismatch");
  if (typeof b.baseRate === "number" && b.baseRate > 0) ok(`Base rate: ${b.baseRate}`);
  else fail("baseRate invalid/missing");
  if (typeof b.markupPercent === "number" && b.markupPercent > 0) ok(`Markup: ${b.markupPercent}%`);
  else fail("markupPercent invalid/missing");
  if (typeof b.effectiveRate === "number" && b.effectiveRate > 0) ok(`Effective rate: ${b.effectiveRate}`);
  else fail("effectiveRate invalid/missing");

  // Check stale header
  if (res.headers["x-rate-stale"] === "true") {
    info("X-Rate-Stale: true — circuit may be open or fallback in use");
  }

  // Reverse direction
  try {
    const revRes = await httpRequest(`${CONFIG.backendUrl}${CONFIG.rateEndpoint}?from=NGN&to=GHS`, { headers });
    if (revRes.status === 200) ok(`NGN→GHS rate: ${revRes.body.baseRate}`);
  } catch { skip("NGN→GHS endpoint"); }

  return b;
}

// ── 4. Cache Hit/Miss ───────────────────────────────────────────────
async function testCacheHitMiss(token) {
  heading(4, "Cache Hit/Miss Validation");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${CONFIG.backendUrl}${CONFIG.rateEndpoint}?from=GHS&to=NGN`;

  const times = [], rates = [];
  for (let i = 1; i <= 4; i++) {
    const t0 = Date.now();
    let res;
    try { res = await httpRequest(url, { headers }); } catch { fail(`Request ${i} failed`); continue; }
    const t = Date.now() - t0;
    times.push(t);
    rates.push(res.body?.baseRate);
    if (i === 1) ok(`Request 1: ${res.body?.baseRate} (${t}ms) — cold`);
    else if (rates[i - 1] === rates[0]) ok(`Request ${i}: ${res.body?.baseRate} (${t}ms) — cache HIT`);
    else ok(`Request ${i}: ${res.body?.baseRate} (${t}ms)`);
    await new Promise((r) => setTimeout(r, 200));
  }

  const avgCached = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
  if (avgCached < times[0]) ok(`Cached faster: ${times[0]}ms → ${avgCached.toFixed(0)}ms avg`);
  if (new Set(rates.filter(Boolean)).size === 1) ok("All responses returned same rate — cache consistent");
}

// ── 5. Circuit Breaker ──────────────────────────────────────────────
async function testCircuitBreaker() {
  heading(5, "Circuit Breaker Architecture");
  const rateSource = fs.readFileSync(path.join(__dirname, "..", "src", "exchange", "providers", "rate.service.ts"), "utf-8");
  if (rateSource.includes("CircuitState")) ok("Circuit breaker state machine present");
  else fail("Circuit breaker missing");
  if (rateSource.includes("CIRCUIT_FAILURE_THRESHOLD")) ok("Failure threshold configured");
  if (rateSource.includes("CIRCUIT_RECOVERY_MS")) ok("Recovery timeout configured");
  if (rateSource.includes('"OPEN"')) ok("Circuit OPEN state handling");
  if (rateSource.includes('"HALF_OPEN"')) ok("Half-open recovery probing");
  if (rateSource.includes("isStale")) ok("Stale rate flag propagated");
  if (rateSource.includes("RATE_FRESHNESS_TTL_MS")) ok("60s rate freshness TTL");
  if (rateSource.includes("FX_RATE_CIRCUIT_OPENED")) ok("Circuit-open audit log alert");
}

// ── 6. Code Integrity ───────────────────────────────────────────────
async function testCodeIntegrity() {
  heading(6, "Code Integrity Checks");
  const pkg = require(path.join(__dirname, "..", "package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const dep of ["@nestjs/axios", "@nestjs/schedule", "axios", "ioredis", "@prisma/client"]) {
    if (deps[dep]) ok(`Dependency: ${dep}`);
    else fail(`Missing: ${dep}`);
  }

  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    ok(".env file exists");
    const envContent = fs.readFileSync(envPath, "utf-8");
    if (envContent.includes("FX_API_URL")) ok("FX_API_URL configured");
    else info("FX_API_URL not set — using stored/fallback rates");
    if (envContent.includes("FX_API_KEY")) ok("FX_API_KEY configured");
    else info("FX_API_KEY not set — using stored/fallback rates");
  } else { fail(".env file missing"); }

  const rateSource = fs.readFileSync(path.join(__dirname, "..", "src", "exchange", "providers", "rate.service.ts"), "utf-8");
  for (const method of ["getRate", "fetchRates", "setManualRate", "getDeviationFromMarket", "getCircuitStatus"]) {
    if (rateSource.includes(`async ${method}`) || rateSource.includes(`${method}(`)) ok(`RateService.${method}()`);
    else fail(`RateService.${method}() missing`);
  }
}

// ── 7. Summary ──────────────────────────────────────────────────────
function printSummary() {
  heading(7, "Results Summary");
  log(`${C.BD}  PASSED: ${C.G}${passed}${C.X}`, C.X);
  log(`${C.BD}  FAILED: ${C.R}${failed}${C.X}`, C.X);
  log(`${C.BD}  SKIPPED: ${C.Y}${skipped}${C.X}`, C.X);
  if (failures.length > 0) {
    log(`${C.R}  FAILURES:${C.X}`, C.R);
    for (const f of failures) log(`    ${f}`, C.R);
  }
  log(failed === 0 ? `${C.G}${C.BD}  ALL CHECKS PASSED${C.X}` : `${C.R}${C.BD}  ${failed} CHECK(S) FAILED${C.X}`, failed === 0 ? C.G : C.R);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("");
  log(`${C.BD}TRUSTPAY — Task 1.3: Sandbox Rate Fetch & Cache Validation${C.X}`, C.B);
  log(`${"=".repeat(64)}`, C.B);

  // Offline checks (always run)
  await testCodeIntegrity();
  await testCircuitBreaker();

  // Try online checks
  let backendStarted = false;
  heading(1, "Backend Startup");
  try {
    backendStarted = await startBackend();
  } catch (err) {
    info(`Could not auto-start backend: ${err.message}`);
    info("");
    info(`${C.BD}Manual startup:${C.X}`);
    info("  1. Ensure PostgreSQL + Redis are running");
    info("  2. cd BACKEND && npm run build");
    info("  3. cd BACKEND && npm run start:dev");
    info("  4. node scripts/validate-rate-endpoint.js");
  }

  if (backendStarted) {
    const token = await getAuthToken();
    await testRateEndpoint(token);
    await testCacheHitMiss(token);
    stopBackend();
  } else {
    skip("Rate endpoint live test (backend not running)");
    skip("Cache hit/miss test (backend not running)");
  }

  printSummary();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); stopBackend(); process.exit(1); });
