import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/money/money_value.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';
import '../../notifications/services/notifications_service.dart';

class HomeScreen extends StatefulWidget {
  final HomeDataService homeDataService;
  final NotificationsService notificationsService;
  final Duration notificationPollInterval;
  final bool isHomeTabActive;

  HomeScreen({
    super.key,
    HomeDataService? homeDataService,
    NotificationsService? notificationsService,
    this.notificationPollInterval = const Duration(seconds: 30),
    this.isHomeTabActive = true,
  })  : homeDataService = homeDataService ?? HomeDataService(),
        notificationsService = notificationsService ?? NotificationsService();

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with WidgetsBindingObserver, RouteAware {
  late Future<HomeDashboardData> _dashboardFuture;
  bool _showBalances = true;
  bool _refreshing = false;
  int _unreadNotificationCount = 0;
  bool _foreground = true;
  bool _routeVisible = true;
  Timer? _notificationPollTimer;
  Timer? _balancePollTimer;
  bool _balancePollInFlight = false;
  HomeDashboardData? _lastDashboard;
  Future<void>? _notificationCountInFlight;
  ModalRoute<dynamic>? _subscribedRoute;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _dashboardFuture = _loadDashboard();
    _refreshNotificationCount();
    _scheduleNotificationPoll();
    _scheduleBalancePoll();
    // Re-fetch balances whenever a money action completes elsewhere in the
    // app so the dashboard never shows stale figures.
    walletRefreshSignal.addListener(_refreshDashboard);
  }

