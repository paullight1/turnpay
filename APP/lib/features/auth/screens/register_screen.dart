import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/auth_service.dart';
import '../../../services/transaction_security_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

class _RegisterStepContent {
  const _RegisterStepContent({
    required this.stepLabel,
    required this.headline,
    required this.description,
    required this.panelTitle,
    required this.panelSubtitle,
    required this.primaryLabel,
    required this.icon,
  });

  final String stepLabel;
  final String headline;
  final String description;
  final String panelTitle;
  final String panelSubtitle;
  final String primaryLabel;
  final IconData icon;
}

const _registerSteps = [
  _RegisterStepContent(
    stepLabel: 'Identity',
    headline: 'Start with your profile.',
    description: 'Use the name, email, and phone number tied to your wallet.',
    panelTitle: 'Personal info',
    panelSubtitle: 'This helps us protect your TRUSTPAY account.',
    primaryLabel: 'Continue',
    icon: Icons.person_outline_rounded,
  ),
  _RegisterStepContent(
    stepLabel: 'Password',
    headline: 'Secure your sign in.',
    description: 'Create a password before setting transaction controls.',
    panelTitle: 'Account security',
    panelSubtitle: 'Use a password that is hard to guess and easy to recall.',
    primaryLabel: 'Set password',
    icon: Icons.lock_outline_rounded,
  ),
  _RegisterStepContent(
    stepLabel: 'PIN',
    headline: 'Protect money actions.',
    description: 'Your transaction PIN is used for transfers and withdrawals.',
    panelTitle: 'Transaction PIN',
    panelSubtitle: 'Set a 4 digit PIN for withdrawals, transfers, and swaps.',
    primaryLabel: 'Confirm PIN',
    icon: Icons.pin_outlined,
  ),
  _RegisterStepContent(
    stepLabel: 'Review',
    headline: 'Review and finish.',
    description: 'Check the account details before creating your wallet.',
    panelTitle: 'Confirm setup',
    panelSubtitle: 'Re-enter your PIN and review the account owner.',
    primaryLabel: 'Create account',
    icon: Icons.verified_user_outlined,
  ),
];

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const _stepCount = 4;
  static const _pinLength = 4;

  final _stepFormKeys =
      List.generate(_stepCount, (_) => GlobalKey<FormState>());
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _transactionPinController = TextEditingController();
  final _confirmTransactionPinController = TextEditingController();
  final _authService = AuthService();
  final _securityService = TransactionSecurityService();

  int _currentStep = 0;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _isLoading = false;
  bool _agreedToTerms = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _transactionPinController.dispose();
    _confirmTransactionPinController.dispose();
    super.dispose();
  }

  void _handleBack() {
    if (_isLoading) return;

    if (_currentStep == 0) {
      context.pop();
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() => _currentStep -= 1);
  }

  void _onNext() {
    if (_isLoading) return;

    FocusScope.of(context).unfocus();
    if (!(_stepFormKeys[_currentStep].currentState?.validate() ?? false)) {
      return;
    }

    if (_currentStep == 1 && !_agreedToTerms) {
      _showError('Please agree to the Terms and Privacy Policy.');
      return;
    }

    setState(() => _currentStep += 1);
  }

  Future<void> _onRegister() async {
    if (_isLoading) return;

    FocusScope.of(context).unfocus();
    if (!(_stepFormKeys[_currentStep].currentState?.validate() ?? false)) {
      return;
    }
    if (!_agreedToTerms) {
      _showError('Please agree to the Terms and Privacy Policy.');
      setState(() => _currentStep = 1);
      return;
    }

    setState(() => _isLoading = true);

    try {
      final hasSession = await _authService.register(
        fullName: _nameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        password: _passwordController.text,
        transactionPin: _transactionPinController.text,
      );
      await _securityService.savePin(
        _transactionPinController.text,
        pinLength: _pinLength,
      );

      if (!mounted) return;

      await _offerBiometricSetup();
      if (!mounted) return;

      if (hasSession) {
        context.go(AppRoutes.home);
      } else {
        context.push(
          AppRoutes.otp,
          extra: {
            'phone': _phoneController.text.trim(),
            'purpose': 'verify',
          },
        );
      }
    } catch (error) {
      if (!mounted) return;
      _showError(authErrorMessage(error, 'Registration failed'));
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _offerBiometricSetup() async {
    final config = await _securityService.getConfig();
    if (!mounted || !config.canUseBiometrics || !config.hasBiometric) return;

    final shouldEnable = await showDialog<bool>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              backgroundColor: AppColors.surface,
              title: Text(
                'Enable biometric approval',
                style: AppTextStyles.headingM,
              ),
              content: Text(
                'Use ${config.biometricLabel} to unlock your transaction PIN before money actions.',
                style: AppTextStyles.bodyM,
              ),
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
                  child: const Text('Enable'),
                ),
              ],
            );
          },
        ) ??
        false;

    if (!shouldEnable) return;

    final approved = await _securityService.authenticateBiometric(
      reason: 'Enable ${config.biometricLabel} for TRUSTPAY transactions',
    );
    if (!approved) {
      _showError('Biometric setup was not completed.');
      return;
    }

    await _securityService.setBiometricEnabled(true);
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message,
          style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
        ),
        backgroundColor: AppColors.surfaceVariant,
      ),
    );
  }

  String? _validateName(String? value) {
    if (value == null || value.trim().length < 2) {
      return 'Enter your full name';
    }
    return null;
  }

  String? _validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Please enter your email';
    }
    final emailRegex = RegExp(r'^[\w\.-]+@[\w-]+\.\w+$');
    if (!emailRegex.hasMatch(value.trim())) return 'Enter a valid email';
    return null;
  }

  String? _validatePhone(String? value) {
    final phone = value?.replaceAll(RegExp(r'\s+'), '') ?? '';
    final phoneRegex = RegExp(r'^\+?[1-9]\d{9,14}$');
    if (!phoneRegex.hasMatch(phone)) {
      return 'Enter a valid phone number';
    }
    return null;
  }

  String? _validatePassword(String? value) {
    final password = value ?? '';
    final passwordRegex = RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$');
    if (!passwordRegex.hasMatch(password)) {
      return 'Use 8+ chars with upper, lower, and number';
    }
    return null;
  }

  String? _validateConfirmPassword(String? value) {
    if (value != _passwordController.text) {
      return 'Passwords do not match';
    }
    return null;
  }

  String? _validatePin(String? value) {
    final pin = value ?? '';
    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      return 'Use a 4 digit transaction PIN';
    }
    return null;
  }

  String? _validateConfirmPin(String? value) {
    final pinError = _validatePin(value);
    if (pinError != null) return pinError;
    if (value != _transactionPinController.text) {
      return 'Transaction PINs do not match';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final step = _registerSteps[_currentStep];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: _AuthBackground(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.lg,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _RegisterTopBar(
                  currentStep: _currentStep,
                  stepCount: _stepCount,
                  isDisabled: _isLoading,
                  onBack: _handleBack,
                ),
                const SizedBox(height: AppSpacing.xl),
                _RegisterHero(content: step),
                const SizedBox(height: AppSpacing.xl),
                _StepProgress(currentStep: _currentStep, stepCount: _stepCount),
                const SizedBox(height: AppSpacing.lg),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  switchInCurve: Curves.easeOut,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: (child, animation) {
                    return FadeTransition(
                      opacity: animation,
                      child: SlideTransition(
                        position: Tween<Offset>(
                          begin: const Offset(0.04, 0),
                          end: Offset.zero,
                        ).animate(animation),
                        child: child,
                      ),
                    );
                  },
                  child: Form(
                    key: _stepFormKeys[_currentStep],
                    child: _buildStep(),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                TpButton(
                  label: step.primaryLabel,
                  isLoading: _isLoading,
                  isDisabled: _isLoading,
                  onTap: _currentStep == _stepCount - 1 ? _onRegister : _onNext,
                ),
                if (_currentStep > 0) ...[
                  const SizedBox(height: AppSpacing.md),
                  TpButton(
                    label: 'Back',
                    isOutlined: true,
                    isDisabled: _isLoading,
                    onTap: _handleBack,
                  ),
                ],
                if (_currentStep == 0) ...[
                  const SizedBox(height: AppSpacing.xl),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'Already have an account? ',
                        style: AppTextStyles.bodyM,
                      ),
                      GestureDetector(
                        onTap: () => context.pushReplacement(AppRoutes.login),
                        child: Text(
                          'Log in',
                          style: AppTextStyles.link.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStep() {
    final step = _registerSteps[_currentStep];

    switch (_currentStep) {
      case 0:
        return _StepPanel(
          key: const ValueKey('personal-step'),
          icon: step.icon,
          title: step.panelTitle,
          subtitle: step.panelSubtitle,
          children: [
            AuthTextField(
              controller: _nameController,
              label: 'Full name',
              hint: 'John Mensah',
              textInputAction: TextInputAction.next,
              validator: _validateName,
            ),
            const SizedBox(height: AppSpacing.md),
            AuthTextField(
              controller: _emailController,
              label: 'Email address',
              hint: 'you@example.com',
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              validator: _validateEmail,
            ),
            const SizedBox(height: AppSpacing.md),
            AuthTextField(
              controller: _phoneController,
              label: 'Phone number',
              hint: '+234 800 000 0000',
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.done,
              validator: _validatePhone,
            ),
          ],
        );
      case 1:
        return _StepPanel(
          key: const ValueKey('password-step'),
          icon: step.icon,
          title: step.panelTitle,
          subtitle: step.panelSubtitle,
          children: [
            AuthTextField(
              controller: _passwordController,
              label: 'Password',
              hint: '********',
              obscureText: _obscurePassword,
              textInputAction: TextInputAction.next,
              suffixIcon: _VisibilityToggle(
                isObscured: _obscurePassword,
                onTap: () {
                  setState(() => _obscurePassword = !_obscurePassword);
                },
              ),
              validator: _validatePassword,
            ),
            const SizedBox(height: AppSpacing.md),
            AuthTextField(
              controller: _confirmPasswordController,
              label: 'Confirm password',
              hint: '********',
              obscureText: _obscureConfirm,
              textInputAction: TextInputAction.done,
              suffixIcon: _VisibilityToggle(
                isObscured: _obscureConfirm,
                onTap: () {
                  setState(() => _obscureConfirm = !_obscureConfirm);
                },
              ),
              validator: _validateConfirmPassword,
            ),
            const SizedBox(height: AppSpacing.lg),
            _TermsCheckbox(
              agreedToTerms: _agreedToTerms,
              onChanged: (value) {
                setState(() => _agreedToTerms = value ?? false);
              },
            ),
          ],
        );
      case 2:
        return _StepPanel(
          key: const ValueKey('pin-step'),
          icon: step.icon,
          title: step.panelTitle,
          subtitle: step.panelSubtitle,
          children: [
            AuthTextField(
              controller: _transactionPinController,
              label: 'Transaction PIN',
              hint: '4 digits',
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(_pinLength),
              ],
              maxLength: _pinLength,
              textInputAction: TextInputAction.done,
              validator: _validatePin,
            ),
          ],
        );
      default:
        return _StepPanel(
          key: const ValueKey('confirm-pin-step'),
          icon: step.icon,
          title: step.panelTitle,
          subtitle: step.panelSubtitle,
          children: [
            AuthTextField(
              controller: _confirmTransactionPinController,
              label: 'Confirm transaction PIN',
              hint: '4 digits',
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(_pinLength),
              ],
              maxLength: _pinLength,
              textInputAction: TextInputAction.done,
              validator: _validateConfirmPin,
            ),
            const SizedBox(height: AppSpacing.lg),
            _AccountReviewSummary(
              name: _nameController.text.trim(),
              email: _emailController.text.trim(),
              phone: _phoneController.text.trim(),
            ),
          ],
        );
    }
  }
}

class _RegisterTopBar extends StatelessWidget {
  const _RegisterTopBar({
    required this.currentStep,
    required this.stepCount,
    required this.isDisabled,
    required this.onBack,
  });

  final int currentStep;
  final int stepCount;
  final bool isDisabled;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _BackButton(
          isDisabled: isDisabled,
          onTap: onBack,
        ),
        const Spacer(),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.full),
            border: Border.all(color: AppColors.border),
          ),
          child: Text(
            'Step ${currentStep + 1} of $stepCount',
            style: AppTextStyles.labelS.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ),
      ],
    );
  }
}

