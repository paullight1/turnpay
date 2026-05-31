import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import '../theme/app_theme.dart';

enum TrustPayAnimationVariant { loading, send, success }

class TrustPayLottie extends StatelessWidget {
  final TrustPayAnimationVariant variant;
  final double size;
  final bool? repeat;
  final String? semanticsLabel;

  const TrustPayLottie({
    super.key,
    required this.variant,
    this.size = 64,
    this.repeat,
    this.semanticsLabel,
  });

  String get _asset {
    switch (variant) {
      case TrustPayAnimationVariant.loading:
        return 'assets/animations/trustpay-loading.json';
      case TrustPayAnimationVariant.send:
        return 'assets/animations/trustpay-send.json';
      case TrustPayAnimationVariant.success:
        return 'assets/animations/trustpay-success.json';
    }
  }

  String get _label {
    switch (variant) {
      case TrustPayAnimationVariant.loading:
        return 'Loading';
      case TrustPayAnimationVariant.send:
        return 'Sending';
      case TrustPayAnimationVariant.success:
        return 'Complete';
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    if (reduceMotion) {
      return Semantics(
        label: semanticsLabel ?? _label,
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.border),
          ),
          child:
              Icon(_fallbackIcon, color: AppColors.primary, size: size * 0.4),
        ),
      );
    }

    return Semantics(
      label: semanticsLabel ?? _label,
      child: Lottie.asset(
        _asset,
        width: size,
        height: size,
        fit: BoxFit.contain,
        repeat: repeat ?? variant != TrustPayAnimationVariant.success,
      ),
    );
  }

  IconData get _fallbackIcon {
    switch (variant) {
      case TrustPayAnimationVariant.loading:
        return Icons.sync_rounded;
      case TrustPayAnimationVariant.send:
        return Icons.near_me_rounded;
      case TrustPayAnimationVariant.success:
        return Icons.check_circle_rounded;
    }
  }
}

class TrustPayAnimatedState extends StatelessWidget {
  final TrustPayAnimationVariant variant;
  final String title;
  final String detail;
  final double animationSize;
  final Widget? action;

  const TrustPayAnimatedState({
    super.key,
    required this.variant,
    required this.title,
    required this.detail,
    this.animationSize = 86,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TrustPayLottie(
            variant: variant,
            size: animationSize,
            repeat: variant != TrustPayAnimationVariant.success,
            semanticsLabel: title,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            title,
            style: AppTextStyles.headingM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            detail,
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          if (action != null) ...[
            const SizedBox(height: AppSpacing.md),
            action!,
          ],
        ],
      ),
    );
  }
}
