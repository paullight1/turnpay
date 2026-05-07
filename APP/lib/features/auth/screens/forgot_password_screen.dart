import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

/// Forgot Password screen — Single email field, clean layout.
/// After submitting, user is instructed to check their email for an OTP.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _isLoading = false;
  bool _sent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _onSubmit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isLoading = true);

    // TODO: call forgot password service
    await Future.delayed(const Duration(seconds: 2));

    if (mounted) {
      setState(() {
        _isLoading = false;
        _sent = true;
      });
    }
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
                // ── Back Button ──
                GestureDetector(
                  onTap: () => context.pop(),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceVariant,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: const Icon(
                      Icons.arrow_back_ios_new_rounded,
                      color: AppColors.textPrimary,
                      size: 18,
                    ),
                  ),
                ),

                const SizedBox(height: AppSpacing.xl),

                // ── Icon ──
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: const Icon(
                    Icons.lock_reset_rounded,
                    color: AppColors.primary,
                    size: 28,
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),

                Text(
                  _sent ? 'Check your\nemail.' : 'Forgot your\npassword?',
                  style: AppTextStyles.displayMedium,
                ),

                const SizedBox(height: AppSpacing.sm),

                Text(
                  _sent
                      ? 'We\'ve sent a reset link to ${_emailController.text.trim()}. Check your inbox and spam folder.'
                      : 'Enter the email address associated with your account. We\'ll send a link to reset your password.',
                  style: AppTextStyles.bodyL,
                ),

                if (!_sent) ...[
                  const SizedBox(height: AppSpacing.xxl),

                  AuthTextField(
                    controller: _emailController,
                    label: 'Email address',
                    hint: 'you@example.com',
                    keyboardType: TextInputType.emailAddress,
                    prefixIcon: Icons.mail_outline_rounded,
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Please enter your email';
                      final emailRegex = RegExp(r'^[\w-.]+@[\w-]+\.\w+\$');
                      if (!emailRegex.hasMatch(v)) return 'Enter a valid email';
                      return null;
                    },
                  ),

                  const SizedBox(height: AppSpacing.xl),

                  TpButton(
                    label: 'Send reset link',
                    isLoading: _isLoading,
                    onTap: _onSubmit,
                  ),
                ] else ...[
                  const SizedBox(height: AppSpacing.xxl),

                  // ── Success Illustration ──
                  Center(
                    child: Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        color: AppColors.success.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.mark_email_read_outlined,
                        size: 48,
                        color: AppColors.success,
                      ),
                    ),
                  ),

                  const SizedBox(height: AppSpacing.xl),

                  TpButton(
                    label: 'Back to login',
                    onTap: () => context.go(AppRoutes.login),
                  ),
                ],

                const SizedBox(height: AppSpacing.xl),

                if (!_sent)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('Remembered it? ', style: AppTextStyles.bodyM),
                      GestureDetector(
                        onTap: () => context.pop(),
                        child: Text(
                          'Back to login',
                          style: AppTextStyles.link.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