class _RegisterHero extends StatelessWidget {
  const _RegisterHero({required this.content});

  final _RegisterStepContent content;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.26),
                ),
              ),
              child: Icon(
                content.icon,
                color: AppColors.primary,
                size: 22,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(
              content.stepLabel,
              style: AppTextStyles.labelM.copyWith(
                color: AppColors.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          content.headline,
          style: AppTextStyles.displayMedium,
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          content.description,
          style: AppTextStyles.bodyL,
        ),
      ],
    );
  }
}

class _BackButton extends StatelessWidget {
  const _BackButton({
    required this.onTap,
    this.isDisabled = false,
  });

  final VoidCallback onTap;
  final bool isDisabled;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isDisabled ? null : onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 180),
        opacity: isDisabled ? 0.45 : 1,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.border),
          ),
          child: Icon(
            Icons.arrow_back_ios_new_rounded,
            color: AppColors.textPrimary,
            size: 18,
          ),
        ),
      ),
    );
  }
}

class _StepProgress extends StatelessWidget {
  const _StepProgress({
    required this.currentStep,
    required this.stepCount,
  });

  final int currentStep;
  final int stepCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(stepCount, (index) {
        final isActive = index <= currentStep;
        return Expanded(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            height: 4,
            margin: EdgeInsets.only(
              right: index == stepCount - 1 ? 0 : AppSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: isActive ? AppColors.primary : AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
          ),
        );
      }),
    );
  }
}

