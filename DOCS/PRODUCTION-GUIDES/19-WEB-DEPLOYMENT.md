# 🌐 Web/Admin Production Deployment — Vercel

> **Guide ID:** `PROD-19-WEB`
> **Stream:** STREAM-INFRA Phase 1.5
> **Target Platform:** Vercel (edge-optimized for Next.js)
> **Last Updated:** 2026-05-31

---

## Why Vercel for TRUSTPAY

- **Zero-config Next.js 16** — framework-level optimization
- **Edge middleware** — auth protection runs globally at the edge
- **Auto-HTTPS** — Let's Encrypt certs included
- **Preview deployments** — every PR gets its own URL
- **Analytics + Speed Insights** — built-in performance monitoring
- **Free tier** covers startup needs (100 GB bandwidth, 6,000 build minutes)

---

## Pre-Deployment Checklist

- [ ] Backend deployed and accessible at production URL
- [ ] `NEXT_PUBLIC_API_URL` points to production backend
- [ ] Supabase production project created and configured
- [ ] Middleware fixed (see Critical Fix below)
- [ ] All 21+ routes tested locally with `next build && next start`
- [ ] `vercel.json` created (done — at `WEBSITE/vercel.json`)

---

## 🚨 Critical Fix: Middleware Discovery

### Problem

The auth middleware is at `WEBSITE/src/proxy.ts` with:
```typescript
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] }
```

**Next.js 16 only auto-discovers `src/middleware.ts` (or `src/middleware.js`).** The file at `src/proxy.ts` is **dead code** — it is never loaded by Next.js. This means dashboard and admin routes are **not actually protected** by middleware.

### Fix

Rename the file and update the export:

```bash
cd WEBSITE
mv src/proxy.ts src/middleware.ts
```

Then update the function name in `src/middleware.ts`:
```typescript
// CHANGE:
export async function proxy(request: NextRequest) {

// TO:
export async function middleware(request: NextRequest) {
```

The `config` export stays the same — Next.js uses it for route matching.

### Verification After Fix

```bash
# Build and start locally
cd WEBSITE
npm run build
npm start

# Test unprotected route redirects
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3001/dashboard
# Should return: 307 http://localhost:3001/login?callbackUrl=/dashboard

# Test auth page redirects when logged in
# (requires session cookie — test manually in browser)
```

---

## Step-by-Step Deployment

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Deploy (First Time)

```bash
cd WEBSITE

# Preview deploy (test first!)
vercel

# Production deploy
vercel --prod
```

### 3. Link GitHub Repository

1. Go to https://vercel.com/dashboard
2. Import project → select TRUSTPAY GitHub repo
3. Root directory: `WEBSITE`
4. Framework: Next.js (auto-detected)
5. Build command: `next build` (auto-detected)
6. Output directory: `.next` (auto-detected)

### 4. Configure Environment Variables

In Vercel dashboard → Settings → Environment Variables:

| Variable | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.trustpay.xyz` | Production |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Production |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Production |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME` | (optional) | Production |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME` | (optional) | Production |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER` | (optional) | Production |

For **preview deployments** (staging):
- Set same variables but with staging values
- `NEXT_PUBLIC_API_URL` → staging backend URL

### 5. Configure Domain

```bash
# Via CLI
vercel domains add trustpay.xyz
vercel domains add www.trustpay.xyz

# Or in Vercel dashboard → Domains
# Add CNAME record in your DNS provider:
#   trustpay.xyz  →  cname.vercel-dns.com
#   www.trustpay.xyz  →  cname.vercel-dns.com
```

---

## Post-Deployment Smoke Tests

### Public Routes (No Auth Required)

```bash
PROD_URL="https://trustpay.xyz"

# Marketing pages — all should return 200
for route in "/" "/features" "/exchange" "/vtu" "/security" "/company" "/support"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL$route")
  echo "$route: $STATUS"
done

# Auth pages — should return 200 (not redirect)
for route in "/login" "/register" "/forgot-password"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL$route")
  echo "$route: $STATUS"
done
```

### Auth Protection — Should Redirect to Login

```bash
# Dashboard routes — should return 307 redirect to /login
for route in "/dashboard" "/dashboard/exchange" "/dashboard/vtu" \
             "/dashboard/transactions" "/dashboard/withdraw" "/dashboard/fund" \
             "/dashboard/profile" "/dashboard/kyc" "/dashboard/support"; do
  REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "$PROD_URL$route")
  echo "$route → $REDIRECT"
done

# Admin routes — should return 307 redirect to /login
for route in "/admin" "/admin/kyc" "/admin/vtu" "/admin/support"; do
  REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "$PROD_URL$route")
  echo "$route → $REDIRECT"
done
```

### Auth Pages With Session — Should Redirect to Dashboard

Test manually in browser:
1. Log in at `/login`
2. Navigate to `/login` again → should redirect to `/dashboard`
3. Navigate to `/register` → should redirect to `/dashboard`

### Security Headers Verification

```bash
curl -sI https://trustpay.xyz | grep -E "(strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy)"
```

Expected:
```
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
```

### API Proxy Verification

```bash
# The Vercel rewrite in vercel.json proxies /api/* to backend
curl -s https://trustpay.xyz/api/health | jq
```

### Build Verification

```bash
# Check latest deployment
vercel ls

# Check build logs
vercel logs https://trustpay.xyz
```

---

## Route Map (27 Total)

| Category | Routes | Auth Required |
|---|---|---|
| Public/Marketing | `/`, `/features`, `/exchange`, `/vtu`, `/security`, `/company`, `/support` | No |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password` | No (redirect if logged in) |
| Dashboard | `/dashboard`, `/dashboard/exchange`, `/dashboard/vtu`, `/dashboard/transactions`, `/dashboard/transactions/[id]`, `/dashboard/withdraw`, `/dashboard/fund`, `/dashboard/profile`, `/dashboard/kyc`, `/dashboard/support`, `/dashboard/wallet/[currency]` | Yes |
| Admin | `/admin`, `/admin/kyc`, `/admin/vtu`, `/admin/support` | Yes (Admin role) |
| System | `/error`, `/not-found` | N/A |

---

## Environment-Specific Config

| Setting | Staging | Production |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api-staging.trustpay.xyz` | `https://api.trustpay.xyz` |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase project | Production Supabase project |
| Vercel domain | `staging.trustpay.xyz` | `trustpay.xyz` |
| Build on PR | Yes (preview deploy) | N/A |
| Auto-deploy on merge | From `staging` branch | From `main` branch |

---

## Rollback

```bash
# List deployments
vercel ls

# Rollback to previous deployment
vercel rollback

# Or via Vercel dashboard → Deployments → select previous → Promote to Production
```

---

## Monitoring

- **Vercel Analytics** — Dashboard → Analytics (Web Vitals, traffic)
- **Sentry** — Error tracking via Next.js error boundary
- **Uptime** — Configure Better Uptime / Pingdom to monitor `https://trustpay.xyz`

---

*Last updated: 2026-05-31 | Stream: STREAM-INFRA Phase 1.5*
