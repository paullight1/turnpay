import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/transaction_security_service.dart';

class TransactionSecurityScreen extends StatefulWidget {
  const TransactionSecurityScreen({super.key});

  @override
  State<TransactionSecurityScreen> createState() =>
      _TransactionSecurityScreenState();
}

class _TransactionSecurityScreenState extends State<TransactionSecurityScreen> {
  final _securityService = TransactionSecurityService();
  late Future<TransactionSecurityConfig> _future;

  @override
  void initState() {
    super.initState();
    _future = _securityService.getConfig();
  }

  void _reload() {
    setState(() {
      _future = _securityService.getConfig();
    });
  }

  Future<void> _openPinSetup(TransactionSecurityConfig config) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TransactionPinScreen.create(
          initialPinLength: config.pinLength,
        ),
        fullscreenDialog: true,
      ),
    );

    if (saved == true) {
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
        reason: 'Enable ${config.biometricLabel} for TRUSTPAY transactions',
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
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<TransactionSecurityConfig>(
          future: _future,
          builder: (context, snapshot) {
            final config = snapshot.data;

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
                      Row(
                        children: [
                          _TopIconButton(
                            icon: Icons.arrow_back_ios_new_rounded,
                            onTap: () => context.pop(),
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Text(
                              'Transaction Security',
                              style: AppTextStyles.headingXL,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        'Protect money actions with a transaction PIN and optional biometric approval.',
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
                      else ...[
                        _SecurityStatusHero(config: config!),
                        const SizedBox(height: AppSpacing.lg),
                        _SecurityActionPanel(
                          title: config.hasPin
                              ? 'Update transaction PIN'
                              : 'Create transaction PIN',
                          detail: config.hasPin
                              ? 'Your PIN is required before sensitive wallet actions.'
                              : 'Set the PIN used for money action approvals.',
                          icon: Icons.password_rounded,
                          cta: config.hasPin ? 'Change PIN' : 'Create PIN',
                          onTap: () => _openPinSetup(config),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        _BiometricTogglePanel(
                          title: config.biometricLabel,
                          detail: config.hasBiometric
                              ? 'Use ${config.biometricLabel} to approve sensitive transactions after your PIN is set.'
                              : '${config.biometricLabel} is not available on this device or current build.',
                          icon: _biometricIcon(config),
                          value: config.biometricEnabled && config.hasBiometric,
                          enabled: config.hasBiometric,
                          onChanged: (value) => _toggleBiometric(config, value),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const _SecurityInfoPanel(
                          title: 'Current behavior',
                          detail:
                              'Money action routes request your PIN before submission. Biometrics can unlock your PIN only when enabled and supported.',
                          icon: Icons.verified_user_outlined,
                        ),
                      ],
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
  final bool allowBiometric;
  final String biometricLabel;
  final String title;
  final String subtitle;

  const TransactionPinScreen._({
    required this.mode,
    required this.initialPinLength,
    required this.allowBiometric,
    required this.biometricLabel,
    required this.title,
    required this.subtitle,
  });

  factory TransactionPinScreen.create({int initialPinLength = 4}) {
    return TransactionPinScreen._(
      mode: PinScreenMode.create,
      initialPinLength: initialPinLength,
      allowBiometric: false,
      biometricLabel: 'Biometric approval',
      title: 'Create transaction PIN',
      subtitle: 'Set the code that will be required for money action requests.',
    );
  }

  factory TransactionPinScreen.verify({
    required int pinLength,
    required bool allowBiometric,
    required String biometricLabel,
    required String title,
    required String subtitle,
  }) {
    return TransactionPinScreen._(
      mode: PinScreenMode.verify,
      initialPinLength: pinLength,
      allowBiometric: allowBiometric,
      biometricLabel: biometricLabel,
      title: title,
      subtitle: subtitle,
    );
  }

  @override
  State<TransactionPinScreen> createState() => _TransactionPinScreenState();
}

class _TransactionPinScreenState extends State<TransactionPinScreen> {
  final _securityService = TransactionSecurityService();
  final _authService = AuthService();
  final StringBuffer _buffer = StringBuffer();
  String? _firstPin;
  String? _error;
  late int _pinLength;

  @override
  void initState() {
    super.initState();
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

    if (widget.mode == PinScreenMode.create) {
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

    final result = await _securityService.verifyPinWithLockout(pin);
    if (!mounted) return;

    if (result.approved) {
      Navigator.of(context).pop(pin);
      return;
    }

    final lockoutMessage = result.lockedUntil == null
        ? null
        : 'Too many incorrect attempts. Try again after ${TimeOfDay.fromDateTime(result.lockedUntil!.toLocal()).format(context)}.';
    setState(() {
      _buffer.clear();
      _error = lockoutMessage ?? 'Incorrect PIN. Try again.';
    });
  }

  Future<void> _useBiometric() async {
    final pin = await _securityService.unlockPinWithBiometric(
      reason: 'Approve this TRUSTPAY transaction with ${widget.biometricLabel}',
    );

    if (!mounted) return;

    if (pin != null) {
      Navigator.of(context).pop(pin);
      return;
    }

    setState(() {
      _error = 'Biometric check was not completed.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final isCreateConfirm =
        widget.mode == PinScreenMode.create && _firstPin != null;
    final currentTitle = widget.mode == PinScreenMode.create
        ? (isCreateConfirm ? 'Confirm your PIN' : widget.title)
        : widget.title;
    final currentSubtitle = widget.mode == PinScreenMode.create
        ? (isCreateConfirm
            ? 'Enter the same code again to confirm it.'
            : widget.subtitle)
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
                  if (widget.mode == PinScreenMode.create)
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(AppSpacing.xs),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(AppRadius.full),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: _PinLengthChip(
                                label: '4 digit',
                                active: _pinLength == 4,
                                onTap: () => setState(() => _pinLength = 4),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            Expanded(
                              child: _PinLengthChip(
                                label: '6 digit',
                                active: _pinLength == 6,
                                onTap: () => setState(() => _pinLength = 6),
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    const Spacer(),
                  const SizedBox(width: AppSpacing.md),
                  _TopIconButton(
                    icon: Icons.close_rounded,
                    onTap: () => context.pop(),
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
              const SizedBox(height: AppSpacing.xl),
              TrustPayLottie(
                variant: widget.mode == PinScreenMode.create
                    ? TrustPayAnimationVariant.success
                    : TrustPayAnimationVariant.send,
                size: 72,
                repeat: widget.mode != PinScreenMode.create,
                semanticsLabel: currentTitle,
              ),
              const SizedBox(height: AppSpacing.md),
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
                  _KeypadIconButton(
                    icon: widget.allowBiometric
                        ? widget.biometricLabel == 'Face ID'
                            ? Icons.face_retouching_natural_rounded
                            : Icons.fingerprint_rounded
                        : Icons.circle_outlined,
                    enabled: widget.allowBiometric,
                    onTap: widget.allowBiometric ? _useBiometric : null,
                  ),
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

enum PinScreenMode { create, verify }

class _SecurityStatusHero extends StatelessWidget {
  final TransactionSecurityConfig config;

  const _SecurityStatusHero({required this.config});

  @override
  Widget build(BuildContext context) {
    final status = config.hasPin ? 'Protected' : 'Action required';
    final detail = config.hasPin
        ? 'Money actions can require transaction approval.'
        : 'Create a PIN before sensitive transaction requests can be protected.';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            AppColors.surfaceVariant,
          ],
        ),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 68,
            height: 68,
            child: TrustPayLottie(
              variant: config.hasPin
                  ? TrustPayAnimationVariant.success
                  : TrustPayAnimationVariant.loading,
              size: 68,
              repeat: !config.hasPin,
              semanticsLabel: status,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(status, style: AppTextStyles.headingM),
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
          FilledButton(
            onPressed: onTap,
            style: FilledButton.styleFrom(
              minimumSize: const Size(double.infinity, 50),
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
            ),
            child: Text(cta),
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
          Switch(
            value: enabled ? value : false,
            onChanged: enabled ? onChanged : null,
            activeThumbColor: AppColors.primary,
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

class _PinLengthChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _PinLengthChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
        child: Center(
          child: Text(
            label,
            style: AppTextStyles.labelS.copyWith(
              color: active ? Colors.white : AppColors.textSecondary,
            ),
          ),
        ),
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
