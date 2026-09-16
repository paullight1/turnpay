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

const _supportedPhoneCountries = <_PhoneCountry>[
  _PhoneCountry(
    isoCode: 'NG',
    name: 'Nigeria',
    flag: '🇳🇬',
    dialCode: '+234',
    nationalNumberLength: 10,
    nationalNumberPattern: r'^[789]\d{9}$',
    example: '801 234 5678',
  ),
  _PhoneCountry(
    isoCode: 'GH',
    name: 'Ghana',
    flag: '🇬🇭',
    dialCode: '+233',
    nationalNumberLength: 9,
    nationalNumberPattern: r'^[25]\d{8}$',
    example: '24 123 4567',
  ),
];

class RegisterScreen extends StatefulWidget {
  final AuthService? authService;
  final TransactionSecurityService? securityService;

  const RegisterScreen({
    super.key,
    this.authService,
    this.securityService,
  });

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const _pinLength = 4;
  static const _totalSteps = 8;
  static const _referralStep = 6;
  static const _termsStep = 7;

  final _stepFormKeys = List.generate(
    _totalSteps,
    (_) => GlobalKey<FormState>(),
  );
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _transactionPinController = TextEditingController();
  final _referralCodeController = TextEditingController();
  late final AuthService _authService;
  late final TransactionSecurityService _securityService;

  int _currentStep = 0;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _isLoading = false;
  bool _agreedToTerms = false;
  _PhoneCountry _selectedPhoneCountry = _supportedPhoneCountries.first;

  String? get _normalizedPhone =>
      _selectedPhoneCountry.normalize(_phoneController.text);

  @override
  void initState() {
    super.initState();
    _authService = widget.authService ?? AuthService();
    _securityService = widget.securityService ?? TransactionSecurityService();
  }

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

    if (_currentStep < _termsStep) {
      setState(() => _currentStep += 1);
      return;
    }

    if (!_agreedToTerms) {
      _showError('Please agree to the Terms and Privacy Policy.');
      return;
    }

