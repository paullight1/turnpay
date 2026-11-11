# V1 Money-Out Gate and Immersive Exchange Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide and block customer Send Money and Withdraw actions for V1 without deleting their implementation, present Add funds as the single wallet CTA, and keep the full Exchange journey outside the bottom-tab shell with guarded cancellation.

**Architecture:** Add a compile-time launch-capability facade under `core/config` and consume it at every active money-out entry point plus the router boundary. Keep receipt/history routes readable. Change the Exchange tab action from an embedded tab selection to a pushed top-level route, then let the manual flow own a local draft-discard guard for header and system back.

**Tech Stack:** Flutter, Dart, Riverpod, go_router, flutter_test.

**Spec:** `DOCS/superpowers/specs/2026-11-06-v1-hide-money-out-design.md`

**Global Constraints:** Preserve all existing Send Money and Withdraw implementation code. Do not change backend APIs, financial mutations, idempotency, persisted history, or receipt access. Preserve unrelated dirty-worktree changes. Use `apply_patch` for edits. Do not commit from this shared dirty checkout.

---

## Task 1: Centralize and enforce the V1 money-out capability

**Files:**
- Create: `APP/lib/core/config/launch_capabilities.dart`
- Modify: `APP/lib/core/router/app_router.dart`
- Modify: `APP/lib/features/home/screens/home_task_screen.dart`
- Modify: `APP/lib/features/home/widgets/quick_actions_row.dart`
- Modify: `APP/lib/features/auth/screens/onboarding_screen.dart`
- Test: `APP/test/feature_hub_visual_test.dart`
- Test: `APP/test/widget_prototypes_test.dart`
- Test: `APP/test/onboarding_screen_test.dart` (create if no suitable test exists)
- Test: `APP/test/v1_money_out_routes_test.dart` (create)

**Interface:** `LaunchCapabilities.moneyOutEnabled` is the single V1 switch. Active action routes consume the same gate and redirect to `AppRoutes.home`; receipt/success/detail routes do not.

1. Add or update widget/router tests that prove Send Money and Withdraw entry points are absent, the onboarding transfer slide is skipped, and direct action routes fail closed while receipt routes remain registered.
2. Run the focused tests and confirm RED because the capability and hiding behavior do not exist.
3. Add the capability facade with money-out disabled for V1, filter the active UI surfaces, and add route redirects for `send`, `sendTrustpay`, `sendBank`, `withdraw`, and `withdrawAuthorize` only.
4. Run the focused tests and confirm GREEN.

## Task 2: Replace wallet money-out controls with one Add funds CTA

**Files:**
- Modify: `APP/lib/features/home/screens/home_screen.dart`
- Modify: `APP/lib/features/wallet/screens/wallet_detail_screen.dart`
- Test: `APP/test/home_screen_test.dart`
- Test: `APP/test/wallet_detail_screen_test.dart`

**Interface:** Both wallet surfaces consume `LaunchCapabilities.moneyOutEnabled`. With V1 disabled they render one full-width `Add funds` control that opens the existing receiving/funding flow; beneficiary shortcuts are not built.

1. Change the widget tests first to prove Send Money/Withdraw are absent, `Add funds` is present, has at least a 48px target, spans the available action row, and opens the existing funding route.
2. Run the tests and confirm RED against the two-action layouts.
3. Add capability-aware layouts that preserve the old two-action implementation behind the switch, hide quick-transfer beneficiaries, and rebalance card height/spacing for the single CTA.
4. Run the focused tests and confirm GREEN at normal and large text scale.

## Task 3: Make Exchange immersive and guard draft cancellation

**Files:**
- Modify: `APP/lib/core/widgets/main_shell.dart`
- Modify: `APP/lib/features/exchange/screens/manual_exchange_screen.dart`
- Modify only if the focused layout test demonstrates a gap: `APP/lib/features/exchange/screens/kora_exchange_screen.dart`
- Test: `APP/test/main_shell_test.dart`
- Test: `APP/test/manual_exchange_screen_test.dart`
- Test: `APP/test/manual_exchange_v1_layout_test.dart`

**Interface:** Tapping Exchange calls `context.push(AppRoutes.exchange)` instead of selecting an embedded tab. `ManualExchangeScreen` treats `_step > 0` as a started draft, intercepts header/system back, and exposes `Keep exchange` and `Cancel exchange`; cancellation clears only local draft fields and returns to the chooser.

1. Update tests first to prove the bottom navigation disappears after opening Exchange, an untouched chooser may close normally, and a started draft blocks both header and system back behind the warning.
2. Add tests that `Keep exchange` retains the amount/current step and `Cancel exchange` clears local fields and returns to `Start a new exchange` without deleting history.
3. Run the focused tests and confirm RED for the missing immersive route and warning.
4. Push Exchange above `MainShell`, add `PopScope` plus the shared discard dialog, and keep full-width primary CTAs at least 48px tall with safe bottom spacing.
5. Run the focused tests and confirm GREEN, including 320px width / 1.5x text-scale layout coverage.

## Final Verification

Run:

```bash
cd APP
flutter analyze
flutter test test/feature_hub_visual_test.dart test/widget_prototypes_test.dart test/onboarding_screen_test.dart test/v1_money_out_routes_test.dart test/home_screen_test.dart test/wallet_detail_screen_test.dart test/main_shell_test.dart test/manual_exchange_screen_test.dart test/manual_exchange_v1_layout_test.dart
flutter test
```

Expected: focused tests pass; analyzer has no new findings. Report any pre-existing full-suite failure verbatim rather than concealing it. Restart the existing Flutter web-server session and verify `http://127.0.0.1:8080/#/home` loads through the hosted API proxy.

## Review Focus

- No remaining customer-visible path starts Send Money or Withdraw while V1 is disabled.
- Receipt/history access remains available.
- No local cancellation path mutates or deletes server exchange history.
- Exchange cannot show the bottom navigation once its route is open.
- Header and system back use the same draft-discard contract.
- CTA sizing remains usable under narrow width and large text.
