import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

/// Superlist-inspired social auth button.
/// Dark surface with icon + label â€” used for Google / Apple sign-in.
class SocialAuthButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const SocialAuthButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 54,
        width: double.infinity,
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: AppColors.border, width: 1),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: AppColors.textPrimary, size: 22),
            const SizedBox(width: AppSpacing.sm),
            Text(label, style: AppTextStyles.labelM),
          ],
        ),
      ),
    );
  }
}
