import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

/// Horizontal scrolling row of wallet/card items.
/// Shows a "+" add button followed by gradient wallet cards for GHS and NGN.
/// Matches the reference design's horizontal card scroller.
class WalletCardsRow extends StatelessWidget {
  const WalletCardsRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.lg),
              child: Text(
                'Wallets',
                style: AppTextStyles.headingM,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 100,
          child: ListView(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            children: [
              // ── Add new wallet button ──
              GestureDetector(
                onTap: () {},
                child: Container(
                  width: 64,
                  height: 100,
                  margin: const EdgeInsets.only(right: AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border.all(
                      color: AppColors.border,
                      width: 1.5,
                    ),
                  ),
                  child: const Icon(
                    Icons.add_rounded,
                    color: AppColors.textSecondary,
                    size: 26,
                  ),
                ),
              ),

              // ── GHS Wallet Card ──
              _WalletCard(
                currency: 'GHS',
                flag: '🇬🇭',
                label: 'Ghana Cedi',
                balance: 17298.92,
                gradientColors: const [
                  Color(0xFF6B21A8),
                  Color(0xFF7C3AED),
                  Color(0xFF9333EA),
                ],
                lastFour: '4269',
              ),

              const SizedBox(width: AppSpacing.sm),

              // ── NGN Wallet Card ──
              _WalletCard(
                currency: 'NGN',
                flag: '🇳🇬',
                label: 'Naira',
                balance: 5240000,
                gradientColors: const [
                  Color(0xFF1E3A5F),
                  Color(0xFF2563EB),
                  Color(0xFF3B82F6),
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

// ─── INDIVIDUAL WALLET CARD ───────────────────────────────────────────────────
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
    final formatted = _formatBalance(balance, currency);

    return Container(
      width: 180,
      height: 100,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: gradientColors.last.withOpacity(0.35),
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
                  color: Colors.white.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: Colors.greenAccent,
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
