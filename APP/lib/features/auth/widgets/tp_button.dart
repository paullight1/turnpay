import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/trustpay_lottie.dart';

/// Primary CTA button used across all auth screens.
/// Features coral fill, loading spinner, and disabled state.
class TpButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool isLoading;
  final bool isDisabled;
  final bool isOutlined; // For secondary ghost style

  const TpButton({
    super.key,
    required this.label,
    required this.onTap,
    this.isLoading = false,
    this.isDisabled = false,
    this.isOutlined = false,
  });

  @override
  Widget build(BuildContext context) {
    final effectiveDisabled = isDisabled || isLoading;

    return GestureDetector(
      onTap: effectiveDisabled
          ? null
          : () {
              Haptics.medium();
              onTap();
            },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 56,
        width: double.infinity,
        decoration: BoxDecoration(
          color: isOutlined
              ? Colors.transparent
              : effectiveDisabled
                  ? AppColors.primary.withValues(alpha: 0.35)
                  : AppColors.primary,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: isOutlined
              ? Border.all(color: AppColors.border, width: 1.5)
              : null,
          boxShadow: (!isOutlined && !effectiveDisabled)
              ? [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.3),
                    blurRadius: 20,
                    offset: const Offset(0, 6),
                  ),
                ]
              : null,
        ),
        child: Center(
          child: isLoading
              ? const TrustPayLottie(
                  variant: TrustPayAnimationVariant.loading,
                  size: 30,
                  semanticsLabel: 'Loading',
                )
              : Text(
                  label,
                  style: AppTextStyles.labelL.copyWith(
                    color: isOutlined
                        ? AppColors.textSecondary
                        : Colors.white,
                  ),
                ),
        ),
      ),
    );
  }
}
