import 'package:flutter/foundation.dart';

/// Broadcasts a "wallet balances changed" signal after a money action
/// (send, withdraw, VTU purchase, authorized withdrawal) completes
/// successfully so balance-driven screens can re-fetch their data.
class WalletRefreshSignal extends ChangeNotifier {
  int _tick = 0;

  /// Monotonic counter; increments once per successful money action.
  int get tick => _tick;

  /// Notifies listeners that wallet balances may have changed.
  void bump() {
    _tick++;
    notifyListeners();
  }
}

/// Process-wide wallet refresh signal. A single instance keeps the dashboard
/// in sync with money actions without threading state through every screen
/// (mirrors [authStateNotifier] in core/auth/auth_state.dart).
final walletRefreshSignal = WalletRefreshSignal();
