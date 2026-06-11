import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class TpCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final BorderRadius? borderRadius;
  final Color? color;
  final Color? borderColor;
  final List<BoxShadow>? boxShadow;
  final EdgeInsetsGeometry? margin;

  const TpCard({
    super.key,
    required this.child,
    this.padding,
    this.borderRadius,
    this.color,
    this.borderColor,
    this.boxShadow,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: margin,
      padding: padding ?? const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: color ?? AppColors.surface,
        borderRadius: borderRadius ?? BorderRadius.circular(AppRadius.md),
        border: Border.all(color: borderColor ?? AppColors.border),
        boxShadow: boxShadow ??
            [
              BoxShadow(
                color: AppColors.overlayLight,
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
      ),
      child: child,
    );
  }
}

class TpCardVariant extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;

  const TpCardVariant({
    super.key,
    required this.child,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}
