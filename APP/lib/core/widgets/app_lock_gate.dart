import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/api_client.dart';
import '../../services/auth_service.dart';
import '../../services/transaction_security_service.dart';
import '../auth/auth_state.dart';
import '../router/app_router.dart';
import '../theme/app_theme.dart';

typedef AppLockClock = DateTime Function();

/// Signals user activity to [AppLockGate]. The gate also observes pointer
/// activity in its child, while this signal lets tests and app-level activity
/// sources use the same inactivity policy without depending on wall-clock
/// delays.
class AppLockActivitySignal extends ChangeNotifier {
  void markActivity() => notifyListeners();
}

class AppLockGate extends ConsumerStatefulWidget {
  final Widget child;
  final TransactionSecurityService securityService;
  final AuthService authService;
  final AppLockClock clock;
  final AppLockActivitySignal activitySignal;
  final Duration inactivityTimeout;

  AppLockGate({
    super.key,
    required this.child,
    TransactionSecurityService? securityService,
    AuthService? authService,
    AppLockClock? clock,
    AppLockActivitySignal? activitySignal,
    this.inactivityTimeout = const Duration(minutes: 15),
  })  : securityService = securityService ?? TransactionSecurityService(),
        authService = authService ?? AuthService(),
        clock = clock ?? DateTime.now,
        activitySignal = activitySignal ?? AppLockActivitySignal();

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate>
    with WidgetsBindingObserver {
  static const _privacyChannel = MethodChannel('trustpay/app_privacy');

  final _apiClient = ApiClient();
  bool _locked = false;
  bool _ready = false;
  bool _checkingLock = false;
  bool _verifying = false;
  bool _lockOnResume = false;
  bool _isForeground = true;
  bool _biometricPromptInProgress = false;
  bool _lockCheckQueued = false;
  bool _usingAccountPassword = false;
  String _pin = '';
  String _accountPassword = '';
  String? _error;
  TransactionSecurityConfig? _config;
  DateTime? _lastActivityAt;
  Timer? _inactivityTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    authStateNotifier.addListener(_handleAuthStateChanged);
    widget.activitySignal.addListener(_handleActivitySignal);
    SemanticsBinding.instance
        .addSemanticsActionListener(_handleSemanticsActivity);
    HardwareKeyboard.instance.addHandler(_handleKeyboardActivity);
    _lastActivityAt = widget.clock();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_maybeLock());
    });
  }

  @override
  void dispose() {
    authStateNotifier.removeListener(_handleAuthStateChanged);
    widget.activitySignal.removeListener(_handleActivitySignal);
    SemanticsBinding.instance
        .removeSemanticsActionListener(_handleSemanticsActivity);
    HardwareKeyboard.instance.removeHandler(_handleKeyboardActivity);
    _inactivityTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _isForeground = false;
      _inactivityTimer?.cancel();
      unawaited(_clearLegacyTransactionMaterialSafely());
      unawaited(_notifyNativePrivacy('show'));

      final promptInProgress = _biometricPromptInProgress;
      _lockOnResume = !promptInProgress;
      if (mounted) {
        setState(() {
          _ready = false;
          if (!promptInProgress) {
            _locked = true;
            _pin = '';
            _accountPassword = '';
            _error = null;
          }
        });
      }
      return;
    }

    if (state == AppLifecycleState.resumed) {
      _isForeground = true;
      if (_biometricPromptInProgress) return;

      final resumedFromBackground = _lockOnResume;
      if (resumedFromBackground) {
        _lockOnResume = false;
        // Lock synchronously before awaiting any storage/biometric checks so
        // protected content never flashes unlocked on resume. If it turns out
        // no PIN is configured (or there is no session), _maybeLock releases
        // it after the readiness check completes.
        if (mounted) {
          setState(() {
            _ready = false;
            _locked = true;
            _pin = '';
            _accountPassword = '';
            _error = null;
          });
        }
        unawaited(_notifyNativePrivacy('show'));
      }

      // The first post-frame check is already in flight when the binding
      // reports its initial resumed state. Avoid queueing a duplicate check;
      // a real background/resume pair still forces one even if another check
      // is currently running.
      if (!_ready && (resumedFromBackground || !_checkingLock)) {
        _requestLockCheck();
      }
    }
  }

  void _handleSemanticsActivity(SemanticsActionEvent event) {
    _handleActivitySignal();
  }

  bool _handleKeyboardActivity(KeyEvent event) {
    _handleActivitySignal();
    return false; // Observe activity without consuming the user's keystroke.
  }

  void _requestLockCheck() {
    if (_checkingLock) {
      _lockCheckQueued = true;
      return;
    }
    unawaited(_maybeLock());
  }

  void _handleAuthStateChanged() {
    if (!mounted || !authStateNotifier.sessionExpired) return;

    _inactivityTimer?.cancel();
    _inactivityTimer = null;
    final foreground = _isForeground;
    setState(() {
      // A server-confirmed session revocation must reach the login route even
      // when the app was sitting behind the lock screen. The router handles
      // the redirect; this gate must not leave a stale PIN prompt above it.
      _locked = false;
      _ready = foreground;
      _verifying = false;
      _config = null;
      _pin = '';
      _error = null;
    });
    if (foreground) {
      unawaited(_notifyNativePrivacy('ready'));
    }
  }

  Future<void> _maybeLock() async {
    if (!mounted) return;
    if (_checkingLock) {
      _lockCheckQueued = true;
      return;
    }
    setState(() => _checkingLock = true);

    try {
      final refreshToken = await _apiClient.readRefreshToken();
      final config = (refreshToken == null || refreshToken.isEmpty)
          ? null
          : await widget.securityService.getConfig();
      if (!mounted) return;

      if (authStateNotifier.sessionExpired) {
        _handleAuthStateChanged();
        return;
      }

      final shouldLock = config != null && config.hasPin;
      var shouldOfferBiometricSetup = false;
      if (shouldLock) {
        shouldOfferBiometricSetup = config.canUseBiometrics &&
            config.hasBiometric &&
            !config.biometricEnabled &&
            !(await widget.securityService.hasSeenBiometricPrompt());
      }
      if (!mounted) return;

      if (authStateNotifier.sessionExpired) {
        _handleAuthStateChanged();
        return;
      }

      setState(() {
        _config = config;
        // Release the pre-emptive lock if this session has no PIN to enter.
        if (shouldLock) {
          _locked = true;
        } else {
          _locked = false;
        }
        if (!_locked) {
          _pin = '';
          _error = null;
        }
      });

      if (shouldOfferBiometricSetup && mounted && _isForeground) {
        await _offerBiometricSetup(config!);
      }

      if (authStateNotifier.sessionExpired) {
        _handleAuthStateChanged();
        return;
      }

      // A resume can queue a fresh read while this one is awaiting secure
      // storage. Do not publish this older result as ready or the protected
      // child could flash before the queued read completes.
      if (mounted && _isForeground && !_lockCheckQueued) {
        _markLockStateReady();
      }
    } catch (_) {
      // A storage or local-auth readiness error must fail closed. Keep the
      // logout action available so the user can leave a session that cannot be
      // safely unlocked, while avoiding a false unlock on an exception.
      if (mounted) {
        if (authStateNotifier.sessionExpired) {
          _handleAuthStateChanged();
          return;
        }
        setState(() {
          _locked = true;
          _ready = _isForeground && !_lockCheckQueued;
          _pin = '';
          _error = 'Unable to verify app security. Log out and try again.';
        });
        if (_isForeground && !_lockCheckQueued) {
          unawaited(_notifyNativePrivacy('ready'));
        }
      }
    } finally {
      if (mounted) {
        setState(() => _checkingLock = false);
      }
      if (_lockCheckQueued && mounted && _isForeground) {
        _lockCheckQueued = false;
        unawaited(_maybeLock());
      }
    }
  }

  void _markLockStateReady() {
    if (!mounted || !_isForeground) return;
    _lastActivityAt ??= widget.clock();
    setState(() => _ready = true);
    unawaited(_notifyNativePrivacy('ready'));
    _scheduleInactivityCheck();
  }

  void _handleActivitySignal() {
    if (!mounted || !_isForeground || !_ready || _locked) return;

    final now = widget.clock();
    final lastActivity = _lastActivityAt;
    if (lastActivity != null && _hasExpired(now, lastActivity)) {
      _lockForInactivity();
      return;
    }

    _lastActivityAt = now;
    _scheduleInactivityCheck();
  }

  bool _hasExpired(DateTime now, DateTime lastActivity) {
    final elapsed = now.difference(lastActivity);
    return !elapsed.isNegative && elapsed >= widget.inactivityTimeout;
  }

  void _scheduleInactivityCheck() {
    _inactivityTimer?.cancel();
    _inactivityTimer = null;

    if (!mounted ||
        !_isForeground ||
        !_ready ||
        _locked ||
        _config?.hasPin != true ||
        _lastActivityAt == null) {
      return;
    }

    final now = widget.clock();
    final elapsed = now.difference(_lastActivityAt!);
    if (!elapsed.isNegative && elapsed >= widget.inactivityTimeout) {
      _lockForInactivity();
      return;
    }

    final remaining = elapsed.isNegative
        ? widget.inactivityTimeout
        : widget.inactivityTimeout - elapsed;
    _inactivityTimer = Timer(remaining, _handleInactivityTimer);
  }

  void _handleInactivityTimer() {
    _inactivityTimer = null;
    if (!mounted || !_isForeground || !_ready || _locked) return;

    final lastActivity = _lastActivityAt;
    if (lastActivity == null) return;
    final now = widget.clock();
    if (_hasExpired(now, lastActivity)) {
      _lockForInactivity();
    } else {
      _scheduleInactivityCheck();
    }
  }

  void _lockForInactivity() {
    if (!mounted || _locked || !_ready || _config?.hasPin != true) return;
    _inactivityTimer?.cancel();
    _inactivityTimer = null;
    setState(() {
      _locked = true;
      _pin = '';
      _accountPassword = '';
      _error = null;
    });
  }

  void _markSuccessfulActivity() {
    _lastActivityAt = widget.clock();
    _scheduleInactivityCheck();
  }

  void _appendDigit(String digit) {
    final config = _config;
    if (config == null || _verifying || _pin.length >= config.pinLength) {
      return;
    }

    HapticFeedback.selectionClick();
    setState(() {
      _pin += digit;
      _error = null;
    });

    if (_pin.length == config.pinLength) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _verifyPin());
    }
  }

  void _deleteDigit() {
    if (_pin.isEmpty || _verifying) return;
    HapticFeedback.selectionClick();
    setState(() {
      _pin = _pin.substring(0, _pin.length - 1);
      _error = null;
    });
  }

  void _toggleAccountPassword() {
    if (_verifying) return;
    setState(() {
      _usingAccountPassword = !_usingAccountPassword;
      _pin = '';
      _accountPassword = '';
      _error = null;
    });
  }

  void _setAccountPassword(String value) {
    if (_verifying) return;
    setState(() {
      _accountPassword = value;
      _error = null;
    });
  }

  Future<void> _verifyAccountPassword() async {
    if (_verifying || _accountPassword.isEmpty) return;

    final email = await _apiClient.readAccountEmail();
    if (!mounted) return;
    if (email == null || email.isEmpty) {
      setState(() {
        _error =
            'Your session needs a full sign-in. Log out and sign in again.';
      });
      return;
    }

    setState(() => _verifying = true);
    try {
      final approved = await widget.authService.login(
        email: email,
        password: _accountPassword,
      );
      if (!mounted) return;
      if (approved && _isForeground && !authStateNotifier.sessionExpired) {
        setState(() {
          _locked = false;
          _verifying = false;
          _accountPassword = '';
          _error = null;
        });
        _markSuccessfulActivity();
        return;
      }
      setState(() {
        _verifying = false;
        _accountPassword = '';
        _error = 'Incorrect password. Try again.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _accountPassword = '';
        _error = authErrorMessage(error, 'Incorrect password. Try again.');
      });
    }
  }

  Future<void> _verifyPin() async {
    final config = _config;
    if (config == null || _pin.length != config.pinLength || _verifying) {
      return;
    }

    setState(() => _verifying = true);
    try {
      final result = await widget.securityService.verifyPinWithLockout(_pin);
      if (!mounted) return;
      if (authStateNotifier.sessionExpired) {
        _handleAuthStateChanged();
        return;
      }

      if (result.approved) {
        setState(() {
          _locked = false;
          _verifying = false;
          _pin = '';
          _error = null;
        });
        _markSuccessfulActivity();
        return;
      }

      final lockoutMessage = result.lockedUntil == null
          ? null
          : 'Too many incorrect attempts. Try again after ${TimeOfDay.fromDateTime(result.lockedUntil!.toLocal()).format(context)}.';
      setState(() {
        _pin = '';
        _verifying = false;
        _error = lockoutMessage ?? 'Incorrect PIN. Try again.';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locked = true;
        _pin = '';
        _verifying = false;
        _error = 'Unable to verify your PIN. Try again or log out.';
      });
    }
  }

  Future<void> _useBiometric() async {
    final config = _config;
    if (config == null || !config.shouldOfferBiometrics || _verifying) {
      return;
    }

    setState(() => _verifying = true);
    // App-unlock only needs proof of presence — it never needs the plaintext
    // PIN, so use a pass/fail biometric prompt rather than revealing the PIN.
    var approved = false;
    try {
      approved = await _authenticateBiometric(
        reason: 'Unlock TrustPay with ${config.biometricLabel}',
      );
    } catch (_) {
      approved = false;
    }
    if (!mounted) return;
    if (authStateNotifier.sessionExpired) {
      _handleAuthStateChanged();
      return;
    }

    if (!_isForeground) {
      // A biometric dialog can outlive the scene transition that opened it.
      // Keep the protected content covered and require the normal resume
      // check before exposing either the lock or the child.
      _lockOnResume = true;
      setState(() {
        _locked = true;
        _ready = false;
        _verifying = false;
        _pin = '';
        _error = approved ? null : 'Biometric check was not completed.';
      });
      return;
    }

    setState(() {
      _locked = !approved;
      _verifying = false;
      _pin = '';
      _error = approved ? null : 'Biometric check was not completed.';
    });
    if (approved) {
      _markSuccessfulActivity();
    }
    _markLockStateReady();
  }

  Future<void> _offerBiometricSetup(TransactionSecurityConfig config) async {
    var dontRemindAgain = false;
    final shouldEnable = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) {
            return AlertDialog(
              backgroundColor: AppColors.surface,
              title: Text(
                'Unlock faster with ${config.biometricLabel}',
                style: AppTextStyles.headingM,
              ),
              content: StatefulBuilder(builder: (context, update) {
                return Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(
                    'Use your device’s ${config.biometricLabel} to unlock TrustPay. You can always use your PIN or change this in Device Security.',
                    style: AppTextStyles.bodyM,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('Don’t remind me again'),
                    value: dontRemindAgain,
                    onChanged: (value) =>
                        update(() => dontRemindAgain = value ?? false),
                  ),
                ]);
              }),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(
                    'Not now',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                  ),
                  child: Text('Enable ${config.biometricLabel}'),
                ),
              ],
            );
          },
        ) ??
        false;

    if (!mounted) return;
    if (authStateNotifier.sessionExpired) {
      _handleAuthStateChanged();
      return;
    }
    if (dontRemindAgain) {
      await widget.securityService.markBiometricPromptSeen();
    }
    if (!shouldEnable) return;

    final approved = await _authenticateBiometric(
      reason: 'Enable ${config.biometricLabel} for TrustPay',
    );
    if (!mounted) return;
    if (authStateNotifier.sessionExpired) {
      _handleAuthStateChanged();
      return;
    }

    if (!approved) {
      setState(() => _error =
          '${config.biometricLabel} setup was not completed. You can continue with your PIN.');
      return;
    }

    await widget.securityService.setBiometricEnabled(true);
    final refreshedConfig = await widget.securityService.getConfig();
    if (!mounted) return;

    if (!_isForeground) {
      _lockOnResume = true;
      setState(() {
        _config = refreshedConfig;
        _locked = true;
        _ready = false;
        _verifying = false;
        _pin = '';
        _error = null;
      });
      return;
    }

    setState(() {
      _config = refreshedConfig;
      _locked = false;
      _verifying = false;
      _pin = '';
      _error = null;
    });
    _markSuccessfulActivity();
  }

  Future<void> _logout() async {
    if (_verifying) return;
    setState(() => _verifying = true);
    try {
      await widget.authService.logout();
    } catch (_) {
      if (!mounted) return;
      // Keep the gate locked and the action enabled. A secure-storage failure
      // must not turn a failed cleanup into an apparent sign-out.
      setState(() {
        _verifying = false;
        _locked = true;
        _error = 'Could not log out securely. Try again.';
      });
      return;
    }

    if (!mounted) return;
    _inactivityTimer?.cancel();
    setState(() {
      _locked = false;
      _ready = true;
      _verifying = false;
      _config = null;
      _pin = '';
      _error = null;
    });
    unawaited(_notifyNativePrivacy('ready'));
    ref.read(appRouterProvider).go(AppRoutes.login);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _handleActivitySignal(),
      onPointerMove: (_) => _handleActivitySignal(),
      child: Stack(
        children: [
          ExcludeSemantics(
            excluding: !_ready || _locked,
            child: ExcludeFocus(
              excluding: !_ready || _locked,
              child: IgnorePointer(
                ignoring: !_ready || _locked,
                child: widget.child,
              ),
            ),
          ),
          if (!_ready)
            const Positioned.fill(child: _AppLockReadinessCover())
          else if (_locked)
            Positioned.fill(
              child: _LockOverlay(
                config: _config,
                pinLength: _config?.pinLength ?? 4,
                pinLengthEntered: _pin.length,
                usingAccountPassword: _usingAccountPassword,
                accountPassword: _accountPassword,
                error: _error,
                verifying: _verifying,
                onDigit: _appendDigit,
                onDelete: _deleteDigit,
                onPasswordChanged: _setAccountPassword,
                onPasswordSubmit: _verifyAccountPassword,
                onTogglePassword: _toggleAccountPassword,
                onBiometric: _useBiometric,
                onLogout: _logout,
              ),
            ),
        ],
      ),
    );
  }

  Future<bool> _authenticateBiometric({required String reason}) async {
    _biometricPromptInProgress = true;
    try {
      return await widget.securityService.authenticateBiometric(
        reason: reason,
      );
    } finally {
      _biometricPromptInProgress = false;
    }
  }

  Future<void> _clearLegacyTransactionMaterialSafely() async {
    try {
      await widget.securityService.clearLegacyTransactionApprovalMaterial();
    } catch (_) {
      // Legacy raw-PIN cleanup is best effort; this lifecycle callback must
      // not crash the app or block the app lock boundary.
    }
  }

  Future<void> _notifyNativePrivacy(String method) async {
    if (kIsWeb) return;
    try {
      await _privacyChannel.invokeMethod<void>(method);
    } on MissingPluginException {
      // Android uses FLAG_SECURE and does not register the iOS privacy channel.
    } on PlatformException {
      // A native cover failure must never be treated as an auth success.
    }
  }
}

