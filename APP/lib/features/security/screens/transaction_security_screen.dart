import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
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

  Future<void> _toggleFaceId(
    TransactionSecurityConfig config,
    bool enabled,
  ) async {
    if (!config.hasPin) {
      _showToast('Set your transaction PIN first.');
      return;
    }
    if (!config.hasFaceId) {
      _showToast('Face ID is not available on this device/build.');
      return;
    }

    await _securityService.setFaceIdEnabled(enabled);
    _reload();
  }

  Future<void> _toggleFingerprint(
    TransactionSecurityConfig config,
    bool enabled,
  ) async {
    if (!config.hasPin) {
      _showToast('Set your transaction PIN first.');
      return;
    }
    if (!config.hasFingerprint) {
      _showToast('Fingerprint is not available on this device/build.');
      return;
    }

    await _securityService.setFingerprintEnabled(enabled);
    _reload();
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
                        'Protect money actions with a temporary local PIN gate and optional biometric approval.',
                        style: AppTextStyles.bodyM,
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      if (snapshot.connectionState == ConnectionState.waiting)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(AppSpacing.xl),
                            child: CircularProgressIndicator(),
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
                              : 'Set a local PIN for money action approvals.',
                          icon: Icons.password_rounded,
                          cta: config.hasPin ? 'Change PIN' : 'Create PIN',
                          onTap: () => _openPinSetup(config),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        _BiometricTogglePanel(
                          title: 'Face ID',
                          detail: config.hasFaceId
                              ? 'Allow face authentication before sensitive transactions.'
                              : 'Not available on this device or current build.',
                          icon: Icons.face_retouching_natural_rounded,
                          value: config.faceIdEnabled && config.hasFaceId,
                          enabled: config.hasFaceId,
                          onChanged: (value) => _toggleFaceId(config, value),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        _BiometricTogglePanel(
                          title: 'Fingerprint',
                          detail: config.hasFingerprint
                              ? 'Allow fingerprint approval as a faster alternative to your PIN.'
                              : 'Not available on this device or current build.',
                          icon: Icons.fingerprint_rounded,
                          value: config.fingerprintEnabled &&
                              config.hasFingerprint,
                          enabled: config.hasFingerprint,
                          onChanged: (value) =>
                              _toggleFingerprint(config, value),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const _SecurityInfoPanel(
                          title: 'Current behavior',
                          detail:
                              'Money action routes request your PIN before submission. Biometrics are offered only when enabled and supported.',
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
  final String title;
  final String subtitle;

  const TransactionPinScreen._({
    required this.mode,
    required this.initialPinLength,
    required this.allowBiometric,
    required this.title,
    required this.subtitle,
  });

  factory TransactionPinScreen.create({int initialPinLength = 4}) {
    return TransactionPinScreen._(
      mode: PinScreenMode.create,
      initialPinLength: initialPinLength,
      allowBiometric: false,
      title: 'Create transaction PIN',
      subtitle: 'Set the code that will be required for money action requests.',
    );
  }

  factory TransactionPinScreen.verify({
    required int pinLength,
    required bool allowBiometric,
    required String title,
    required String subtitle,
  }) {
    return TransactionPinScreen._(
      mode: PinScreenMode.verify,
      initialPinLength: pinLength,
      allowBiometric: allowBiometric,
      title: title,
      subtitle: subtitle,
    );
  }

  @override
  State<TransactionPinScreen> createState() => _TransactionPinScreenState();
}

class _TransactionPinScreenState extends State<TransactionPinScreen> {
  final _securityService = TransactionSecurityService();
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

      await _securityService.savePin(pin, pinLength: _pinLength);
      if (!mounted) return;
      Navigator.of(context).pop(true);
      return;
    }

    final result = await _securityService.verifyPinWithLockout(pin);
    if (!mounted) return;

    if (result.approved) {
      Navigator.of(context).pop(true);
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
    final approved = await _securityService.authenticateBiometric(
      reason: 'Approve this TRUSTPAY transaction',
    );

    if (!mounted) return;

    if (approved) {
      Navigator.of(context).pop(true);
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
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  _pinLength,
                  (index) => _PinDot(
                    filled: index < _buffer.length,
                    obscured: widget.mode == PinScreenMode.verify,
                    value: index < _buffer.length
                        ? _buffer.toString()[index]
                        : null,
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
                        ? Icons.fingerprint_rounded
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
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: config.hasPin
                  ? AppColors.success.withValues(alpha: 0.16)
                  : AppColors.warning.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(
              config.hasPin ? Icons.lock_rounded : Icons.lock_open_rounded,
              color: config.hasPin ? AppColors.success : AppColors.warning,
              size: 28,
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
  final bool obscured;
  final String? value;

  const _PinDot({
    required this.filled,
    required this.obscured,
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
        filled ? (obscured ? '*' : value ?? '') : '',
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
