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

#### Setup
```bash
# Install
cd backend
npm install twilio

# Add to .env
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

#### Implementation
```typescript
// src/otp/providers/twilio.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class TwilioProvider {
  private client: any;

  constructor(private configService: ConfigService) {
    this.client = twilio(
      this.configService.get('TWILIO_ACCOUNT_SID'),
      this.configService.get('TWILIO_AUTH_TOKEN'),
    );
  }

  async sendSms(to: string, message: string): Promise<boolean> {
    try {
      await this.client.messages.create({
        body: message,
        from: this.configService.get('TWILIO_PHONE_NUMBER'),
        to,
      });
      return true;
    } catch (error) {
      console.error('Twilio SMS failed:', error);
      return false;
    }
  }
}
```

#### Update OTP Service
```typescript
// In OtpService.sendOtp():
const message = `Your TrustPay verification code is: ${code}. Valid for ${this.expirySeconds / 60} minutes.`;
await this.smsProvider.sendSms(phone, message);
```

### Africa's Talking

#### Setup
```bash
npm install africastalking

# Add to .env
SMS_PROVIDER=africastalking
AT_USERNAME=your_username
AT_API_KEY=your_api_key
AT_SHORTCODE=your_shortcode
```

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

## Payment Gateways

### Paystack

#### Setup
```bash
# Add to .env
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx
```

#### Webhook URL
```
POST https://your-domain.com/api/webhooks/paystack
Header: x-paystack-signature: {signature}
```

#### Events to Handle
| Event | Action |
|-------|--------|
| `charge.success` | Credit user wallet |
| `transfer.success` | Mark withdrawal as complete |
| `transfer.failed` | Reverse withdrawal, notify user |

### Flutterwave

#### Setup
```bash
# Add to .env
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-xxxxxxxxxxxxxxxxxxxxx
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxx
FLUTTERWAVE_ENCRYPTION_KEY=FLWSECK_xxxxxxxxxxxxxxxxxxxx
FLUTTERWAVE_SECRET_HASH=your_webhook_hash
```

#### Webhook URL
```
POST https://your-domain.com/api/webhooks/flutterwave
Header: flw-signature: {signature}
```

---

## VTU Providers

### Reloadly

#### Setup
```bash
# Add to .env
VTU_API_URL=https://topups.reloadly.com
VTU_API_KEY=your_reloadly_api_key
VTU_API_SECRET=your_reloadly_secret
```

#### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /operators` | List operators |
| `GET /operators/{id}/discounts` | Get discounts |
| `POST /topups` | Send topup |

### Shago Payments

#### Setup
```bash
# Add to .env
VTU_API_URL=https://api.shagopay.com
VTU_API_KEY=your_shago_api_key
```

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