class _AppLockReadinessCover extends StatelessWidget {
  const _AppLockReadinessCover();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      key: const ValueKey('app-lock-readiness-cover'),
      color: AppColors.background,
      child: Center(
        child: Icon(
          Icons.lock_outline_rounded,
          size: 54,
          color: AppColors.primary,
        ),
      ),
    );
  }
}

class _LockOverlay extends StatelessWidget {
  final TransactionSecurityConfig? config;
  final int pinLength;
  final int pinLengthEntered;
  final bool usingAccountPassword;
  final String accountPassword;
  final String? error;
  final bool verifying;
  final ValueChanged<String> onDigit;
  final VoidCallback onDelete;
  final ValueChanged<String> onPasswordChanged;
  final VoidCallback onPasswordSubmit;
  final VoidCallback onTogglePassword;
  final VoidCallback onBiometric;
  final VoidCallback onLogout;

  const _LockOverlay({
    required this.config,
    required this.pinLength,
    required this.pinLengthEntered,
    required this.usingAccountPassword,
    required this.accountPassword,
    required this.error,
    required this.verifying,
    required this.onDigit,
    required this.onDelete,
    required this.onPasswordChanged,
    required this.onPasswordSubmit,
    required this.onTogglePassword,
    required this.onBiometric,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final biometricIcon = config?.biometricLabel == 'Face ID'
        ? Icons.face_retouching_natural_rounded
        : Icons.fingerprint_rounded;
    final allowBiometric = config?.shouldOfferBiometrics ?? false;

    return Material(
      color: AppColors.background,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.xl,
          ),
          child: Column(
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: verifying ? null : onLogout,
                  child: Text(
                    'Log out',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ),
              const Spacer(),
              Icon(
                Icons.lock_outline_rounded,
                color: AppColors.primary,
                size: 54,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Unlock TrustPay',
                style: AppTextStyles.headingXL,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                config == null
                    ? 'App security could not be verified. Log out and try again.'
                    : allowBiometric
                        ? 'Use ${config!.biometricLabel} or enter your transaction PIN.'
                        : 'Enter your transaction PIN to continue.',
                style: AppTextStyles.bodyM,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xl),
              if (usingAccountPassword)
                TextField(
                  key: const ValueKey('app-lock-account-password'),
                  autofocus: true,
                  obscureText: true,
                  enabled: !verifying,
                  textInputAction: TextInputAction.done,
                  onChanged: onPasswordChanged,
                  onSubmitted: (_) => onPasswordSubmit(),
                  decoration: const InputDecoration(
                    labelText: 'Account password',
                    hintText: 'Enter your account password',
                  ),
                )
              else
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(
                    pinLength,
                    (index) => Container(
                      width: 16,
                      height: 16,
                      margin: const EdgeInsets.symmetric(horizontal: 6),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: index < pinLengthEntered
                            ? AppColors.primary
                            : AppColors.border,
                      ),
                    ),
                  ),
                ),
              if (error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  error!,
                  style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
                  textAlign: TextAlign.center,
                ),
              ],
              if (verifying) ...[
                const SizedBox(height: AppSpacing.md),
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  usingAccountPassword
                      ? 'Signing in securely…'
                      : 'Checking your PIN securely…',
                  style: AppTextStyles.caption,
                  textAlign: TextAlign.center,
                ),
              ],
              if (usingAccountPassword) ...[
                const SizedBox(height: AppSpacing.lg),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: verifying || accountPassword.isEmpty
                        ? null
                        : onPasswordSubmit,
                    child: const Text('Unlock'),
                  ),
                ),
              ],
              const Spacer(),
              if (!usingAccountPassword)
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  childAspectRatio: 1.5,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    for (final digit in const [
                      '1',
                      '2',
                      '3',
                      '4',
                      '5',
                      '6',
                      '7',
                      '8',
                      '9'
                    ])
                      _LockKeyButton(
                        label: digit,
                        enabled: !verifying,
                        onTap: () => onDigit(digit),
                      ),
                    _LockIconButton(
                      icon: allowBiometric
                          ? biometricIcon
                          : Icons.circle_outlined,
                      enabled: allowBiometric && !verifying,
                      onTap: onBiometric,
                      tooltip: allowBiometric
                          ? 'Unlock with ${config!.biometricLabel}'
                          : null,
                    ),
                    _LockKeyButton(
                      label: '0',
                      enabled: !verifying,
                      onTap: () => onDigit('0'),
                    ),
                    _LockIconButton(
                      icon: Icons.backspace_outlined,
                      enabled: !verifying && pinLengthEntered > 0,
                      onTap: onDelete,
                    ),
                  ],
                ),
              TextButton(
                onPressed: verifying ? null : onTogglePassword,
                child: Text(
                  usingAccountPassword
                      ? 'Use transaction PIN'
                      : 'Use account password',
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LockKeyButton extends StatelessWidget {
  final String label;
  final bool enabled;
  final VoidCallback onTap;

  const _LockKeyButton({
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return TextButton(
      onPressed: enabled ? onTap : null,
      child: Text(
        label,
        style: AppTextStyles.headingL.copyWith(
          color: enabled ? AppColors.textPrimary : AppColors.textHint,
        ),
      ),
    );
  }
}

class _LockIconButton extends StatelessWidget {
  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;
  final String? tooltip;

  const _LockIconButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return IconButton(
      onPressed: enabled ? onTap : null,
      tooltip: tooltip,
      icon: Icon(
        icon,
        color: enabled ? AppColors.textPrimary : AppColors.textHint,
      ),
    );
  }
}
