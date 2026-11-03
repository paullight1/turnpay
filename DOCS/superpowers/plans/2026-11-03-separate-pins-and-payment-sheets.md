# Separate PINs and Payment Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Separate transaction authorization from device unlock and make payment review/PIN interaction fast and clear.

**Architecture:** Keep the existing server credential and financial endpoint checks. Stop payment screens from verifying twice or saving a local transaction-PIN hash. Treat the existing device hash as an app-unlock credential, add independent device PIN management and OS-credential support, and move hashing off the UI thread while preserving digest compatibility. Use reusable review bottom-sheet UI.

**Tech Stack:** Existing Flutter, Dio, secure storage, local_auth, crypto; conditional Dart JS interop for native browser cryptography. No server schema changes.

**Spec:** `DOCS/superpowers/specs/2026-11-03-separate-pins-and-payment-sheets-design.md` (owner approved).

## Global Constraints

- Preserve existing app-lock credentials and server transaction credentials; do not persist raw transaction PINs.
- Preserve 120,000-round local PBKDF2-SHA256 compatibility and all server PIN verification/lockouts/reset holds.
- Phone security is app unlock only; browser availability must be reported accurately.
- No real purchase, genuine PIN change, or security-control bypass during agent testing.
- Preserve unrelated checkout changes.

## Review Focus

- A server PIN reset must not change the app PIN or hide its one-hour payment hold.
- Incorrect PIN responses from actual payment endpoints must remain actionable and never become cached payment success.
- Only-device-auth accounts must lock even without a custom app PIN; cancelled OS prompts remain locked.
- Backgrounding while a PIN request is pending must not pop an unrelated route or erase another user's security state.
- Large text, short screens, and review dismissal must retain reachable controls and make no money request.

### Task 1: Separate and accelerate transaction PIN handling

**Files:** Modify `APP/lib/features/security/screens/transaction_security_screen.dart`, `APP/lib/features/home/screens/money_action_screen.dart`, `APP/lib/features/exchange/screens/manual_exchange_screen.dart`, `APP/lib/features/ghana/ghana_widgets.dart`; test `APP/test/transaction_security_semantics_test.dart`, `APP/test/vtu_purchase_ux_test.dart`, and focused new PIN-boundary tests.

**Interfaces:** Add `TransactionPinScreen.collect(...)` for fresh PIN collection without standalone server verification or local storage. Existing verify/create/reset remain server operations and must not mutate device PIN state. Transaction status, including reset hold, remains sourced from `AuthService.getTransactionPinStatus()`.

- [x] Write a regression that payment PIN collection returns the entered value without invoking verify/save, and transaction creation/reset leaves an existing app PIN unchanged; run and observe failures.
- [x] Add collection mode, remove local writes from server-PIN modes, eliminate device-config checks from money approval, and prefetch per-screen status where safe. Keep errors/cancellation mounted-safe.
- [x] Run focused PIN/payment tests and inspect rejected PIN handling against the unchanged backend guards.

### Task 2: Independent app unlock and responsive cryptography

**Files:** Modify `APP/lib/services/transaction_security_service.dart`, `APP/lib/core/widgets/app_lock_gate.dart`, and security screen; create focused app-PIN screen and conditional KDF helper files under `APP/lib/features/security` / `APP/lib/services`; test existing service/gate tests and new independent app-PIN cases.

**Interfaces:** Device service gains capability for OS authentication without enrolled biometrics; existing local hash remains exclusively the app-unlock credential. New app-PIN create/change screen calls only device service, verifying the old app PIN before replacement. `deriveAppPinHash(pin, salt)` returns the existing Base64 PBKDF2 digest asynchronously (native isolate / browser Web Crypto with safe compatible fallback).

- [x] Write regressions for independent PIN changes, device-auth-only locking, OS cancellation, legacy hash compatibility, and failure lockouts; observe failures.
- [x] Implement independent create/change flow, plain app-unlock copy, supported OS screen-lock fallback, and asynchronous KDF. Preserve account binding and recovery.
- [x] Run gate/service/crypto tests and analysis; validate browser capability reporting and event-loop responsiveness.

### Task 3: Security settings and large payment review sheets

**Files:** Modify security screen and money-action review; create reusable sheet widget under `APP/lib/features/home/widgets`; test security semantics, VTU purchase UX, new review layout checks.

**Interfaces:** Review sheet accepts title, amount/currency, detail rows, and edit/continue callbacks. Minimum primary action height 56 px, large secondary action, scrolling/safe-area behavior. Security settings present separate Transaction PIN and App unlock sections with hold status and platform-specific device unlock.

- [x] Write layout/cancel/edit regressions for 360/430 px widths, short screens and 2x text; observe failures.
- [x] Replace cramped AlertDialog reviews with bottom sheets; remove implementation jargon and shared-PIN device-verification copy.
- [x] Run full Flutter tests and analysis, inspect Chrome security/review states without submitting real transactions, perform an independent scoped review, document evidence and security checks, and push reviewed changes to main under existing authorization.
