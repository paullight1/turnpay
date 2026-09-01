import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';

class HomeScreen extends StatefulWidget {
  final HomeDataService homeDataService;

  HomeScreen({
    super.key,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<HomeDashboardData> _dashboardFuture;
  bool _showBalances = true;

  @override
  void initState() {
    super.initState();
    _dashboardFuture = widget.homeDataService.fetchDashboard();
  }

  void _toggleBalances() {
    HapticFeedback.selectionClick();
    setState(() => _showBalances = !_showBalances);
  }

  void _refreshDashboard() {
    setState(() {
      _dashboardFuture = widget.homeDataService.fetchDashboard();
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
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.md,
                  AppSpacing.lg,
                  88,
                ),
                children: [
                  _HomeTopBar(user: data.user),
                  SizedBox(height: AppSpacing.md),
                  _BalancePanel(
                    data: data,
                    showBalances: _showBalances,
                    onToggleBalances: _toggleBalances,
                  ),
                  SizedBox(height: AppSpacing.lg),
                  const _QuickActionsGrid(),
                  SizedBox(height: AppSpacing.lg),
                  if (data.user.kycStatus.toUpperCase() == 'VERIFIED')
                    const _PromoBanner()
                  else
                    _KycStatusBanner(
                      status: data.user.kycStatus,
                    ),
                  if (data.beneficiaries.isNotEmpty) ...[
                    SizedBox(height: AppSpacing.lg),
                    _BeneficiaryStrip(
                      beneficiaries: data.beneficiaries,
                    ),
                  ],
                  SizedBox(height: AppSpacing.lg),
                  const _SectionTitle(
                    title: 'Other wallets',
                    actionLabel: 'Manage',
                    route: AppRoutes.wallets,
                  ),
                  SizedBox(height: AppSpacing.md),
                  _WalletSummaryRow(
                    wallets: data.wallets,
                    showBalances: _showBalances,
                  ),
                  SizedBox(height: AppSpacing.lg),
                  _RecentTransactionsSection(
                    transactions: data.transactions,
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
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.primary,
            border: Border.all(color: AppColors.surface, width: 3),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.25),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Text(
            user.initials,
            style: AppTextStyles.headingM.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_greeting(), style: AppTextStyles.bodyM),
              Text(
                _compactName(user.displayName),
                style: AppTextStyles.headingM.copyWith(
                  color: AppColors.textPrimary,
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

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
}

class _BalancePanel extends StatefulWidget {
  final HomeDashboardData data;
  final bool showBalances;
  final VoidCallback onToggleBalances;

  const _BalancePanel({
    // The key remains available for stable widget identity in parent rebuilds.
    // ignore: unused_element_parameter
    super.key,
    required this.data,
    required this.showBalances,
    required this.onToggleBalances,
  });

  @override
  State<_BalancePanel> createState() => _BalancePanelState();
}

class _BalancePanelState extends State<_BalancePanel> {
  late final ScrollController _scrollController;
  int _currentPage = 0;
  double _cardExtent = 1;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()
      ..addListener(_handleCarouselScroll);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_handleCarouselScroll)
      ..dispose();
    super.dispose();
  }

  void _handleCarouselScroll() {
    if (!_scrollController.hasClients || _cardExtent <= 0) return;
    final nextPage = (_scrollController.offset / _cardExtent)
        .round()
        .clamp(0, 1)
        .toInt();
    if (nextPage != _currentPage) {
      setState(() => _currentPage = nextPage);
    }
  }

  void _animateToPage(int page) {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      page * _cardExtent,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ngnBalance = widget.data.walletFor('NGN')?.balance ?? 0;
    final ghsBalance = widget.data.walletFor('GHS')?.balance ?? 0;
    final ngnAccount = _accountForCurrency(widget.data.virtualAccounts, 'NGN');
    final ghsAccount = _accountForCurrency(widget.data.virtualAccounts, 'GHS');
    final pageWidth = MediaQuery.sizeOf(context).width;
    final cardWidth = pageWidth * 0.8;
    _cardExtent = cardWidth + AppSpacing.sm;

    final cards = [
      _BalanceCardData(
        currency: 'NGN',
        balance: ngnBalance,
        account: ngnAccount,
        colors: [
          AppColors.primaryDark,
          AppColors.primary,
          AppColors.primaryLight,
        ],
      ),
      _BalanceCardData(
        currency: 'GHS',
        balance: ghsBalance,
        account: ghsAccount,
        colors: const [
          Color(0xFF0E7490),
          Color(0xFF0F766E),
          Color(0xFF34D399),
        ],
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 184,
          child: OverflowBox(
            alignment: Alignment.center,
            minWidth: pageWidth,
            maxWidth: pageWidth,
            child: ScrollConfiguration(
              behavior: const _CarouselScrollBehavior(),
              child: ListView.separated(
                controller: _scrollController,
                scrollDirection: Axis.horizontal,
                physics: const BouncingScrollPhysics(),
                padding: const EdgeInsets.only(
                  left: AppSpacing.md,
                  right: AppSpacing.md,
                ),
                itemCount: cards.length,
                separatorBuilder: (_, __) => const SizedBox(
                  width: AppSpacing.sm,
                ),
                itemBuilder: (context, index) {
                  final card = cards[index];
                  return SizedBox(
                    width: cardWidth,
                    child: _CurrencyBalanceCard(
                      data: card,
                      showBalances: widget.showBalances,
                      onToggleBalances: widget.onToggleBalances,
                      onSend: () => context.push(AppRoutes.send),
                      onReceive: () => context.push(AppRoutes.receiveMoney),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var index = 0; index < cards.length; index++) ...[
              GestureDetector(
                onTap: () => _animateToPage(index),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: index == _currentPage ? 20 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: index == _currentPage
                        ? AppColors.primary
                        : AppColors.border,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                ),
              ),
              if (index < cards.length - 1) const SizedBox(width: 6),
            ],
          ],
        ),
      ],
    );
  }
}

class _CarouselScrollBehavior extends MaterialScrollBehavior {
  const _CarouselScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.trackpad,
      };
}

class _BalanceCardData {
  final String currency;
  final double balance;
  final HomeVirtualAccount? account;
  final List<Color> colors;

  const _BalanceCardData({
    required this.currency,
    required this.balance,
    required this.account,
    required this.colors,
  });
}

class _CurrencyBalanceCard extends StatelessWidget {
  final _BalanceCardData data;
  final bool showBalances;
  final VoidCallback onToggleBalances;
  final VoidCallback onSend;
  final VoidCallback onReceive;

  const _CurrencyBalanceCard({
    required this.data,
    required this.showBalances,
    required this.onToggleBalances,
    required this.onSend,
    required this.onReceive,
  });

  @override
  Widget build(BuildContext context) {
    final visibleAmount = showBalances ? _walletCardAmount(data.balance) : '******';
    final accountNumber = data.account?.accountNumber.trim() ?? '';
    final accountChipLabel = accountNumber.isNotEmpty
        ? _formatAccountNumber(accountNumber)
        : 'Request account';
    final accountChip = Container(
      constraints: const BoxConstraints(maxWidth: 198, minHeight: 34),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.16),
        ),
      ),
      child: Text(
        accountChipLabel,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppTextStyles.labelS.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w900,
        ),
      ),
    );

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: data.colors.first.withValues(alpha: 0.24),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: data.colors,
                ),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.white.withValues(alpha: 0.12),
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.14),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              14,
              14,
              14,
              12,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: accountNumber.isEmpty
                            ? TapScale(
                                onTap: onReceive,
                                borderRadius:
                                    BorderRadius.circular(AppRadius.full),
                                child: accountChip,
                              )
                            : accountChip,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    TapScale(
                      onTap: onToggleBalances,
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.18),
                          ),
                        ),
                        child: Icon(
                          showBalances
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                          color: Colors.white.withValues(alpha: 0.92),
                          size: 18,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Available balance',
                  style: AppTextStyles.caption.copyWith(
                    color: Colors.white.withValues(alpha: 0.74),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      data.currency,
                      style: AppTextStyles.labelM.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Flexible(
                      child: AnimatedValueText(
                        value: visibleAmount,
                        style: AppTextStyles.displayMedium.copyWith(
                          color: Colors.white,
                          fontSize: 32,
                          height: 0.98,
                          letterSpacing: 0,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _BalanceCtaButton(
                        label: 'Send money',
                        icon: Icons.near_me_rounded,
                        onTap: onSend,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: _BalanceCtaButton(
                        label: 'Receive',
                        icon: Icons.call_received_rounded,
                        onTap: onReceive,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Retained for the next dashboard rollout; not mounted by the current layout.
// ignore: unused_element
class _VirtualAccountSection extends StatelessWidget {
  final HomeVirtualAccount? account;
  final bool showBalances;

  const _VirtualAccountSection({
    required this.account,
    required this.showBalances,
  });

  @override
  Widget build(BuildContext context) {
    final displayAccountNumber = account?.displayAccountNumber ?? '';
    final normalizedAccountNumber = displayAccountNumber.trim();

    if (account == null || normalizedAccountNumber.isEmpty) {
      return _NoVirtualAccountHomeCard(
        onTap: () => context.push(AppRoutes.receiveMoney),
      );
    }

    final activeAccount = account!;
    final accountNumber = showBalances
        ? _formatAccountNumber(normalizedAccountNumber)
        : '•••• •••• ••••';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: AppColors.primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Virtual account',
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      activeAccount.bankName,
                      style: AppTextStyles.bodyS.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: Text(
                  activeAccount.currency,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: Text(
                  accountNumber,
                  style: AppTextStyles.headingL.copyWith(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              TapScale(
                onTap: () {
                  Clipboard.setData(
                    ClipboardData(text: displayAccountNumber),
                  );
                  showTpSnackbar(
                    context,
                    'Virtual account copied',
                    type: TpSnackbarType.success,
                  );
                },
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Icon(
                    Icons.copy_rounded,
                    color: AppColors.textPrimary,
                    size: 18,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            activeAccount.accountName,
            style: AppTextStyles.bodyM.copyWith(
              color: AppColors.textSecondary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Share this account number to receive bank transfers directly into your TrustPay wallet.',
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _NoVirtualAccountHomeCard extends StatelessWidget {
  final VoidCallback onTap;

  const _NoVirtualAccountHomeCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.account_balance_outlined,
              color: AppColors.primary,
              size: 22,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'No virtual account yet',
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Request a virtual account to receive bank transfers directly into your TrustPay wallet.',
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          FilledButton(
            onPressed: onTap,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
            ),
            child: const Text('Request'),
          ),
        ],
      ),
    );
  }
}

class _BalanceCtaButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const _BalanceCtaButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      pressedScale: 0.97,
      child: Container(
        height: 38,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.16),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.24),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.white, size: 17),
            SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                label,
                style: AppTextStyles.labelS.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
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
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.32)),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.10),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isVerified
                    ? Icons.verified_user_rounded
                    : Icons.verified_user_outlined,
                color: color,
                size: 22,
              ),
            ),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                message,
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textPrimary,
                  height: 1.45,
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

class _PromoBanner extends StatelessWidget {
  const _PromoBanner();

  Future<void> _openPromo() async {
    final uri = Uri.parse('https://trustpay.xyz');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: _openPromo,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        constraints: const BoxConstraints(minHeight: 96),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: AppColors.primary.withValues(alpha: 0.22),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 18,
              offset: const Offset(0, 10),
            ),
          ],
          image: const DecorationImage(
            image: AssetImage('assets/images/onboarding_transfer.jpg'),
            fit: BoxFit.cover,
            alignment: Alignment.center,
          ),
        ),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                Colors.black.withValues(alpha: 0.62),
                Colors.black.withValues(alpha: 0.28),
                Colors.black.withValues(alpha: 0.12),
              ],
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Featured offer',
                      style: AppTextStyles.caption.copyWith(
                        color: Colors.white.withValues(alpha: 0.86),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Move between GHS and NGN faster',
                      style: AppTextStyles.labelM.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Tap to see the live TrustPay exchange experience.',
                      style: AppTextStyles.bodyS.copyWith(
                        color: Colors.white.withValues(alpha: 0.86),
                        height: 1.3,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Icon(
                Icons.arrow_forward_rounded,
                color: Colors.white.withValues(alpha: 0.92),
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickActionsGrid extends StatelessWidget {
  const _QuickActionsGrid();

  @override
  Widget build(BuildContext context) {
    final actions = [
      const _ActionItem(
        'Airtime',
        Icons.signal_cellular_alt_rounded,
        AppRoutes.airtime,
        Color(0xFF2563EB),
      ),
      const _ActionItem(
        'Data',
        Icons.wifi_rounded,
        AppRoutes.data,
        Color(0xFF0F766E),
      ),
      const _ActionItem(
        'Electricity',
        Icons.electrical_services_rounded,
        AppRoutes.electricity,
        Color(0xFFD97706),
      ),
      const _ActionItem(
        'More',
        Icons.grid_view_rounded,
        AppRoutes.more,
        Color(0xFF7C3AED),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Top services',
          style: AppTextStyles.headingL.copyWith(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w900,
          ),
        ),
        SizedBox(height: AppSpacing.md),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: actions.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4,
            crossAxisSpacing: AppSpacing.sm,
            mainAxisSpacing: AppSpacing.sm,
            childAspectRatio: 0.86,
          ),
          itemBuilder: (context, index) {
            final action = actions[index];
            return _QuickActionTile(action: action);
          },
        ),
      ],
    );
  }
}

class _QuickActionTile extends StatelessWidget {
  final _ActionItem action;

  const _QuickActionTile({required this.action});

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: () => _openAction(context),
      borderRadius: BorderRadius.circular(22),
      pressedScale: 0.96,
      child: SizedBox(
        width: double.infinity,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: action.color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: action.color.withValues(alpha: 0.24),
                  width: 1,
                ),
                boxShadow: [
                  BoxShadow(
                    color: action.color.withValues(alpha: 0.10),
                    blurRadius: 14,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Icon(
                action.icon,
                color: action.color,
                size: 28,
              ),
            ),
            SizedBox(height: AppSpacing.sm),
            Text(
              action.label,
              style: AppTextStyles.labelS.copyWith(
                color: AppColors.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w900,
                height: 1.05,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  void _openAction(BuildContext context) {
    context.push(action.route);
  }
}

class _BeneficiaryStrip extends StatelessWidget {
  final List<HomeBeneficiary> beneficiaries;

  const _BeneficiaryStrip({required this.beneficiaries});

  @override
  Widget build(BuildContext context) {
    final visible = beneficiaries.take(6).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RichText(
          text: TextSpan(
            style: AppTextStyles.headingM.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w900,
            ),
            children: [
              const TextSpan(text: 'Quick transfer'),
              TextSpan(
                text: ' - Beneficiary',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 112,
          child: visible.isEmpty
              ? _EmptyBeneficiaryCard(onTap: () => context.push(AppRoutes.send))
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  itemCount: visible.length,
                  separatorBuilder: (_, __) => SizedBox(width: AppSpacing.sm),
                  itemBuilder: (context, index) {
                    return _BeneficiaryCard(beneficiary: visible[index]);
                  },
                ),
        ),
      ],
    );
  }
}

class _EmptyBeneficiaryCard extends StatelessWidget {
  final VoidCallback onTap;

  const _EmptyBeneficiaryCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.person_add_alt_1_rounded,
                color: AppColors.primary,
              ),
            ),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'No saved beneficiaries yet',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 3),
                  Text(
                    'Send once, then beneficiaries appear here.',
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
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

class _BeneficiaryCard extends StatelessWidget {
  final HomeBeneficiary beneficiary;

  const _BeneficiaryCard({required this.beneficiary});

  @override
  Widget build(BuildContext context) {
    final label = beneficiary.accountName.isEmpty
        ? beneficiary.bankName
        : beneficiary.accountName;

    return TapScale(
      onTap: () => context.push(AppRoutes.send),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 92,
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.035),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.surfaceVariant,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _initials(label),
                    style: AppTextStyles.labelL.copyWith(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Positioned(
                  right: -2,
                  bottom: 2,
                  child: Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      color: AppColors.success,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.surface, width: 2),
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(height: AppSpacing.sm),
            Text(
              label,
              style: AppTextStyles.labelS.copyWith(
                color: AppColors.textPrimary,
                fontWeight: FontWeight.w700,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
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
    final walletByCurrency = {
      for (final wallet in wallets) wallet.currency.toUpperCase(): wallet,
    };
    final items = _supportedWallets
        .where((template) => template.currency != 'NGN' && template.currency != 'GHS')
        .map((template) {
      final wallet = walletByCurrency[template.currency];
      final isUnlocked = template.isUnlocked;
      return _WalletDisplayItem(
        currency: template.currency,
        name: template.name,
        flag: template.flag,
        icon: template.icon,
        colors: template.colors,
        isUnlocked: isUnlocked,
        balance: isUnlocked ? wallet?.balance ?? 0 : 0,
      );
    }).toList(growable: false);

    return SizedBox(
      height: 124,
      child: ListView.separated(
        clipBehavior: Clip.none,
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount: items.length,
        separatorBuilder: (_, __) => SizedBox(width: AppSpacing.sm),
        itemBuilder: (context, index) {
          final item = items[index];
          return SizedBox(
            width: 154,
              child: _WalletCard(
                item: item,
                balance: item.isUnlocked
                    ? showBalances
                        ? _compactMoney(item.balance)
                        : '••••'
                    : '****',
              ),
            );
          },
        ),
    );
  }
}

class _SupportedWallet {
  final String currency;
  final String name;
  final String flag;
  final IconData icon;
  final List<Color> colors;
  final bool isUnlocked;

  const _SupportedWallet({
    required this.currency,
    required this.name,
    required this.flag,
    required this.icon,
    required this.colors,
    required this.isUnlocked,
  });
}

class _WalletDisplayItem {
  final String currency;
  final String name;
  final String flag;
  final IconData icon;
  final List<Color> colors;
  final bool isUnlocked;
  final double balance;

  const _WalletDisplayItem({
    required this.currency,
    required this.name,
    required this.flag,
    required this.icon,
    required this.colors,
    required this.isUnlocked,
    required this.balance,
  });
}

const _supportedWallets = [
  _SupportedWallet(
    currency: 'GHS',
    name: 'Ghana cedi',
    flag: '🇬🇭',
    icon: Icons.account_balance_wallet_rounded,
    colors: [Color(0xFFB42318), Color(0xFFE2574C)],
    isUnlocked: true,
  ),
  _SupportedWallet(
    currency: 'NGN',
    name: 'Nigerian naira',
    flag: '🇳🇬',
    icon: Icons.account_balance_wallet_rounded,
    colors: [Color(0xFF047857), Color(0xFF13A169)],
    isUnlocked: true,
  ),
  _SupportedWallet(
    currency: 'USD',
    name: 'US dollar',
    flag: '🇺🇸',
    icon: Icons.lock_rounded,
    colors: [Color(0xFF1D4ED8), Color(0xFF60A5FA)],
    isUnlocked: false,
  ),
  _SupportedWallet(
    currency: 'EUR',
    name: 'Euro',
    flag: '🇪🇺',
    icon: Icons.lock_rounded,
    colors: [Color(0xFF4338CA), Color(0xFF8B5CF6)],
    isUnlocked: false,
  ),
  _SupportedWallet(
    currency: 'GBP',
    name: 'British pound',
    flag: '🇬🇧',
    icon: Icons.lock_rounded,
    colors: [Color(0xFFBE185D), Color(0xFFF472B6)],
    isUnlocked: false,
  ),
  _SupportedWallet(
    currency: 'ZAR',
    name: 'South African rand',
    flag: '🇿🇦',
    icon: Icons.lock_rounded,
    colors: [Color(0xFF0F766E), Color(0xFF2DD4BF)],
    isUnlocked: false,
  ),
];

class _WalletCard extends StatelessWidget {
  final _WalletDisplayItem item;
  final String balance;

  const _WalletCard({
    required this.item,
    required this.balance,
  });

  @override
  Widget build(BuildContext context) {
    final contentOpacity = item.isUnlocked ? 1.0 : 0.74;
    return Container(
      constraints: const BoxConstraints(minHeight: 116),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: item.colors,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
        boxShadow: [
          BoxShadow(
            color: item.colors.first.withValues(alpha: 0.20),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -10,
            bottom: -14,
            child: Text(
              item.currency,
              style: AppTextStyles.displayLarge.copyWith(
                color: Colors.white.withValues(alpha: 0.07),
                fontSize: 50,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
            ),
          ),
          Positioned(
            right: 10,
            top: 10,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(AppRadius.full),
                border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
              ),
              child: Text(
                item.isUnlocked ? 'Active' : '****',
                style: AppTextStyles.caption.copyWith(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Opacity(
              opacity: contentOpacity,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(item.flag,
                            style: const TextStyle(fontSize: 16)),
                      ),
                      SizedBox(width: AppSpacing.sm),
                      Text(
                        item.currency,
                        style: AppTextStyles.labelM.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  Text(
                    balance,
                    style: AppTextStyles.headingM.copyWith(
                      color: Colors.white,
                      letterSpacing: 0,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(item.icon, color: Colors.white, size: 14),
                      SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          item.name,
                          style: AppTextStyles.caption.copyWith(
                            color: Colors.white.withValues(alpha: 0.90),
                            fontWeight: FontWeight.w700,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
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

class _RecentTransactionsSection extends StatelessWidget {
  final List<HomeTransaction> transactions;

  const _RecentTransactionsSection({required this.transactions});

  @override
  Widget build(BuildContext context) {
    final items = transactions.map(_activityFromTransaction).take(4).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionTitle(
          title: 'Recent transactions',
          actionLabel: 'View more',
          route: AppRoutes.activity,
        ),
        SizedBox(height: AppSpacing.sm),
        if (items.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.md,
              horizontal: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                TpIllustration(
                  variant: TpIllustrationVariant.emptyTransactions,
                  size: 116,
                  semanticLabel: 'No transactions yet',
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'No transactions yet',
                  style: AppTextStyles.labelM,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 2),
                Text(
                  'Your recent activity will show up here.',
                  style: AppTextStyles.bodyS,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          )
        else
          _ActivityList(transactions: transactions),
      ],
    );
  }
}

class _ActivityList extends StatelessWidget {
  final List<HomeTransaction> transactions;

  const _ActivityList({required this.transactions});

  @override
  Widget build(BuildContext context) {
    final items = transactions.map(_activityFromTransaction).take(4).toList();

    return Column(
      children: [
        for (var index = 0; index < items.length; index++) ...[
          _ActivityRow(item: items[index]),
          if (index < items.length - 1)
            Divider(
              height: 1,
              color: AppColors.divider,
              indent: 52,
            ),
        ],
      ],
    );
  }
}

class _ActivityRow extends StatelessWidget {
  final _ActivityItem item;

  const _ActivityRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return TapScale(
      onTap: () => context.push(item.route),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: item.color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(item.icon, color: item.color, size: 20),
            ),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  SizedBox(height: 2),
                  Text(
                    item.detail,
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 1,
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
          child: Text(
            title,
            style: AppTextStyles.headingM.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        TapScale(
          onTap: () => context.push(route),
          borderRadius: BorderRadius.circular(AppRadius.full),
          pressedScale: 0.96,
          child: Text(
            actionLabel,
            style: AppTextStyles.labelM.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w800,
            ),
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

  const _IconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: TapScale(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        pressedScale: 0.94,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
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
  final Color color;

  const _ActionItem(
    this.label,
    this.icon,
    this.route,
    this.color,
  );
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
    return SizedBox.expand(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 44,
              height: 44,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'Loading your dashboard…',
              style: AppTextStyles.bodyS,
            ),
          ],
        ),
      ),
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
              TpIllustration(
                variant: TpIllustrationVariant.connectionLost,
                size: 148,
                semanticLabel: 'Dashboard could not load',
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                message,
                style: AppTextStyles.bodyM.copyWith(
                  color: AppColors.textPrimary,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.lg),
              FilledButton(
                onPressed: () {
                  Haptics.selection();
                  onRetry();
                },
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Retry'),
              ),
              TextButton(
                onPressed: () {
                  Haptics.selection();
                  context.go(AppRoutes.login);
                },
                child: const Text('Log in'),
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

String _compactMoney(double amount) {
  final absolute = amount.abs();
  if (absolute >= 1000000) {
    return '${(amount / 1000000).toStringAsFixed(2)}M';
  }
  if (absolute >= 1000) {
    return '${(amount / 1000).toStringAsFixed(1)}K';
  }
  return _decimal(amount);
}

String _walletCardAmount(double amount) {
  if (amount == amount.truncateToDouble()) {
    return NumberFormat('#,##0').format(amount);
  }
  return NumberFormat('#,##0.00').format(amount);
}

String _decimal(double amount) {
  return NumberFormat('#,##0.00').format(amount);
}

String _titleCase(String value) {
  if (value.isEmpty) return value;
  return value
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _compactName(String name) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return 'TrustPay user';
  final parts = trimmed.split(RegExp(r'\s+')).where((part) => part.isNotEmpty);
  return parts.take(2).join(' ');
}

HomeVirtualAccount? _accountForCurrency(
  List<HomeVirtualAccount> accounts,
  String currency,
) {
  final targetCurrency = currency.toUpperCase();
  for (final account in accounts) {
    final hasNumber = account.displayAccountNumber.trim().isNotEmpty;
    final isUsable = !{'FAILED', 'REJECTED', 'CANCELLED'}.contains(
      account.status.toUpperCase(),
    );
    if (account.currency.toUpperCase() == targetCurrency &&
        hasNumber &&
        isUsable) {
      return account;
    }
  }
  return null;
}

String _formatAccountNumber(String accountNumber) {
  final compact = accountNumber.replaceAll(RegExp(r'\s+'), '');
  if (compact.length <= 4) return compact;

  final groups = <String>[];
  for (var index = 0; index < compact.length; index += 4) {
    final end = index + 4 > compact.length ? compact.length : index + 4;
    groups.add(compact.substring(index, end));
  }
  return groups.join(' ');
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList(growable: false);
  if (parts.isEmpty) return 'TP';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
}