class _StepPanel extends StatelessWidget {
  const _StepPanel({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: key,
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 24,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.surfaceVariant,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: AppColors.border),
                ),
                child: Icon(
                  icon,
                  color: AppColors.primary,
                  size: 20,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppTextStyles.headingL),
                    const SizedBox(height: AppSpacing.xs),
                    Text(subtitle, style: AppTextStyles.bodyM),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          ...children,
        ],
      ),
    );
  }
}

class _AccountReviewSummary extends StatelessWidget {
  const _AccountReviewSummary({
    required this.name,
    required this.email,
    required this.phone,
  });

  final String name;
  final String email;
  final String phone;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Account owner',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: AppSpacing.md),
          _ReviewLine(label: 'Name', value: name),
          const SizedBox(height: AppSpacing.sm),
          _ReviewLine(label: 'Email', value: email),
          const SizedBox(height: AppSpacing.sm),
          _ReviewLine(label: 'Phone', value: phone),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.info_outline_rounded,
                color: AppColors.textHint,
                size: 18,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Password and PIN are hidden for your security.',
                  style: AppTextStyles.bodyS,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReviewLine extends StatelessWidget {
  const _ReviewLine({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 56,
          child: Text(
            label,
            style: AppTextStyles.bodyS,
          ),
        ),
        Expanded(
          child: Text(
            value.isEmpty ? '-' : value,
            style: AppTextStyles.labelM,
            overflow: TextOverflow.ellipsis,
            maxLines: 2,
          ),
        ),
      ],
    );
  }
}

