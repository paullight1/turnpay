import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';

/// Two large pill buttons: Send Money | Exchange.
/// Full-width coral pill buttons with icons and press/haptic feedback.
class QuickActionsRow extends StatelessWidget {
  final VoidCallback? onSend;
  final VoidCallback? onExchange;

  const QuickActionsRow({super.key, this.onSend, this.onExchange});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      children: [
        if (LaunchCapabilities.moneyOutEnabled) ...[
          Expanded(
            child: _QuickActionPill(
              label: 'Send',
              icon: Icons.send_rounded,
              onTap: onSend ?? () => context.push(AppRoutes.send),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
        ],
        Expanded(
          child: _QuickActionPill(
            label: 'Exchange',
            icon: Icons.currency_exchange_rounded,
            onTap: onExchange ?? () => context.push(AppRoutes.exchange),
          ),
        ),
      ],
    );
  }
}

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
    AppColors.watch(context);
    return TapScale(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.full),
      semanticLabel: label,
      child: Container(
        height: 56,
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(AppRadius.full),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withValues(alpha: 0.35),
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
                color: Colors.white.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 15),
            ),
            const SizedBox(width: AppSpacing.sm),
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