  @override
  void dispose() {
    _notificationPollTimer?.cancel();
    _balancePollTimer?.cancel();
    _notificationPollTimer = null;
    if (_subscribedRoute != null) {
      appRouteObserver.unsubscribe(this);
      _subscribedRoute = null;
    }
    WidgetsBinding.instance.removeObserver(this);
    walletRefreshSignal.removeListener(_refreshDashboard);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) {
      if (_notificationPollingEnabled) {
        unawaited(_pollBalances());
      }
      if (_notificationPollingEnabled) _refreshNotificationCount();
      _scheduleNotificationPoll();
      _scheduleBalancePoll();
    } else {
      _notificationPollTimer?.cancel();
      _notificationPollTimer = null;
      _balancePollTimer?.cancel();
      _balancePollTimer = null;
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route == _subscribedRoute) return;
    if (_subscribedRoute != null) appRouteObserver.unsubscribe(this);
    if (route != null) appRouteObserver.subscribe(this, route);
    _subscribedRoute = route;
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isHomeTabActive == widget.isHomeTabActive) return;
    if (widget.isHomeTabActive) {
      unawaited(_pollBalances());
      _refreshNotificationCount();
      _scheduleNotificationPoll();
      _scheduleBalancePoll();
    } else {
      _notificationPollTimer?.cancel();
      _notificationPollTimer = null;
      _balancePollTimer?.cancel();
      _balancePollTimer = null;
    }
  }

  @override
  void didPush() {
    _routeVisible = true;
    _scheduleNotificationPoll();
    _scheduleBalancePoll();
  }

  @override
  void didPopNext() {
    _routeVisible = true;
    unawaited(_pollBalances());
    if (_notificationPollingEnabled) _refreshNotificationCount();
    _scheduleNotificationPoll();
    _scheduleBalancePoll();
  }

  @override
  void didPushNext() {
    _routeVisible = false;
    _balancePollTimer?.cancel();
    _balancePollTimer = null;
    _notificationPollTimer?.cancel();
    _notificationPollTimer = null;
  }

  @override
  void didPop() {
    _routeVisible = false;
    _balancePollTimer?.cancel();
    _balancePollTimer = null;
    _notificationPollTimer?.cancel();
    _notificationPollTimer = null;
  }

  bool get _notificationPollingEnabled =>
      mounted && _foreground && _routeVisible && widget.isHomeTabActive;

  void _scheduleNotificationPoll() {
    if (!_notificationPollingEnabled || _notificationPollTimer != null) {
      return;
    }
    final interval = widget.notificationPollInterval <= Duration.zero
        ? const Duration(milliseconds: 1)
        : widget.notificationPollInterval;
    _notificationPollTimer = Timer(interval, _runNotificationPoll);
  }

  void _runNotificationPoll() {
    _notificationPollTimer = null;
    if (!_notificationPollingEnabled) return;
    _refreshNotificationCount().whenComplete(_scheduleNotificationPoll);
  }

  void _toggleBalances() {
    HapticFeedback.selectionClick();
    setState(() => _showBalances = !_showBalances);
  }

  Future<HomeDashboardData> _loadDashboard() async {
    final data = await widget.homeDataService.fetchDashboard();
    _lastDashboard = data;
    return data;
  }

  void _scheduleBalancePoll() {
    if (!_notificationPollingEnabled || _balancePollTimer != null) return;
    _balancePollTimer = Timer(const Duration(seconds: 5), () async {
      _balancePollTimer = null;
      if (!_notificationPollingEnabled) return;
      await _pollBalances();
      _scheduleBalancePoll();
    });
  }

  Future<void> _pollBalances() async {
    if (_balancePollInFlight || _refreshing || _lastDashboard == null) return;
    _balancePollInFlight = true;
    try {
      final wallets = await widget.homeDataService.fetchWalletBalances();
      if (!_notificationPollingEnabled || _refreshing) return;
      final previous = _lastDashboard!.wallets;
      final changed = wallets.length != previous.length ||
          wallets.any((wallet) => !previous.any((old) =>
              old.id == wallet.id &&
              old.currency == wallet.currency &&
              old.balanceDecimalString == wallet.balanceDecimalString));
      if (changed) await _refreshDashboard(background: true);
    } catch (_) {
      // Keep the last confirmed balance during a temporary poll outage.
      // Manual refresh still exposes actionable errors.
    } finally {
      _balancePollInFlight = false;
    }
  }

  Future<void> _refreshDashboard({bool background = false}) async {
    if (_refreshing || !mounted) return;
    if (_notificationPollingEnabled) _refreshNotificationCount();
    final request = _loadDashboard();
    _refreshing = true;
    if (!background) {
      setState(() {
        _dashboardFuture = request;
      });
    }
    try {
      final data = await request;
      if (background && mounted) {
        setState(() {
          _dashboardFuture = Future.value(data);
        });
      }
    } catch (_) {
      // The builder presents the failed refresh rather than hiding it.
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _refreshNotificationCount() {
    final inFlight = _notificationCountInFlight;
    if (inFlight != null) return inFlight;

    final request = _loadNotificationCount();
    _notificationCountInFlight = request;
    request.whenComplete(() {
      if (identical(_notificationCountInFlight, request)) {
        _notificationCountInFlight = null;
      }
    });
    return request;
  }

  Future<void> _loadNotificationCount() async {
    try {
      final count = await widget.notificationsService.fetchUnreadCount();
      if (mounted) setState(() => _unreadNotificationCount = count);
    } catch (_) {
      // Notification availability should never block balances or hide a
      // previously known badge count during a transient outage.
    }
  }

  void _openNotifications() {
    unawaited(
      context.push(AppRoutes.notifications).then((_) {
        if (mounted) _refreshNotificationCount();
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<HomeDashboardData>(
          future: _dashboardFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting &&
                !snapshot.hasData) {
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
            final hasNgnAccount =
                _hasActiveAccount(data.virtualAccounts, 'NGN');
            return RefreshIndicator(
              color: AppColors.primary,
              backgroundColor: AppColors.surface,
              onRefresh: _refreshDashboard,
              child: ScrollConfiguration(
                behavior: ScrollConfiguration.of(context).copyWith(
                  dragDevices: const {
                    PointerDeviceKind.touch,
                    PointerDeviceKind.mouse,
                    PointerDeviceKind.trackpad,
                    PointerDeviceKind.stylus,
                  },
                ),
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
                    if (_refreshing) ...[
                      const LinearProgressIndicator(minHeight: 2),
                      const Text('Updating balances…'),
                    ],
                    _HomeTopBar(
                      user: data.user,
                      notificationCount: _unreadNotificationCount,
                      onNotifications: _openNotifications,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _BalancePanel(
                      data: data,
                      showBalances: _showBalances,
                      onToggleBalances: _toggleBalances,
                      onSend: hasNgnAccount
                          ? () => context.push(AppRoutes.send)
                          : () => context.push(AppRoutes.receiveMoney),
                    ),
                    if (data.virtualAccounts.isEmpty ||
                        !_hasActiveAccount(data.virtualAccounts, 'NGN')) ...[
                      const SizedBox(height: AppSpacing.md),
                      _AccountSetupBanner(
                        awaitingVerification:
                            data.user.kycStatus.toUpperCase() == 'SUBMITTED',
                        onRequest: () => context.push(
                            data.user.kycStatus.toUpperCase() == 'SUBMITTED'
                                ? AppRoutes.virtualAccount
                                : AppRoutes.receiveMoney),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    const _QuickActionsGrid(),
                    const SizedBox(height: AppSpacing.lg),
                    if (data.user.kycStatus.toUpperCase() == 'VERIFIED')
                      const _PromoBanner()
                    else
                      _KycStatusBanner(
                        status: data.user.kycStatus,
                      ),
                    if (LaunchCapabilities.moneyOutEnabled &&
                        data.beneficiaries.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.lg),
                      _BeneficiaryStrip(
                        beneficiaries: data.beneficiaries,
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    _RecentTransactionsSection(
                      transactions: data.transactions,
                    ),
                  ],
                ),
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
  final int notificationCount;
  final VoidCallback onNotifications;

  const _HomeTopBar({
    required this.user,
    required this.notificationCount,
    required this.onNotifications,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
        const SizedBox(width: AppSpacing.md),
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
          badgeCount: notificationCount,
          onTap: onNotifications,
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
  final VoidCallback onSend;

  const _BalancePanel({
    // Retained for widget identity compatibility while the panel is private.
    // ignore: unused_element_parameter
    super.key,
    required this.data,
    required this.showBalances,
    required this.onToggleBalances,
    required this.onSend,
  });

  @override
  State<_BalancePanel> createState() => _BalancePanelState();
}

class _BalancePanelState extends State<_BalancePanel> {
  static const _storage = FlutterSecureStorage();
  Set<String> _currencies = {
    'NGN',
    if (LaunchCapabilities.ghanaCedisWalletEnabled) 'GHS',
  };
  Set<String> get _supportedCurrencies => {
        'NGN',
        if (LaunchCapabilities.ghanaCedisWalletEnabled) 'GHS',
      };
  String get _preferenceKey => 'dashboard-currencies-${widget.data.user.id}';
  late final ScrollController _scrollController;
  int _currentPage = 0;
  double _cardExtent = 1;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()..addListener(_handleCarouselScroll);
    _loadCurrencies();
  }

  Future<void> _loadCurrencies() async {
    try {
      final saved = await _storage.read(key: _preferenceKey);
      final selected =
          saved?.split(',').where(_supportedCurrencies.contains).toSet();
      if (mounted && selected != null && selected.isNotEmpty) {
        setState(() => _currencies = selected);
      }
    } catch (_) {
      // Keep the default cards if device preferences are unavailable.
    }
  }

  Future<void> _editCurrencies() async {
    final selected = Set<String>.of(_currencies);
    final result = await showModalBottomSheet<Set<String>>(
      context: context,
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(builder: (context, update) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('Your currencies', style: AppTextStyles.headingM),
              const SizedBox(height: AppSpacing.sm),
              for (final currency in _supportedCurrencies)
                CheckboxListTile(
                  title: Text(currency == 'NGN'
                      ? 'NGN · Nigerian naira'
                      : 'GHS · Ghana cedi'),
                  subtitle: Text(
                      _hasActiveAccount(widget.data.virtualAccounts, currency)
                          ? 'Account ready'
                          : currency == 'NGN'
                              ? 'Request an account to get started'
                              : 'Account unavailable now'),
                  value: selected.contains(currency),
                  onChanged: (value) => update(() {
                    if (value == true) {
                      selected.add(currency);
                    } else {
                      selected.remove(currency);
                    }
                  }),
                ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: selected.isEmpty
                        ? null
                        : () => Navigator.pop(context, selected),
                    child: const Text('Save'),
                  )),
            ]),
          ),
        );
      }),
    );
    if (!mounted || result == null) return;
    setState(() {
      _currencies = result;
      _currentPage = 0;
    });
    if (_scrollController.hasClients) _scrollController.jumpTo(0);
    try {
      await _storage.write(key: _preferenceKey, value: result.join(','));
    } catch (_) {
      if (mounted) {
        showTpSnackbar(context,
            'Cards updated. Could not save this preference on your device.');
      }
    }
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
        .clamp(0, _currencies.length - 1)
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
    AppColors.watch(context);
    final ngnBalance =
        widget.data.walletFor('NGN')?.balanceDecimalString ?? '0.00';
    final ngnAccount = _accountForCurrency(widget.data.virtualAccounts, 'NGN');
    final pageWidth = MediaQuery.sizeOf(context).width;

    final cards = [
      _BalanceCardData(
        currency: 'NGN',
        balanceDecimalString: ngnBalance,
        account: ngnAccount,
        colors: [
          AppColors.primaryDark,
          AppColors.primary,
          AppColors.primaryLight,
        ],
      ),
      if (LaunchCapabilities.ghanaCedisWalletEnabled)
        _BalanceCardData(
          currency: 'GHS',
          balanceDecimalString:
              widget.data.walletFor('GHS')?.balanceDecimalString ?? '0.00',
          account: _accountForCurrency(widget.data.virtualAccounts, 'GHS'),
          colors: const [
            Color(0xFF0E7490),
            Color(0xFF0F766E),
            Color(0xFF34D399),
          ],
        ),
    ].where((card) => _currencies.contains(card.currency)).toList();
    final cardWidth =
        cards.length == 1 ? pageWidth - (AppSpacing.md * 2) : pageWidth * 0.8;
    _cardExtent = cardWidth + AppSpacing.sm;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Expanded(child: Text('Your wallets', style: AppTextStyles.labelL)),
          if (LaunchCapabilities.ghanaCedisWalletEnabled)
            IconButton(
              tooltip: 'Edit currencies',
              onPressed: _editCurrencies,
              icon: const Icon(Icons.add_rounded),
            ),
        ]),
        SizedBox(
          height: (LaunchCapabilities.moneyOutEnabled ? 200 : 190) +
              (MediaQuery.textScalerOf(context).scale(16) - 16).clamp(0, 48) *
                  4,
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
                      onSend: card.currency == 'GHS' && card.account == null
                          ? () => showTpSnackbar(
                              context, 'Ghana accounts are unavailable now.')
                          : widget.onSend,
                      onReceive: card.currency == 'GHS' && card.account == null
                          ? () => showTpSnackbar(
                              context, 'Ghana accounts are unavailable now.')
                          : () => context.push(AppRoutes.receiveMoney),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        if (cards.length > 1) ...[
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
  final String balanceDecimalString;
  final HomeVirtualAccount? account;
  final List<Color> colors;

  const _BalanceCardData({
    required this.currency,
    required this.balanceDecimalString,
    required this.account,
    required this.colors,
  });
}

class _AccountSetupBanner extends StatelessWidget {
  final VoidCallback onRequest;
  final bool awaitingVerification;
  const _AccountSetupBanner(
      {required this.onRequest, this.awaitingVerification = false});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.primary.withValues(alpha: .35)),
      ),
      child: Row(children: [
        Icon(Icons.account_balance_rounded, color: AppColors.primary),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
            child: Text(
                awaitingVerification
                    ? 'Your identity check is in progress. You can request your account now.'
                    : 'Create a TrustPay NGN account to fund your wallet and start transacting.',
                style: AppTextStyles.bodyS)),
        TextButton(
            onPressed: onRequest,
            child: Text(awaitingVerification ? 'Manage setup' : 'Request')),
      ]),
    );
  }
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
    AppColors.watch(context);
    final visibleAmount =
        showBalances ? _walletCardAmount(data.balanceDecimalString) : '******';
    final accountNumber = data.account?.accountNumber.trim() ?? '';
    final canRequestAccount = data.currency == 'NGN' && accountNumber.isEmpty;
    final showAccountChip =
        accountNumber.isNotEmpty || canRequestAccount || data.currency == 'GHS';
    final accountChipLabel = accountNumber.isNotEmpty
        ? _formatAccountNumber(accountNumber)
        : canRequestAccount
            ? 'Request account'
            : 'Account unavailable';
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
                      child: showAccountChip
                          ? Align(
                              alignment: Alignment.centerLeft,
                              child: data.currency == 'NGN'
                                  ? TapScale(
                                      onTap: onReceive,
                                      borderRadius: BorderRadius.circular(
                                        AppRadius.full,
                                      ),
                                      child: accountChip,
                                    )
                                  : accountChip,
                            )
                          : const SizedBox.shrink(),
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
                if (LaunchCapabilities.moneyOutEnabled)
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
                  )
                else
                  SizedBox(
                    width: double.infinity,
                    child: _BalanceCtaButton(
                      label: 'Add funds',
                      icon: Icons.add_rounded,
                      onTap: onReceive,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Kept as the full-account variant while the dashboard currently renders the
// compact balance-card account treatment.
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
    AppColors.watch(context);
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
                      activeAccount.provider.toUpperCase() == 'PAYSTACK' &&
                              activeAccount.currency.toUpperCase() == 'NGN'
                          ? 'TrustPay NGN receiving account'
                          : 'Virtual account',
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
                    activeAccount.provider.toUpperCase() == 'PAYSTACK'
                        ? 'TrustPay account copied'
                        : 'Virtual account copied',
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
    AppColors.watch(context);
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
                  'No TrustPay account yet',
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Create a TrustPay NGN account to receive bank transfers directly into your wallet.',
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
    AppColors.watch(context);
    return TapScale(
      onTap: onTap,
      semanticLabel: label,
      borderRadius: BorderRadius.circular(AppRadius.button),
      pressedScale: 0.97,
      child: Container(
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.13),
          borderRadius: BorderRadius.circular(AppRadius.button),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.28),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              color: Colors.white,
              size: 18,
            ),
            const SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                label,
                style: AppTextStyles.labelM.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                ),
                textAlign: TextAlign.center,
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
    AppColors.watch(context);
    final isVerified = status.toUpperCase() == 'VERIFIED';
    final color = isVerified ? AppColors.success : AppColors.warning;
    final message = isVerified
        ? 'Your account is active. View your verification and account limits.'
        : status.toUpperCase() == 'SUBMITTED'
            ? 'Your BVN check is in progress. View verification status.'
            : 'Verify BVN to activate your account and transact within Tier 1 limits.';

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
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                message,
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textPrimary,
                  height: 1.45,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
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

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return TapScale(
      onTap: () => context.push(AppRoutes.exchange),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        constraints: const BoxConstraints(minHeight: 120),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.16),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 18,
              offset: const Offset(0, 10),
            ),
          ],
          image: const DecorationImage(
            image: AssetImage(
              'assets/images/feature_cards/exchange-services-banner.png',
            ),
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
                Colors.black.withValues(alpha: 0.84),
                Colors.black.withValues(alpha: 0.54),
                Colors.black.withValues(alpha: 0.16),
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
                      'EXCHANGE SERVICES',
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.primaryLight,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Exchange NGN to GHS',
                      style: AppTextStyles.labelM.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Upload your receipt. Receive GHS after deposit confirmation.',
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
    AppColors.watch(context);
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
        'Cable TV',
        Icons.live_tv_rounded,
        AppRoutes.cable,
        Color(0xFFDB2777),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Top services',
                style: AppTextStyles.headingL.copyWith(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            TapScale(
              onTap: () => context.push(AppRoutes.more),
              semanticLabel: 'More services',
              borderRadius: BorderRadius.circular(AppRadius.full),
              child: Container(
                height: 36,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceVariant,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'More',
                      style: AppTextStyles.labelS.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 16,
                      color: AppColors.primary,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        LayoutBuilder(
          builder: (context, constraints) {
            final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.35;
            final columns = constraints.maxWidth < 360 || largeText ? 2 : 4;
            return GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: actions.length,
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: AppSpacing.sm,
                mainAxisSpacing: AppSpacing.sm,
                childAspectRatio: columns == 4 ? 0.82 : 1.35,
              ),
              itemBuilder: (context, index) {
                final action = actions[index];
                return _QuickActionTile(action: action);
              },
            );
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
    AppColors.watch(context);
    return TapScale(
      onTap: () => _openAction(context),
      semanticLabel: action.label,
      borderRadius: BorderRadius.circular(20),
      pressedScale: 0.96,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: 4,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: action.color.withValues(alpha: 0.07),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: action.color.withValues(alpha: 0.11),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: action.color.withValues(alpha: 0.18),
                  width: 1,
                ),
              ),
              child: Icon(
                action.icon,
                color: action.color,
                size: 24,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              action.label,
              style: AppTextStyles.labelS.copyWith(
                color: AppColors.textPrimary,
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                height: 1.1,
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
    AppColors.watch(context);
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
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 112,
          child: visible.isEmpty
              ? _EmptyBeneficiaryCard(onTap: () => context.push(AppRoutes.send))
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  itemCount: visible.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(width: AppSpacing.sm),
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
    AppColors.watch(context);
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
            const SizedBox(width: AppSpacing.md),
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
                  const SizedBox(height: 3),
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
    AppColors.watch(context);
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
            const SizedBox(height: AppSpacing.sm),
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

class _RecentTransactionsSection extends StatelessWidget {
  final List<HomeTransaction> transactions;

  const _RecentTransactionsSection({required this.transactions});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final items = transactions.map(_activityFromTransaction).take(4).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionTitle(
          title: 'Recent transactions',
          actionLabel: 'View more',
          route: AppRoutes.activity,
        ),
        const SizedBox(height: AppSpacing.sm),
        if (items.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.md,
              horizontal: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.isDark
                  ? const Color(0xFF13151C)
                  : AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.receipt_long_outlined,
                  size: 28,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(height: AppSpacing.sm),
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
    AppColors.watch(context);
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
    AppColors.watch(context);
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
            const SizedBox(width: AppSpacing.md),
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
                  const SizedBox(height: 2),
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
            const SizedBox(width: AppSpacing.sm),
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
  final String? route;

  const _SectionTitle({
    required this.title,
    required this.actionLabel,
    this.route,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
          onTap: route == null ? null : () => context.push(route!),
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
  final int badgeCount;
  final VoidCallback onTap;

  const _IconButton({
    required this.icon,
    required this.tooltip,
    this.badgeCount = 0,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Tooltip(
      message: tooltip,
      child: TapScale(
        onTap: onTap,
        semanticLabel: badgeCount > 0
            ? '$tooltip, $badgeCount unread notifications'
            : tooltip,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        pressedScale: 0.94,
        child: SizedBox(
          key: const ValueKey('notification-button-frame'),
          width: 48,
          height: 48,
          child: Stack(
            children: [
              Positioned(
                left: 0,
                bottom: 0,
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
              if (badgeCount > 0)
                Positioned(
                  top: 0,
                  right: 0,
                  child: Semantics(
                    label: '$badgeCount unread notifications',
                    child: Container(
                      key: const ValueKey('notification-count-badge'),
                      constraints: const BoxConstraints(minWidth: 20),
                      height: 20,
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(AppRadius.full),
                        border: Border.all(
                          color: AppColors.background,
                          width: 1.5,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          badgeCount > 9 ? '9+' : '$badgeCount',
                          style: const TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                            height: 1,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
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
    AppColors.watch(context);
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
    AppColors.watch(context);
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
              const TpIllustration(
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
  final amount = _money(transaction.currency, transaction.amountDecimalString);
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

String _money(String currency, String decimalString) {
  return '$currency ${_formatExactAmount(decimalString)}';
}

String _walletCardAmount(String decimalString) {
  final value = MoneyValue.parse(decimalString);
  final formatted = _formatExactAmount(value.decimalString);
  if (value.minorUnits % BigInt.from(100) == BigInt.zero) {
    return formatted.substring(0, formatted.length - 3);
  }
  return formatted;
}

bool _hasActiveAccount(List<HomeVirtualAccount> accounts, String currency) {
  final target = currency.toUpperCase();
  return accounts.any((account) =>
      account.currency.toUpperCase() == target &&
      (target != 'NGN' || account.provider.toUpperCase() == 'PAYSTACK') &&
      account.accountNumber.trim().isNotEmpty &&
      !{'FAILED', 'REJECTED', 'CANCELLED'}
          .contains(account.status.toUpperCase()));
}

String _formatExactAmount(String decimalString) {
  final parts = decimalString.split('.');
  final rawWhole = parts.first;
  final isNegative = rawWhole.startsWith('-');
  var whole = isNegative ? rawWhole.substring(1) : rawWhole;
  while (whole.length > 1 && whole.startsWith('0')) {
    whole = whole.substring(1);
  }

  final grouped = StringBuffer();
  for (var index = 0; index < whole.length; index++) {
    if (index > 0 && (whole.length - index) % 3 == 0) {
      grouped.write(',');
    }
    grouped.write(whole[index]);
  }

  final fraction = parts.length > 1 ? parts[1].padRight(2, '0') : '00';
  return '${isNegative ? '-' : ''}$grouped.${fraction.substring(0, 2)}';
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
    // A masked placeholder is useful for status messaging, but it must not
    // unlock account actions. Only a generated account number is
    // considered usable here.
    final hasNumber = account.accountNumber.trim().isNotEmpty;
    final isUsable = !{'FAILED', 'REJECTED', 'CANCELLED'}.contains(
      account.status.toUpperCase(),
    );
    if (account.currency.toUpperCase() == targetCurrency &&
        (targetCurrency != 'NGN' ||
            account.provider.toUpperCase() == 'PAYSTACK') &&
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
