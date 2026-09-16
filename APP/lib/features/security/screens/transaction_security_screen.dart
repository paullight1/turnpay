import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../services/auth_service.dart';
import '../../../services/transaction_security_service.dart';

class _TransactionSecuritySnapshot {
  final TransactionSecurityConfig device;
  final TransactionPinServerStatus server;

  const _TransactionSecuritySnapshot({
    required this.device,
    required this.server,
  });
}

class TransactionSecurityScreen extends StatefulWidget {
  final TransactionSecurityService? securityService;
  final AuthService? authService;

  const TransactionSecurityScreen({
    super.key,
    this.securityService,
    this.authService,
  });

  @override
  State<TransactionSecurityScreen> createState() =>
      _TransactionSecurityScreenState();
}

class _TransactionSecurityScreenState extends State<TransactionSecurityScreen> {
  late final TransactionSecurityService _securityService;
  late final AuthService _authService;
  late Future<_TransactionSecuritySnapshot> _future;

  @override
  void initState() {
    super.initState();
    _securityService = widget.securityService ?? TransactionSecurityService();
    _authService = widget.authService ?? AuthService();
    _future = _loadSecurityState();
  }

  Future<_TransactionSecuritySnapshot> _loadSecurityState() async {
    final values = await Future.wait<dynamic>([
      _securityService.getConfig(),
      _authService.getTransactionPinStatus(),
    ]);
    return _TransactionSecuritySnapshot(
      device: values[0] as TransactionSecurityConfig,
      server: values[1] as TransactionPinServerStatus,
    );
  }

  void _reload() {
    setState(() {
      _future = _loadSecurityState();
    });
  }

  Future<void> _openPinSetup() async {
    final state = await _future;
    if (!mounted) return;
    final entryMode = TransactionPinServerPolicy.entryMode(
      serverConfigured: state.server.configured,
    );
    var screenMode = PinScreenMode.create;
    if (entryMode == TransactionPinServerEntryMode.verifyExisting) {
      final selected = await showModalBottomSheet<PinScreenMode>(
        context: context,
        backgroundColor: AppColors.surface,
        showDragHandle: true,
        builder: (context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.sm,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Manage transaction PIN', style: AppTextStyles.headingM),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Verify this device or replace the PIN after confirming your current one.',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.md),
                FilledButton.icon(
                  onPressed: () =>
                      Navigator.of(context).pop(PinScreenMode.verify),
                  icon: const Icon(Icons.verified_user_outlined),
                  label: const Text('Verify on this device'),
                ),
                const SizedBox(height: AppSpacing.sm),
                OutlinedButton.icon(
                  onPressed: () =>
                      Navigator.of(context).pop(PinScreenMode.reset),
                  icon: const Icon(Icons.password_rounded),
                  label: const Text('Reset transaction PIN'),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected == null || !mounted) return;
      screenMode = selected;
    }

    final result = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => switch (screenMode) {
          PinScreenMode.verify => TransactionPinScreen.verify(
              pinLength: state.server.pinLength ?? state.device.pinLength,
              title: 'Verify transaction PIN',
              subtitle:
                  'Confirm the PIN already configured on your TrustPay account.',
              securityService: _securityService,
              authService: _authService,
            ),
          PinScreenMode.reset => TransactionPinScreen.reset(
              pinLength: state.server.pinLength ?? state.device.pinLength,
              securityService: _securityService,
              authService: _authService,
            ),
          PinScreenMode.create => TransactionPinScreen.create(
              securityService: _securityService,
              authService: _authService,
            ),
        },
        fullscreenDialog: true,
      ),
    );

