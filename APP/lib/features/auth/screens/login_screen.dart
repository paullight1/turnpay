import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

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
      if (mounted) setState(() => _isLoading = false);
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
      body: _AuthBackground(
        child: SafeArea(
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
                  _BackButton(onTap: () => context.pop()),
                  SizedBox(height: AppSpacing.xxl),
                  Text('Welcome\nback.', style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Log in to manage your transfers and payments.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xxl),
                  _AuthPanel(
                    children: [
                      AuthTextField(
                        controller: _emailController,
                        label: 'Email address',
                        hint: 'you@example.com',
                        keyboardType: TextInputType.emailAddress,
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return 'Please enter your email';
                          }
                          final emailRegex =
                              RegExp(r'^[\w\.-]+@[\w-]+\.\w+$');
                          if (!emailRegex.hasMatch(value)) {
                            return 'Enter a valid email';
                          }
                          return null;
                        },
                      ),
                      SizedBox(height: AppSpacing.md),
                      AuthTextField(
                        controller: _passwordController,
                        label: 'Password',
                        hint: '********',
                        obscureText: _obscurePassword,
                        suffixIcon: GestureDetector(
                          onTap: () {
                            setState(
                              () => _obscurePassword = !_obscurePassword,
                            );
                          },
                          child: Icon(
                            _obscurePassword
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                            color: AppColors.textHint,
                            size: 20,
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return 'Please enter your password';
                          }
                          if (value.length < 8) {
                            return 'Password must be at least 8 characters';
                          }
                          return null;
                        },
                      ),
                      SizedBox(height: AppSpacing.sm),
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
                      TpButton(
                        label: 'Log in',
                        isLoading: _isLoading,
                        onTap: _onLogin,
                      ),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        "Don't have an account? ",
                        style: AppTextStyles.bodyM,
                      ),
                      GestureDetector(
                        onTap: () =>
                            context.pushReplacement(AppRoutes.register),
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
      ),
    );
  }
}

class _BackButton extends StatelessWidget {
  final VoidCallback onTap;

  const _BackButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
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

class _AuthPanel extends StatelessWidget {
  final List<Widget> children;

  const _AuthPanel({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
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
        children: children,
      ),
    );
  }
}
