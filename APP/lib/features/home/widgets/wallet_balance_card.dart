import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';

/// Large wallet balance section.
/// Shows "Wallet Balance" label, huge amount in GHS, and eye toggle icon.
/// Matches reference: "$17,298.92 ðŸ‘" style.
class WalletBalanceCard extends StatelessWidget {
  final double balanceGHS;
  final bool visible;
  final VoidCallback onToggleVisibility;

  const WalletBalanceCard({
    super.key,
    required this.balanceGHS,
    required this.visible,
    required this.onToggleVisibility,
  });

  @override
  Widget build(BuildContext context) {
    final formatted = NumberFormat.currency(
      locale: 'en_GH',
      symbol: 'GHâ‚µ ',
      decimalDigits: 2,
    ).format(balanceGHS);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Wallet Balance',
          style: AppTextStyles.bodyM.copyWith(
            color: AppColors.textSecondary,
          ),
        ),
        SizedBox(height: AppSpacing.xs),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: visible
                  ? Text(
                      formatted,
                      style: AppTextStyles.displayLarge.copyWith(
                        fontSize: 36,
                        letterSpacing: -1.5,
                        fontWeight: FontWeight.w800,
                      ),
                      overflow: TextOverflow.ellipsis,
                    )
                  : Text(
                      'GHâ‚µ â€¢â€¢â€¢â€¢â€¢â€¢',
                      style: AppTextStyles.displayLarge.copyWith(
                        fontSize: 36,
                        letterSpacing: 4,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textSecondary,
                      ),
                    ),
            ),
            SizedBox(width: AppSpacing.sm),
            GestureDetector(
              onTap: onToggleVisibility,
              child: Icon(
                visible
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined,
                color: AppColors.textSecondary,
                size: 22,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