class _VisibilityToggle extends StatelessWidget {
  const _VisibilityToggle({
    required this.isObscured,
    required this.onTap,
  });

  final bool isObscured;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Icon(
        isObscured ? Icons.visibility_off_outlined : Icons.visibility_outlined,
        color: AppColors.textHint,
        size: 20,
      ),
    );
  }
}

class _TermsCheckbox extends StatelessWidget {
  const _TermsCheckbox({
    required this.agreedToTerms,
    required this.onChanged,
  });

  final bool agreedToTerms;
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 24,
          height: 24,
          child: Checkbox(
            value: agreedToTerms,
            onChanged: onChanged,
            activeColor: AppColors.primary,
            side: BorderSide(
              color: AppColors.border,
              width: 1.5,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: AppTextStyles.bodyS,
              children: [
                const TextSpan(text: 'I agree to the '),
                TextSpan(
                  text: 'Terms of Service',
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const TextSpan(text: ' and '),
                TextSpan(
                  text: 'Privacy Policy',
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _AuthBackground extends StatelessWidget {
  final Widget child;

  const _AuthBackground({required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                AppColors.primary.withValues(alpha: 0.18),
                AppColors.background.withValues(alpha: 0.92),
                AppColors.background,
              ],
              stops: const [0, 0.48, 1],
            ),
          ),
        ),
        Positioned(
          top: -88,
          right: -92,
          child: Container(
            width: 280,
            height: 280,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primary.withValues(alpha: 0.14),
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 300,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.background.withValues(alpha: 0),
                  AppColors.background.withValues(alpha: 0.94),
                  AppColors.background,
                ],
              ),
            ),
          ),
        ),
        child,
      ],
    );
  }
}
