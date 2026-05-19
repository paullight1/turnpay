import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

/// Forgot Password screen â€” Single email field, clean layout.
/// After submitting, user is instructed to check their email for an OTP.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _authService = AuthService();
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

    try {
      await _authService.forgotPassword(_emailController.text);

      if (mounted) {
        setState(() => _sent = true);
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            authErrorMessage(error, 'Could not send reset email'),
            style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
          ),
          backgroundColor: AppColors.surfaceVariant,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
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

                // â”€â”€ Icon â”€â”€
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Icon(
                    Icons.lock_reset_rounded,
                    color: AppColors.primary,
                    size: 28,
                  ),
                ),

                SizedBox(height: AppSpacing.lg),

                Text(
                  _sent ? 'Check your\nemail.' : 'Forgot your\npassword?',
                  style: AppTextStyles.displayMedium,
                ),

                SizedBox(height: AppSpacing.sm),

                Text(
                  _sent
                      ? 'We\'ve sent a reset link to ${_emailController.text.trim()}. Check your inbox and spam folder.'
                      : 'Enter the email address associated with your account. We\'ll send a link to reset your password.',
                  style: AppTextStyles.bodyL,
                ),

                if (!_sent) ...[
                  SizedBox(height: AppSpacing.xxl),
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
                  SizedBox(height: AppSpacing.xl),
                  TpButton(
                    label: 'Send reset link',
                    isLoading: _isLoading,
                    onTap: _onSubmit,
                  ),
                ] else ...[
                  SizedBox(height: AppSpacing.xxl),

                  // â”€â”€ Success Illustration â”€â”€
                  Center(
                    child: Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        color: AppColors.success.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.mark_email_read_outlined,
                        size: 48,
                        color: AppColors.success,
                      ),
                    ),
                  ),

                  SizedBox(height: AppSpacing.xl),

                  TpButton(
                    label: 'Back to login',
                    onTap: () => context.go(AppRoutes.login),
                  ),
                ],

                SizedBox(height: AppSpacing.xl),

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

