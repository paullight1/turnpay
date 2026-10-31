import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';

class HomeTaskScreen extends StatelessWidget {
  const HomeTaskScreen({super.key});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
        title: 'Cable TV',
        subtitle: 'Pay DStv, GOtv and StarTimes',
        icon: Icons.live_tv_rounded,
        route: AppRoutes.cable,
      ),
      _FeatureItem(
        title: 'Electricity',
        subtitle: 'Recharge prepaid meters',
        icon: Icons.bolt_rounded,
        route: AppRoutes.electricity,
      ),
      _FeatureItem(
        title: 'Paystack NGN account',
        subtitle: 'Receive NGN bank transfers',
        icon: Icons.account_balance_outlined,
        route: AppRoutes.virtualAccount,
      ),
      _FeatureItem(
        title: 'Wallets',
        subtitle: 'Manage active currencies',
        icon: Icons.account_balance_wallet_outlined,
        route: AppRoutes.wallets,
      ),
    ];

    const comingSoon = [
      _FeatureItem(
        title: 'Airtime to cash',
        subtitle: 'Turn unused airtime into wallet funds in a few taps.',
        icon: Icons.swap_horiz_rounded,
        backgroundAsset: 'assets/images/feature_cards/airtime-to-cash.png',
      ),
      _FeatureItem(
        title: 'Virtual cards',
        subtitle:
            'Pay online securely with instant cards you can freeze anytime.',
        icon: Icons.credit_card_rounded,
        backgroundAsset: 'assets/images/feature_cards/virtual-cards.png',
      ),
      _FeatureItem(
        title: 'Book hotels',
        subtitle:
            'Reserve stays with your wallet and keep every booking in one place.',
        icon: Icons.hotel_rounded,
        backgroundAsset: 'assets/images/feature_cards/book-hotels.png',
      ),
      _FeatureItem(
        title: 'Pay for flights',
        subtitle:
            'Book flights in seconds with clear receipts and wallet control.',
        icon: Icons.flight_takeoff_rounded,
        backgroundAsset: 'assets/images/feature_cards/pay-flights.png',
      ),
      _FeatureItem(
        title: 'Betting wallet',
        subtitle: 'Move funds in and out quickly with safer, simpler controls.',
        icon: Icons.sports_esports_rounded,
        backgroundAsset: 'assets/images/feature_cards/betting-wallet.png',
      ),
      _FeatureItem(
        title: 'Gift cards',
        subtitle:
            'Buy digital gift cards for the brands and moments you care about.',
        icon: Icons.card_giftcard_rounded,
        backgroundAsset: 'assets/images/feature_cards/gift-cards.png',
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
                  const TpPageHeader(
                    label: 'Feature hub',
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text('Explore features', style: AppTextStyles.displayMedium),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Move money, pay bills, and keep your everyday finances in one calm, secure wallet.',
                    style: AppTextStyles.bodyL,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  const _FeatureGrid(items: liveFeatures),
                  const SizedBox(height: AppSpacing.xl),
                  Text('Coming soon', style: AppTextStyles.headingM),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'From top-ups to travel and lifestyle spending, the next wave of TrustPay features is designed to keep more of life in one wallet.',
                    style: AppTextStyles.bodyM,
                  ),
                  const SizedBox(height: AppSpacing.md),
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
    AppColors.watch(context);
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: AppSpacing.xs,
        mainAxisSpacing: AppSpacing.xs,
        childAspectRatio: 0.94,
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
    AppColors.watch(context);
    final color = _featureColor(index);

    return Material(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: item.route == null ? null : () => context.push(item.route!),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xs),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: color.withValues(alpha: 0.22)),
                ),
                child: Icon(item.icon, color: color, size: 20),
              ),
              const SizedBox(height: 4),
              Text(
                item.title,
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  height: 1.0,
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
    AppColors.watch(context);
    final accent = _featureColor(index);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 28,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: Opacity(
              opacity: 0.56,
              child: Image.asset(
                item.backgroundAsset ??
                    'assets/images/feature_cards/airtime-to-cash.png',
                fit: BoxFit.cover,
                alignment: Alignment.center,
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
                    AppColors.background.withValues(alpha: 0.94),
                    AppColors.surface.withValues(alpha: 0.56),
                    accent.withValues(alpha: 0.20),
                  ],
                  stops: const [0, 0.52, 1],
                ),
              ),
            ),
          ),
          Positioned(
            top: AppSpacing.xs,
            right: AppSpacing.xs,
            child: _LockBadge(accent: accent),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              92,
              AppSpacing.md,
            ),
            child: SizedBox(
              height: 142,
              child: Align(
                alignment: Alignment.centerLeft,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'COMING SOON',
                      style: AppTextStyles.caption.copyWith(
                        color: accent,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      item.title,
                      style: AppTextStyles.labelL.copyWith(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                        height: 1.1,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      item.subtitle,
                      style: AppTextStyles.bodyM.copyWith(
                        color: AppColors.textPrimary.withValues(alpha: 0.78),
                        fontSize: 14,
                        height: 1.3,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
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

  const _FeatureItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    this.route,
    this.backgroundAsset,
  });
}

class _LockBadge extends StatelessWidget {
  final Color accent;

  const _LockBadge({required this.accent});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xs,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: accent.withValues(alpha: 0.22)),
      ),
      child: Icon(
        Icons.lock_rounded,
        size: 14,
        color: accent,
      ),
    );
  }
}
