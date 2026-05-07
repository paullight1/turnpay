import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

// ─── TRANSACTION MODEL (mock) ─────────────────────────────────────────────────
class _Transaction {
  final String title;
  final String subtitle;
  final double amount;
  final bool isCredit;
  final String currency;
  final String time;
  final IconData icon;
  final Color iconColor;

  const _Transaction({
    required this.title,
    required this.subtitle,
    required this.amount,
    required this.isCredit,
    required this.currency,
    required this.time,
    required this.icon,
    required this.iconColor,
  });
}

final _mockTransactions = [
  const _Transaction(
    title: 'Money Transfer',
    subtitle: 'Sent to Kwame Asante',
    amount: 1200.00,
    isCredit: false,
    currency: 'GH₵',
    time: '09:41 AM',
    icon: Icons.send_rounded,
    iconColor: Color(0xFF7C3AED),
  ),
  const _Transaction(
    title: 'Airtime Top-up',
    subtitle: 'MTN • 080 4502 1193',
    amount: 50.00,
    isCredit: false,
    currency: 'GH₵',
    time: 'Yesterday',
    icon: Icons.phone_android_rounded,
    iconColor: Color(0xFFF59E0B),
  ),
  const _Transaction(
    title: 'Received Transfer',
    subtitle: 'From Emeka Eze',
    amount: 75000,
    isCredit: true,
    currency: '₦',
    time: '4 May',
    icon: Icons.arrow_downward_rounded,
    iconColor: Color(0xFF059669),
  ),
  const _Transaction(
    title: 'Electricity Bill',
    subtitle: 'NEPA • Meter 4802 6271',
    amount: 120.00,
    isCredit: false,
    currency: 'GH₵',
    time: '3 May',
    icon: Icons.bolt_rounded,
    iconColor: Color(0xFFE8472A),
  ),
];

// ─── RECENT TRANSACTIONS LIST ─────────────────────────────────────────────────
class RecentTransactionsList extends StatelessWidget {
  const RecentTransactionsList({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Recent Transactions', style: AppTextStyles.headingM),
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
        ..._mockTransactions.map((tx) => _TransactionRow(tx: tx)),
      ],
    );
  }
}

// ─── SINGLE TRANSACTION ROW ───────────────────────────────────────────────────
class _TransactionRow extends StatelessWidget {
  final _Transaction tx;
  const _TransactionRow({required this.tx});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Row(
        children: [
          // Icon Box
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: tx.iconColor.withOpacity(0.15),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(tx.icon, color: tx.iconColor, size: 20),
          ),
          const SizedBox(width: AppSpacing.md),

          // Title + Subtitle
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tx.title, style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(tx.subtitle, style: AppTextStyles.bodyS),
              ],
            ),
          ),

          // Amount + Time
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${tx.isCredit ? '+' : '-'}${tx.currency}${_fmt(tx.amount)}',
                style: AppTextStyles.labelM.copyWith(
                  color: tx.isCredit ? AppColors.success : AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(tx.time, style: AppTextStyles.bodyS),
            ],
          ),
        ],
      ),
    );
  }

  String _fmt(double amount) {
    if (amount >= 1000) {
      return '${(amount / 1000).toStringAsFixed(1)}K';
    }
    return amount.toStringAsFixed(2);
  }
}
