import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../core/widgets/tp_back_button.dart';
import '../../../core/widgets/tp_card.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_help_button.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

/// Forgot Password screen — Single email field, clean layout.
class ForgotPasswordScreen extends StatefulWidget {
  final String initialEmail;
  final AuthService? authService;

  const ForgotPasswordScreen({
    super.key,
    this.initialEmail = '',
    this.authService,
  });

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  late final AuthService _authService;
  bool _isLoading = false;
  bool _sent = false;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(
      text: widget.initialEmail.trim().toLowerCase(),
    );
    _authService = widget.authService ?? AuthService();
  }

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
      showTpSnackbar(
        context,
        authErrorMessage(error, 'Could not send reset email'),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

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
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    TpBackButton(),
                    Spacer(),
                    AuthHelpButton(),
                  ],
                ),
                const SizedBox(height: AppSpacing.xxl),
                Text(
                  _sent ? 'Check your\nemail.' : 'Forgot your\npassword?',
                  style: AppTextStyles.displayMedium,
                ),
                const SizedBox(height: AppSpacing.sm),
                if (_sent) ...[
                  const TrustPayAnimatedState(
                    variant: TrustPayAnimationVariant.success,
                    title: 'Reset request received',
                    detail:
                        'If an account exists for that email, a reset link will arrive shortly. Check your inbox and spam folder.',
                    animationSize: 78,
                  ),
                ] else ...[
                  Text(
                    'Enter the email address associated with your account. We\'ll send a link to reset your password.',
                    style: AppTextStyles.bodyL,
                  ),
                ],
                if (!_sent) ...[
                  const SizedBox(height: AppSpacing.xxl),
                  TpCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
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
                        const SizedBox(height: AppSpacing.xl),
                        TpButton(
                          label: 'Send reset link',
                          isLoading: _isLoading,
                          onTap: _onSubmit,
                        ),
                      ],
                    ),
                  ),
                ] else ...[
                  const SizedBox(height: AppSpacing.xxl),
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
                        onTap: () => context.go(AppRoutes.login),
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
