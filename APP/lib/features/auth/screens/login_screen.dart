import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';
import '../widgets/social_auth_button.dart';

/// Login screen â€” Superlist-inspired dark layout with top logo,
/// bold welcome heading, email/password fields, and social auth options.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _authService = AuthService();
  bool _obscurePassword = true;
  bool _isLoading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _onLogin() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _isLoading = true);

    try {
      await _authService.login(
        email: _emailController.text,
        password: _passwordController.text,
      );

      if (!mounted) return;
      context.go(AppRoutes.home);
    } catch (error) {
      if (!mounted) return;
      _showError(authErrorMessage(error, 'Login failed'));
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

                // â”€â”€ Logo Mark â”€â”€
                _TrustPayIcon(),

                SizedBox(height: AppSpacing.lg),

                // â”€â”€ Welcome Copy â”€â”€
                Text('Welcome\nback.', style: AppTextStyles.displayMedium),

                SizedBox(height: AppSpacing.sm),

                Text(
                  'Log in to manage your transfers and payments.',
                  style: AppTextStyles.bodyL,
                ),

                SizedBox(height: AppSpacing.xxl),

                // â”€â”€ Email Field â”€â”€
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

                // â”€â”€ Password Field â”€â”€
                AuthTextField(
                  controller: _passwordController,
                  label: 'Password',
                  hint: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢',
                  obscureText: _obscurePassword,
                  prefixIcon: Icons.lock_outline_rounded,
                  suffixIcon: GestureDetector(
                    onTap: () {
                      setState(() => _obscurePassword = !_obscurePassword);
                    },
                    child: Icon(
                      _obscurePassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      color: AppColors.textHint,
                      size: 20,
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty)
                      return 'Please enter your password';
                    if (v.length < 8)
                      return 'Password must be at least 8 characters';
                    return null;
                  },
                ),

                SizedBox(height: AppSpacing.sm),

                // â”€â”€ Forgot Password link â”€â”€
                Align(
                  alignment: Alignment.centerRight,
                  child: GestureDetector(
                    onTap: () => context.push(AppRoutes.forgotPassword),
                    child: Text(
                      'Forgot password?',
                      style: AppTextStyles.link,
                    ),
                  ),
                ),

                SizedBox(height: AppSpacing.xl),

                // â”€â”€ Log In Button â”€â”€
                TpButton(
                  label: 'Log in',
                  isLoading: _isLoading,
                  onTap: _onLogin,
                ),

                SizedBox(height: AppSpacing.lg),

                // â”€â”€ Divider â”€â”€
                _OrDivider(),

                SizedBox(height: AppSpacing.lg),

                // â”€â”€ Social Logins â”€â”€
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

                // â”€â”€ Sign Up redirect â”€â”€
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      "Don't have an account? ",
                      style: AppTextStyles.bodyM,
                    ),
                    GestureDetector(
                      onTap: () => context.pushReplacement(AppRoutes.register),
                      child: Text(
                        'Sign up',
                        style: AppTextStyles.link.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),

                SizedBox(height: AppSpacing.lg),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// â”€â”€â”€ SMALL LOGO MARK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _TrustPayIcon extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
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
    );
  }
}

// â”€â”€â”€ OR DIVIDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _OrDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Divider(color: AppColors.divider)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: Text(
            'or continue with',
            style: AppTextStyles.caption,
          ),
        ),
        Expanded(child: Divider(color: AppColors.divider)),
      ],
    );
  }
}

