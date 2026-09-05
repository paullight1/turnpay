import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import 'tawk_service.dart';

class AuthHelpButton extends StatelessWidget {
  const AuthHelpButton({
    super.key,
    this.onDark = false,
    this.onTap,
  });

  final bool onDark;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final foreground = onDark ? Colors.white : AppColors.textPrimary;
    final border =
        onDark ? Colors.white.withValues(alpha: 0.26) : AppColors.border;
    final background = onDark
        ? Colors.black.withValues(alpha: 0.24)
        : AppColors.surface.withValues(alpha: 0.92);

    return Semantics(
      button: true,
      label: 'Get help',
      child: GestureDetector(
        onTap: onTap ?? () => openTawkChat(context),
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(AppRadius.full),
            border: Border.all(color: border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.support_agent_rounded,
                size: 16,
                color: foreground,
              ),
              const SizedBox(width: AppSpacing.xs),
              Text(
                'Get help',
                style: AppTextStyles.labelS.copyWith(color: foreground),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
