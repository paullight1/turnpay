import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/trustpay_lottie.dart';

/// Shared auth action with native focus, keyboard and accessibility behavior.
class TpButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool isLoading;
  final bool isDisabled;
  final bool isOutlined;
  final String? loadingLabel;

  const TpButton({
    super.key,
    required this.label,
    required this.onTap,
    this.isLoading = false,
    this.isDisabled = false,
    this.isOutlined = false,
    this.loadingLabel,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final effectiveDisabled = isDisabled || isLoading;
    final VoidCallback? activate = effectiveDisabled
        ? null
        : () {
            Haptics.medium();
            onTap();
          };
    final loadingContent = loadingLabel == null
        ? const TrustPayLottie(
            variant: TrustPayAnimationVariant.loading,
            size: 30,
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              ),
              const SizedBox(width: 12),
              Text(loadingLabel!, textAlign: TextAlign.center),
            ],
          );
    final content = isLoading
        ? Semantics(
            label: '${loadingLabel ?? label}, loading',
            liveRegion: true,
            child: ExcludeSemantics(child: loadingContent),
          )
        : Text(label, textAlign: TextAlign.center);
    const padding = EdgeInsets.symmetric(horizontal: 24, vertical: 16);
    const minimumSize = Size.fromHeight(56);
    final button = isOutlined
        ? OutlinedButton(
            onPressed: activate,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.textSecondary,
              side: BorderSide(color: AppColors.border, width: 1.5),
              shape: const StadiumBorder(),
              minimumSize: minimumSize,
              padding: padding,
              textStyle: AppTextStyles.labelL,
            ),
            child: content,
          )
        : FilledButton(
            onPressed: activate,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              disabledBackgroundColor:
                  AppColors.primary.withValues(alpha: 0.35),
              disabledForegroundColor: Colors.white,
              shape: const StadiumBorder(),
              minimumSize: minimumSize,
              padding: padding,
              textStyle: AppTextStyles.labelL,
            ),
            child: content,
          );
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.full),
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
      child: button,
    );
  }
}
