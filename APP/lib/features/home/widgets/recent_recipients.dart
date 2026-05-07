import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
class _Recipient {
  final String name;
  final String initials;
  final Color avatarColor;
  final String shortDate;
  final double lastAmount;
  final String currency;

  const _Recipient({
    required this.name,
    required this.initials,
    required this.avatarColor,
    required this.shortDate,
    required this.lastAmount,
    required this.currency,
  });
}

final _mockRecipients = [
  const _Recipient(
    name: 'Kwame Asante',
    initials: 'KA',
    avatarColor: Color(0xFF7C3AED),
    shortDate: '5 May',
    lastAmount: 1200.00,
    currency: 'GH₵',
  ),
  const _Recipient(
    name: 'Fatima Bello',
    initials: 'FB',
    avatarColor: Color(0xFF2563EB),
    shortDate: '4 May',
    lastAmount: 50000,
    currency: '₦',
  ),
  const _Recipient(
    name: 'Ama Kofie',
    initials: 'AK',
    avatarColor: Color(0xFF059669),
    shortDate: '3 May',
    lastAmount: 340.00,
    currency: 'GH₵',
  ),
];

// ─── RECENT RECIPIENTS WIDGET ─────────────────────────────────────────────────
/// 2×2 grid of recent beneficiaries + "Add More" cell.
/// Matches the reference design exactly.
class RecentRecipients extends StatelessWidget {
  const RecentRecipients({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // ── Section Header ──
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Recipients', style: AppTextStyles.headingM),
            GestureDetector(
              onTap: () {},
              child: Text(
                'See all',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),

        const SizedBox(height: AppSpacing.md),

        // ── 2×2 Grid ──
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: AppSpacing.sm,
          mainAxisSpacing: AppSpacing.sm,
          childAspectRatio: 1.55,
          children: [
            ..._mockRecipients.map((r) => _RecipientCard(recipient: r)),
            _AddMoreCard(onTap: () {}),
          ],
        ),
      ],
    );
  }
}

// ─── INDIVIDUAL RECIPIENT CARD ────────────────────────────────────────────────
class _RecipientCard extends StatelessWidget {
  final _Recipient recipient;

  const _RecipientCard({required this.recipient});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Avatar circle
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: recipient.avatarColor,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                recipient.initials,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
          ),
          const Spacer(),
          Text(
            recipient.name,
            style: AppTextStyles.labelM.copyWith(fontSize: 13),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                recipient.shortDate,
                style: AppTextStyles.bodyS.copyWith(fontSize: 11),
              ),
              Text(
                '${recipient.currency}${recipient.lastAmount.toStringAsFixed(0)}',
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─── ADD MORE CARD ────────────────────────────────────────────────────────────
class _AddMoreCard extends StatelessWidget {
  final VoidCallback onTap;
  const _AddMoreCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(color: AppColors.border, width: 1.5),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.inputFill,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.border, width: 1.5),
              ),
              child: const Icon(
                Icons.add_rounded,
                color: AppColors.textSecondary,
                size: 20,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Add More',
              style: AppTextStyles.labelS.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
