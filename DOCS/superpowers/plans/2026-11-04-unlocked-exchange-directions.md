# Unlocked Exchange Directions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both Exchange direction cards selectable, remove the blocking chooser warning, and keep recovery/incomplete information in Recent exchanges below the cards.

**Architecture:** The Flutter chooser will separate navigation availability from server settlement readiness. Selecting GHS→NGN uses the existing direct-bank form contract and still relies on the backend to issue a configured collection account or reject safely; no account details are invented client-side. Existing server orders and the device-local unresolved-create journal remain in Recent exchanges.

**Tech Stack:** Flutter, Dart, widget tests, existing Dio manual-exchange API.

**Spec:** `DOCS/implementation/2026-11-04-mobile-ui-refresh.md` — “Exchange chooser and recent history”.

## Global Constraints

- Preserve JWT, KYC, transaction-PIN, idempotency, exact money and audit enforcement.
- Never fabricate a receiving account when the backend has not configured one.
- Preserve all accepted and incomplete exchange recovery routes.
- Keep both cards visible and selectable on the chooser.

## Review Focus

- GHS configuration without advertised availability still opens the direct-bank form without a range error.
- The red blocking notice is absent from the chooser.
- A locally unresolved create remains visible under Recent exchanges and restores only its original fingerprint.
- Server-backed history rows continue to open their detail routes.
- Missing backend collection details fail before any payment instructions are shown.

---

### Task 1: Unlock chooser navigation without bypassing backend validation

**Files:**
- Modify: `APP/lib/features/exchange/screens/manual_exchange_screen.dart`
- Test: `APP/test/manual_exchange_screen_test.dart`
- Modify: `DOCS/implementation/2026-11-04-mobile-ui-refresh.md`
- Modify: `DOCS/SECURITY-RULES.MD`

**Interfaces:**
- Consumes: `ManualExchangeConfig.supportedSourceCurrencies`, `ManualExchangeConfig.deliveryModesFor`, `ManualExchangeService.createOrder`.
- Produces: chooser direction callbacks that always open supported GHS/NGN flows and retain backend-authoritative creation.

- [ ] **Step 1: Write the failing widget test**

Assert that a configuration advertising only NGN availability still renders Cedis to naira as selectable, removes the blocking warning/“Not available yet” copy, and opens the GHS amount form when tapped. Assert that an incomplete saved create remains below both cards in Recent exchanges.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `flutter test test/manual_exchange_screen_test.dart --plain-name 'both exchange directions stay selectable while recovery remains in recent history'`

Expected: failure because Cedis to naira is disabled and the blocking warning is present.

- [ ] **Step 3: Implement the minimal chooser behavior**

Use the existing direct-bank settlement mode as the safe GHS form default when the hosted config does not advertise a mode. Remove only the chooser warning and disabled-card presentation; retain backend creation/configuration validation and do not expose collection instructions before a successful server order response.

- [ ] **Step 4: Verify focused and exchange regression suites**

Run the new test, the manual exchange/history/recovery suites, and scoped Flutter analysis. Expected: all pass with no analyzer issues.

- [ ] **Step 5: Refresh documentation and live preview**

Record that navigation is unlocked while the backend remains authoritative for receiving-account readiness, then hot reload the existing `127.0.0.1:8080` Flutter server.
