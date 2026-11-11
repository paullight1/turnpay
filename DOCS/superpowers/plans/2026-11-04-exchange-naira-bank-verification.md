# Exchange Naira Bank Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual Nigerian payout details in Cedis-to-naira exchange with bank selection and provider-verified account names.

**Architecture:** `ManualExchangeService` owns typed reads of the existing bank-list and account-resolution endpoints. `_ExternalDestinationForm` owns debounced UI state, stale-response rejection, and the verified-input gate while preserving the existing immutable recovery path.

**Tech Stack:** Flutter, Dart, Dio, existing TRUSTPAY APIs and design tokens.

**Spec:** `docs/superpowers/specs/2026-11-04-exchange-naira-bank-verification-design.md`

## Global Constraints

- New Nigerian payout destinations have no manual recipient-name fallback.
- The verified name is server-derived and read-only.
- A changed bank or account number invalidates verification immediately.
- Saved pending attempts keep their recorded destination and do not perform a new lookup.
- No backend endpoint, DTO, or database change is in scope.

## Review Focus

- An old resolution response arriving after an edit must not verify the new input; cover in the screen test.
- Empty or mismatched resolver payloads must remain unverified; cover in the service and screen tests.
- Bank-list failure must present a retry state and prevent submission; cover in the screen test.
- A valid ten-digit account without a selected bank must not call the resolver; cover in the screen test.
- A saved immutable recovery attempt must remain submittable without a new resolver call; retain the existing recovery regression test.

---

### Task 1: Typed Nigerian Bank Lookup Boundary

**Files:**
- Modify: `APP/lib/features/exchange/services/manual_exchange_service.dart`
- Test: `APP/test/manual_exchange_service_test.dart`

**Interfaces:**
- Produces: `ManualNigerianBankOption`, `ManualNigerianBankResolution`, `ManualExchangeService.fetchNigerianBanks()`, and `ManualExchangeService.resolveNigerianBankAccount({required String accountNumber, required String bankCode})`.
- Consumes: authenticated `GET /api/payments/banks` and `POST /api/payments/banks/resolve` responses.

- [ ] **Step 1: Write failing service tests**

Add tests proving the bank list is parsed/sorted, a valid bound resolution returns its name, and empty or mismatched account/bank payloads throw `FormatException`.

- [ ] **Step 2: Run the service tests and verify RED**

Run: `cd APP && flutter test test/manual_exchange_service_test.dart`

Expected: FAIL because the typed Nigerian bank interfaces do not exist.

- [ ] **Step 3: Implement the typed service boundary**

Add the two immutable value types and the two service methods. Validate a ten-digit account number, a non-empty bank code/name, and response binding before returning data.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `cd APP && flutter test test/manual_exchange_service_test.dart`

Expected: PASS.

### Task 2: Verified Nigerian Recipient Form

**Files:**
- Modify: `APP/lib/features/exchange/screens/manual_exchange_screen.dart`
- Test: `APP/test/manual_exchange_screen_test.dart`

**Interfaces:**
- Consumes: Task 1 bank option, resolution, and service methods.
- Produces: searchable Nigerian bank selection, debounced lookup, read-only verified recipient state, retry state, and a form-validation gate.

- [ ] **Step 1: Write failing widget tests**

Add tests that select a bank, enter `0123456789`, observe `Ada Lovelace` and a verified state, then proceed; edit the account during an in-flight lookup and prove the stale name never appears; prove no bank means no lookup; prove lookup failure exposes retry and keeps the CTA gated.

- [ ] **Step 2: Run the widget tests and verify RED**

Run: `cd APP && flutter test test/manual_exchange_screen_test.dart`

Expected: FAIL because the current form still accepts free-text bank and recipient name.

- [ ] **Step 3: Implement the Nigerian bank selector and resolver state**

Within `_ExternalDestinationFormState`, load banks only for NGN bank settlement, display them in a searchable bottom sheet, debounce account resolution by 450 ms, bind responses to `bankCode|accountNumber`, clear verification on every edit, and make the recipient field read-only. Preserve `allowExistingBankValue` for saved immutable retries.

- [ ] **Step 4: Run the widget tests and verify GREEN**

Run: `cd APP && flutter test test/manual_exchange_screen_test.dart`

Expected: PASS.

- [ ] **Step 5: Run focused regression and analysis**

Run: `cd APP && flutter test test/manual_exchange_service_test.dart test/manual_exchange_screen_test.dart test/manual_exchange_history_test.dart test/manual_exchange_v1_layout_test.dart test/manual_exchange_v1_ux_test.dart && flutter analyze lib/features/exchange/services/manual_exchange_service.dart lib/features/exchange/screens/manual_exchange_screen.dart`

Expected: all focused tests pass and analysis reports no issues.

- [ ] **Step 6: Run the complete Flutter suite**

Run: `cd APP && flutter test`

Expected: report the existing unrelated `money_action_validation_test.dart` copy mismatch separately if it remains; no new exchange failure.
