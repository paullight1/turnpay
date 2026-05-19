import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

/// Two large pill buttons: Send Money | Exchange
/// Matches reference design: full-width coral pill buttons with icons.
class QuickActionsRow extends StatelessWidget {
  const QuickActionsRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // â”€â”€ Send Money â”€â”€
        Expanded(
          child: _QuickActionPill(
            label: 'Send',
            icon: Icons.send_rounded,
            onTap: () {},
          ),
        ),
        SizedBox(width: AppSpacing.md),

        // â”€â”€ Exchange â”€â”€
        Expanded(
          child: _QuickActionPill(
            label: 'Exchange',
            icon: Icons.currency_exchange_rounded,
            onTap: () {},
          ),
        ),
      ],
    );
  }
}

// â”€â”€â”€ INDIVIDUAL PILL BUTTON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _QuickActionPill extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const _QuickActionPill({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 56,
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(AppRadius.full),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withOpacity(0.35),
              blurRadius: 18,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 15),
            ),
            SizedBox(width: AppSpacing.sm),
            Text(
              label,
              style: AppTextStyles.labelL.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