    if (result != null && result != false) {
      _reload();
    }
  }

  Future<void> _toggleBiometric(
    TransactionSecurityConfig config,
    bool enabled,
  ) async {
    if (!config.hasPin) {
      _showToast('Set your transaction PIN first.');
      return;
    }
    if (!config.canUseBiometrics || !config.hasBiometric) {
      _showToast('${config.biometricLabel} is not available on this device.');
      return;
    }

    if (enabled) {
      final approved = await _securityService.authenticateBiometric(
        reason: 'Enable ${config.biometricLabel} for TrustPay app unlock',
      );
      if (!approved) {
        _showToast('${config.biometricLabel} setup was not completed.');
        return;
      }
    }

    await _securityService.setBiometricEnabled(enabled);
    _reload();
  }

  IconData _biometricIcon(TransactionSecurityConfig config) {
    return config.biometricLabel == 'Face ID'
        ? Icons.face_retouching_natural_rounded
        : Icons.fingerprint_rounded;
  }

  void _showToast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.surface,
        content: Text(
          message,
          style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<_TransactionSecuritySnapshot>(
          future: _future,
          builder: (context, snapshot) {
            return CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.md,
                    AppSpacing.lg,
                    AppSpacing.xxl,
                  ),
                  sliver: SliverList.list(
                    children: [
                      TpPageHeader(
                        label: 'Transaction Security',
                        menuActions: [
                          TpPageMenuAction(
                            label: 'More',
                            icon: Icons.more_horiz_rounded,
                            onTap: () => context.push(AppRoutes.more),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        'Protect money actions with a fresh transaction PIN. Biometrics unlock the app only.',
                        style: AppTextStyles.bodyM,
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      if (snapshot.connectionState == ConnectionState.waiting)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(AppSpacing.xl),
                            child: TrustPayAnimatedState(
                              variant: TrustPayAnimationVariant.loading,
                              title: 'Checking security',
                              detail:
                                  'Loading your transaction PIN and biometric settings.',
                              animationSize: 72,
                            ),
                          ),
                        )
                      else if (!snapshot.hasData)
                        const _SecurityInfoPanel(
                          title: 'Unavailable',
                          detail:
                              'Could not load transaction security settings.',
                          icon: Icons.lock_clock_rounded,
                        )
                      else
                        Builder(
                          builder: (context) {
                            final state = snapshot.requireData;
                            final config = state.device;
                            final server = state.server;

                            return Column(
                              children: [
                                _SecurityActionPanel(
                                  title: server.configured
                                      ? 'Manage transaction PIN'
                                      : 'Create transaction PIN',
                                  detail: server.configured
                                      ? 'Verify this device or reset your server PIN using the current PIN.'
                                      : 'Set the PIN used for money action approvals.',
                                  icon: Icons.password_rounded,
                                  cta: server.configured
                                      ? 'Change PIN'
                                      : 'Create PIN',
                                  onTap: _openPinSetup,
                                ),
                                const SizedBox(height: AppSpacing.md),
                                _BiometricTogglePanel(
                                  title: config.biometricLabel,
                                  detail: config.hasBiometric
                                      ? 'Use ${config.biometricLabel} to unlock the TrustPay app after it locks.'
                                      : '${config.biometricLabel} is not available on this device or current build.',
                                  icon: _biometricIcon(config),
                                  value: config.biometricEnabled &&
                                      config.hasBiometric,
                                  enabled:
                                      server.configured && config.hasBiometric,
                                  onChanged: (value) =>
                                      _toggleBiometric(config, value),
                                ),
                                const SizedBox(height: AppSpacing.md),
                                const _SecurityInfoPanel(
                                  title: 'Current behavior',
                                  detail:
                                    'Money action routes always request a freshly entered transaction PIN before submission. Biometrics are limited to app unlock until a server challenge can bind approval to the device.',
                                  icon: Icons.verified_user_outlined,
                                ),
                              ],
                            );
                          },
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class TransactionPinScreen extends StatefulWidget {
  final PinScreenMode mode;
  final int initialPinLength;
  final String title;
  final String subtitle;
  final TransactionSecurityService? securityService;
  final AuthService? authService;

  const TransactionPinScreen._({
    required this.mode,
    required this.initialPinLength,
    required this.title,
    required this.subtitle,
    this.securityService,
    this.authService,
  });

  factory TransactionPinScreen.create({
    TransactionSecurityService? securityService,
    AuthService? authService,
  }) {
    return TransactionPinScreen._(
      mode: PinScreenMode.create,
      initialPinLength: 4,
      title: 'Create transaction PIN',
      subtitle: 'Set the code that will be required for money action requests.',
      securityService: securityService,
      authService: authService,
    );
  }

  factory TransactionPinScreen.verify({
    required int pinLength,
    required String title,
    required String subtitle,
    TransactionSecurityService? securityService,
    AuthService? authService,
  }) {
    return TransactionPinScreen._(
      mode: PinScreenMode.verify,
      initialPinLength: pinLength,
      title: title,
      subtitle: subtitle,
      securityService: securityService,
      authService: authService,
    );
  }

  factory TransactionPinScreen.reset({
    required int pinLength,
    TransactionSecurityService? securityService,
    AuthService? authService,
  }) {
    return TransactionPinScreen._(
      mode: PinScreenMode.reset,
      initialPinLength: pinLength,
      title: 'Verify current PIN',
      subtitle: 'Enter your current server PIN before choosing a new one.',
      securityService: securityService,
      authService: authService,
    );
  }

  @override
  State<TransactionPinScreen> createState() => _TransactionPinScreenState();
}

class _TransactionPinScreenState extends State<TransactionPinScreen> {
  late final TransactionSecurityService _securityService;
  late final AuthService _authService;
  final StringBuffer _buffer = StringBuffer();
  String? _firstPin;
  String? _currentPin;
  String? _error;
  late int _pinLength;
  bool _verifyExistingServerPin = false;

  @override
  void initState() {
    super.initState();
    _securityService = widget.securityService ?? TransactionSecurityService();
    _authService = widget.authService ?? AuthService();
    _pinLength = widget.initialPinLength;
  }

  Future<void> _handleDigit(String digit) async {
    if (_buffer.length >= _pinLength) {
      return;
    }

    HapticFeedback.selectionClick();
    setState(() {
      _buffer.write(digit);
      _error = null;
    });

    if (_buffer.length == _pinLength) {
      await _completeStep();
    }
  }

  void _handleDelete() {
    if (_buffer.isEmpty) {
      return;
    }

    HapticFeedback.selectionClick();
    final current = _buffer.toString();
    setState(() {
      _buffer
        ..clear()
        ..write(current.substring(0, current.length - 1));
      _error = null;
    });
  }

  Future<void> _completeStep() async {
    final pin = _buffer.toString();
    if (widget.mode == PinScreenMode.reset) {
      await _completeResetStep(pin);
      return;
    }

    final isCreateMode =
        widget.mode == PinScreenMode.create && !_verifyExistingServerPin;

    if (isCreateMode) {
      if (_firstPin == null) {
        setState(() {
          _firstPin = pin;
          _buffer.clear();
        });
        return;
      }

      if (_firstPin != pin) {
        setState(() {
          _buffer.clear();
          _firstPin = null;
          _error = 'PINs did not match. Start again.';
        });
        return;
      }

      try {
        await _authService.setTransactionPin(pin);
        await _securityService.savePin(pin, pinLength: _pinLength);
      } catch (error) {
        if (isTransactionPinAlreadySetError(error)) {
          try {
            final status = await _authService.getTransactionPinStatus();
            if (!mounted) return;
            setState(() {
              _verifyExistingServerPin = status.configured;
              _pinLength = status.pinLength ?? _pinLength;
              _buffer.clear();
              _firstPin = null;
              _error = status.configured
                  ? 'A server PIN already exists. Enter that PIN to verify this device.'
                  : 'PIN state changed. Try setup again.';
            });
          } catch (_) {
            if (!mounted) return;
            setState(() {
              _buffer.clear();
              _firstPin = null;
              _error = 'Could not refresh transaction PIN status.';
            });
          }
          return;
        }

        setState(() {
          _buffer.clear();
          _firstPin = null;
          _error = authErrorMessage(
            error,
            'Could not save transaction PIN. Try again.',
          );
        });
        return;
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
      return;
    }

    try {
      await _authService.verifyTransactionPin(pin);
      await _securityService.saveVerifiedDevicePin(pin);
      if (!mounted) return;
      Navigator.of(context).pop(pin);
      return;
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _buffer.clear();
        _error = authErrorMessage(error, 'Could not verify transaction PIN.');
      });
    }
  }

  Future<void> _completeResetStep(String pin) async {
    final step = TransactionPinResetPolicy.step(
      currentPin: _currentPin,
      replacementPin: _firstPin,
    );

    if (step == TransactionPinResetStep.verifyCurrent) {
      try {
        await _authService.verifyTransactionPin(pin);
        if (!mounted) return;
        setState(() {
          _currentPin = pin;
          _buffer.clear();
        });
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _buffer.clear();
          _error = authErrorMessage(error, 'Could not verify current PIN.');
        });
      }
      return;
    }

    if (step == TransactionPinResetStep.enterReplacement) {
      final validation = TransactionPinResetPolicy.validateReplacement(
        currentPin: _currentPin!,
        replacementPin: pin,
      );
      if (validation != null) {
        setState(() {
          _buffer.clear();
          _error = validation;
        });
        return;
      }
      setState(() {
        _firstPin = pin;
        _buffer.clear();
      });
      return;
    }

    final validation = TransactionPinResetPolicy.validateConfirmation(
      replacementPin: _firstPin!,
      confirmationPin: pin,
    );
    if (validation != null) {
      setState(() {
        _buffer.clear();
        _error = validation;
      });
      return;
    }

    try {
      await _authService.resetTransactionPin(
        currentPin: _currentPin!,
        newPin: pin,
      );
      await _securityService.saveVerifiedDevicePin(pin);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _buffer.clear();
        _error = authErrorMessage(error, 'Could not reset transaction PIN.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final isCreateConfirm = widget.mode == PinScreenMode.create &&
        !_verifyExistingServerPin &&
        _firstPin != null;
    final resetStep = TransactionPinResetPolicy.step(
      currentPin: _currentPin,
      replacementPin: _firstPin,
    );
    final currentTitle = widget.mode == PinScreenMode.reset
        ? switch (resetStep) {
            TransactionPinResetStep.verifyCurrent => 'Verify current PIN',
            TransactionPinResetStep.enterReplacement => 'Choose a new PIN',
            TransactionPinResetStep.confirmReplacement => 'Confirm new PIN',
          }
        : widget.mode == PinScreenMode.create && !_verifyExistingServerPin
            ? (isCreateConfirm ? 'Confirm your PIN' : widget.title)
            : _verifyExistingServerPin
                ? 'Verify existing PIN'
                : widget.title;
    final currentSubtitle = widget.mode == PinScreenMode.reset
        ? switch (resetStep) {
            TransactionPinResetStep.verifyCurrent =>
              'Enter your current server PIN before choosing a new one.',
            TransactionPinResetStep.enterReplacement =>
              'Choose a different $_pinLength-digit PIN.',
            TransactionPinResetStep.confirmReplacement =>
              'Enter the new PIN again to confirm it.',
          }
        : widget.mode == PinScreenMode.create && !_verifyExistingServerPin
            ? (isCreateConfirm
                ? 'Enter the same code again to confirm it.'
                : widget.subtitle)
            : _verifyExistingServerPin
                ? 'Enter the PIN already configured on your TrustPay account.'
                : widget.subtitle;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.md,
            AppSpacing.lg,
            AppSpacing.xxl,
          ),
          child: Column(
            children: [
              Row(
                children: [
                  const Spacer(),
                  const SizedBox(width: AppSpacing.md),
                  _TopIconButton(
                    icon: Icons.close_rounded,
                    onTap: () {
                      if (context.canPop()) {
                        context.pop();
                      } else {
                        context.go(AppRoutes.home);
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xxl),
              Text(
                currentTitle,
                style: AppTextStyles.headingXL,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                currentSubtitle,
                style: AppTextStyles.bodyM,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xxl),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  _pinLength,
                  (index) => _PinDot(
                    filled: index < _buffer.length,
                    value: index < _buffer.length ? '*' : null,
                  ),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  _error!,
                  style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
                  textAlign: TextAlign.center,
                ),
              ],
              const Spacer(),
              GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                childAspectRatio: 1.35,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (final digit in [
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
                    _KeypadButton(
                      label: digit,
                      onTap: () => _handleDigit(digit),
                    ),
                  // Keep the zero key centered in the three-column keypad.
                  // Money actions require a freshly entered transaction PIN.
                  const SizedBox.shrink(),
                  _KeypadButton(
                    label: '0',
                    onTap: () => _handleDigit('0'),
                  ),
                  _KeypadIconButton(
                    icon: Icons.backspace_outlined,
                    enabled: true,
                    onTap: _handleDelete,
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

bool isTransactionPinAlreadySetError(Object error) {
  if (error is! DioException) {
    return false;
  }

  if (error.response?.statusCode != 409) {
    return false;
  }

  final message = _extractDioMessage(error.response?.data);
  return message != null && message.toLowerCase().contains('already set');
}

String? _extractDioMessage(dynamic data) {
  if (data is String && data.isNotEmpty) {
    return data;
  }

  if (data is Map<String, dynamic>) {
    final message = data['message'];
    if (message is String && message.isNotEmpty) {
      return message;
    }
    if (message is List && message.isNotEmpty) {
      return message.whereType<String>().join('\n');
    }
    if (message is Map<String, dynamic>) {
      return _extractDioMessage(message) ??
          _extractDioMessage(message['error']);
    }
  }

  if (data is List && data.isNotEmpty) {
    final values = data.whereType<String>().where((value) => value.isNotEmpty);
    final joined = values.join('\n');
    if (joined.isNotEmpty) {
      return joined;
    }
  }

  return null;
}

enum PinScreenMode { create, verify, reset }

class _SecurityActionPanel extends StatelessWidget {
  final String title;
  final String detail;
  final String cta;
  final IconData icon;
  final VoidCallback onTap;

  const _SecurityActionPanel({
    required this.title,
    required this.detail,
    required this.cta,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: Text(title, style: AppTextStyles.headingM)),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(detail, style: AppTextStyles.bodyM),
          const SizedBox(height: AppSpacing.md),
          Semantics(
            container: true,
            button: true,
            enabled: true,
            label: cta,
            onTap: onTap,
            child: ExcludeSemantics(
              child: FilledButton(
                onPressed: onTap,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 50),
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
                child: Text(cta),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BiometricTogglePanel extends StatelessWidget {
  final String title;
  final String detail;
  final IconData icon;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  const _BiometricTogglePanel({
    required this.title,
    required this.detail,
    required this.icon,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.inputFill,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(icon, color: AppColors.textPrimary),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(detail, style: AppTextStyles.bodyS),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Semantics(
            container: true,
            label: '$title app unlock',
            value: enabled ? (value ? 'On' : 'Off') : 'Unavailable',
            enabled: enabled,
            toggled: enabled && value,
            onTap: enabled ? () => onChanged(!value) : null,
            child: ExcludeSemantics(
              child: SizedBox(
                width: 48,
                height: 48,
                child: Switch(
                  value: enabled ? value : false,
                  onChanged: enabled ? onChanged : null,
                  activeThumbColor: AppColors.primary,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SecurityInfoPanel extends StatelessWidget {
  final String title;
  final String detail;
  final IconData icon;

  const _SecurityInfoPanel({
    required this.title,
    required this.detail,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.labelM),
                const SizedBox(height: AppSpacing.xs),
                Text(detail, style: AppTextStyles.bodyM),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PinDot extends StatelessWidget {
  final bool filled;
  final String? value;

  const _PinDot({
    required this.filled,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      margin: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? AppColors.surfaceVariant : AppColors.inputFill,
        border: Border.all(
          color: filled ? AppColors.primary : AppColors.border,
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        filled ? value ?? '*' : '',
        style: AppTextStyles.headingM.copyWith(color: AppColors.textPrimary),
      ),
    );
  }
}

class _KeypadButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _KeypadButton({
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.full),
        onTap: onTap,
        child: Container(
          width: 72,
          height: 72,
          alignment: Alignment.center,
          child: Text(
            label,
            style: AppTextStyles.headingL.copyWith(letterSpacing: 0),
          ),
        ),
      ),
    );
  }
}

class _KeypadIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final bool enabled;

  const _KeypadIconButton({
    required this.icon,
    required this.onTap,
    required this.enabled,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.full),
        onTap: onTap,
        child: Container(
          width: 72,
          height: 72,
          alignment: Alignment.center,
          child: Icon(
            icon,
            size: 28,
            color: enabled ? AppColors.textPrimary : AppColors.textHint,
          ),
        ),
      ),
    );
  }
}

class _TopIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _TopIconButton({
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: AppColors.textPrimary, size: 20),
        ),
      ),
    );
  }
}
