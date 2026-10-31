import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_back_button.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../widgets/auth_help_button.dart';
import '../widgets/tp_button.dart';

/// OTP Verification screen â€” 6-digit split input boxes.
/// Verifies email ownership without marking phone or KYC as verified.
class OtpScreen extends StatefulWidget {
  final String email;
  final AuthService? authService;
  final String purpose; // 'verify' | 'reset'

  const OtpScreen({
    super.key,
    required this.email,
    this.authService,
    required this.purpose,
  });

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final int _otpLength = 6;
  final List<TextEditingController> _controllers = [];
  final List<FocusNode> _focusNodes = [];
  late final AuthService _authService = widget.authService ?? AuthService();
  bool _isLoading = false;
  int _resendSeconds = 60;
  Timer? _resendTimer;

  @override
  void initState() {
    super.initState();
    for (int i = 0; i < _otpLength; i++) {
      _controllers.add(TextEditingController());
      _focusNodes.add(FocusNode()..addListener(_refreshInputState));
    }
    _startResendTimer();
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  void _refreshInputState() {
    if (mounted) setState(() {});
  }

  void _startResendTimer() {
    _resendTimer?.cancel();
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || _resendSeconds <= 0) {
        timer.cancel();
        return;
      }
      setState(() => _resendSeconds--);
      if (_resendSeconds == 0) timer.cancel();
    });
  }

  String get _otpValue => _controllers.map((c) => c.text).join();

  bool get _isComplete => _otpValue.length == _otpLength;

  void _onOtpChanged(int index, String value) {
    final digits = _normalizeDigits(value);

    if (digits.length > 1) {
      _applyOtpValue(digits);
      return;
    }

    if (digits != value) {
      _controllers[index].text = digits;
      _controllers[index].selection = TextSelection.collapsed(
        offset: digits.length,
      );
    }

    if (digits.length == 1 && index < _otpLength - 1) {
      _focusNodes[index + 1].requestFocus();
    } else if (digits.isEmpty && index > 0) {
      _focusNodes[index - 1].requestFocus();
    }
    setState(() {});
  }

  void _applyOtpValue(String rawValue) {
    final normalized = _normalizeDigits(rawValue);
    final digits = normalized.substring(
      0,
      normalized.length.clamp(0, _otpLength).toInt(),
    );

    for (var i = 0; i < _otpLength; i++) {
      _controllers[i].text = i < digits.length ? digits[i] : '';
    }

    final focusIndex = digits.length >= _otpLength
        ? _otpLength - 1
        : digits.length.clamp(0, _otpLength - 1).toInt();
    _focusNodes[focusIndex].requestFocus();
    setState(() {});
  }

  String _normalizeDigits(String value) {
    const digitMap = {
      'Ù ': '0',
      'Ù¡': '1',
      'Ù¢': '2',
      'Ù£': '3',
      'Ù¤': '4',
      'Ù¥': '5',
      'Ù¦': '6',
      'Ù§': '7',
      'Ù¨': '8',
      'Ù©': '9',
      'Û°': '0',
      'Û±': '1',
      'Û²': '2',
      'Û³': '3',
      'Û´': '4',
      'Ûµ': '5',
      'Û¶': '6',
      'Û·': '7',
      'Û¸': '8',
      'Û¹': '9',
    };

    return value
        .split('')
        .map((character) => digitMap[character] ?? character)
        .where((character) => RegExp(r'\d').hasMatch(character))
        .join();
  }

  Future<void> _onVerify() async {
    if (!_isComplete || _isLoading) return;
    setState(() => _isLoading = true);

    try {
      await _authService.verifyOtp(
        email: widget.email,
        otp: _otpValue,
      );

      if (!mounted) return;

      context.go('/login', extra: {'email': widget.email});
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(error, 'OTP verification failed'),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _onResend() async {
    if (_resendSeconds > 0 || _isLoading) return;
    setState(() => _isLoading = true);

    try {
      await _authService.resendOtp(widget.email);

      if (!mounted) return;
      setState(() => _resendSeconds = 60);
      _startResendTimer();
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(error, 'Could not resend OTP'),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final maskedEmail = _maskEmail(widget.email);
    const heading = 'Check your\nemail.';
    final subtext =
        'Enter the 6-digit code sent to $maskedEmail. It expires in 5 minutes. Check your spam folder too.';

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
              const Row(
                children: [
                  TpBackButton(),
                  Spacer(),
                  AuthHelpButton(),
                ],
              ),

              const SizedBox(height: AppSpacing.xl),

              // â”€â”€ Icon â”€â”€
              TrustPayLottie(
                variant: _isLoading
                    ? TrustPayAnimationVariant.loading
                    : TrustPayAnimationVariant.send,
                size: 72,
                semanticsLabel: 'OTP verification',
              ),

              const SizedBox(height: AppSpacing.lg),

              Text(heading, style: AppTextStyles.displayMedium),

              const SizedBox(height: AppSpacing.sm),

              Text(subtext, style: AppTextStyles.bodyL),

              const SizedBox(height: AppSpacing.xxl),

              // â”€â”€ OTP Input Boxes â”€â”€
              LayoutBuilder(
                builder: (context, constraints) {
                  const gap = 10.0;
                  final boxWidth =
                      ((constraints.maxWidth - (gap * (_otpLength - 1))) /
                              _otpLength)
                          .clamp(42.0, 56.0);

                  return Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_otpLength, (index) {
                      return Padding(
                        padding: EdgeInsets.only(
                          right: index == _otpLength - 1 ? 0 : gap,
                        ),
                        child: _OtpBox(
                          width: boxWidth,
                          controller: _controllers[index],
                          focusNode: _focusNodes[index],
                          onChanged: (v) => _onOtpChanged(index, v),
                        ),
                      );
                    }),
                  );
                },
              ),

              const SizedBox(height: AppSpacing.xl),

              // â”€â”€ Verify Button â”€â”€
              TpButton(
                label: 'Verify',
                isLoading: _isLoading,
                isDisabled: !_isComplete,
                onTap: _onVerify,
              ),

              const SizedBox(height: AppSpacing.xl),

              // â”€â”€ Resend Code â”€â”€
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    "Didn't receive a code? ",
                    style: AppTextStyles.bodyM,
                  ),
                  GestureDetector(
                    onTap: () => _onResend(),
                    child: Text(
                      _resendSeconds > 0
                          ? 'Resend in ${_resendSeconds ~/ 60}:${(_resendSeconds % 60).toString().padLeft(2, '0')}'
                          : 'Resend now',
                      style: AppTextStyles.bodyM.copyWith(
                        color: _resendSeconds > 0
                            ? AppColors.textHint
                            : AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _maskEmail(String email) {
    final parts = email.split('@');
    if (parts.length != 2 || parts.first.isEmpty) return 'your email address';
    return '${parts.first[0]}•••@${parts.last}';
  }
}

// â”€â”€â”€ SINGLE OTP INPUT BOX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _OtpBox extends StatelessWidget {
  final double width;
  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  const _OtpBox({
    required this.width,
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final hasValue = controller.text.isNotEmpty;
    final isFocused = focusNode.hasFocus;
    final borderColor =
        isFocused || hasValue ? AppColors.primary : AppColors.border;
    final fillColor =
        isFocused ? AppColors.surfaceVariant : AppColors.inputFill;

    return SizedBox(
      width: width,
      height: 58,
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        onChanged: onChanged,
        textAlign: TextAlign.center,
        textAlignVertical: TextAlignVertical.center,
        textDirection: TextDirection.ltr,
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.next,
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9Ù -Ù©Û°-Û¹]')),
        ],
        style: AppTextStyles.headingL.copyWith(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          color: AppColors.textPrimary,
          letterSpacing: 0,
        ),
        decoration: InputDecoration(
          counterText: '',
          filled: true,
          fillColor: fillColor,
          contentPadding: EdgeInsets.zero,
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: borderColor,
              width: hasValue ? 1.5 : 1,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: AppColors.primary,
              width: 2,
            ),
          ),
        ),
      ),
    );
  }
}
