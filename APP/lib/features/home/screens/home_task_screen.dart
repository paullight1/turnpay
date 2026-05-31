import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';

class HomeTaskScreen extends StatelessWidget {
  const HomeTaskScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const liveFeatures = [
      _FeatureItem(
        title: 'Fund wallet',
        subtitle: 'Card and bank funding',
        icon: Icons.add_card_rounded,
        route: AppRoutes.fund,
      ),
      _FeatureItem(
        title: 'Send money',
        subtitle: 'Move money to another user',
        icon: Icons.near_me_rounded,
        route: AppRoutes.send,
      ),
      _FeatureItem(
        title: 'Withdraw',
        subtitle: 'Send wallet funds to a bank',
        icon: Icons.account_balance_rounded,
        route: AppRoutes.withdraw,
      ),
      _FeatureItem(
        title: 'Exchange',
        subtitle: 'NGN and GHS conversion flow',
        icon: Icons.currency_exchange_rounded,
        route: AppRoutes.exchange,
      ),
      _FeatureItem(
        title: 'Airtime',
        subtitle: 'Top up phone lines',
        icon: Icons.phone_android_rounded,
        route: AppRoutes.airtime,
      ),
      _FeatureItem(
        title: 'Data',
        subtitle: 'Buy data bundles',
        icon: Icons.signal_cellular_alt_rounded,
        route: AppRoutes.data,
      ),
      _FeatureItem(
        title: 'Electricity',
        subtitle: 'Recharge prepaid meters',
        icon: Icons.bolt_rounded,
        route: AppRoutes.electricity,
      ),
      _FeatureItem(
        title: 'Virtual account',
        subtitle: 'Receive bank transfers',
        icon: Icons.account_balance_outlined,
        route: AppRoutes.virtualAccount,
      ),
      _FeatureItem(
        title: 'Wallets',
        subtitle: 'Manage active currencies',
        icon: Icons.account_balance_wallet_outlined,
        route: AppRoutes.wallets,
      ),
      _FeatureItem(
        title: 'History',
        subtitle: 'Review recent activity',
        icon: Icons.history_rounded,
        route: AppRoutes.activity,
      ),
    ];

    const comingSoon = [
      _FeatureItem(
        title: 'Get accounts',
        subtitle: 'Multi-country receiving accounts',
        icon: Icons.language_rounded,
      ),
      _FeatureItem(
        title: 'Virtual cards',
        subtitle: 'Create and freeze cards instantly',
        icon: Icons.credit_card_rounded,
      ),
      _FeatureItem(
        title: 'Book hotels',
        subtitle: 'Travel booking from your wallet',
        icon: Icons.hotel_rounded,
      ),
      _FeatureItem(
        title: 'Pay for flights',
        subtitle: 'Air travel checkout and receipts',
        icon: Icons.flight_takeoff_rounded,
      ),
      _FeatureItem(
        title: 'Betting wallet',
        subtitle: 'Fast pay-ins and payouts',
        icon: Icons.sports_esports_rounded,
      ),
      _FeatureItem(
        title: 'Gift cards',
        subtitle: 'Buy and redeem digital cards',
        icon: Icons.card_giftcard_rounded,
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              sliver: SliverList.list(
                children: [
                  Row(
                    children: [
                      _IconButton(
                        icon: Icons.arrow_back_ios_new_rounded,
                        onTap: () => context.pop(),
                      ),
                      const Spacer(),
                      const _StatusPill(label: 'Feature hub'),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceVariant,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: Icon(
                      Icons.apps_rounded,
                      color: AppColors.primary,
                      size: 26,
                    ),
                  ),
                  SizedBox(height: AppSpacing.lg),
                  Text('Explore features', style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Everything users can do now, plus the next actions already planned for this wallet.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Text('Available now', style: AppTextStyles.headingM),
                  SizedBox(height: AppSpacing.md),
                  const _FeatureGrid(items: liveFeatures),
                  SizedBox(height: AppSpacing.xl),
                  Text('Coming soon', style: AppTextStyles.headingM),
                  SizedBox(height: AppSpacing.xs),
                  Text(
                    'These remain visible so users know what the platform is growing into.',
                    style: AppTextStyles.bodyM,
                  ),
                  SizedBox(height: AppSpacing.md),
                  ...comingSoon.map(
                    (item) => _ComingSoonRow(item: item),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureGrid extends StatelessWidget {
  final List<_FeatureItem> items;

  const _FeatureGrid({required this.items});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: AppSpacing.sm,
        mainAxisSpacing: AppSpacing.sm,
        childAspectRatio: 1.18,
      ),
      itemBuilder: (context, index) {
        final item = items[index];
        return _FeatureCard(item: item);
      },
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final _FeatureItem item;

  const _FeatureCard({required this.item});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: item.route == null ? null : () => context.push(item.route!),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: AppColors.inputFill,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(item.icon, color: AppColors.primary, size: 22),
              ),
              const Spacer(),
              Text(item.title, style: AppTextStyles.labelL),
              SizedBox(height: 2),
              Text(
                item.subtitle,
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textSecondary,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComingSoonRow extends StatelessWidget {
  final _FeatureItem item;

  const _ComingSoonRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.inputFill,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(item.icon, color: AppColors.primary, size: 20),
          ),
          SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.title, style: AppTextStyles.labelL),
                SizedBox(height: 2),
                Text(item.subtitle, style: AppTextStyles.bodyS),
              ],
            ),
          ),
          SizedBox(width: AppSpacing.sm),
          const _StatusPill(label: 'Coming soon'),
        ],
      ),
    );
  }
}

class _FeatureItem {
  final String title;
  final String subtitle;
  final IconData icon;
  final String? route;

  const _FeatureItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    this.route,
  });
}

class _StatusPill extends StatelessWidget {
  final String label;

  const _StatusPill({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(label, style: AppTextStyles.labelS),
    );
  }
}

class _IconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _IconButton({
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: AppColors.textPrimary, size: 18),
        ),
      ),
    );
  }
}

