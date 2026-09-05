import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/trustpay_lottie.dart';

/// Horizontal scrolling row of wallet/card items.
/// Shows a "+" add button followed by gradient wallet cards for GHS and NGN.
/// Matches the reference design's horizontal card scroller.
class WalletCardsRow extends StatelessWidget {
  const WalletCardsRow({super.key});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const TrustPayLottie(
              variant: TrustPayAnimationVariant.loading,
              size: 26,
              semanticsLabel: 'Wallets',
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(
              'Wallets',
              style: AppTextStyles.headingM,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 120,
          child: ListView(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            children: [
              // â”€â”€ Add new wallet button â”€â”€
              GestureDetector(
                onTap: () {},
                child: Container(
                  width: 64,
                  height: 120,
                  margin: const EdgeInsets.only(right: AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border.all(
                      color: AppColors.border,
                      width: 1.5,
                    ),
                  ),
                  child: const TrustPayLottie(
                    variant: TrustPayAnimationVariant.send,
                    size: 32,
                    semanticsLabel: 'Add wallet',
                  ),
                ),
              ),

              // â”€â”€ GHS Wallet Card â”€â”€
              _WalletCard(
                currency: 'GHS',
                flag: '🇬🇭',
                label: 'Ghana Cedi',
                balance: 17298.92,
                gradientColors: [
                  AppColors.primaryDark,
                  AppColors.primary,
                  AppColors.primaryLight,
                ],
                lastFour: '4269',
              ),

              const SizedBox(width: AppSpacing.sm),

              // â”€â”€ NGN Wallet Card â”€â”€
              _WalletCard(
                currency: 'NGN',
                flag: '🇳🇬',
                label: 'Naira',
                balance: 5240000,
                gradientColors: [
                  AppColors.primary,
                  AppColors.primaryLight,
                  AppColors.primaryLight,
                ],
                lastFour: '4258',
              ),

              const SizedBox(width: AppSpacing.lg),
            ],
          ),
        ),
      ],
    );
  }
}

// â”€â”€â”€ INDIVIDUAL WALLET CARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _WalletCard extends StatelessWidget {
  final String currency;
  final String flag;
  final String label;
  final double balance;
  final List<Color> gradientColors;
  final String lastFour;

  const _WalletCard({
    required this.currency,
    required this.flag,
    required this.label,
    required this.balance,
    required this.gradientColors,
    required this.lastFour,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final formatted = _formatBalance(balance, currency);

    return Container(
      width: 200,
      height: 120,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: gradientColors.last.withValues(alpha: 0.35),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '$flag  $currency',
                style: AppTextStyles.labelS.copyWith(color: Colors.white70),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: AppColors.success,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Active',
                      style: AppTextStyles.caption.copyWith(
                        color: Colors.white70,
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                formatted,
                style: AppTextStyles.headingM.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                '•••• •••• $lastFour',
                style: AppTextStyles.caption.copyWith(
                  color: Colors.white60,
                  letterSpacing: 2,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatBalance(double amount, String currency) {
    final symbol = currency == 'GHS' ? 'GH₵' : '₦';
    if (amount >= 1000000) {
      return '$symbol${(amount / 1000000).toStringAsFixed(2)}M';
    } else if (amount >= 1000) {
      return '$symbol${(amount / 1000).toStringAsFixed(1)}K';
    }
    return '$symbol${amount.toStringAsFixed(2)}';
  }
}
