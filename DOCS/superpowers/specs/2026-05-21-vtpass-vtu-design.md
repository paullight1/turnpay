# VTPass VTU Design

Date: 2026-05-21

## Goal

Add real VTU purchasing to TRUSTPAY using VTPass as the first live aggregator. The first supported scope is Nigerian NGN wallet purchases for airtime, data, cable TV, and electricity. The implementation must preserve wallet integrity, idempotency, masked customer identifiers, and auditable provider status handling.

## Current State

The backend already has a `vtu` module, protected routes, DTOs, wallet debit through `LedgerService`, reversal handling, and a web dashboard VTU page. Mobile already exposes airtime, data, and electricity entry points, but data package selection and cable are incomplete. The existing provider is generic and falls back to simulated responses when `VTU_API_URL` is absent.

## Provider Choice

Use VTPass first because it directly covers the current TRUSTPAY service set: airtime, data bundles, electricity, cable TV, service variation codes, transaction requery, and transaction update webhooks. Flutterwave Bills remains a later adapter option if TRUSTPAY wants to consolidate bill payments through Flutterwave. Reloadly remains a later adapter option for broader international airtime and data.

## Architecture

Create a stable internal provider contract around the existing VTU service:

- `VtuProviderGateway`: internal interface for listing providers, listing packages, validating billers, purchasing, requerying, and verifying callbacks.
- `VtpassProvider`: concrete adapter that maps TRUSTPAY request fields to VTPass service IDs, variation codes, billers codes, request IDs, and response statuses.
- `VtuService`: owns TRUSTPAY transaction lifecycle, wallet debit/reversal, status transitions, safe metadata, and provider orchestration.
- `VtuController`: keeps the existing authenticated routes and adds webhook/requery endpoints where needed.

Provider-specific secrets must come from environment/config only:

- `VTU_PROVIDER=vtpass`
- `VTPASS_BASE_URL`
- `VTPASS_API_KEY`
- `VTPASS_PUBLIC_KEY`
- `VTPASS_SECRET_KEY`
- `VTPASS_WEBHOOK_SECRET` or an equivalent callback verification token if configured by the provider

## Data Flow

1. Client loads providers for a service type.
2. Client loads packages when the type requires variations, such as data or cable.
3. Client optionally validates smart card or meter details for cable/electricity.
4. Client submits `POST /api/vtu/purchase` with an `Idempotency-Key`.
5. Backend validates DTO input and normalizes the amount with `Decimal`.
6. Backend creates a TRUSTPAY transaction with a VTPass-compliant request ID and debits the NGN wallet inside a Prisma transaction.
7. Backend sends the provider request to VTPass with the same request ID.
8. Backend maps the provider response:
   - delivered/successful: mark transaction `SUCCESS`
   - failed/not processed/invalid: reverse wallet once and mark `FAILED`
   - timeout, processing, initiated, pending, or unclear: keep transaction `PENDING` and require requery/webhook finalization
9. Requery or webhook finalization updates the pending transaction to `SUCCESS`, `FAILED`, or `REVERSED` with idempotent ledger behavior.

## Status Mapping

VTPass statuses and response codes are normalized into TRUSTPAY statuses:

- `delivered` or a clearly successful final response maps to `SUCCESS`.
- explicit failed, invalid, not processed, or rejected responses map to `FAILED` with a single wallet reversal.
- `initiated`, `pending`, `processing`, request timeout, and unclear responses map to `PENDING`.
- VTPass reversal updates map to `REVERSED` after a single wallet credit, unless TRUSTPAY already reversed the debit for the same transaction.

The implementation must not trust a top-level provider code alone when VTPass also provides an inner transaction status.

## Security And Financial Controls

- All user-facing VTU routes remain protected by `JwtAuthGuard`.
- All mutation routes require `Idempotency-Key`.
- All input uses DTO validation; validation endpoints should receive DTOs instead of unvalidated query-only inputs for mutating POST routes.
- Wallet debit and reversal use Prisma transactions through `LedgerService`.
- Money values use `Decimal`, never `Float`.
- Customer phone, smart card, and meter values are masked in transaction metadata and logs.
- Provider API keys are never logged.
- Webhook processing stores raw provider event data in `ProviderEvent` or a VTU-specific provider event record before processing.
- Webhook processing is idempotent by provider, event type, and provider/request reference.
- Failed provider calls after a local debit must either reverse exactly once or remain pending for requery when the provider outcome is unknown.

## Web And Mobile UX

The web dashboard VTU page should keep the four tabs and become fully provider-backed. Data and cable package options should come from backend package endpoints. Electricity should capture meter type where required by the provider. Cable and electricity validations should show the customer name/status before purchase when the provider supports it.

The mobile app should add a provider-backed VTU service layer and complete the current flows:

- Airtime: network, phone, amount.
- Data: network, phone, package selection, package-derived amount.
- Cable: provider, smart card number, package selection, validation, purchase.
- Electricity: disco, meter number, meter type, amount, validation, purchase.

Both clients must preserve one idempotency key per visible purchase attempt, disable submit while in flight, and show pending status distinctly from failure.

## Testing

Use TDD for implementation. Backend tests must cover:

- provider config and header mapping without exposing secrets
- provider service/package mapping
- request ID format generation
- status mapping for success, failure, reversal, pending, and timeout
- no auto-reversal on provider timeout or unclear response
- exactly-once reversal on provider failure or reversal webhook
- duplicate purchase request returns the idempotent cached response
- validation errors for unsupported provider/type/amount/package combinations

Frontend/mobile tests should cover:

- idempotency key reuse during a purchase attempt
- package-derived amount for data/cable
- validation and disabled submit behavior
- pending/success/failure display states

## Rollout

Start with VTPass sandbox credentials. Verify one low-value airtime sandbox/live smoke test before enabling data, cable, and electricity broadly. Keep the simulated fallback only for local development when live provider credentials are intentionally absent. Production must fail closed if required VTPass credentials are missing while real VTU is enabled.
