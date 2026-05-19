import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';
import '../widgets/social_auth_button.dart';

/// Register screen â€” mirroring Login with additional Full Name, Phone fields.
/// Matches the same dark Superlist-inspired layout.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _authService = AuthService();
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
    super.dispose();
  }

  Future<void> _onRegister() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (!_agreedToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Please agree to the Terms and Privacy Policy.',
            style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
          ),
          backgroundColor: AppColors.surfaceVariant,
        ),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final hasSession = await _authService.register(
        fullName: _nameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        password: _passwordController.text,
      );

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
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // â”€â”€ Back Button â”€â”€
                GestureDetector(
                  onTap: () => context.pop(),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceVariant,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Icon(
                      Icons.arrow_back_ios_new_rounded,
                      color: AppColors.textPrimary,
                      size: 18,
                    ),
                  ),
                ),

                SizedBox(height: AppSpacing.xl),

                // â”€â”€ Logo â”€â”€
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withOpacity(0.3),
                        blurRadius: 20,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Center(
                    child: Text(
                      'T',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),

                SizedBox(height: AppSpacing.lg),

                Text('Create your\naccount.',
                    style: AppTextStyles.displayMedium),

                SizedBox(height: AppSpacing.sm),

                Text(
                  'Join thousands of people sending money across Africa.',
                  style: AppTextStyles.bodyL,
                ),

                SizedBox(height: AppSpacing.xxl),

                // â”€â”€ Full Name â”€â”€
                AuthTextField(
                  controller: _nameController,
                  label: 'Full name',
                  hint: 'John Mensah',
                  prefixIcon: Icons.person_outline_rounded,
                  validator: (v) {
                    if (v == null || v.trim().length < 2) {
                      return 'Enter your full name';
                    }
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.md),

                // â”€â”€ Email â”€â”€
                AuthTextField(
                  controller: _emailController,
                  label: 'Email address',
                  hint: 'you@example.com',
                  keyboardType: TextInputType.emailAddress,
                  prefixIcon: Icons.mail_outline_rounded,
                  validator: (v) {
                    if (v == null || v.isEmpty)
                      return 'Please enter your email';
                    final emailRegex = RegExp(r'^[\w\.-]+@[\w-]+\.\w+$');
                    if (!emailRegex.hasMatch(v)) return 'Enter a valid email';
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.md),

                // â”€â”€ Phone Number â”€â”€
                AuthTextField(
                  controller: _phoneController,
                  label: 'Phone number',
                  hint: '+234 080 0000 0000',
                  keyboardType: TextInputType.phone,
                  prefixIcon: Icons.phone_outlined,
                  validator: (v) {
                    final phone = v?.replaceAll(RegExp(r'\s+'), '') ?? '';
                    final phoneRegex = RegExp(r'^\+?[1-9]\d{9,14}$');
                    if (!phoneRegex.hasMatch(phone)) {
                      return 'Enter a valid phone number';
                    }
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.md),

                // â”€â”€ Password â”€â”€
                AuthTextField(
                  controller: _passwordController,
                  label: 'Password',
                  hint: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢',
                  obscureText: _obscurePassword,
                  prefixIcon: Icons.lock_outline_rounded,
                  suffixIcon: GestureDetector(
                    onTap: () =>
                        setState(() => _obscurePassword = !_obscurePassword),
                    child: Icon(
                      _obscurePassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      color: AppColors.textHint,
                      size: 20,
                    ),
                  ),
                  validator: (v) {
                    final password = v ?? '';
                    final passwordRegex =
                        RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$');
                    if (!passwordRegex.hasMatch(password)) {
                      return 'Use 8+ chars with upper, lower, and number';
                    }
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.md),

                // â”€â”€ Confirm Password â”€â”€
                AuthTextField(
                  controller: _confirmPasswordController,
                  label: 'Confirm password',
                  hint: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢',
                  obscureText: _obscureConfirm,
                  prefixIcon: Icons.lock_outline_rounded,
                  suffixIcon: GestureDetector(
                    onTap: () =>
                        setState(() => _obscureConfirm = !_obscureConfirm),
                    child: Icon(
                      _obscureConfirm
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      color: AppColors.textHint,
                      size: 20,
                    ),
                  ),
                  validator: (v) {
                    if (v != _passwordController.text) {
                      return 'Passwords do not match';
                    }
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.lg),

                // â”€â”€ Terms Checkbox â”€â”€
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: Checkbox(
                        value: _agreedToTerms,
                        onChanged: (v) =>
                            setState(() => _agreedToTerms = v ?? false),
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
                    SizedBox(width: AppSpacing.sm),
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
                ),

                SizedBox(height: AppSpacing.xl),

                // â”€â”€ Create Account CTA â”€â”€
                TpButton(
                  label: 'Create account',
                  isLoading: _isLoading,
                  onTap: _onRegister,
                ),

                SizedBox(height: AppSpacing.lg),

                // â”€â”€ OR Divider â”€â”€
                Row(
                  children: [
                    Expanded(child: Divider(color: AppColors.divider)),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                      ),
                      child:
                          Text('or sign up with', style: AppTextStyles.caption),
                    ),
                    Expanded(child: Divider(color: AppColors.divider)),
                  ],
                ),

                SizedBox(height: AppSpacing.lg),

                SocialAuthButton(
                  label: 'Continue with Google',
                  icon: Icons.g_mobiledata_rounded,
                  onTap: () {},
                ),

                SizedBox(height: AppSpacing.sm),

                SocialAuthButton(
                  label: 'Continue with Apple',
                  icon: Icons.apple_rounded,
                  onTap: () {},
                ),

                SizedBox(height: AppSpacing.xl),

                // â”€â”€ Login redirect â”€â”€
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

                SizedBox(height: AppSpacing.xl),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

