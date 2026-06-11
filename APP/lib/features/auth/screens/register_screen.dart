import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_back_button.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/auth_service.dart';
import '../../../services/transaction_security_service.dart';
import '../widgets/auth_help_button.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/legal_page_link.dart';
import '../widgets/tp_button.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const _pinLength = 4;

  final _stepFormKeys = [
    GlobalKey<FormState>(),
    GlobalKey<FormState>(),
  ];
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _transactionPinController = TextEditingController();
  final _referralCodeController = TextEditingController();
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
    _referralCodeController.dispose();
    super.dispose();
  }

  void _handleBack() {
    if (_isLoading) return;

    if (_currentStep == 0) {
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(AppRoutes.login);
      }
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

    if (_currentStep == 0) {
      setState(() => _currentStep = 1);
      return;
    }

    if (!_agreedToTerms) {
      _showError('Please agree to the Terms and Privacy Policy.');
      return;
    }

    _onRegister();
  }

  Future<void> _onRegister() async {
    // _onNext already validates the form and terms before calling this.
    setState(() => _isLoading = true);

    try {
      final hasSession = await _authService.register(
        fullName: _nameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        password: _passwordController.text,
        transactionPin: _transactionPinController.text,
        referralCode: _referralCodeController.text,
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
    showTpSnackbar(context, message, type: TpSnackbarType.error);
  }

  // ── Validators ──

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
      return 'Use a 4-digit transaction PIN';
    }
    return null;
  }

  String? _validateReferralCode(String? value) {
    final code = value?.trim() ?? '';
    if (code.isEmpty) return null;
    if (!RegExp(r'^[A-Za-z0-9]{4,20}$').hasMatch(code)) {
      return 'Enter a valid referral code';
    }
    return null;
  }

  // ── Build ──

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildTopBar(),
              const SizedBox(height: AppSpacing.lg),
              _buildStepProgress(),
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
                  child: _currentStep == 0
                      ? _buildIdentityStep()
                      : _buildSecurityStep(),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              TpButton(
                label: _currentStep == 0 ? 'Continue' : 'Create account',
                isLoading: _isLoading,
                isDisabled: _isLoading,
                onTap: _onNext,
              ),
              if (_currentStep == 1) ...[
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
    );
  }

  Widget _buildTopBar() {
    return Row(
      children: [
        TpBackButton(
          isDisabled: _isLoading,
          onTap: _handleBack,
        ),
        const Spacer(),
        const AuthHelpButton(),
        const SizedBox(width: AppSpacing.sm),
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
            'Step ${_currentStep + 1} of 2',
            style: AppTextStyles.labelS.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildStepProgress() {
    return Row(
      children: List.generate(2, (index) {
        final isActive = index <= _currentStep;
        return Expanded(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            height: 4,
            margin: EdgeInsets.only(
              right: index == 1 ? 0 : AppSpacing.xs,
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

  Widget _buildIdentityStep() {
    return _StepCard(
      key: const ValueKey('identity-step'),
      icon: Icons.person_outline_rounded,
      title: 'Personal info',
      subtitle: 'Use the name, email, and phone tied to your wallet.',
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
  }

  Widget _buildSecurityStep() {
    return _StepCard(
      key: const ValueKey('security-step'),
      icon: Icons.lock_outline_rounded,
      title: 'Security',
      subtitle: 'Set a strong password and a 4-digit PIN for transactions.',
      children: [
        AuthTextField(
          controller: _passwordController,
          label: 'Password',
          hint: 'Minimum 8 characters',
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
          hint: 'Re-enter your password',
          obscureText: _obscureConfirm,
          textInputAction: TextInputAction.next,
          suffixIcon: _VisibilityToggle(
            isObscured: _obscureConfirm,
            onTap: () {
              setState(() => _obscureConfirm = !_obscureConfirm);
            },
          ),
          validator: _validateConfirmPassword,
        ),
        const SizedBox(height: AppSpacing.md),
        AuthTextField(
          controller: _transactionPinController,
          label: 'Transaction PIN (4 digits)',
          hint: 'Used for transfers and withdrawals',
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
        const SizedBox(height: AppSpacing.lg),
        AuthTextField(
          controller: _referralCodeController,
          label: 'Referral code (optional)',
          hint: 'TP123ABC',
          textInputAction: TextInputAction.done,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
            LengthLimitingTextInputFormatter(20),
          ],
          validator: _validateReferralCode,
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
  }
}

// ── Reusable step card ──

class _StepCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  const _StepCard({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
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

// ── Shared helpers ──

class _VisibilityToggle extends StatelessWidget {
  final bool isObscured;
  final VoidCallback onTap;

  const _VisibilityToggle({
    required this.isObscured,
    required this.onTap,
  });

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
  final bool agreedToTerms;
  final ValueChanged<bool?> onChanged;

  const _TermsCheckbox({
    required this.agreedToTerms,
    required this.onChanged,
  });

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
          child: Wrap(
            alignment: WrapAlignment.start,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 4,
            runSpacing: 2,
            children: [
              Text(
                'I agree to the ',
                style: AppTextStyles.bodyS,
              ),
              LegalPageLink(
                label: 'Terms of Service',
                fragment: 'terms',
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                ' and ',
                style: AppTextStyles.bodyS,
              ),
              LegalPageLink(
                label: 'Privacy Policy',
                fragment: 'privacy',
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
