import 'package:flutter/foundation.dart';

/// Result of attempting to restore a session on launch / refresh.
///
/// - [active]  : the server accepted the refresh; the user stays signed in.
/// - [expired] : the server explicitly rejected the refresh (401/403) or there
///               is no token to restore — the user must sign in again.
/// - [offline] : a network/transport error prevented refresh. Tokens are kept
///               and the app should retry later rather than logging out.
enum SessionRestoreState { active, expired, offline }

/// Broadcasts authentication lifecycle signals to widgets that cannot easily
/// reach the auth services — most importantly the router, which listens to
/// this to redirect an expired session to the login screen.
class AuthStateNotifier extends ChangeNotifier {
  bool _sessionExpired = false;

  /// True when the server has explicitly rejected the stored session and the
  /// user must re-authenticate.
  bool get sessionExpired => _sessionExpired;

  /// Flags the session as expired (server-rejected refresh). Safe to call
  /// repeatedly; only notifies listeners on a state change.
  void markExpired() {
    if (_sessionExpired) return;
    _sessionExpired = true;
    notifyListeners();
  }

  /// Clears the expired flag, e.g. after a successful login or logout.
  void reset() {
    if (!_sessionExpired) return;
    _sessionExpired = false;
    notifyListeners();
  }
}

/// Process-wide auth signal. A single instance keeps the router, API client
/// and auth service in sync without threading a provider through every call.
final authStateNotifier = AuthStateNotifier();
