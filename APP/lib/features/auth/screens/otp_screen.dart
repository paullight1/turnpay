import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../widgets/tp_button.dart';

/// OTP Verification screen — 6-digit split input boxes.
/// Used for both phone verification on signup and password reset.
class OtpScreen extends StatefulWidget {
  final String phone;
  final String purpose; // 'verify' | 'reset'

  const OtpScreen({
    super.key,
    required this.phone,
    required this.purpose,
  });

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final int _otpLength = 6;
  final List<TextEditingController> _controllers = [];
  final List<FocusNode> _focusNodes = [];
  bool _isLoading = false;
  int _resendSeconds = 30;

  @override
  void initState() {
    super.initState();
    for (int i = 0; i < _otpLength; i++) {
      _controllers.add(TextEditingController());
      _focusNodes.add(FocusNode());
    }
    _startResendTimer();
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  void _startResendTimer() {
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      if (_resendSeconds > 0) {
        setState(() => _resendSeconds--);
        return true;
      }
      return false;
    });
  }

  String get _otpValue =>
      _controllers.map((c) => c.text).join();

  bool get _isComplete => _otpValue.length == _otpLength;

  void _onOtpChanged(int index, String value) {
    if (value.length == 1 && index < _otpLength - 1) {
      _focusNodes[index + 1].requestFocus();
    } else if (value.isEmpty && index > 0) {
      _focusNodes[index - 1].requestFocus();
    }
    setState(() {});
  }

  Future<void> _onVerify() async {
    if (!_isComplete) return;
    setState(() => _isLoading = true);
    // TODO: Call OTP verification service
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) {
      setState(() => _isLoading = false);
      if (widget.purpose == 'verify') {
        context.go('/home');
      } else {
        context.go('/login');
      }
    }
  }

  void _onResend() {
    if (_resendSeconds > 0) return;
    setState(() => _resendSeconds = 30);
    _startResendTimer();
    // TODO: Call resend OTP service
  }

  @override
  Widget build(BuildContext context) {
    final maskedPhone = _maskPhone(widget.phone);
    final heading = widget.purpose == 'reset'
        ? 'Check your\nphone.'
        : 'Verify your\nnumber.';
    final subtext =
        'We sent a 6-digit code to $maskedPhone. It expires in 10 minutes.';

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
                  Icons.chat_bubble_outline_rounded,
                  color: AppColors.primary,
                  size: 26,
                ),
              ),

              const SizedBox(height: AppSpacing.lg),

              Text(heading, style: AppTextStyles.displayMedium),

              const SizedBox(height: AppSpacing.sm),

              Text(subtext, style: AppTextStyles.bodyL),

              const SizedBox(height: AppSpacing.xxl),

              // ── OTP Input Boxes ──
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: List.generate(_otpLength, (index) {
                  return _OtpBox(
                    controller: _controllers[index],
                    focusNode: _focusNodes[index],
                    onChanged: (v) => _onOtpChanged(index, v),
                  );
                }),
              ),

              const SizedBox(height: AppSpacing.xl),

              // ── Verify Button ──
              TpButton(
                label: 'Verify',
                isLoading: _isLoading,
                isDisabled: !_isComplete,
                onTap: _onVerify,
              ),

              const SizedBox(height: AppSpacing.xl),

              // ── Resend Code ──
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    "Didn't receive a code? ",
                    style: AppTextStyles.bodyM,
                  ),
                  GestureDetector(
                    onTap: _onResend,
                    child: Text(
                      _resendSeconds > 0
                          ? 'Resend in 0:${_resendSeconds.toString().padLeft(2, '0')}'
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

  String _maskPhone(String phone) {
    if (phone.length < 5) return phone;
    final visible = phone.substring(phone.length - 4);
    final masked = '●●●● ●●●● ';
    return '$masked$visible';
  }
}

// ─── SINGLE OTP INPUT BOX ─────────────────────────────────────────────────────
class _OtpBox extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  const _OtpBox({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 48,
      height: 60,
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        onChanged: onChanged,
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 1,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        style: AppTextStyles.headingL.copyWith(fontSize: 24),
        decoration: InputDecoration(
          counterText: '',
          fillColor: focusNode.hasFocus
              ? AppColors.surfaceVariant
              : AppColors.inputFill,
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: BorderSide(
              color: controller.text.isNotEmpty
                  ? AppColors.primary
                  : AppColors.border,
              width: 1.5,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: const BorderSide(
              color: AppColors.primary,
              width: 2,
            ),
          ),
        ),
      ),
    );
  }
}
