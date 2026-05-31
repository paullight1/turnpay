import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _homeDataService = HomeDataService();
  late Future<HomeDashboardData> _dashboardFuture;
  bool _showBalances = true;

  @override
  void initState() {
    super.initState();
    _dashboardFuture = _homeDataService.fetchDashboard();
  }

  void _toggleBalances() {
    HapticFeedback.selectionClick();
    setState(() => _showBalances = !_showBalances);
  }

  void _refreshDashboard() {
    setState(() {
      _dashboardFuture = _homeDataService.fetchDashboard();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<HomeDashboardData>(
          future: _dashboardFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const _HomeLoadingState();
            }

            if (snapshot.hasError || !snapshot.hasData) {
              return _HomeErrorState(
                message: authErrorMessage(
                  snapshot.error ?? 'Dashboard could not load',
                  'Dashboard could not load',
                ),
                onRetry: _refreshDashboard,
              );
            }

            final data = snapshot.data!;
            return RefreshIndicator(
              color: AppColors.primary,
              backgroundColor: AppColors.surface,
              onRefresh: () async => _refreshDashboard(),
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
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
                        StaggeredEntrance(
                          child: _HomeTopBar(user: data.user),
                        ),
                        SizedBox(height: AppSpacing.lg),
                        StaggeredEntrance(
                          delay: const Duration(milliseconds: 45),
                          child: _BalancePanel(
                            data: data,
                            showBalances: _showBalances,
                            onToggleBalances: _toggleBalances,
                          ),
                        ),
                        SizedBox(height: AppSpacing.md),
                        StaggeredEntrance(
                          delay: const Duration(milliseconds: 90),
                          child: _KycStatusBanner(status: data.user.kycStatus),
                        ),
                        SizedBox(height: AppSpacing.lg),
                        StaggeredEntrance(
                          delay: const Duration(milliseconds: 130),
                          child: _QuickActionsGrid(
                            kycStatus: data.user.kycStatus,
                            kycTier: data.user.kycTier,
                          ),
                        ),
                        SizedBox(height: AppSpacing.xl),
                        const _SectionTitle(
                          title: 'Wallets',
                          actionLabel: 'Manage',
                          route: AppRoutes.wallets,
                        ),
                        SizedBox(height: AppSpacing.md),
                        _WalletSummaryRow(
                          wallets: data.wallets,
                          showBalances: _showBalances,
                        ),
                        SizedBox(height: AppSpacing.xl),
                        const _SectionTitle(
                          title: 'Virtual account',
                          actionLabel: 'View',
                          route: AppRoutes.virtualAccount,
                        ),
                        SizedBox(height: AppSpacing.md),
                        _VirtualAccountPanel(
                          accounts: data.virtualAccounts,
                          kycStatus: data.user.kycStatus,
                          kycTier: data.user.kycTier,
                        ),
                        SizedBox(height: AppSpacing.xl),
                        const _SectionTitle(
                          title: 'Recent activity',
                          actionLabel: 'See all',
                          route: AppRoutes.activity,
                        ),
                        SizedBox(height: AppSpacing.md),
                        _ActivityList(
                          transactions: data.transactions,
                          kycStatus: data.user.kycStatus,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _HomeTopBar extends StatelessWidget {
  final HomeUser user;

  const _HomeTopBar({required this.user});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Stack(
          alignment: Alignment.center,
          children: [
            const TrustPayLottie(
              variant: TrustPayAnimationVariant.loading,
              size: 56,
              semanticsLabel: 'Home greeting',
            ),
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary,
              ),
              alignment: Alignment.center,
              child: Text(
                user.initials,
                style: AppTextStyles.headingM.copyWith(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Welcome back', style: AppTextStyles.bodyM),
              Text(
                user.displayName,
                style: AppTextStyles.headingM.copyWith(
                  fontWeight: FontWeight.w800,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        _IconButton(
          icon: Icons.notifications_none_rounded,
          tooltip: 'Notifications',
          onTap: () => context.push(AppRoutes.notifications),
        ),
      ],
    );
  }
}

class _BalancePanel extends StatelessWidget {
  final HomeDashboardData data;
  final bool showBalances;
  final VoidCallback onToggleBalances;

  const _BalancePanel({
    required this.data,
    required this.showBalances,
    required this.onToggleBalances,
  });

  @override
  Widget build(BuildContext context) {
    final ngn = data.walletFor('NGN')?.balance ?? 0;
    final ghs = data.walletFor('GHS')?.balance ?? 0;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Available balance',
                  style: AppTextStyles.bodyM,
                ),
              ),
              _PanelActionButton(
                icon: Icons.history_rounded,
                label: 'History',
                tooltip: 'Transaction history',
                onTap: () => context.push(AppRoutes.activity),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Flexible(
                child: AnimatedValueText(
                  value: showBalances ? _money('NGN', ngn) : 'NGN ******',
                  style: AppTextStyles.displayMedium.copyWith(
                    fontSize: 34,
                    letterSpacing: 0,
                  ),
                ),
              ),
              SizedBox(width: AppSpacing.sm),
              _IconButton(
                icon: showBalances
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined,
                tooltip: showBalances ? 'Hide balances' : 'Show balances',
                onTap: onToggleBalances,
                compact: true,
              ),
            ],
          ),
          SizedBox(height: AppSpacing.xs),
          AnimatedValueText(
            value: showBalances
                ? '${_money('GHS', ghs)} available'
                : 'GHS ****** available',
            style: AppTextStyles.bodyM,
          ),
          SizedBox(height: AppSpacing.md),
          _PanelActionButton(
            icon: Icons.add_rounded,
            label: 'Add Money',
            tooltip: 'Add money',
            onTap: () => context.push(AppRoutes.fund),
            emphasized: true,
          ),
        ],
      ),
    );
  }
}

class _PanelActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final String tooltip;
  final VoidCallback onTap;
  final bool emphasized;

  const _PanelActionButton({
    required this.icon,
    required this.label,
    required this.tooltip,
    required this.onTap,
    this.emphasized = false,
  });

  @override
  Widget build(BuildContext context) {
    final background =
        emphasized ? AppColors.primary : AppColors.surfaceVariant;
    final foreground =
        emphasized ? AppColors.textPrimary : AppColors.textSecondary;

    return Tooltip(
      message: tooltip,
      child: TapScale(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.full),
        pressedScale: 0.96,
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
          constraints: const BoxConstraints(minWidth: 34),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: foreground, size: 17),
              SizedBox(width: 4),
              Text(
                label,
                style: AppTextStyles.labelS.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KycStatusBanner extends StatelessWidget {
  final String status;

  const _KycStatusBanner({required this.status});

  @override
  Widget build(BuildContext context) {
    final isVerified = status.toUpperCase() == 'VERIFIED';
    final color = isVerified ? AppColors.success : AppColors.warning;
    final message = isVerified
        ? 'KYC verified. Withdrawals, higher limits, and virtual account access are enabled.'
        : 'Complete KYC to unlock higher limits, withdrawals, and virtual account access.';

    return TapScale(
      onTap: () => context.push(AppRoutes.kyc),
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          children: [
            Icon(
              isVerified
                  ? Icons.verified_user_rounded
                  : Icons.verified_user_outlined,
              color: color,
              size: 22,
            ),
            SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            SizedBox(width: AppSpacing.sm),
            Icon(
              Icons.chevron_right_rounded,
              color: color,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActionsGrid extends StatelessWidget {
  final String kycStatus;
  final String kycTier;

  const _QuickActionsGrid({
    required this.kycStatus,
    required this.kycTier,
  });

  @override
  Widget build(BuildContext context) {
    final needsKyc = kycStatus.toUpperCase() != 'VERIFIED';
    final needsVtuTier = needsKyc || !KycGatePolicy.isTier2OrHigher(kycTier);
    final vtuBadge = needsKyc
        ? 'KYC'
        : needsVtuTier
            ? 'Tier 2'
            : null;
    final actions = [
      const _ActionItem('Fund', Icons.add_card_rounded, AppRoutes.fund),
      _ActionItem(
        'Send',
        Icons.near_me_rounded,
        AppRoutes.send,
        badge: needsKyc ? 'KYC' : null,
      ),
      _ActionItem(
        'Withdraw',
        Icons.account_balance_rounded,
        AppRoutes.withdraw,
        badge: needsKyc ? 'KYC' : null,
      ),
      _ActionItem(
        'Exchange',
        Icons.currency_exchange_rounded,
        AppRoutes.exchange,
        badge: needsKyc ? 'KYC' : null,
      ),
      _ActionItem(
        'Airtime',
        Icons.phone_android_rounded,
        AppRoutes.airtime,
        badge: vtuBadge,
      ),
      _ActionItem(
        'Data',
        Icons.signal_cellular_alt_rounded,
        AppRoutes.data,
        badge: vtuBadge,
      ),
      _ActionItem(
        'Electricity',
        Icons.bolt_rounded,
        AppRoutes.electricity,
        badge: vtuBadge,
      ),
      const _ActionItem('More', Icons.more_horiz_rounded, AppRoutes.more),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: actions.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: AppSpacing.sm,
        mainAxisSpacing: AppSpacing.sm,
        childAspectRatio: 0.92,
      ),
      itemBuilder: (context, index) {
        final action = actions[index];
        return _QuickActionTile(
          action: action,
          kycStatus: kycStatus,
          kycTier: kycTier,
        );
      },
    );
  }
}

class _QuickActionTile extends StatelessWidget {
  final _ActionItem action;
  final String kycStatus;
  final String kycTier;

  const _QuickActionTile({
    required this.action,
    required this.kycStatus,
    required this.kycTier,
  });

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: () => _openAction(context),
      borderRadius: BorderRadius.circular(AppRadius.sm),
      pressedScale: 0.94,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: AppColors.border.withValues(alpha: 0.6)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                  child: Icon(action.icon, color: AppColors.primary, size: 22),
                ),
                if (action.badge != null)
                  Positioned(
                    right: -24,
                    top: -8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(AppRadius.full),
                        border: Border.all(
                          color: AppColors.warning.withValues(alpha: 0.45),
                        ),
                      ),
                      child: Text(
                        action.badge!,
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.warning,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            SizedBox(height: AppSpacing.sm),
            Text(
              action.label,
              style: AppTextStyles.labelS.copyWith(
                color: AppColors.textPrimary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openAction(BuildContext context) async {
    if (!KycGatePolicy.isBlocked(
      route: action.route,
      status: kycStatus,
      kycTier: kycTier,
    )) {
      context.push(action.route);
      return;
    }

    final goToKyc = await _showKycRequiredDialog(
      context,
      action.label,
      requiresTier2: KycGatePolicy.vtuRoutesRequiringTier2.contains(
        action.route,
      ),
    );
    if (goToKyc == true && context.mounted) {
      context.push(AppRoutes.kyc);
    }
  }
}

Future<bool?> _showKycRequiredDialog(
  BuildContext context,
  String actionLabel, {
  bool requiresTier2 = false,
}) {
  final requirement =
      requiresTier2 ? 'KYC verification and Tier 2' : 'KYC verification';
  final guidance = requiresTier2
      ? 'Complete or upgrade KYC to continue.'
      : 'Complete KYC to continue.';

  return showDialog<bool>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text(
          requiresTier2 ? 'KYC and Tier 2 required' : 'KYC required',
          style: AppTextStyles.headingM,
        ),
        content: Text(
          '$actionLabel requires $requirement. $guidance',
          style: AppTextStyles.bodyM,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(
              'Not now',
              style: AppTextStyles.labelM.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
            ),
            child: const Text('Complete KYC'),
          ),
        ],
      );
    },
  );
}

class _WalletSummaryRow extends StatelessWidget {
  final List<HomeWallet> wallets;
  final bool showBalances;

  const _WalletSummaryRow({
    required this.wallets,
    required this.showBalances,
  });

  @override
  Widget build(BuildContext context) {
    final visibleWallets = wallets.isEmpty
        ? const [
            HomeWallet(id: '', currency: 'NGN', balance: 0),
            HomeWallet(id: '', currency: 'GHS', balance: 0),
          ]
        : wallets;

    return Row(
      children: visibleWallets.take(2).map((wallet) {
        final isLast = wallet == visibleWallets.take(2).last;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: isLast ? 0 : AppSpacing.sm),
            child: _WalletCard(
              currency: wallet.currency,
              balance: showBalances ? _decimal(wallet.balance) : '******',
              accent: _walletAccent(wallet.currency),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _WalletCard extends StatelessWidget {
  final String currency;
  final String balance;
  final Color accent;

  const _WalletCard({
    required this.currency,
    required this.balance,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 118),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF223B68),
            Color(0xFF1E2A4B),
          ],
        ),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: const Color(0xFF30466F)),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -10,
            bottom: -14,
            child: Text(
              _currencyMark(currency),
              style: AppTextStyles.displayLarge.copyWith(
                color: AppColors.textPrimary.withValues(alpha: 0.05),
                fontSize: 54,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: accent,
                        shape: BoxShape.circle,
                      ),
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Text(currency, style: AppTextStyles.labelM),
                  ],
                ),
                SizedBox(height: AppSpacing.xl),
                Text(
                  '$currency $balance',
                  style: AppTextStyles.headingM.copyWith(letterSpacing: 0),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _currencyMark(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return 'NGN';
    case 'GHS':
      return 'GHS';
    default:
      return currency.toUpperCase();
  }
}

class _VirtualAccountPanel extends StatelessWidget {
  final List<HomeVirtualAccount> accounts;
  final String kycStatus;
  final String kycTier;

  const _VirtualAccountPanel({
    required this.accounts,
    required this.kycStatus,
    required this.kycTier,
  });

  @override
  Widget build(BuildContext context) {
    final activeAccount = accounts
        .where((account) {
          return account.status.toUpperCase() == 'ACTIVE';
        })
        .cast<HomeVirtualAccount?>()
        .firstOrNull;
    final firstAccount =
        activeAccount ?? accounts.cast<HomeVirtualAccount?>().firstOrNull;
    final hasAccount = firstAccount != null;
    final isVerified = kycStatus.toUpperCase() == 'VERIFIED';
    final title = hasAccount
        ? '${firstAccount.bankName} ${firstAccount.currency}'
        : isVerified
            ? 'Ready to provision'
            : 'Not provisioned yet';
    final detail = hasAccount
        ? '${firstAccount.accountName} - ${firstAccount.accountNumberMasked}'
        : isVerified
            ? 'Create a provider-assigned account to receive bank transfers.'
            : 'A partner bank account will appear here after KYC and provider setup.';

    return TapScale(
      onTap: () async {
        if (!KycGatePolicy.isBlocked(
          route: AppRoutes.virtualAccount,
          status: kycStatus,
          kycTier: kycTier,
        )) {
          context.push(AppRoutes.virtualAccount);
          return;
        }
        final goToKyc = await _showKycRequiredDialog(
          context,
          'Virtual account access',
        );
        if (goToKyc == true && context.mounted) {
          context.push(AppRoutes.kyc);
        }
      },
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.inputFill,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Center(
                child: TrustPayLottie(
                  variant: hasAccount
                      ? TrustPayAnimationVariant.success
                      : TrustPayAnimationVariant.loading,
                  size: 30,
                  repeat: !hasAccount,
                  semanticsLabel: title,
                ),
              ),
            ),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTextStyles.labelM),
                  SizedBox(height: 2),
                  Text(
                    detail,
                    style: AppTextStyles.bodyS,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            SizedBox(width: AppSpacing.sm),
            Icon(
              Icons.chevron_right_rounded,
              color: AppColors.textHint,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityList extends StatelessWidget {
  final List<HomeTransaction> transactions;
  final String kycStatus;

  const _ActivityList({
    required this.transactions,
    required this.kycStatus,
  });

  @override
  Widget build(BuildContext context) {
    final items = transactions.isEmpty
        ? [
            _ActivityItem(
              title: 'Wallets are live',
              detail: 'Balances are loaded from your backend account.',
              icon: Icons.account_balance_wallet_outlined,
              color: AppColors.success,
              route: AppRoutes.wallets,
            ),
            if (kycStatus.toUpperCase() != 'VERIFIED')
              _ActivityItem(
                title: 'KYC pending',
                detail: 'Submit identity details before withdrawals',
                icon: Icons.assignment_ind_outlined,
                color: AppColors.warning,
                route: AppRoutes.kyc,
              ),
            _ActivityItem(
              title: 'No transactions yet',
              detail: 'Fund your wallet to start moving money',
              icon: Icons.history_rounded,
              color: AppColors.textSecondary,
              route: AppRoutes.activity,
            ),
          ]
        : transactions.map(_activityFromTransaction).toList();

    return Column(
      children: [
        if (transactions.isEmpty) ...[
          const TrustPayAnimatedState(
            variant: TrustPayAnimationVariant.send,
            title: 'Ready for your first transfer',
            detail:
                'Fund your wallet or complete KYC, then recent activity will appear here.',
            animationSize: 72,
          ),
          SizedBox(height: AppSpacing.md),
        ],
        ...items.map((item) => _ActivityRow(item: item)),
      ],
    );
  }
}

class _ActivityRow extends StatelessWidget {
  final _ActivityItem item;

  const _ActivityRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: TapScale(
        onTap: () => context.push(item.route),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Row(
            children: [
              Icon(item.icon, color: item.color, size: 22),
              SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.title, style: AppTextStyles.labelM),
                    SizedBox(height: 2),
                    Text(item.detail, style: AppTextStyles.bodyS),
                  ],
                ),
              ),
              SizedBox(width: AppSpacing.sm),
              Icon(
                Icons.chevron_right_rounded,
                color: AppColors.textHint,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  final String actionLabel;
  final String route;

  const _SectionTitle({
    required this.title,
    required this.actionLabel,
    required this.route,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(title, style: AppTextStyles.headingM),
        ),
        TapScale(
          onTap: () => context.push(route),
          borderRadius: BorderRadius.circular(AppRadius.full),
          pressedScale: 0.96,
          child: Text(
            actionLabel,
            style: AppTextStyles.labelM.copyWith(color: AppColors.primary),
          ),
        ),
      ],
    );
  }
}

class _IconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool compact;

  const _IconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final size = compact ? 36.0 : 44.0;

    return Tooltip(
      message: tooltip,
      child: TapScale(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        pressedScale: 0.94,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Icon(icon, color: AppColors.textPrimary, size: 20),
        ),
      ),
    );
  }
}

class _ActionItem {
  final String label;
  final IconData icon;
  final String route;
  final String? badge;

  const _ActionItem(this.label, this.icon, this.route, {this.badge});
}

class _ActivityItem {
  final String title;
  final String detail;
  final IconData icon;
  final Color color;
  final String route;

  const _ActivityItem({
    required this.title,
    required this.detail,
    required this.icon,
    required this.color,
    required this.route,
  });
}

class _HomeLoadingState extends StatelessWidget {
  const _HomeLoadingState();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xxl,
      ),
      children: [
        const TrustPayAnimatedState(
          variant: TrustPayAnimationVariant.loading,
          title: 'Loading dashboard',
          detail: 'Fetching balances, account status, and recent activity.',
          animationSize: 72,
        ),
        SizedBox(height: AppSpacing.lg),
        Row(
          children: [
            ShimmerBlock(
              width: 44,
              height: 44,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            SizedBox(width: AppSpacing.md),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ShimmerBlock(width: 96, height: 12),
                  SizedBox(height: AppSpacing.sm),
                  ShimmerBlock(width: 154, height: 18),
                ],
              ),
            ),
            ShimmerBlock(
              width: 44,
              height: 44,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
          ],
        ),
        SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 188,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        SizedBox(height: AppSpacing.md),
        ShimmerBlock(
          width: double.infinity,
          height: 72,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        SizedBox(height: AppSpacing.lg),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: 8,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4,
            crossAxisSpacing: AppSpacing.sm,
            mainAxisSpacing: AppSpacing.sm,
            childAspectRatio: 0.92,
          ),
          itemBuilder: (context, index) => ShimmerBlock(
            width: double.infinity,
            height: double.infinity,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
        ),
        SizedBox(height: AppSpacing.xl),
        Row(
          children: [
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 118,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            SizedBox(width: AppSpacing.sm),
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 118,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
          ],
        ),
        SizedBox(height: AppSpacing.xl),
        ShimmerBlock(
          width: double.infinity,
          height: 76,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
      ],
    );
  }
}

class _HomeErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _HomeErrorState({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Center(
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.cloud_off_rounded,
                color: AppColors.primary,
                size: 36,
              ),
              SizedBox(height: AppSpacing.md),
              Text(
                message,
                style: AppTextStyles.bodyM.copyWith(
                  color: AppColors.textPrimary,
                ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: AppSpacing.lg),
              FilledButton(
                onPressed: onRetry,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.textPrimary,
                ),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

_ActivityItem _activityFromTransaction(HomeTransaction transaction) {
  final type = transaction.type.replaceAll('_', ' ').toLowerCase();
  final title = '${_titleCase(type)} ${transaction.status.toLowerCase()}';
  final amount = _money(transaction.currency, transaction.amount);
  final date = transaction.createdAt == null
      ? 'recently'
      : DateFormat('MMM d, HH:mm').format(transaction.createdAt!.toLocal());

  return _ActivityItem(
    title: title,
    detail: '$amount - $date',
    icon: _transactionIcon(transaction.type),
    color: _transactionColor(transaction.status),
    route: AppRoutes.activity,
  );
}

IconData _transactionIcon(String type) {
  switch (type.toUpperCase()) {
    case 'FUND':
      return Icons.add_card_rounded;
    case 'WITHDRAW':
      return Icons.account_balance_rounded;
    case 'TRANSFER':
      return Icons.near_me_rounded;
    case 'EXCHANGE':
      return Icons.currency_exchange_rounded;
    case 'AIRTIME':
    case 'BILL':
      return Icons.receipt_long_rounded;
    default:
      return Icons.history_rounded;
  }
}

Color _transactionColor(String status) {
  switch (status.toUpperCase()) {
    case 'SUCCESS':
      return AppColors.success;
    case 'FAILED':
    case 'REVERSED':
      return AppColors.error;
    case 'PENDING':
    default:
      return AppColors.warning;
  }
}

String _money(String currency, double amount) {
  return '$currency ${_decimal(amount)}';
}

String _decimal(double amount) {
  return NumberFormat('#,##0.00').format(amount);
}

Color _walletAccent(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return AppColors.success;
    case 'GHS':
      return AppColors.primaryLight;
    default:
      return AppColors.textSecondary;
  }
}

String _titleCase(String value) {
  if (value.isEmpty) return value;
  return value
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}
