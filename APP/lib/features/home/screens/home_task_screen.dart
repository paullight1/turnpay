import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';

class HomeTaskScreen extends StatelessWidget {
  const HomeTaskScreen({super.key, this.embedded = false});

  final bool embedded;

  static const _primaryFeatures = [
    _FeatureItem(
      slug: 'fund-wallet',
      title: 'Fund wallet',
      subtitle: 'Add money securely',
      iconAsset: 'assets/icons/feature-fund-wallet.svg',
      route: AppRoutes.fund,
    ),
    _FeatureItem(
      slug: 'send-money',
      title: 'Send money',
      subtitle: 'Transfer to another user',
      iconAsset: 'assets/icons/feature-send-money.svg',
      route: AppRoutes.send,
    ),
    _FeatureItem(
      slug: 'withdraw',
      title: 'Withdraw',
      subtitle: 'Send funds to your bank',
      iconAsset: 'assets/icons/feature-withdraw.svg',
      route: AppRoutes.withdraw,
    ),
    _FeatureItem(
      slug: 'airtime',
      title: 'Airtime',
      subtitle: 'Top up any phone line',
      iconAsset: 'assets/icons/feature-airtime.svg',
      route: AppRoutes.airtime,
    ),
    _FeatureItem(
      slug: 'data',
      title: 'Data',
      subtitle: 'Buy mobile data bundles',
      iconAsset: 'assets/icons/feature-data.svg',
      route: AppRoutes.data,
    ),
    _FeatureItem(
      slug: 'cable-tv',
      title: 'Cable TV',
      subtitle: 'DStv, GOtv and StarTimes',
      iconAsset: 'assets/icons/feature-cable-tv.svg',
      route: AppRoutes.cable,
    ),
    _FeatureItem(
      slug: 'electricity',
      title: 'Electricity',
      subtitle: 'Recharge prepaid meters',
      iconAsset: 'assets/icons/feature-electricity.svg',
      route: AppRoutes.electricity,
    ),
    _FeatureItem(
      slug: 'wallets',
      title: 'Wallets',
      subtitle: 'Manage your currencies',
      iconAsset: 'assets/icons/feature-wallets.svg',
      route: AppRoutes.wallets,
    ),
  ];

