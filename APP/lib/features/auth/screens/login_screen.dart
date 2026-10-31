import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_back_button.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_help_button.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/tp_button.dart';

class LoginScreen extends StatefulWidget {
  final String initialEmail;
  final AuthService? authService;

  const LoginScreen({
    super.key,
    this.initialEmail = '',
    this.authService,
  });

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  final _passwordController = TextEditingController();
  late final AuthService _authService = widget.authService ?? AuthService();
  bool _obscurePassword = true;
  bool _isLoading = false;
  bool _expiredNoticeShown = false;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(
      text: widget.initialEmail.trim().toLowerCase(),
    );
    // If we landed here because the session expired, surface a message once.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _expiredNoticeShown) return;
      final expired =
          GoRouterState.of(context).uri.queryParameters['expired'] == '1';
      if (expired) {
        _expiredNoticeShown = true;
        showTpSnackbar(
          context,
          'Your session expired. Please sign in again.',
          type: TpSnackbarType.error,
        );
      }
    });
  }

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
      final hasSession = await _authService.login(
        email: _emailController.text,
        password: _passwordController.text,
      );

      if (!mounted) return;
      if (!hasSession) {
        _showError('Login did not return a valid session. Please try again.');
        return;
      }
      context.go(AppRoutes.home);
    } catch (error) {
      if (!mounted) return;
      _showError(authErrorMessage(error, 'Login failed'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _onVerifyEmail() async {
    if (_isLoading) return;
    final email = _emailController.text.trim().toLowerCase();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      _showError('Enter your account email first.');
      return;
    }
    setState(() => _isLoading = true);
    try {
      await _authService.resendOtp(email);
      if (!mounted) return;
      context.push(AppRoutes.otp, extra: {'email': email, 'purpose': 'verify'});
    } catch (error) {
      if (mounted) {
        _showError(authErrorMessage(error, 'Could not request an email code'));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showError(String message) {
    showTpSnackbar(context, message, type: TpSnackbarType.error);
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
                // ── Top bar ──
                const Row(
                  children: [
                    TpBackButton(),
                    Spacer(),
                    AuthHelpButton(),
                  ],
                ),
                const SizedBox(height: AppSpacing.xxl),

                // ── Heading ──
                Text(
                  'Welcome\nback.',
                  style: AppTextStyles.displayMedium,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Log in to manage your transfers and payments.',
                  style: AppTextStyles.bodyL,
                ),
                const SizedBox(height: AppSpacing.xxl),

                // ── Email ──
                AuthTextField(
                  controller: _emailController,
                  label: 'Email address',
                  hint: 'you@example.com',
                  keyboardType: TextInputType.emailAddress,
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter your email';
                    }
                    final emailRegex = RegExp(r'^[\w\.-]+@[\w-]+\.\w+$');
                    if (!emailRegex.hasMatch(value)) {
                      return 'Enter a valid email';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: AppSpacing.md),

                // ── Password ──
                AuthTextField(
                  controller: _passwordController,
                  label: 'Password',
                  hint: 'Enter your password',
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
                const SizedBox(height: AppSpacing.sm),

                // ── Forgot password ──
                Align(
                  alignment: Alignment.centerRight,
                  child: GestureDetector(
                    onTap: () => context.push(
                      AppRoutes.forgotPassword,
                      extra: {
                        'email': _emailController.text.trim().toLowerCase(),
                      },
                    ),
                    child: Text(
                      'Forgot password?',
                      style: AppTextStyles.link,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),

                // ── Submit ──
                TpButton(
                  label: 'Log in',
                  isLoading: _isLoading,
                  onTap: _onLogin,
                ),
                const SizedBox(height: AppSpacing.xl),

                TextButton(
                  onPressed: _isLoading ? null : _onVerifyEmail,
                  child: const Text('Verify email'),
                ),
                const SizedBox(height: AppSpacing.sm),

                // ── Sign up link ──
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
                const SizedBox(height: AppSpacing.lg),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
