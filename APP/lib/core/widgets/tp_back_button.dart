import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../theme/app_theme.dart';

class TpBackButton extends StatelessWidget {
  final VoidCallback? onTap;
  final bool isDisabled;

  const TpBackButton({
    super.key,
    this.onTap,
    this.isDisabled = false,
  });

  @override
  Widget build(BuildContext context) {
    void handleTap() {
      if (onTap != null) {
        onTap!();
        return;
      }
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(AppRoutes.home);
      }
    }

    return GestureDetector(
      onTap: isDisabled ? null : handleTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 180),
        opacity: isDisabled ? 0.45 : 1,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.border),
          ),
          child: Icon(
            Icons.arrow_back_ios_new_rounded,
            color: AppColors.textPrimary,
            size: 18,
          ),
        ),
      ),
    );
  }
}
