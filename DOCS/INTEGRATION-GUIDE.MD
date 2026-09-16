# TRUSTPAY Integration Guide

How to integrate third-party services into the TRUSTPAY platform.

---

## Table of Contents
1. [SMS Provider (OTP)](#sms-provider-otp)
2. [Email Service](#email-service)
3. [Payment Gateways](#payment-gateways)
4. [VTU Providers](#vtu-providers)
5. [FX Rate APIs](#fx-rate-apis)
6. [Error Tracking](#error-tracking)
7. [SMS/Email Templates](#smsemail-templates)

---

## SMS Provider (OTP)

### Twilio

Twilio is the selected SMS provider for the current OTP implementation. The
backend calls Twilio's REST Messages endpoint through the existing
`@nestjs/axios` dependency; no Twilio SDK or second SMS provider is required.

#### Configuration

Set these values in the backend secret manager (never commit them):

```env
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<secret>
TWILIO_PHONE_NUMBER=+15557122661
OTP_EXPIRES_IN=5m
OTP_LENGTH=6
# Development/test only. Leave empty in staging and production.
OTP_DEV_CODE=
```

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` are
required for staging and production. Startup validation must reject a deployed
environment with missing or invalid values. A six-digit `OTP_DEV_CODE` is
accepted only when `NODE_ENV` is `development` or `test`; it bypasses the SMS
transport for local verification and must be absent from staging and
production.

#### Delivery behavior

`BACKEND/src/otp/twilio.provider.ts` sends one `POST` request to
`https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` with
HTTP Basic authentication and URL-encoded `To`, `From`, and `Body` fields. The
provider uses an eight-second request timeout and deliberately does not retry:
an ambiguous timeout may mean Twilio accepted the message, so retrying could
send a duplicate code.

`OtpService` persists the generated code only after Twilio returns a successful
message response with a message SID. Delivery errors produce a safe 503 and do
not return `{ success: true }` or log the OTP, auth token, message body, or
provider credentials. The existing send limit remains three requests per hour
per normalized phone, and verification remains three attempts with a maximum
five-minute lifetime.

The auth mutation idempotency interceptor protects `/api/auth/otp/send` and
registration. Clients must reuse the same `Idempotency-Key` when retrying an
unknown response; do not issue a new delivery request merely because the
provider call timed out.

#### Local verification

No live SMS is needed for the OTP unit tests. Run the synthetic provider tests
with:

```bash
cd BACKEND
npm test -- --runInBand otp.service.spec.ts twilio.provider.spec.ts
```

Before launch, validate delivery with a controlled staging handset and
provider-approved sender. Record the provider response and successful OTP
verification without putting the code in logs or test artifacts.

---

## Email Service

### Resend (Recommended)

#### Setup
```bash
cd backend
npm install resend

# Add to .env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=noreply@trustpay.com
```

#### Implementation
```typescript
// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.resend.emails.send({
      from: this.configService.get('FROM_EMAIL'),
      to,
      subject: 'Reset Your TrustPay Password',
      html: `
        <h2>Reset Your Password</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link expires in 1 hour.</p>
      `,
    });
  }

  async sendTransactionReceipt(to: string, transaction: any): Promise<void> {
    await this.resend.emails.send({
      from: this.configService.get('FROM_EMAIL'),
      to,
      subject: `Transaction Receipt - ${transaction.reference}`,
      html: `
        <h2>Transaction Receipt</h2>
        <table>
          <tr><td>Reference</td><td>${transaction.reference}</td></tr>
          <tr><td>Type</td><td>${transaction.type}</td></tr>
          <tr><td>Amount</td><td>${transaction.currency} ${transaction.amount}</td></tr>
          <tr><td>Status</td><td>${transaction.status}</td></tr>
        </table>
      `,
    });
  }
}
```

### SendGrid Alternative
```bash
npm install @sendgrid/mail
```

---

## Provider Integrations

TRUSTPAY has one provider per capability. Do not add fallback credentials or route
selection for another provider.

### Monnify — banking and payments

```env
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_WEBHOOK_URL=https://your-domain.com/api/webhooks/monnify
```

Monnify handles reserved accounts, deposits, account resolution, beneficiaries,
withdrawals, status checks, and payment webhooks. Verify every webhook signature and
process each provider reference only once.

### VTpass — VTU and bills

```env
VTU_PROVIDER=vtpass
VTPASS_BASE_URL=https://sandbox.vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
VTPASS_WEBHOOK_SECRET=
```

Register `https://your-domain.com/api/webhooks/vtu/vtpass` in the VTpass dashboard.
The active product scope is Nigerian airtime, data, cable, and electricity supported
by the VTpass catalogue.

### Ninja — direct Nigerian KYC

```env
KYC_PROVIDER=ninja
NINJA_BASE_URL=https://api.sandbox.ninja.boucloud.io
NINJA_CLIENT_KEY=
NINJA_CLIENT_SECRET=
```

The mobile/web client submits explicit consent, BVN or NIN, and date of birth to
`POST /api/kyc/verify`. Only the backend authenticates with Ninja. Ninja direct
identity verification does not require a webhook; never expose either Ninja
credential in a client environment.

See `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD` and `DOCS/KYC-GUIDE.MD` for the supported
routes and launch checks.

---

## FX Rate APIs

### ExchangeRate-API

#### Setup
```bash
# Add to .env
FX_RATE_API_URL=https://v6.exchangerate-api.com/v6/{key}/latest/GHS
FX_RATE_API_KEY=your_api_key
```

### Open Exchange Rates

#### Setup
```bash
# Add to .env
FX_RATE_API_URL=https://openexchangerates.org/api/latest.json
FX_RATE_API_KEY=your_app_id
```

---

## Error Tracking

### Sentry

#### Backend Setup
```bash
cd backend
npm install @sentry/nestjs
```

```typescript
// main.ts
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

#### Frontend Setup
```bash
cd website
npm install @sentry/nextjs
```

```typescript
// next.config.ts
import {withSentryConfig} from "@sentry/nextjs";

const nextConfig = {...};

export default withSentryConfig(nextConfig, {
  org: "your-org",
  project: "trustpay",
});
```

---

## SMS/Email Templates

### OTP SMS
```
Your TrustPay verification code is: {code}. Valid for {minutes} minutes.
```

### Password Reset Email
```
Subject: Reset Your TrustPay Password

Hi {name},

Click the link below to reset your password:
{reset_url}

This link expires in 1 hour.

If you didn't request this, ignore this email.

— TrustPay Team
```

### Transaction Receipt Email
```
Subject: Transaction Receipt - {reference}

Hi {name},

Your transaction details:

Reference: {reference}
Type: {type}
Amount: {currency} {amount}
Fee: {currency} {fee}
Status: {status}
Date: {date}

— TrustPay Team
```

### Welcome Email
```
Subject: Welcome to TrustPay!

Hi {name},

Welcome to TrustPay! You can now:
- Exchange GHS ↔ NGN
- Buy airtime and data
- Pay cable TV and electricity bills
- Send money to bank accounts

Get started: {dashboard_url}

— TrustPay Team
```
