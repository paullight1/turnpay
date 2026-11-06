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
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 22),
      label: Text(label, textAlign: TextAlign.center),
      style: OutlinedButton.styleFrom(
        backgroundColor: AppColors.surfaceVariant,
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.button)),
        textStyle: AppTextStyles.labelL.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}
