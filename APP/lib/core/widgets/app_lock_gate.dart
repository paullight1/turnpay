import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/api_client.dart';
import '../../services/auth_service.dart';
import '../../services/transaction_security_service.dart';
import '../router/app_router.dart';
import '../theme/app_theme.dart';

class AppLockGate extends ConsumerStatefulWidget {
  final Widget child;
  final TransactionSecurityService securityService;

  AppLockGate({
    super.key,
    required this.child,
    TransactionSecurityService? securityService,
  }) : securityService = securityService ?? TransactionSecurityService();

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate>
    with WidgetsBindingObserver {
  final _apiClient = ApiClient();
  final _authService = AuthService();
  bool _locked = false;
  bool _checkingLock = false;
  bool _verifying = false;
  bool _lockOnResume = false;
  String _pin = '';
  String? _error;
  TransactionSecurityConfig? _config;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLock());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.hidden) {
      _lockOnResume = true;
      return;
    }

    if (state == AppLifecycleState.resumed && _lockOnResume) {
      _lockOnResume = false;
      // Lock synchronously before awaiting any storage/biometric checks so the
      // protected content never flashes unlocked on resume. If it turns out no
      // PIN is configured (or there is no session), _maybeLock releases it.
      if (mounted && !_locked) {
        setState(() {
          _locked = true;
          _pin = '';
          _error = null;
        });
      }
      _maybeLock();
    }
  }

  Future<void> _maybeLock() async {
    if (!mounted || _checkingLock) return;
    setState(() => _checkingLock = true);

    try {
      final refreshToken = await _apiClient.readRefreshToken();
      final config = (refreshToken == null || refreshToken.isEmpty)
          ? null
          : await widget.securityService.getConfig();
      if (!mounted) return;

      final shouldLock = config != null && config.hasPin;
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
    } finally {
      if (mounted) {
        setState(() => _checkingLock = false);
      }
    }
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

  Future<void> _verifyPin() async {
    final config = _config;
    if (config == null || _pin.length != config.pinLength || _verifying) {
      return;
    }

    setState(() => _verifying = true);
    final result = await widget.securityService.verifyPinWithLockout(_pin);
    if (!mounted) return;

    if (result.approved) {
      setState(() {
        _locked = false;
        _verifying = false;
        _pin = '';
        _error = null;
      });
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
  }

  Future<void> _useBiometric() async {
    final config = _config;
    if (config == null || !config.shouldOfferBiometrics || _verifying) {
      return;
    }

    setState(() => _verifying = true);
    // App-unlock only needs proof of presence — it never needs the plaintext
    // PIN, so use a pass/fail biometric prompt rather than revealing the PIN.
    final approved = await widget.securityService.authenticateBiometric(
      reason: 'Unlock TRUSTPAY with ${config.biometricLabel}',
    );
    if (!mounted) return;

    setState(() {
      _locked = !approved;
      _verifying = false;
      _pin = '';
      _error = approved ? null : 'Biometric check was not completed.';
    });
  }

  Future<void> _logout() async {
    await _authService.logout();
    if (!mounted) return;
    setState(() {
      _locked = false;
      _pin = '';
      _error = null;
    });
    ref.read(appRouterProvider).go(AppRoutes.login);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_locked)
          Positioned.fill(
            child: _LockOverlay(
              config: _config,
              pinLength: _config?.pinLength ?? 4,
              pinLengthEntered: _pin.length,
              error: _error,
              verifying: _verifying,
              onDigit: _appendDigit,
              onDelete: _deleteDigit,
              onBiometric: _useBiometric,
              onLogout: _logout,
            ),
          ),
      ],
    );
  }
}

class _LockOverlay extends StatelessWidget {
  final TransactionSecurityConfig? config;
  final int pinLength;
  final int pinLengthEntered;
  final String? error;
  final bool verifying;
  final ValueChanged<String> onDigit;
  final VoidCallback onDelete;
  final VoidCallback onBiometric;
  final VoidCallback onLogout;

  const _LockOverlay({
    required this.config,
    required this.pinLength,
    required this.pinLengthEntered,
    required this.error,
    required this.verifying,
    required this.onDigit,
    required this.onDelete,
    required this.onBiometric,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
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
                'Unlock TRUSTPAY',
                style: AppTextStyles.headingXL,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Enter your transaction PIN to continue.',
                style: AppTextStyles.bodyM,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xl),
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
              ],
              const Spacer(),
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
                    icon:
                        allowBiometric ? biometricIcon : Icons.circle_outlined,
                    enabled: allowBiometric && !verifying,
                    onTap: onBiometric,
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

  const _LockIconButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: enabled ? onTap : null,
      icon: Icon(
        icon,
        color: enabled ? AppColors.textPrimary : AppColors.textHint,
      ),
    );
  }
}
