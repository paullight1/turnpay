import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/haptics.dart';
import 'micro_interactions.dart';
import 'tp_illustration.dart';

/// A consistent, theme-aware empty / error / success state built around the
/// hand-drawn [TpIllustration] set.
///
/// Use it for empty lists, network errors, "coming soon" placeholders and
/// end-of-flow confirmations so every zero-data surface feels intentional.
class TpEmptyState extends StatelessWidget {
  final TpIllustrationVariant variant;
  final String title;
  final String message;
  final String? primaryActionLabel;
  final VoidCallback? onPrimaryAction;
  final String? secondaryActionLabel;
  final VoidCallback? onSecondaryAction;
  final double illustrationSize;
  final bool compact;
  final Color? accent;

  const TpEmptyState({
    super.key,
    required this.variant,
    required this.title,
    required this.message,
    this.primaryActionLabel,
    this.onPrimaryAction,
    this.secondaryActionLabel,
    this.onSecondaryAction,
    this.illustrationSize = 168,
    this.compact = false,
    this.accent,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: SingleChildScrollView(
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: compact ? AppSpacing.md : AppSpacing.xl,
        ),
        child: StaggeredEntrance(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TpIllustration(
                variant: variant,
                size: compact ? illustrationSize * 0.72 : illustrationSize,
                accent: accent,
              ),
              SizedBox(height: compact ? AppSpacing.sm : AppSpacing.md),
              Text(
                title,
                style: AppTextStyles.headingM,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xs),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 320),
                child: Text(
                  message,
                  style: AppTextStyles.bodyM,
                  textAlign: TextAlign.center,
                ),
              ),
              if (primaryActionLabel != null && onPrimaryAction != null) ...[
                SizedBox(height: compact ? AppSpacing.md : AppSpacing.lg),
                FilledButton(
                  onPressed: () {
                    Haptics.medium();
                    onPrimaryAction!();
                  },
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(200, 52),
                  ),
                  child: Text(primaryActionLabel!),
                ),
              ],
              if (secondaryActionLabel != null &&
                  onSecondaryAction != null) ...[
                const SizedBox(height: AppSpacing.xs),
                TextButton(
                  onPressed: () {
                    Haptics.selection();
                    onSecondaryAction!();
                  },
                  child: Text(
                    secondaryActionLabel!,
                    style: AppTextStyles.link.copyWith(
                      decoration: TextDecoration.none,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
