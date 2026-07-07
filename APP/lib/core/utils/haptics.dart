import 'package:flutter/services.dart';

/// Centralized, semantic haptic feedback for TrustPay.
///
/// Prefer these named intents over calling [HapticFeedback] directly so that
/// feedback stays consistent across the app and can be tuned in one place.
///
/// Guidelines:
///  - [selection]  → lightweight taps: nav items, chips, list rows, toggles.
///  - [light]      → confirming a minor action (copy, expand, small toggles).
///  - [medium]     → primary button presses, opening sheets/dialogs.
///  - [heavy]      → committing to an irreversible/important action.
///  - [success]    → a flow completed successfully (payment sent, receipt saved).
///  - [warning]    → a soft failure or something needing attention.
///  - [error]      → a hard failure (validation error, request failed).
class Haptics {
  const Haptics._();

  static void selection() {
    HapticFeedback.selectionClick();
  }

  static void light() {
    HapticFeedback.lightImpact();
  }

  static void medium() {
    HapticFeedback.mediumImpact();
  }

  static void heavy() {
    HapticFeedback.heavyImpact();
  }

  /// A short double-tap pattern that reads as "done / confirmed".
  static void success() {
    HapticFeedback.mediumImpact();
    Future<void>.delayed(const Duration(milliseconds: 90), () {
      HapticFeedback.lightImpact();
    });
  }

  /// A single firm tap that reads as "heads up".
  static void warning() {
    HapticFeedback.mediumImpact();
  }

  /// A heavier double tap that reads as "something went wrong".
  static void error() {
    HapticFeedback.heavyImpact();
    Future<void>.delayed(const Duration(milliseconds: 110), () {
      HapticFeedback.mediumImpact();
    });
  }
}
