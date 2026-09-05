import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/trustpay_lottie.dart';

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
    AppColors.watch(context);
    final formatted = NumberFormat.currency(
      locale: 'en_GH',
      symbol: 'GH₵ ',
      decimalDigits: 2,
    ).format(balanceGHS);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const TrustPayLottie(
              variant: TrustPayAnimationVariant.send,
              size: 22,
              semanticsLabel: 'Wallet balance',
            ),
            const SizedBox(width: AppSpacing.xs),
            Text(
              'Wallet Balance',
              style: AppTextStyles.bodyM.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
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
                      'GH₵ ••••••',
                      style: AppTextStyles.displayLarge.copyWith(
                        fontSize: 36,
                        letterSpacing: 4,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textSecondary,
                      ),
                    ),
            ),
            const SizedBox(width: AppSpacing.sm),
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
