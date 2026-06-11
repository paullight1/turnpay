import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';

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
        title: 'Airtime to cash',
        subtitle: 'Convert airtime into wallet balance',
        icon: Icons.swap_horiz_rounded,
        backgroundAsset: 'assets/images/onboarding_transfer.jpg',
        backgroundAlignment: Alignment.centerLeft,
      ),
      _FeatureItem(
        title: 'Virtual cards',
        subtitle: 'Create and freeze cards instantly',
        icon: Icons.credit_card_rounded,
        backgroundAsset: 'assets/images/onboarding_security.jpg',
        backgroundAlignment: Alignment.centerRight,
      ),
      _FeatureItem(
        title: 'Book hotels',
        subtitle: 'Travel booking from your wallet',
        icon: Icons.hotel_rounded,
        backgroundAsset: 'assets/images/onboarding_bills.jpg',
        backgroundAlignment: Alignment.center,
      ),
      _FeatureItem(
        title: 'Pay for flights',
        subtitle: 'Air travel checkout and receipts',
        icon: Icons.flight_takeoff_rounded,
        backgroundAsset: 'assets/images/onboarding_transfer.jpg',
        backgroundAlignment: Alignment.topCenter,
      ),
      _FeatureItem(
        title: 'Betting wallet',
        subtitle: 'Fast pay-ins and payouts',
        icon: Icons.sports_esports_rounded,
        backgroundAsset: 'assets/images/onboarding_security.jpg',
        backgroundAlignment: Alignment.bottomCenter,
      ),
      _FeatureItem(
        title: 'Gift cards',
        subtitle: 'Buy and redeem digital cards',
        icon: Icons.card_giftcard_rounded,
        backgroundAsset: 'assets/images/onboarding_bills.jpg',
        backgroundAlignment: Alignment.centerLeft,
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
                  TpPageHeader(
                    label: 'Feature hub',
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Text('Explore features', style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Everything users can do now, plus the next actions already planned for this wallet.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xl),
                  const _FeatureGrid(items: liveFeatures),
                  SizedBox(height: AppSpacing.xl),
                  Text('Coming soon', style: AppTextStyles.headingM),
                  SizedBox(height: AppSpacing.xs),
                  Text(
                    'These remain visible so users know what the platform is growing into.',
                    style: AppTextStyles.bodyM,
                  ),
                  SizedBox(height: AppSpacing.md),
                  ...comingSoon.asMap().entries.map(
                    (entry) => _ComingSoonCard(
                      item: entry.value,
                      index: entry.key,
                    ),
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
        crossAxisCount: 3,
        crossAxisSpacing: AppSpacing.sm,
        mainAxisSpacing: AppSpacing.sm,
        childAspectRatio: 0.82,
      ),
      itemBuilder: (context, index) {
        final item = items[index];
        return _FeatureCard(item: item, index: index);
      },
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final _FeatureItem item;
  final int index;

  const _FeatureCard({
    required this.item,
    required this.index,
  });

  @override
  Widget build(BuildContext context) {
    final color = _featureColor(index);

    return Material(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: item.route == null ? null : () => context.push(item.route!),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.sm),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: color.withValues(alpha: 0.22)),
                ),
                child: Icon(item.icon, color: color, size: 24),
              ),
              SizedBox(height: AppSpacing.sm),
              Text(
                item.title,
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w900,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Color _featureColor(int index) {
  final colors = [
    AppColors.primary,
    AppColors.success,
    AppColors.warning,
    const Color(0xFF2563EB),
    const Color(0xFF0EA5E9),
    const Color(0xFF7C3AED),
  ];

  return colors[index % colors.length];
}

class _ComingSoonCard extends StatelessWidget {
  final _FeatureItem item;
  final int index;

  const _ComingSoonCard({
    required this.item,
    required this.index,
  });

  @override
  Widget build(BuildContext context) {
    final accent = _featureColor(index);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: Opacity(
              opacity: 0.16,
              child: Image.asset(
                item.backgroundAsset ?? 'assets/images/onboarding_transfer.jpg',
                fit: BoxFit.cover,
                alignment: item.backgroundAlignment,
              ),
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppColors.surface.withValues(alpha: 0.92),
                    AppColors.surfaceVariant.withValues(alpha: 0.74),
                    accent.withValues(alpha: 0.08),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            top: AppSpacing.sm,
            right: AppSpacing.sm,
            child: _LockBadge(accent: accent),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: SizedBox(
              height: 118,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    item.title,
                    style: AppTextStyles.labelL.copyWith(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.subtitle,
                    style: AppTextStyles.bodyM.copyWith(
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ),
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
  final String? backgroundAsset;
  final Alignment backgroundAlignment;

  const _FeatureItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    this.route,
    this.backgroundAsset,
    this.backgroundAlignment = Alignment.center,
  });
}

class _LockBadge extends StatelessWidget {
  final Color accent;

  const _LockBadge({required this.accent});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: accent.withValues(alpha: 0.22)),
      ),
      child: Icon(
        Icons.lock_rounded,
        size: 16,
        color: accent,
      ),
    );
  }
}
