import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

enum TpSnackbarType { info, success, error, warning }

void showTpSnackbar(
  BuildContext context,
  String message, {
  TpSnackbarType type = TpSnackbarType.info,
  Duration duration = const Duration(seconds: 3),
}) {
  final color = switch (type) {
    TpSnackbarType.success => AppColors.success,
    TpSnackbarType.error => AppColors.error,
    TpSnackbarType.warning => AppColors.warning,
    TpSnackbarType.info => AppColors.primary,
  };

  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Row(
        children: [
          Icon(
            _iconFor(type),
            color: Colors.white,
            size: 20,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.bodyM.copyWith(color: Colors.white),
            ),
          ),
        ],
      ),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        0,
        AppSpacing.lg,
        AppSpacing.lg + 76,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm + 2,
      ),
      duration: duration,
    ),
  );
}

IconData _iconFor(TpSnackbarType type) {
  switch (type) {
    case TpSnackbarType.success:
      return Icons.check_circle_rounded;
    case TpSnackbarType.error:
      return Icons.error_outline_rounded;
    case TpSnackbarType.warning:
      return Icons.warning_amber_rounded;
    case TpSnackbarType.info:
      return Icons.info_outline_rounded;
  }
}
