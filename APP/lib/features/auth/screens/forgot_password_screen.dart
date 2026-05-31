import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../core/widgets/trustpay_lottie.dart';
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
                  // â”€â”€ Back Button â”€â”€
                  GestureDetector(
                    onTap: () => context.pop(),
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

                  SizedBox(height: AppSpacing.xxl),

                  Text(
                    _sent ? 'Check your\nemail.' : 'Forgot your\npassword?',
                    style: AppTextStyles.displayMedium,
                  ),

                  SizedBox(height: AppSpacing.sm),

                  if (_sent) ...[
                    TrustPayAnimatedState(
                      variant: TrustPayAnimationVariant.success,
                      title: 'Reset link sent',
                      detail:
                          'We\'ve sent a reset link to ${_emailController.text.trim()}. Check your inbox and spam folder.',
                      animationSize: 78,
                    ),
                  ] else ...[
                    Text(
                      'Enter the email address associated with your account. We\'ll send a link to reset your password.',
                      style: AppTextStyles.bodyL,
                    ),
                  ],

                  if (!_sent) ...[
                    SizedBox(height: AppSpacing.xxl),
                    _AuthPanel(
                      children: [
                        AuthTextField(
                          controller: _emailController,
                          label: 'Email address',
                          hint: 'you@example.com',
                          keyboardType: TextInputType.emailAddress,
                          validator: (v) {
                            if (v == null || v.isEmpty) {
                              return 'Please enter your email';
                            }
                            final emailRegex =
                                RegExp(r'^[\w\.-]+@[\w-]+\.\w+$');
                            if (!emailRegex.hasMatch(v)) {
                              return 'Enter a valid email';
                            }
                            return null;
                          },
                        ),
                        SizedBox(height: AppSpacing.xl),
                        TpButton(
                          label: 'Send reset link',
                          isLoading: _isLoading,
                          onTap: _onSubmit,
                        ),
                      ],
                    ),
                  ] else ...[
                    SizedBox(height: AppSpacing.xxl),
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
