# 🏦 Monnify KYB (Know Your Business) Checklist

> **Status:** 🔜 Pending Human Submission
> **Stream:** STREAM-BANKING — Phase 1, Task 1.1
> **Last Updated:** 2026-05-31

---

## Required Documents

### 1. Corporate Affairs Commission (CAC) Registration
- [ ] Certificate of Incorporation (scanned PDF, clear and legible)
- [ ] CAC Status Report (not older than 6 months)
- [ ] Memorandum and Articles of Association (MEMART)

### 2. Director / Signatory Identification
- [ ] Valid government-issued ID (International Passport, National ID, Driver's License, or Voter's Card)
- [ ] BVN (Bank Verification Number) of at least one director
- [ ] Passport photograph of the primary director/signatory

### 3. Bank Account for Settlement
- [ ] Business bank account details for settlement of funds
- [ ] Bank statement or bank confirmation letter (not older than 3 months)
- [ ] Account must be in the company's registered business name

### 4. Business Address Verification
- [ ] Utility bill (electricity, water, waste) in company name, not older than 3 months
- [ ] Tenancy agreement if office is rented, OR
- [ ] Certificate of Occupancy if owned

### 5. Tax & Regulatory
- [ ] Tax Identification Number (TIN)
- [ ] SCUML (Special Control Unit Against Money Laundering) certificate (for fintechs)

---

## Submission Steps

### Step 1: Create Monnify Business Account
1. Go to [https://monnify.com](https://monnify.com) → Create Business Account
2. Enter business email (use `engineering@trustpay.ng` or equivalent)
3. Verify email address

### Step 2: Complete Business Profile
1. Fill in business legal name: **TrustPay** (as registered with CAC)
2. Select business type: **Fintech / Financial Services**
3. Enter RC number from CAC certificate
4. Provide TIN

### Step 3: Upload Documents
1. Navigate to Settings → KYB → Document Upload
2. Upload each document listed above in the appropriate category
3. Ensure files are PDF, PNG, or JPG under 5MB each

### Step 4: API Key Generation
1. Navigate to Settings → API Keys & Webhooks
2. Generate **Sandbox API Key** (test environment)
3. Copy **Sandbox Secret Key** (shown once — store immediately)
4. Note the **Contract Code** (found in Settings → Contracts)

### Step 5: Production Credentials
1. After KYB approval (typically 24-72 hours), request production activation
2. Generate Production API Key and Secret Key
3. Note Production Contract Code

---

## Credential Storage

Store credentials in the project's secret manager. For local development, set in `.env`:

```bash
# Sandbox (development/staging)
MONNIFY_API_KEY=sandbox_mk_xxxxxxxxxxxxxxxx
MONNIFY_SECRET_KEY=sandbox_sk_xxxxxxxxxxxxxxxx
MONNIFY_CONTRACT_CODE=xxxxxxxxxxxx
MONNIFY_BASE_URL=https://sandbox.monnify.com

# Webhooks are signed with MONNIFY_SECRET_KEY; no separate webhook secret exists.

# Production (overridden in production environment)
BANKING_SANDBOX_MODE=true
```

For production, these are stored in the deployment environment's secret manager (e.g., AWS Secrets Manager, GCP Secret Manager, or Vercel Environment Variables).

---

## Status Tracker

| Step | Status | Date Completed | Notes |
|---|---|---|---|
| CAC documents gathered | ⬜ Pending | — | |
| Director ID prepared | ⬜ Pending | — | |
| Settlement bank account confirmed | ⬜ Pending | — | |
| Address verification obtained | ⬜ Pending | — | |
| TIN / SCUML ready | ⬜ Pending | — | |
| Monnify business account created | ⬜ Pending | — | |
| Business profile completed | ⬜ Pending | — | |
| Documents uploaded | ⬜ Pending | — | |
| KYB approved | ⬜ Pending | — | |
| Sandbox API key obtained | ⬜ Pending | — | |
| Sandbox secret key stored | ⬜ Pending | — | |
| Contract code noted | ⬜ Pending | — | |
| Production credentials requested | ⬜ Pending | — | |
| Production credentials obtained | ⬜ Pending | — | |

---

## Acceptance Criteria

- [ ] Monnify sandbox credentials obtained and verified
- [ ] Contract code assigned and noted
- [ ] Production credentials requested (may be pending Monnify review)
- [ ] All credentials stored securely (never committed to git)

---

## Notes

- Monnify sandbox is available immediately after business account creation — you don't need full KYB approval to start testing
- Production credentials require full KYB approval
- The sandbox uses test bank accounts — see [Monnify Sandbox Documentation](https://docs.monnify.com)
- Reserve accounts in sandbox do NOT receive real money — use Monnify's simulation tools