    _onRegister();
  }

  void _skipReferral() {
    if (_isLoading || _currentStep != _referralStep) return;

    FocusScope.of(context).unfocus();
    _referralCodeController.clear();
    setState(() => _currentStep += 1);
  }

  Future<void> _onRegister() async {
    // _onNext already validates the form and terms before calling this.
    final phone = _normalizedPhone;
    if (phone == null) {
      _showError(
        'Enter a valid ${_selectedPhoneCountry.name} phone number.',
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final hasSession = await _authService.register(
        fullName: _nameController.text,
        email: _emailController.text,
        phone: phone,
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
            'phone': phone,
            'purpose': 'verify',
          },
        );
      }
    } catch (error) {
      if (!mounted) return;
      _showError(authErrorMessage(error, 'Registration failed'));

      if (isRegistrationConflict(error)) {
        await Future<void>.delayed(const Duration(milliseconds: 1500));
        if (mounted) {
          context.go(AppRoutes.login);
        }
      }
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
                'Enable biometric app unlock',
                style: AppTextStyles.headingM,
              ),
              content: Text(
                'Use ${config.biometricLabel} to unlock the TrustPay app after it locks. Money actions still require a freshly entered transaction PIN.',
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

    await _securityService.markBiometricPromptSeen();
    if (!shouldEnable) return;

    final approved = await _securityService.authenticateBiometric(
      reason: 'Enable ${config.biometricLabel} for TrustPay app unlock',
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
    if (_selectedPhoneCountry.normalize(value ?? '') == null) {
      return 'Enter a valid ${_selectedPhoneCountry.name} phone number';
    }
    return null;
  }

  Future<void> _choosePhoneCountry() async {
    FocusScope.of(context).unfocus();
    final selected = await showModalBottomSheet<_PhoneCountry>(
      context: context,
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              0,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Choose your country', style: AppTextStyles.headingM),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Your country code is added automatically.',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.md),
                ..._supportedPhoneCountries.map(
                  (country) => ListTile(
                    key: ValueKey('phone-country-${country.isoCode}'),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    leading: Text(
                      country.flag,
                      style: const TextStyle(fontSize: 24),
                    ),
                    title: Text(country.name, style: AppTextStyles.labelL),
                    subtitle: Text(
                      country.dialCode,
                      style: AppTextStyles.bodyM,
                    ),
                    trailing: country == _selectedPhoneCountry
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: AppColors.primary,
                          )
                        : null,
                    onTap: () => Navigator.of(sheetContext).pop(country),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (!mounted || selected == null || selected == _selectedPhoneCountry) {
      return;
    }

    setState(() => _selectedPhoneCountry = selected);
    if (_phoneController.text.isNotEmpty) {
      _stepFormKeys[2].currentState?.validate();
    }
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
    AppColors.watch(context);
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
                  child: _buildCurrentStep(),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              TpButton(
                label:
                    _currentStep == _termsStep ? 'Create account' : 'Continue',
                isLoading: _isLoading,
                isDisabled: _isLoading,
                onTap: _onNext,
              ),
              if (_currentStep == _referralStep) ...[
                const SizedBox(height: AppSpacing.md),
                TpButton(
                  label: 'Skip for now',
                  isOutlined: true,
                  isDisabled: _isLoading,
                  onTap: _skipReferral,
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
            'Step ${_currentStep + 1} of $_totalSteps',
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
      children: List.generate(_totalSteps, (index) {
        final isActive = index <= _currentStep;
        return Expanded(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            height: 4,
            margin: EdgeInsets.only(
              right: index == _totalSteps - 1 ? 0 : AppSpacing.xs,
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

  Widget _buildCurrentStep() {
    switch (_currentStep) {
      case 0:
        return _buildFullNameStep();
      case 1:
        return _buildEmailStep();
      case 2:
        return _buildPhoneStep();
      case 3:
        return _buildPasswordStep();
      case 4:
        return _buildConfirmPasswordStep();
      case 5:
        return _buildPinStep();
      case _referralStep:
        return _buildReferralStep();
      case _termsStep:
        return _buildTermsStep();
      default:
        throw StateError('Unknown registration step: $_currentStep');
    }
  }

  Widget _buildFullNameStep() {
    return _StepCard(
      key: const ValueKey('full-name-step'),
      icon: Icons.person_outline_rounded,
      title: "What's your full name?",
      subtitle: 'Use the name shown on your official ID.',
      children: [
        AuthTextField(
          controller: _nameController,
          label: 'Full name',
          hint: 'John Mensah',
          textInputAction: TextInputAction.done,
          validator: _validateName,
        ),
      ],
    );
  }

  Widget _buildEmailStep() {
    return _StepCard(
      key: const ValueKey('email-step'),
      icon: Icons.mail_outline_rounded,
      title: "What's your email address?",
      subtitle: "We'll use it for receipts and important account updates.",
      children: [
        AuthTextField(
          controller: _emailController,
          label: 'Email address',
          hint: 'you@example.com',
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.done,
          validator: _validateEmail,
        ),
      ],
    );
  }

  Widget _buildPhoneStep() {
    return _StepCard(
      key: const ValueKey('phone-step'),
      icon: Icons.phone_outlined,
      title: "What's your phone number?",
      subtitle: "We'll send a code to verify this number.",
      children: [
        _PhoneNumberField(
          controller: _phoneController,
          country: _selectedPhoneCountry,
          onCountryTap: _choosePhoneCountry,
          onChanged: (_) => setState(() {}),
          validator: _validatePhone,
        ),
      ],
    );
  }

  Widget _buildPasswordStep() {
    return _StepCard(
      key: const ValueKey('password-step'),
      icon: Icons.lock_outline_rounded,
      title: 'Create a password',
      subtitle: 'Use 8+ characters with upper, lower, and a number.',
      children: [
        AuthTextField(
          controller: _passwordController,
          label: 'Password',
          hint: 'Minimum 8 characters',
          obscureText: _obscurePassword,
          textInputAction: TextInputAction.done,
          suffixIcon: _VisibilityToggle(
            isObscured: _obscurePassword,
            onTap: () {
              setState(() => _obscurePassword = !_obscurePassword);
            },
          ),
          validator: _validatePassword,
        ),
      ],
    );
  }

  Widget _buildConfirmPasswordStep() {
    return _StepCard(
      key: const ValueKey('confirm-password-step'),
      icon: Icons.lock_reset_rounded,
      title: 'Confirm your password',
      subtitle: 'Enter it again so we know there are no typing mistakes.',
      children: [
        AuthTextField(
          controller: _confirmPasswordController,
          label: 'Confirm password',
          hint: 'Re-enter your password',
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
      ],
    );
  }

  Widget _buildPinStep() {
    return _StepCard(
      key: const ValueKey('pin-step'),
      icon: Icons.pin_outlined,
      title: 'Set a transaction PIN',
      subtitle: 'Use 4 digits you can remember but others cannot guess.',
      children: [
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
      ],
    );
  }

  Widget _buildReferralStep() {
    return _StepCard(
      key: const ValueKey('referral-step'),
      icon: Icons.redeem_outlined,
      title: 'Have a referral code?',
      subtitle: "Enter it here, or skip if you don't have one.",
      children: [
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
      ],
    );
  }

  Widget _buildTermsStep() {
    return _StepCard(
      key: const ValueKey('terms-step'),
      icon: Icons.verified_user_outlined,
      title: 'Review and agree',
      subtitle: 'Read how TrustPay protects your account and data.',
      children: [
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

class _PhoneCountry {
  final String isoCode;
  final String name;
  final String flag;
  final String dialCode;
  final int nationalNumberLength;
  final String nationalNumberPattern;
  final String example;

  const _PhoneCountry({
    required this.isoCode,
    required this.name,
    required this.flag,
    required this.dialCode,
    required this.nationalNumberLength,
    required this.nationalNumberPattern,
    required this.example,
  });

  String? normalize(String rawNumber) {
    final digits = rawNumber.replaceAll(RegExp(r'[\s()+-]'), '');
    if (!RegExp(r'^\d+$').hasMatch(digits)) return null;

    final dialDigits = dialCode.substring(1);
    var nationalNumber = digits;
    if (nationalNumber.startsWith(dialDigits)) {
      nationalNumber = nationalNumber.substring(dialDigits.length);
    } else if (nationalNumber.startsWith('0')) {
      nationalNumber = nationalNumber.substring(1);
    }

    if (nationalNumber.length != nationalNumberLength ||
        !RegExp(nationalNumberPattern).hasMatch(nationalNumber)) {
      return null;
    }

    final normalized = '$dialCode$nationalNumber';
    return RegExp(r'^\+[1-9]\d{1,14}$').hasMatch(normalized)
        ? normalized
        : null;
  }
}

class _PhoneNumberField extends StatelessWidget {
  final TextEditingController controller;
  final _PhoneCountry country;
  final VoidCallback onCountryTap;
  final ValueChanged<String> onChanged;
  final String? Function(String?) validator;

  const _PhoneNumberField({
    required this.controller,
    required this.country,
    required this.onCountryTap,
    required this.onChanged,
    required this.validator,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final normalizedPhone = country.normalize(controller.text);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Phone number', style: AppTextStyles.labelM),
        const SizedBox(height: AppSpacing.xs + 2),
        TextFormField(
          key: const ValueKey('phone-number-input'),
          controller: controller,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.done,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(15),
          ],
          style: AppTextStyles.bodyL.copyWith(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w500,
          ),
          autovalidateMode: AutovalidateMode.onUserInteraction,
          validator: validator,
          onChanged: onChanged,
          decoration: InputDecoration(
            hintText: country.example,
            prefixIconConstraints: const BoxConstraints(
              minWidth: 120,
              minHeight: 56,
            ),
            prefixIcon: Material(
              color: Colors.transparent,
              child: Semantics(
                button: true,
                label:
                    'Select country code. Current ${country.name} ${country.dialCode}',
                onTap: onCountryTap,
                excludeSemantics: true,
                child: InkWell(
                  key: const ValueKey('phone-country-selector'),
                  onTap: onCountryTap,
                  borderRadius: const BorderRadius.horizontal(
                    left: Radius.circular(AppRadius.md),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(left: AppSpacing.md),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          country.flag,
                          style: const TextStyle(fontSize: 21),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(
                          country.dialCode,
                          style: AppTextStyles.labelM,
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        Icon(
                          Icons.keyboard_arrow_down_rounded,
                          color: AppColors.textSecondary,
                          size: 20,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Container(
                          width: 1,
                          height: 24,
                          color: AppColors.border,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xs + 2),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 160),
          child: Text(
            normalizedPhone == null
                ? 'Enter the local number without the country code.'
                : 'Number to verify: $normalizedPhone',
            key: ValueKey(normalizedPhone),
            style: AppTextStyles.bodyS.copyWith(
              color: normalizedPhone == null
                  ? AppColors.textHint
                  : AppColors.success,
            ),
          ),
        ),
      ],
    );
  }
}

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
    AppColors.watch(context);
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
    AppColors.watch(context);
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
    AppColors.watch(context);
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