  static const _comingSoon = [
    _FeatureItem(
      slug: 'airtime-cash',
      title: 'Airtime to cash',
      subtitle: 'Turn unused airtime into wallet funds in a few taps.',
      iconAsset: 'assets/icons/feature-airtime-cash.svg',
      backgroundAsset: 'assets/images/feature_cards/airtime-to-cash.png',
    ),
    _FeatureItem(
      slug: 'virtual-cards',
      title: 'Virtual cards',
      subtitle:
          'Pay online securely with instant cards you can freeze anytime.',
      iconAsset: 'assets/icons/feature-virtual-cards.svg',
      backgroundAsset: 'assets/images/feature_cards/virtual-cards.png',
    ),
    _FeatureItem(
      slug: 'book-hotels',
      title: 'Book hotels',
      subtitle:
          'Reserve stays with your wallet and keep every booking in one place.',
      iconAsset: 'assets/icons/feature-hotels.svg',
      backgroundAsset: 'assets/images/feature_cards/book-hotels.png',
    ),
    _FeatureItem(
      slug: 'pay-flights',
      title: 'Pay for flights',
      subtitle:
          'Book flights in seconds with clear receipts and wallet control.',
      iconAsset: 'assets/icons/feature-flights.svg',
      backgroundAsset: 'assets/images/feature_cards/pay-flights.png',
    ),
    _FeatureItem(
      slug: 'betting-wallet',
      title: 'Betting wallet',
      subtitle: 'Move funds in and out with safer, simpler controls.',
      iconAsset: 'assets/icons/feature-betting.svg',
      backgroundAsset: 'assets/images/feature_cards/betting-wallet.png',
    ),
    _FeatureItem(
      slug: 'gift-cards',
      title: 'Gift cards',
      subtitle: 'Buy digital gift cards for brands and special moments.',
      iconAsset: 'assets/icons/feature-gift-cards.svg',
      backgroundAsset: 'assets/images/feature_cards/gift-cards.png',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.35;

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
                    label: embedded ? 'More' : 'Feature hub',
                    showBackButton: !embedded,
                    menuActions: [
                      TpPageMenuAction(
                        label: 'History',
                        icon: Icons.history_rounded,
                        onTap: () => context.push(AppRoutes.activity),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    'ALL SERVICES',
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.4,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'What can we help with?',
                    style: AppTextStyles.headingXL.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Choose a service to move money, pay bills or manage your accounts.',
                    style: AppTextStyles.bodyM,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _FeatureGrid(
                    items: [
                      for (final item in _primaryFeatures)
                        if (LaunchCapabilities.moneyOutEnabled ||
                            (item.slug != 'send-money' &&
                                item.slug != 'withdraw'))
                          item,
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text(
                    'Coming soon',
                    style: AppTextStyles.headingM.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'A preview of what we are building next.',
                    style: AppTextStyles.bodyM,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Column(
                    key: const ValueKey('coming-soon-list'),
                    children: [
                      for (var index = 0;
                          index < _comingSoon.length;
                          index++) ...[
                        _ComingSoonCard(
                          item: _comingSoon[index],
                          index: index,
                          largeText: largeText,
                        ),
                        if (index < _comingSoon.length - 1)
                          const SizedBox(height: AppSpacing.sm),
                      ],
                    ],
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
    return LayoutBuilder(
      builder: (context, constraints) {
        final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.35;
        final columns = constraints.maxWidth >= 330 && !largeText ? 3 : 2;
        final gridWidth =
            constraints.maxWidth > 382 ? 382.0 : constraints.maxWidth;
        const gap = AppSpacing.sm;
        final cardWidth = (gridWidth - (gap * (columns - 1))) / columns;
        return Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: gridWidth,
            child: Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (var index = 0; index < items.length; index++)
                  SizedBox(
                    width: cardWidth,
                    child: _FeatureCard(
                      item: items[index],
                      index: index,
                      compact: columns == 3,
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final _FeatureItem item;
  final int index;
  final bool compact;

  const _FeatureCard({
    required this.item,
    required this.index,
    required this.compact,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final accent = _featureColor(index);
    final icon = _FeatureIcon(
      id: item.slug,
      asset: item.iconAsset,
      color: accent,
      size: 44,
    );
    final cardHeight = compact ? 100.0 : 116.0;

    return Semantics(
      button: true,
      label: '${item.title}. ${item.subtitle}',
      child: Material(
        key: ValueKey('feature-card-${item.slug}'),
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.md),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => context.push(item.route!),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: cardHeight),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  icon,
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    item.title,
                    style: AppTextStyles.labelM.copyWith(
                      fontWeight: FontWeight.w900,
                      height: 1.1,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FeatureIcon extends StatelessWidget {
  final String id;
  final String asset;
  final Color color;
  final double size;

  const _FeatureIcon({
    required this.id,
    required this.asset,
    required this.color,
    required this.size,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('feature-icon-box-$id'),
      width: size,
      height: size,
      padding: EdgeInsets.all(size <= 38 ? 9 : 11),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: SvgPicture.asset(
        asset,
        key: ValueKey('feature-icon-$asset'),
        colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
        excludeFromSemantics: true,
      ),
    );
  }
}

class _ComingSoonCard extends StatelessWidget {
  final _FeatureItem item;
  final int index;
  final bool largeText;

  const _ComingSoonCard({
    required this.item,
    required this.index,
    required this.largeText,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final accent = _comingSoonColor(index);
    final brightSurface = Color.lerp(accent, Colors.white, 0.72)!;

    return Semantics(
      button: true,
      label: '${item.title}. Preview this upcoming feature',
      onTap: () => context
          .push(AppRoutes.comingSoon.replaceFirst(':feature', item.slug)),
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => context.push(
            AppRoutes.comingSoon.replaceFirst(':feature', item.slug),
          ),
          child: Container(
            key: ValueKey('coming-soon-${item.slug}'),
            width: double.infinity,
            height: largeText ? 144 : 112,
            decoration: BoxDecoration(
              color: brightSurface,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(color: accent.withValues(alpha: 0.24)),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  item.backgroundAsset!,
                  key: ValueKey('coming-soon-artwork-${item.slug}'),
                  fit: BoxFit.cover,
                  alignment: Alignment.centerRight,
                  color: accent.withValues(alpha: 0.52),
                  colorBlendMode: BlendMode.screen,
                ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        brightSurface,
                        brightSurface.withValues(alpha: 0.94),
                        accent.withValues(alpha: 0.34),
                      ],
                      stops: const [0.12, 0.58, 1],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: 12,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(
                      widthFactor: 0.72,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.title,
                            style: AppTextStyles.labelL.copyWith(
                              color: const Color(0xFF101828),
                              fontWeight: FontWeight.w900,
                              height: 1.12,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            item.subtitle,
                            style: AppTextStyles.bodyS.copyWith(
                              color: const Color(0xFF344054),
                              fontWeight: FontWeight.w600,
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
          ),
        ),
      ),
    );
  }
}

/// A local preview only: opening an advert never starts a financial action.
class ComingSoonFeatureScreen extends StatelessWidget {
  const ComingSoonFeatureScreen({super.key, required this.slug});

  final String slug;

  static const _stories = <String, (String, List<String>)>{
    'airtime-cash': (
      'Give unused airtime a new purpose.',
      [
        'Convert eligible airtime into wallet funds',
        'Review conversion details before you decide',
        'Keep track of your conversions in one place'
      ],
    ),
    'virtual-cards': (
      'A little more control over online spending.',
      [
        'Create a card for online payments',
        'Manage your card from your wallet',
        'Freeze your card when you need to'
      ],
    ),
    'book-hotels': (
      'Your next stay, all in one place.',
      [
        'Explore stays for your next trip',
        'Review booking details before paying',
        'Keep your reservations together'
      ],
    ),
    'pay-flights': (
      'Make room for your next destination.',
      [
        'Explore flights for your journey',
        'Review fares and travel details',
        'Keep booking receipts close at hand'
      ],
    ),
    'betting-wallet': (
      'Wallet controls, brought together.',
      [
        'Manage supported wallet connections',
        'Review transfers before confirming',
        'Track wallet activity in one place'
      ],
    ),
    'gift-cards': (
      'Something thoughtful, sent digitally.',
      [
        'Explore gift cards from supported brands',
        'Choose a gift for the occasion',
        'Keep digital gift details together'
      ],
    ),
  };

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final index =
        HomeTaskScreen._comingSoon.indexWhere((item) => item.slug == slug);
    final item = index < 0 ? null : HomeTaskScreen._comingSoon[index];
    final story = _stories[slug];
    final accent = _comingSoonColor(index < 0 ? 0 : index);

    return Scaffold(
      key: ValueKey('feature-advert-$slug'),
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(label: item?.title ?? 'Feature preview'),
      bottomNavigationBar: item == null || story == null
          ? null
          : const _ComingSoonFeatureFooter(),
      body: SafeArea(
        top: false,
        bottom: false,
        child: SingleChildScrollView(
          key: const ValueKey('feature-advert-content'),
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item == null || story == null) ...[
                    Text('Feature unavailable', style: AppTextStyles.headingL),
                    const SizedBox(height: AppSpacing.sm),
                    Text('Return to More to explore upcoming features.',
                        style: AppTextStyles.bodyM),
                  ] else ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                      child: AspectRatio(
                        aspectRatio: 1.8,
                        child: Image.asset(
                          item.backgroundAsset!,
                          fit: BoxFit.cover,
                          excludeFromSemantics: true,
                          color: accent.withValues(alpha: 0.32),
                          colorBlendMode: BlendMode.screen,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text('IN THE WORKS',
                        style: AppTextStyles.caption.copyWith(
                            color: AppColors.primary,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: AppSpacing.sm),
                    Text(story.$1,
                        style: AppTextStyles.headingXL.copyWith(height: 1.15)),
                    const SizedBox(height: AppSpacing.md),
                    Text(item.subtitle, style: AppTextStyles.bodyM),
                    const SizedBox(height: AppSpacing.xl),
                    Text('What to expect', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.md),
                    for (final benefit in story.$2)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.check_circle_outline_rounded,
                                color: AppColors.primary, size: 22),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                                child:
                                    Text(benefit, style: AppTextStyles.bodyM)),
                          ],
                        ),
                      ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ComingSoonFeatureFooter extends StatelessWidget {
  const _ComingSoonFeatureFooter();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.background,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.sm, AppSpacing.md, AppSpacing.md),
          child: Align(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FilledButton(
                    key: const ValueKey('coming-soon-cta'),
                    onPressed: null,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 52),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 16),
                      disabledBackgroundColor:
                          AppColors.primary.withValues(alpha: 0.16),
                      disabledForegroundColor: AppColors.textPrimary,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.md)),
                    ),
                    child: const Text('Coming soon'),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'This feature is still being built. Availability may change before launch.',
                    style: AppTextStyles.bodyS,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FeatureItem {
  final String slug;
  final String title;
  final String subtitle;
  final String iconAsset;
  final String? route;
  final String? backgroundAsset;

  const _FeatureItem({
    required this.slug,
    required this.title,
    required this.subtitle,
    required this.iconAsset,
    this.route,
    this.backgroundAsset,
  });
}

Color _featureColor(int index) {
  final colors = [
    AppColors.primary,
    AppColors.success,
    AppColors.warning,
    const Color(0xFF2563EB),
  ];
  return colors[index % colors.length];
}

Color _comingSoonColor(int index) {
  const colors = [
    Color(0xFFFF7043),
    Color(0xFF10B981),
    Color(0xFFF59E0B),
    Color(0xFF3B82F6),
    Color(0xFF14B8A6),
    Color(0xFF8B5CF6),
  ];
  return colors[index % colors.length];
}
