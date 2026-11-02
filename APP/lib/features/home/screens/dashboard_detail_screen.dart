import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';

import '../../../core/money/money_value.dart';
import '../../../core/router/app_router.dart';
import '../../../core/state/exchange_visibility.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_empty_state.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';
import '../../../services/api_client.dart';
import '../../../services/vtu_service.dart';
import '../../auth/widgets/tawk_service.dart';
import '../../wallet/screens/virtual_account_screen.dart';

enum DashboardDetailKind {
  wallets,
  virtualAccount,
  activity,
  kyc,
  notifications,
}

enum ProfileActionKind {
  account,
  appearance,
  security,
  support,
}

class DashboardDetailScreen extends StatefulWidget {
  final DashboardDetailKind kind;
  final HomeDataService homeDataService;

  DashboardDetailScreen({
    super.key,
    required this.kind,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<DashboardDetailScreen> createState() => _DashboardDetailScreenState();
}

class VtuOrderDetailScreen extends StatefulWidget {
  final String reference;

  const VtuOrderDetailScreen({
    super.key,
    required this.reference,
  });

  @override
  State<VtuOrderDetailScreen> createState() => _VtuOrderDetailScreenState();
}

class _VtuOrderDetailScreenState extends State<VtuOrderDetailScreen> {
  final _attemptIdempotency = MoneyAttemptIdempotency();
  late final VtuService _vtuService;
  late Future<VtuOrderStatus> _future;
  bool _isChecking = false;

  @override
  void initState() {
    super.initState();
    _vtuService = VtuService(apiClient: ApiClient());
    _future = _vtuService.getOrderStatus(widget.reference);
  }

  void _reload() {
    setState(() {
      _future = _vtuService.getOrderStatus(widget.reference);
    });
  }

  Future<void> _requery() async {
    if (_isChecking) return;
    setState(() => _isChecking = true);
    try {
      final order = await _vtuService.requeryOrder(
        widget.reference,
        idempotencyKey: _attemptIdempotency.keyFor(
          'vtu-history-requery|${widget.reference}',
        ),
      );
      _attemptIdempotency.markFinalOutcome();
      if (!mounted) return;
      setState(() {
        _future = Future.value(order);
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            authErrorMessage(error, 'Unable to refresh VTU order status'),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isChecking = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<VtuOrderStatus>(
          future: _future,
          builder: (context, snapshot) {
            final children = <Widget>[
              TpPageHeader(
                label: 'VTU order',
                menuActions: [
                  TpPageMenuAction(
                    label: 'Refresh',
                    icon: Icons.refresh_rounded,
                    onTap: _reload,
                  ),
                  TpPageMenuAction(
                    label: 'Home',
                    icon: Icons.home_rounded,
                    onTap: () => context.go(AppRoutes.home),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Track provider confirmation and refresh pending bill payments.',
                style: AppTextStyles.bodyM,
              ),
              const SizedBox(height: AppSpacing.xl),
            ];

            if (snapshot.connectionState == ConnectionState.waiting) {
              children.add(const _LoadingPanel());
            } else if (snapshot.hasError || !snapshot.hasData) {
              children.add(
                _ErrorPanel(
                  message: authErrorMessage(
                    snapshot.error ?? 'Could not load VTU order',
                    'Could not load VTU order',
                  ),
                  onRetry: _reload,
                ),
              );
            } else {
              children.add(
                _VtuOrderBody(
                  order: snapshot.data!,
                  isChecking: _isChecking,
                  onCheckStatus: _requery,
                ),
              );
            }

            return CustomScrollView(
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
                  sliver: SliverList.list(children: children),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DashboardDetailScreenState extends State<DashboardDetailScreen>
    with WidgetsBindingObserver {
  late Future<HomeDashboardData> _future;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.kind != DashboardDetailKind.virtualAccount) {
      _future = widget.homeDataService.fetchDashboard();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reload();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _reload() {
    if (widget.kind == DashboardDetailKind.virtualAccount) return;
    setState(() {
      _future = widget.homeDataService.fetchDashboard();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final config = _configFor(widget.kind);

    if (widget.kind == DashboardDetailKind.virtualAccount) {
      return VirtualAccountScreen(service: widget.homeDataService);
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<HomeDashboardData>(
          future: _future,
          builder: (context, snapshot) {
            final children = <Widget>[
              TpPageHeader(
                label: config.title,
                menuActions: [
                  TpPageMenuAction(
                    label: 'Refresh',
                    icon: Icons.refresh_rounded,
                    onTap: _reload,
                  ),
                  TpPageMenuAction(
                    label: 'Home',
                    icon: Icons.home_rounded,
                    onTap: () => context.go(AppRoutes.home),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(config.subtitle, style: AppTextStyles.bodyM),
              const SizedBox(height: AppSpacing.xl),
            ];

            if (snapshot.connectionState == ConnectionState.waiting) {
              children.add(const _LoadingPanel());
            } else if (snapshot.hasError || !snapshot.hasData) {
              children.add(
                _ErrorPanel(
                  message: authErrorMessage(
                    snapshot.error ?? 'Could not load this page',
                    'Could not load this page',
                  ),
                  onRetry: _reload,
                ),
              );
            } else {
              children.add(_bodyFor(widget.kind, snapshot.data!));
            }

            return CustomScrollView(
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
                  sliver: SliverList.list(children: children),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class DashboardProfileScreen extends StatefulWidget {
  final HomeDataService homeDataService;

  DashboardProfileScreen({
    super.key,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<DashboardProfileScreen> createState() => _DashboardProfileScreenState();
}

class _DashboardProfileScreenState extends State<DashboardProfileScreen> {
  final _authService = AuthService();
  late Future<HomeUser> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchCurrentUser();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: FutureBuilder<HomeUser>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _ProfileSkeletonPanel();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return _ErrorPanel(
                  message: authErrorMessage(
                    snapshot.error ?? 'Could not load profile',
                    'Could not load profile',
                  ),
                  onRetry: () => setState(() {
                    _future = widget.homeDataService.fetchCurrentUser();
                  }),
                );
              }

              final user = snapshot.data!;
              return ListView(
                padding: EdgeInsets.zero,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('Profile', style: AppTextStyles.headingXL),
                      ),
                      const _ProfileThemeQuickToggle(),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 32,
                        backgroundColor: AppColors.primary,
                        child: Text(
                          user.initials,
                          style: AppTextStyles.headingM.copyWith(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(user.displayName,
                                style: AppTextStyles.headingM),
                            Text(user.email, style: AppTextStyles.bodyM),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _ProfileActionRow(
                    icon: Icons.person_outline_rounded,
                    label: 'Account Details',
                    detail: 'Name, email, and phone',
                    onTap: () => context.push(AppRoutes.profileAccount),
                  ),
                  _ProfileActionRow(
                    icon: Icons.palette_outlined,
                    label: 'Appearance',
                    detail: 'Dark mode and light mode',
                    onTap: () => context.push(AppRoutes.profileAppearance),
                  ),
                  ValueListenableBuilder<bool>(
                    valueListenable: exchangeServicesEnabled,
                    builder: (context, enabled, _) => SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      secondary: Icon(
                        Icons.currency_exchange_rounded,
                        color: AppColors.primary,
                      ),
                      title: Text('Exchange services',
                          style: AppTextStyles.labelM),
                      subtitle: Text(
                        enabled
                            ? 'Exchange is available in the navigation bar.'
                            : 'Hide exchange from the navigation bar.',
                        style: AppTextStyles.bodyS,
                      ),
                      value: enabled,
                      onChanged: setExchangeServicesEnabled,
                    ),
                  ),
                  _ProfileActionRow(
                    icon: Icons.security_rounded,
                    label: 'Security & Limits',
                    detail: 'KYC, role, and session status',
                    onTap: () => context.push(AppRoutes.profileSecurity),
                  ),
                  _ProfileActionRow(
                    icon: Icons.notifications_outlined,
                    label: 'Notifications',
                    detail: 'Account and transaction alerts',
                    onTap: () => context.push(AppRoutes.notifications),
                  ),
                  _ProfileActionRow(
                    icon: Icons.help_outline_rounded,
                    label: 'Help & Support',
                    detail: 'Support options and app details',
                    onTap: () => context.push(AppRoutes.profileSupport),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Center(
                    child: TextButton(
                      onPressed: () async {
                        await _authService.logout();
                        if (context.mounted) context.go(AppRoutes.login);
                      },
                      child: Text(
                        'Log Out',
                        style: AppTextStyles.labelL.copyWith(
                          color: AppColors.error,
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class DashboardTransactionsScreen extends StatefulWidget {
  final HomeDataService homeDataService;

  DashboardTransactionsScreen({
    super.key,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<DashboardTransactionsScreen> createState() =>
      _DashboardTransactionsScreenState();
}

class ProfileActionScreen extends StatefulWidget {
  final ProfileActionKind kind;
  final HomeDataService homeDataService;

  ProfileActionScreen({
    super.key,
    required this.kind,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<ProfileActionScreen> createState() => _ProfileActionScreenState();
}

class _ProfileActionScreenState extends State<ProfileActionScreen> {
  late Future<HomeDashboardData> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchDashboard();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final config = _profileConfigFor(widget.kind);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
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
                  TpPageHeader(
                    label: config.title,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(config.subtitle, style: AppTextStyles.bodyM),
                  const SizedBox(height: AppSpacing.xl),
                  FutureBuilder<HomeDashboardData>(
                    future: _future,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const _LoadingPanel();
                      }
                      if (snapshot.hasError || !snapshot.hasData) {
                        return _ErrorPanel(
                          message: authErrorMessage(
                            snapshot.error ?? 'Could not load this page',
                            'Could not load this page',
                          ),
                          onRetry: () => setState(() {
                            _future = widget.homeDataService.fetchDashboard();
                          }),
                        );
                      }
                      return _profileBodyFor(
                        context,
                        widget.kind,
                        snapshot.data!,
                        widget.homeDataService,
                      );
                    },
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

class _DashboardTransactionsScreenState
    extends State<DashboardTransactionsScreen> {
  final _authService = AuthService();
  late Future<List<HomeTransaction>> _future;
  bool _sessionExpired = false;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchTransactions();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (_sessionExpired) {
      return _SessionExpiredScreen(
        onLogin: () => context.go(AppRoutes.login),
      );
    }

    return TransactionsDetailScaffold(
      future: _future,
      onRetry: () {
        setState(() {
          _future = widget.homeDataService.fetchTransactions();
        });
      },
      onUnauthorized: () async {
        final refreshed = await _authService.refreshSession();
        if (!mounted) return;
        if (refreshed) {
          setState(() {
            _future = widget.homeDataService.fetchTransactions();
          });
        } else {
          setState(() => _sessionExpired = true);
        }
      },
    );
  }
}

class TransactionsDetailScaffold extends StatelessWidget {
  final Future<List<HomeTransaction>> future;
  final VoidCallback onRetry;
  final Future<void> Function() onUnauthorized;

  const TransactionsDetailScaffold({
    super.key,
    required this.future,
    required this.onRetry,
    required this.onUnauthorized,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              sliver: SliverList.list(
                children: [
                  const TpPageHeader(
                    label: 'My Transactions',
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  FutureBuilder<List<HomeTransaction>>(
                    future: future,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const _LoadingPanel();
                      }
                      if (snapshot.hasError || !snapshot.hasData) {
                        final error = snapshot.error;
                        if (_isUnauthorized(error)) {
                          return _UnauthorizedPanel(onRetry: onUnauthorized);
                        }

                        return _ErrorPanel(
                          message: authErrorMessage(
                            error ?? 'Could not load transactions',
                            'Could not load transactions',
                          ),
                          onRetry: onRetry,
                        );
                      }
                      final transactions = snapshot.data!;
                      if (transactions.isEmpty) {
                        return SizedBox(
                          height: MediaQuery.sizeOf(context).height * 0.68,
                          child: const TpEmptyState(
                            variant: TpIllustrationVariant.emptyTransactions,
                            illustrationAsset:
                                'assets/images/empty_states/empty-transactions.svg',
                            title: 'No transactions yet',
                            message:
                                'Your completed activity will appear here.',
                            illustrationSize: 220,
                          ),
                        );
                      }
                      return _TransactionsHistoryBody(
                          transactions: transactions);
                    },
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

class DashboardDetailScaffold extends StatelessWidget {
  final String title;
  final String subtitle;
  final Future<HomeDashboardData> future;
  final VoidCallback onRetry;
  final Widget Function(HomeDashboardData data) builder;

  const DashboardDetailScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.future,
    required this.onRetry,
    required this.builder,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              sliver: SliverList.list(
                children: [
                  TpPageHeader(
                    label: title,
                    menuActions: [
                      TpPageMenuAction(
                        label: 'Refresh',
                        icon: Icons.refresh_rounded,
                        onTap: onRetry,
                      ),
                      TpPageMenuAction(
                        label: 'Home',
                        icon: Icons.home_rounded,
                        onTap: () => context.go(AppRoutes.home),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(subtitle, style: AppTextStyles.bodyM),
                  const SizedBox(height: AppSpacing.xl),
                  FutureBuilder<HomeDashboardData>(
                    future: future,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const _LoadingPanel();
                      }
                      if (snapshot.hasError || !snapshot.hasData) {
                        return _ErrorPanel(
                          message: authErrorMessage(
                            snapshot.error ?? 'Could not load this page',
                            'Could not load this page',
                          ),
                          onRetry: onRetry,
                        );
                      }
                      return builder(snapshot.data!);
                    },
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

Widget _bodyFor(DashboardDetailKind kind, HomeDashboardData data) {
  switch (kind) {
    case DashboardDetailKind.wallets:
      return _WalletsBody(wallets: data.wallets);
    case DashboardDetailKind.virtualAccount:
      return _VirtualAccountBody(
        accounts: data.virtualAccounts,
        kycStatus: data.user.kycStatus,
      );
    case DashboardDetailKind.activity:
      return _ActivityBody(transactions: data.transactions);
    case DashboardDetailKind.kyc:
      return _KycBody(status: data.user.kycStatus);
    case DashboardDetailKind.notifications:
      return _NotificationsBody(
        data: data,
      );
  }
}

Widget _profileBodyFor(
  BuildContext context,
  ProfileActionKind kind,
  HomeDashboardData data,
  HomeDataService homeDataService,
) {
  final user = data.user;

  switch (kind) {
    case ProfileActionKind.account:
      return _AccountDetailsBody(
        data: data,
        homeDataService: homeDataService,
      );
    case ProfileActionKind.appearance:
      return const _AppearanceSettingsPanel();
    case ProfileActionKind.security:
      return _SecurityLimitsBody(
        user: user,
        onKyc: () => context.push(AppRoutes.kyc),
        onTransactionSecurity: () =>
            context.push(AppRoutes.transactionSecurity),
      );
    case ProfileActionKind.support:
      return _SupportTicketPanel(
        homeDataService: homeDataService,
      );
  }
}

_DetailConfig _configFor(DashboardDetailKind kind) {
  switch (kind) {
    case DashboardDetailKind.wallets:
      return const _DetailConfig(
        title: 'Wallets',
        subtitle: 'Your money, all in one place.',
      );
    case DashboardDetailKind.virtualAccount:
      return const _DetailConfig(
        title: 'Paystack NGN account',
        subtitle: 'Receive NGN bank transfers directly into your wallet.',
      );
    case DashboardDetailKind.activity:
      return const _DetailConfig(
        title: 'History',
        subtitle: 'Recent transactions',
      );
    case DashboardDetailKind.kyc:
      return const _DetailConfig(
        title: 'KYC verification',
        subtitle: 'Current verification status and account access.',
      );
    case DashboardDetailKind.notifications:
      return const _DetailConfig(
        title: 'Notifications',
        subtitle:
            'Recent account status. Refresh for updates; dismissals last for this visit.',
      );
  }
}

_DetailConfig _profileConfigFor(ProfileActionKind kind) {
  switch (kind) {
    case ProfileActionKind.account:
      return const _DetailConfig(
        title: 'Account Details',
        subtitle: 'Your saved TrustPay account identity details.',
      );
    case ProfileActionKind.appearance:
      return const _DetailConfig(
        title: 'Appearance',
        subtitle: 'Choose how TrustPay looks across your device.',
      );
    case ProfileActionKind.security:
      return const _DetailConfig(
        title: 'Security & Limits',
        subtitle: 'Account upgrade, PIN, biometrics, and KYC tiers.',
      );
    case ProfileActionKind.support:
      return const _DetailConfig(
        title: 'Help & Support',
        subtitle: 'Support channels and operational guidance.',
      );
  }
}

class _SecurityLimitsBody extends StatelessWidget {
  final HomeUser user;
  final VoidCallback onKyc;
  final VoidCallback onTransactionSecurity;

  const _SecurityLimitsBody({
    required this.user,
    required this.onKyc,
    required this.onTransactionSecurity,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final tier = user.kycTier.toUpperCase();
    final verified = user.kycStatus.toUpperCase() == 'VERIFIED';

    return Column(
      children: [
        _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Account upgrade', style: AppTextStyles.headingM),
              const SizedBox(height: AppSpacing.xs),
              Text(
                verified
                    ? 'Your account is verified. Upgrade tiers unlock higher limits as they become available.'
                    : 'Complete verification to unlock withdrawals, virtual accounts, and higher limits.',
                style: AppTextStyles.bodyM,
              ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: onKyc,
                  icon: const Icon(Icons.trending_up_rounded),
                  label: Text(verified ? 'View KYC status' : 'Upgrade account'),
                ),
              ),
            ],
          ),
        ),
        _TierStatusCard(
          title: 'Tier 1 verification',
          detail: 'Basic profile, phone, and starter wallet access.',
          active: tier == 'TIER_1' || tier == 'TIER_2' || tier == 'TIER_3',
          onTap: onKyc,
        ),
        _TierStatusCard(
          title: 'Tier 2 KYC verification',
          detail:
              'Identity verification for transfers, VTU, and virtual account access.',
          active: tier == 'TIER_2' || tier == 'TIER_3',
          onTap: onKyc,
        ),
        _ProfileActionRow(
          icon: Icons.password_rounded,
          label: 'Change PIN',
          detail: 'Create or update the PIN used before transactions',
          onTap: onTransactionSecurity,
        ),
        _ProfileActionRow(
          icon: Icons.fingerprint_rounded,
          label: 'Biometric app unlock',
          detail: 'Unlock the app with fingerprint or Face ID where supported',
          onTap: onTransactionSecurity,
        ),
        _DataPanel(
          child: Text(
            'All money actions request a freshly entered transaction PIN before submission. Keep your PIN private and never share OTPs or passwords.',
            style: AppTextStyles.bodyM,
          ),
        ),
        const _ActiveSessionsPanel(),
      ],
    );
  }
}

class _TierStatusCard extends StatelessWidget {
  final String title;
  final String detail;
  final bool active;
  final VoidCallback onTap;

  const _TierStatusCard({
    required this.title,
    required this.detail,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: (active ? AppColors.success : AppColors.warning)
                    .withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Icon(
                active ? Icons.verified_rounded : Icons.lock_outline_rounded,
                color: active ? AppColors.success : AppColors.warning,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTextStyles.labelM),
                  const SizedBox(height: 2),
                  Text(detail, style: AppTextStyles.bodyS),
                ],
              ),
            ),
            _StatusPill(label: active ? 'Active' : 'Required'),
          ],
        ),
      ),
    );
  }
}

class _AccountDetailsBody extends StatefulWidget {
  final HomeDashboardData data;
  final HomeDataService homeDataService;

  const _AccountDetailsBody({
    required this.data,
    required this.homeDataService,
  });

  @override
  State<_AccountDetailsBody> createState() => _AccountDetailsBodyState();
}

class _AccountDetailsBodyState extends State<_AccountDetailsBody> {
  final _provisionAttempt = MoneyAttemptIdempotency();
  final _fullNameController = TextEditingController();
  final _yearOfBirthController = TextEditingController();
  final _countryController = TextEditingController();
  final _phoneController = TextEditingController();
  late HomeUser _user;
  late List<HomeVirtualAccount> _accounts;
  late List<HomeTransaction> _transactions;
  bool _isProvisioning = false;
  bool _isSavingProfile = false;
  bool _isRequestingDeletion = false;
  bool _isLoadingTransactions = false;
  HomeVirtualAccountProvisioning? _provisioning;
  late Future<List<SupportTicket>> _closureRequests;
  String? _message;

  @override
  void initState() {
    super.initState();
    _user = widget.data.user;
    _accounts = widget.data.virtualAccounts;
    _transactions = widget.data.transactions;
    _closureRequests = widget.homeDataService.fetchSupportTickets(limit: 100);
    _fullNameController.text = _user.fullName;
    _yearOfBirthController.text = _user.yearOfBirth?.toString() ?? '';
    _countryController.text = _user.country.isEmpty ? 'NG' : _user.country;
    _phoneController.text = _user.phone;
    _loadTransactionVolume();
    _loadProvisioningStatus();
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _yearOfBirthController.dispose();
    _countryController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _saveProfileDetails() async {
    if (_isSavingProfile || !_user.canEditProfileDetails) return;

    final year = int.tryParse(_yearOfBirthController.text.trim());
    if (_fullNameController.text.trim().length < 2) {
      setState(() => _message = 'Enter your legal name.');
      return;
    }
    if (year == null || year < 1900 || year > DateTime.now().year - 13) {
      setState(() => _message = 'Enter a valid year of birth.');
      return;
    }
    final country = _countryController.text.trim().toUpperCase();
    if (!['NG', 'GH'].contains(country)) {
      setState(() => _message = 'Country must be NG or GH.');
      return;
    }
    final phone =
        _phoneController.text.replaceAll(RegExp(r'[\s-]+'), '').trim();
    final phoneError = _countryPhoneError(country, phone);
    if (phoneError != null) {
      setState(() => _message = phoneError);
      return;
    }

    setState(() {
      _isSavingProfile = true;
      _message = null;
    });

    try {
      final updated = await widget.homeDataService.updateProfile(
        fullName: _fullNameController.text,
        phone: phone,
        yearOfBirth: year,
        country: country,
      );
      if (!mounted) return;
      setState(() {
        _user = updated;
        _message =
            'Profile details saved. These identity fields are now locked.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _message = authErrorMessage(error, 'Could not save profile details.');
      });
    } finally {
      if (mounted) {
        setState(() => _isSavingProfile = false);
      }
    }
  }

  Future<void> _requestAccountDeletion() async {
    if (_isRequestingDeletion) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Delete account', style: AppTextStyles.headingM),
        content: Text(
          'We will submit an account closure request. Wallet, KYC, and transaction records may be retained where required for audit and compliance.',
          style: AppTextStyles.bodyM,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(
              'Cancel',
              style: AppTextStyles.labelM.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
            ),
            child: const Text('Request deletion'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _isRequestingDeletion = true;
      _message = null;
    });

    try {
      final ticket = await widget.homeDataService.createSupportTicket(
        category: 'ACCOUNT',
        description:
            'Account deletion requested from mobile profile. Please review wallet, KYC, transaction retention, and closure requirements.',
      );
      if (!mounted) return;
      setState(() {
        _message =
            'Closure request ${ticket.id}: ${ticket.status}. Your account has not been deleted.';
        _closureRequests =
            widget.homeDataService.fetchSupportTickets(limit: 100);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _message =
            authErrorMessage(error, 'Could not request account deletion.');
      });
    } finally {
      if (mounted) {
        setState(() => _isRequestingDeletion = false);
      }
    }
  }

  String? _countryPhoneError(String country, String phone) {
    switch (country) {
      case 'NG':
        if (RegExp(r'^\+234\d{10}$').hasMatch(phone)) return null;
        return 'Nigeria phone numbers must start with +234. Example: +2348012345678.';
      case 'GH':
        if (RegExp(r'^\+233\d{9}$').hasMatch(phone)) return null;
        return 'Ghana phone numbers must start with +233. Example: +233241234567.';
      default:
        return 'Choose Nigeria or Ghana before entering your phone number.';
    }
  }

  Future<void> _loadTransactionVolume() async {
    setState(() => _isLoadingTransactions = true);
    try {
      final transactions = await widget.homeDataService.fetchTransactions(
        limit: 100,
      );
      if (!mounted) return;
      setState(() => _transactions = transactions);
    } on DioException {
      // Keep the identity page usable even when the optional volume pull fails.
    } finally {
      if (mounted) {
        setState(() => _isLoadingTransactions = false);
      }
    }
  }

  Future<void> _loadProvisioningStatus() async {
    try {
      final provisioning =
          await widget.homeDataService.fetchVirtualAccountProvisioning();
      if (!mounted) return;
      setState(() => _provisioning = provisioning);
    } on DioException {
      // Keep this page usable on deployments without the optional status
      // endpoint. The issued account list remains authoritative.
    }
  }

  Future<void> _generateVirtualAccount() async {
    if (_isProvisioning) return;

    if (_provisioning?.isPending == true) {
      setState(() {
        _message = _provisioning?.message.isNotEmpty == true
            ? _provisioning!.message
            : 'Paystack is already preparing your NGN receiving account. Refresh shortly.';
      });
      await _loadProvisioningStatus();
      return;
    }

    final consentAccepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Set up your Paystack account'),
        content: const Text(
          'I authorize TRUSTPAY to create a dedicated NGN receiving account with Paystack for wallet funding. Paystack will confirm incoming transfers before your wallet is credited.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Authorize setup'),
          ),
        ],
      ),
    );
    if (consentAccepted != true || !mounted) return;

    setState(() {
      _isProvisioning = true;
      _message = null;
    });

    try {
      final account = await widget.homeDataService.provisionVirtualAccount(
        consentAccepted: true,
        idempotencyKey: _provisionAttempt.keyFor(
          'paystack-virtual-account|${widget.data.user.id}|NGN',
        ),
      );
      _provisionAttempt.markFinalOutcome();
      if (!mounted) return;
      setState(() {
        _provisioning = HomeVirtualAccountProvisioning(
          provider: account.provider.isEmpty ? 'PAYSTACK' : account.provider,
          status: account.status,
        );
        _accounts = [
          account,
          ..._accounts.where((item) =>
              item.displayAccountNumber != account.displayAccountNumber),
        ];
        _message = account.status.toUpperCase() == 'PENDING'
            ? 'Paystack is preparing your NGN receiving account. Refresh shortly.'
            : account.status.toUpperCase() == 'ACTION_REQUIRED'
                ? 'Paystack account setup needs attention. Review your details or contact support, then retry.'
                : 'Paystack receiving account is ready.';
      });
    } on DioException catch (error) {
      if ((error.response?.statusCode ?? 0) >= 400 &&
          (error.response?.statusCode ?? 0) < 500) {
        _provisionAttempt.markFinalOutcome();
      }
      if (!mounted) return;
      setState(() {
        _message = _readDioErrorMessage(error) ?? 'Unable to generate account.';
      });
    } finally {
      if (mounted) {
        setState(() => _isProvisioning = false);
      }
    }
  }

  HomeVirtualAccount? get _paystackNgnAccount {
    for (final account in _accounts) {
      if (account.provider.toUpperCase() == 'PAYSTACK' &&
          account.currency.toUpperCase() == 'NGN' &&
          account.status.toUpperCase() == 'ACTIVE') {
        return account;
      }
    }
    for (final account in _accounts) {
      if (account.provider.toUpperCase() == 'PAYSTACK' &&
          account.currency.toUpperCase() == 'NGN') {
        if (account.status.toUpperCase() != 'ACTIVE' &&
            account.status.toUpperCase() != 'PENDING') {
          continue;
        }
        return account;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final primaryAccount = _paystackNgnAccount;
    final canEdit = _user.canEditProfileDetails;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ProfileIdentityPanel(
          user: _user,
          canEdit: canEdit,
          isSaving: _isSavingProfile,
          fullNameController: _fullNameController,
          yearOfBirthController: _yearOfBirthController,
          countryController: _countryController,
          phoneController: _phoneController,
          onSave: _saveProfileDetails,
        ),
        _VirtualAccountSummaryCard(
          account: primaryAccount,
          isProvisioning: _isProvisioning,
          provisioningPending: _provisioning?.isPending == true,
          provisioningActionRequired: _provisioning?.isActionRequired == true,
          onGenerate: _generateVirtualAccount,
        ),
        if (_message != null)
          _DataPanel(
            child: Text(
              _message!,
              style: AppTextStyles.bodyM.copyWith(
                color: _message!.toLowerCase().contains('unable') ||
                        _message!.toLowerCase().contains('add')
                    ? AppColors.warning
                    : AppColors.success,
              ),
            ),
          ),
        _TransactionVolumeSummary(
          transactions: _transactions,
          isLoading: _isLoadingTransactions,
        ),
        _DeleteAccountPanel(
          isRequesting: _isRequestingDeletion,
          onRequest: _requestAccountDeletion,
        ),
        FutureBuilder<List<SupportTicket>>(
          future: _closureRequests,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Checking closure requests…'));
            }
            if (snapshot.hasError) {
              return _ErrorPanel(
                  message: 'Closure request status is unavailable.',
                  onRetry: () => setState(() {
                        _closureRequests = widget.homeDataService
                            .fetchSupportTickets(limit: 100);
                      }));
            }
            final requests = (snapshot.data ?? [])
                .where((ticket) =>
                    ticket.type == 'ACCOUNT_DELETION' ||
                    (ticket.type == 'ACCOUNT' &&
                        ticket.description
                            .toLowerCase()
                            .contains('account deletion')))
                .toList();
            return Column(children: [
              for (final request in requests)
                _DataPanel(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('Closure request ${request.id}',
                          style: AppTextStyles.labelM),
                      Text('Support status: ${request.status}',
                          style: AppTextStyles.bodyM),
                      if (request.resolution.isNotEmpty)
                        Text(request.resolution, style: AppTextStyles.bodyM),
                      Text(
                          'A support status does not by itself confirm account deletion.',
                          style: AppTextStyles.bodyS),
                    ])),
            ]);
          },
        ),
      ],
    );
  }
}

class _ProfileIdentityPanel extends StatelessWidget {
  final HomeUser user;
  final bool canEdit;
  final bool isSaving;
  final TextEditingController fullNameController;
  final TextEditingController yearOfBirthController;
  final TextEditingController countryController;
  final TextEditingController phoneController;
  final VoidCallback onSave;

  const _ProfileIdentityPanel({
    required this.user,
    required this.canEdit,
    required this.isSaving,
    required this.fullNameController,
    required this.yearOfBirthController,
    required this.countryController,
    required this.phoneController,
    required this.onSave,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (!canEdit) {
      return _DataPanel(
        child: Column(
          children: [
            _CompactInfoLine(label: 'Full name', value: user.fullName),
            _CompactInfoLine(
                label: 'Year of birth',
                value: '${user.yearOfBirth ?? 'Not set'}'),
            _CompactInfoLine(
              label: 'Country',
              value: user.country.isEmpty ? 'Not set' : user.country,
            ),
            _CompactInfoLine(label: 'Phone', value: user.phone),
            _CompactInfoLine(label: 'Email', value: user.email),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Icon(Icons.lock_outline_rounded,
                    size: 16, color: AppColors.textSecondary),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    'Identity details can only be edited once.',
                    style: AppTextStyles.bodyS,
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Identity details', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'You can edit these details once. Use your legal information.',
            style: AppTextStyles.bodyS,
          ),
          const SizedBox(height: AppSpacing.md),
          _ProfileTextField(
            controller: fullNameController,
            label: 'Full name',
            enabled: !isSaving,
          ),
          const SizedBox(height: AppSpacing.sm),
          _ProfileTextField(
            controller: yearOfBirthController,
            label: 'Year of birth',
            enabled: !isSaving,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: AppSpacing.sm),
          _ProfileCountryPicker(
            controller: countryController,
            enabled: !isSaving,
          ),
          const SizedBox(height: AppSpacing.sm),
          _ProfileTextField(
            controller: phoneController,
            label: 'Phone number',
            enabled: !isSaving,
            hint: '+2348012345678 or +233241234567',
            helperText: 'Use +234 for NG or +233 for GH.',
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: isSaving ? null : onSave,
              icon: Icon(isSaving
                  ? Icons.hourglass_empty_rounded
                  : Icons.check_rounded),
              label: Text(isSaving ? 'Saving details' : 'Save once'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileCountryPicker extends StatelessWidget {
  final TextEditingController controller;
  final bool enabled;

  const _ProfileCountryPicker({
    required this.controller,
    required this.enabled,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final current = _supportedProfileCountries.contains(
      controller.text.trim().toUpperCase(),
    )
        ? controller.text.trim().toUpperCase()
        : 'NG';

    return DropdownButtonFormField<String>(
      initialValue: current,
      items: const [
        DropdownMenuItem(
          value: 'NG',
          child: Text('Nigeria (+234 / NGN)'),
        ),
        DropdownMenuItem(
          value: 'GH',
          child: Text('Ghana (+233 / GHS)'),
        ),
      ],
      onChanged: enabled
          ? (value) {
              if (value == null) return;
              controller.text = value;
            }
          : null,
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
      decoration: InputDecoration(
        labelText: 'Country',
        helperText: 'Phone prefix follows this country.',
        filled: true,
        fillColor: AppColors.inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(color: AppColors.primary),
        ),
      ),
    );
  }
}

const _supportedProfileCountries = ['NG', 'GH'];

class _ProfileTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool enabled;
  final String? hint;
  final String? helperText;
  final TextInputType? keyboardType;

  const _ProfileTextField({
    required this.controller,
    required this.label,
    required this.enabled,
    this.hint,
    this.helperText,
    this.keyboardType,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: keyboardType,
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        helperText: helperText,
        filled: true,
        fillColor: AppColors.inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(color: AppColors.border),
        ),
      ),
    );
  }
}

class _DeleteAccountPanel extends StatelessWidget {
  final bool isRequesting;
  final VoidCallback onRequest;

  const _DeleteAccountPanel({
    required this.isRequesting,
    required this.onRequest,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Delete account',
            style: AppTextStyles.headingM.copyWith(color: AppColors.error),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Submit an account closure request. Financial and KYC records may be retained for audit and compliance.',
            style: AppTextStyles.bodyM,
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: isRequesting ? null : onRequest,
              icon: Icon(isRequesting
                  ? Icons.hourglass_empty_rounded
                  : Icons.delete_outline_rounded),
              label: Text(
                isRequesting ? 'Requesting deletion' : 'Delete account',
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.error,
                side: BorderSide(color: AppColors.error),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactInfoLine extends StatelessWidget {
  final String label;
  final String value;

  const _CompactInfoLine({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppTextStyles.bodyM)),
          const SizedBox(width: AppSpacing.md),
          Flexible(
            child: Text(
              value.isEmpty ? 'Not set' : value,
              style: AppTextStyles.labelM,
              textAlign: TextAlign.right,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _VirtualAccountSummaryCard extends StatelessWidget {
  final HomeVirtualAccount? account;
  final bool isProvisioning;
  final bool provisioningPending;
  final bool provisioningActionRequired;
  final VoidCallback onGenerate;

  const _VirtualAccountSummaryCard({
    required this.account,
    required this.isProvisioning,
    required this.provisioningPending,
    required this.provisioningActionRequired,
    required this.onGenerate,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final current = account;
    final accountPending = provisioningPending ||
        (current != null &&
            current.displayAccountNumber.isEmpty &&
            current.status.toUpperCase() == 'PENDING');

    return _DataPanel(
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
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  'Paystack NGN receiving account',
                  style: AppTextStyles.headingM,
                ),
              ),
              if (current != null) _StatusPill(label: current.status),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (provisioningActionRequired) ...[
            const Icon(Icons.warning_amber_rounded),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Paystack account setup needs attention. Review the details or contact support, then retry.',
              style: AppTextStyles.bodyM,
            ),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: isProvisioning ? null : onGenerate,
                icon: isProvisioning
                    ? const Icon(Icons.hourglass_empty_rounded)
                    : const Icon(Icons.refresh_rounded),
                label: Text(
                  isProvisioning ? 'Retrying setup' : 'Retry account setup',
                ),
              ),
            ),
          ] else if (accountPending) ...[
            const Icon(Icons.schedule_rounded),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Paystack is preparing your NGN receiving account. Refresh shortly.',
              style: AppTextStyles.bodyM,
            ),
          ] else if (current == null) ...[
            Text(
              'Get a dedicated Paystack account number for receiving NGN transfers into your wallet.',
              style: AppTextStyles.bodyM,
            ),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: isProvisioning ? null : onGenerate,
                icon: isProvisioning
                    ? const Icon(Icons.hourglass_empty_rounded)
                    : const Icon(Icons.add_rounded),
                label: Text(
                  isProvisioning ? 'Generating account' : 'Generate account',
                ),
              ),
            ),
          ] else ...[
            Text(
              current.displayAccountNumber.isEmpty
                  ? current.accountNumberMasked
                  : current.displayAccountNumber,
              style: AppTextStyles.displayMedium.copyWith(
                fontSize: 30,
                letterSpacing: 0.4,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _CompactInfoLine(label: 'Bank', value: current.bankName),
            _CompactInfoLine(label: 'Account name', value: current.accountName),
            _CompactInfoLine(label: 'Currency', value: current.currency),
            _CompactInfoLine(label: 'Provider', value: current.provider),
          ],
        ],
      ),
    );
  }
}

class _TransactionVolumeSummary extends StatelessWidget {
  final List<HomeTransaction> transactions;
  final bool isLoading;

  const _TransactionVolumeSummary({
    required this.transactions,
    required this.isLoading,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final volumes = _transactionVolumes(transactions);

    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Transaction volume',
                  style: AppTextStyles.headingM,
                ),
              ),
              if (isLoading)
                Text(
                  'Updating...',
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            transactions.isEmpty
                ? 'No transaction volume recorded yet.'
                : 'Based on your recent activity.',
            style: AppTextStyles.bodyS,
          ),
          const SizedBox(height: AppSpacing.md),
          if (volumes.isEmpty)
            Text('No completed transactions yet.', style: AppTextStyles.bodyM)
          else
            ...volumes.entries.map((entry) {
              final value = entry.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        entry.key,
                        style: AppTextStyles.labelM,
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          'In ${_money(entry.key, value.credit)}',
                          style: AppTextStyles.bodyS.copyWith(
                            color: AppColors.success,
                          ),
                        ),
                        Text(
                          'Out ${_money(entry.key, value.debit)}',
                          style: AppTextStyles.bodyS,
                        ),
                      ],
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _TransactionVolume {
  final MoneyValue credit;
  final MoneyValue debit;

  const _TransactionVolume({required this.credit, required this.debit});
}

class _AppearanceSettingsPanel extends ConsumerWidget {
  const _AppearanceSettingsPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    AppColors.watch(context);
    final themeMode = ref.watch(themeModeProvider);
    final controller = ref.read(themeModeProvider.notifier);

    void select(ThemeMode mode) {
      if (mode == themeMode) return;
      Haptics.selection();
      controller.setMode(mode);
    }

    return Column(
      children: [
        _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Appearance', style: AppTextStyles.headingM),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Match your device automatically, or lock TrustPay to a light '
                'or dark look.',
                style: AppTextStyles.bodyM,
              ),
              const SizedBox(height: AppSpacing.md),
              Container(
                padding: const EdgeInsets.all(AppSpacing.xs),
                decoration: BoxDecoration(
                  color: AppColors.inputFill,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: _ThemeModeChip(
                        label: 'System',
                        icon: Icons.brightness_auto_rounded,
                        active: themeMode == ThemeMode.system,
                        onTap: () => select(ThemeMode.system),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Expanded(
                      child: _ThemeModeChip(
                        label: 'Light',
                        icon: Icons.light_mode_rounded,
                        active: themeMode == ThemeMode.light,
                        onTap: () => select(ThemeMode.light),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Expanded(
                      child: _ThemeModeChip(
                        label: 'Dark',
                        icon: Icons.dark_mode_rounded,
                        active: themeMode == ThemeMode.dark,
                        onTap: () => select(ThemeMode.dark),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ProfileThemeQuickToggle extends ConsumerWidget {
  const _ProfileThemeQuickToggle();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    AppColors.watch(context);
    ref.watch(themeModeProvider);
    final controller = ref.read(themeModeProvider.notifier);
    // Reflect what the user is actually looking at (handles system mode too).
    final isDark = AppColors.isDark;

    return Semantics(
      button: true,
      label: isDark ? 'Switch to light mode' : 'Switch to dark mode',
      child: Material(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.full),
          onTap: () {
            Haptics.selection();
            controller.setMode(isDark ? ThemeMode.light : ThemeMode.dark);
          },
          child: Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.full),
              border: Border.all(color: AppColors.border),
            ),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 260),
              transitionBuilder: (child, anim) => RotationTransition(
                turns: Tween<double>(begin: 0.6, end: 1).animate(anim),
                child: FadeTransition(opacity: anim, child: child),
              ),
              child: Icon(
                isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
                key: ValueKey(isDark),
                color: AppColors.primary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SupportTicketPanel extends StatefulWidget {
  final HomeDataService homeDataService;

  const _SupportTicketPanel({
    required this.homeDataService,
  });

  @override
  State<_SupportTicketPanel> createState() => _SupportTicketPanelState();
}

class _SupportTicketPanelState extends State<_SupportTicketPanel> {
  final _referenceController = TextEditingController();
  final _descriptionController = TextEditingController();
  late Future<List<SupportTicket>> _ticketsFuture;
  String _category = 'TRANSACTION';
  bool _submitting = false;
  bool _openingChat = false;
  String? _message;

  static const _categories = [
    'ACCOUNT',
    'KYC',
    'WALLET',
    'TRANSACTION',
    'WITHDRAWAL',
    'EXCHANGE',
    'VTU',
    'OTHER',
  ];

  @override
  void initState() {
    super.initState();
    _ticketsFuture = widget.homeDataService.fetchSupportTickets();
  }

  @override
  void dispose() {
    _referenceController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _reloadTickets() {
    setState(() {
      _ticketsFuture = widget.homeDataService.fetchSupportTickets();
    });
  }

  Future<void> _submitTicket() async {
    final description = _descriptionController.text.trim();
    if (description.length < 20) {
      setState(() {
        _message = 'Describe the issue in at least 20 characters.';
      });
      return;
    }

    setState(() {
      _submitting = true;
      _message = null;
    });

    try {
      await widget.homeDataService.createSupportTicket(
        category: _category,
        description: description,
        transactionReference: _referenceController.text.trim(),
      );
      _referenceController.clear();
      _descriptionController.clear();
      if (!mounted) return;
      setState(() {
        _message = 'Support case sent to customer care.';
        _ticketsFuture = widget.homeDataService.fetchSupportTickets();
      });
    } on DioException catch (error) {
      if (!mounted) return;
      setState(() {
        _message = _readDioMessage(error) ?? 'Unable to send support case.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      children: [
        _DataPanel(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.privacy_tip_rounded, color: AppColors.warning),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  'Customer care can trace wallet, payment, VTU, exchange, KYC, and withdrawal cases. Do not send OTPs, passwords, full card details, or full bank account numbers.',
                  style: AppTextStyles.bodyM,
                ),
              ),
            ],
          ),
        ),
        const _FaqPanel(),
        _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Contact support', style: AppTextStyles.headingM),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Chat with customer care for account, wallet, and verification questions.',
                style: AppTextStyles.bodyM,
              ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _openingChat
                      ? null
                      : () async {
                          setState(() => _openingChat = true);
                          try {
                            await openTawkChat(context);
                          } finally {
                            if (mounted) setState(() => _openingChat = false);
                          }
                        },
                  icon: const Icon(Icons.chat_bubble_outline_rounded),
                  label: Text(
                      _openingChat ? 'Opening support…' : 'Open live chat'),
                ),
              ),
            ],
          ),
        ),
        _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Open a case', style: AppTextStyles.headingM),
              const SizedBox(height: AppSpacing.md),
              DropdownButtonFormField<String>(
                initialValue: _category,
                items: _categories
                    .map(
                      (item) => DropdownMenuItem(
                        value: item,
                        child: Text(switch (item) {
                          'KYC' => 'Identity verification',
                          'VTU' => 'Bill payment',
                          _ => '${item[0]}${item.substring(1).toLowerCase()}',
                        }),
                      ),
                    )
                    .toList(),
                onChanged: _submitting
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _category = value);
                        }
                      },
                dropdownColor: AppColors.surface,
                decoration: _supportInputDecoration('Issue type'),
                style: AppTextStyles.bodyM.copyWith(
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _referenceController,
                enabled: !_submitting,
                style: AppTextStyles.bodyM.copyWith(
                  color: AppColors.textPrimary,
                ),
                decoration: _supportInputDecoration(
                  'Transaction reference (optional)',
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _descriptionController,
                enabled: !_submitting,
                minLines: 4,
                maxLines: 6,
                style: AppTextStyles.bodyM.copyWith(
                  color: AppColors.textPrimary,
                ),
                decoration: _supportInputDecoration('What happened?'),
              ),
              if (_message != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(_message!, style: AppTextStyles.bodyS),
              ],
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _submitting ? null : _submitTicket,
                  icon: _submitting
                      ? const Icon(Icons.hourglass_empty_rounded)
                      : const Icon(Icons.support_agent_rounded),
                  label: Text(_submitting ? 'Sending case' : 'Send to support'),
                ),
              ),
            ],
          ),
        ),
        FutureBuilder<List<SupportTicket>>(
          future: _ticketsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return _DataPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Recent cases', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Support history will appear here shortly.',
                      style: AppTextStyles.bodyM,
                    ),
                  ],
                ),
              );
            }

            if (snapshot.hasError) {
              return _DataPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Cases unavailable', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Pull to refresh later or contact operations with your transaction reference.',
                      style: AppTextStyles.bodyM,
                    ),
                  ],
                ),
              );
            }

            final tickets = snapshot.data ?? const <SupportTicket>[];
            if (tickets.isEmpty) {
              return const _EmptyPanel(
                icon: Icons.support_agent_rounded,
                title: 'No support cases',
                detail: 'Cases you send to customer care will appear here.',
              );
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Recent cases',
                        style: AppTextStyles.headingM,
                      ),
                    ),
                    IconButton(
                      onPressed: _reloadTickets,
                      icon: const Icon(Icons.refresh_rounded),
                      color: AppColors.textSecondary,
                    ),
                  ],
                ),
                ...tickets.map((ticket) => _SupportTicketCard(ticket: ticket)),
              ],
            );
          },
        ),
      ],
    );
  }

  String? _readDioMessage(DioException error) {
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final message = data['message'];
      if (message is String) return message;
      if (message is List && message.isNotEmpty) {
        return message.first.toString();
      }
    }
    return null;
  }
}

class _InviteFriendPanel extends StatefulWidget {
  final HomeDataService homeDataService;

  const _InviteFriendPanel({
    required this.homeDataService,
  });

  @override
  State<_InviteFriendPanel> createState() => _InviteFriendPanelState();
}

class _InviteFriendPanelState extends State<_InviteFriendPanel> {
  late Future<ReferralDashboard> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchReferralDashboard();
  }

  void _reload() {
    setState(() => _future = widget.homeDataService.fetchReferralDashboard());
  }

  Future<void> _copyInvite(ReferralDashboard data) async {
    final message =
        'Join TrustPay and exchange NGN/GHS faster. Use my referral code ${data.code} to sign up.';
    await Clipboard.setData(ClipboardData(text: message));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Invite message copied')),
    );
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return FutureBuilder<ReferralDashboard>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _LoadingPanel();
        }

        if (snapshot.hasError || !snapshot.hasData) {
          return _ErrorPanel(
            message: authErrorMessage(
              snapshot.error ?? 'Could not load referrals',
              'Could not load referrals',
            ),
            onRetry: _reload,
          );
        }

        final data = snapshot.data!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _DataPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: Icon(
                      Icons.card_giftcard_rounded,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('Earn NGN 100', style: AppTextStyles.headingL),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Invite friends to TrustPay. You get ${_money(data.rewardCurrency, data.exactRewardAmount)} for each eligible friend who signs up with your code.',
                    style: AppTextStyles.bodyM,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.inputFill,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            data.code,
                            style: AppTextStyles.headingM.copyWith(
                              letterSpacing: 1.2,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Copy invite',
                          onPressed: () => _copyInvite(data),
                          icon: const Icon(Icons.copy_rounded),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => _copyInvite(data),
                      icon: const Icon(Icons.ios_share_rounded),
                      label: const Text('Copy invite message'),
                    ),
                  ),
                ],
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: _ReferralMetricCard(
                    label: 'Invites',
                    value: '${data.invites}',
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _ReferralMetricCard(
                    label: 'Pending',
                    value: _money('NGN', data.exactPendingAmount),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _ReferralMetricCard(
                    label: 'Paid',
                    value: _money('NGN', data.exactPaidAmount),
                  ),
                ),
              ],
            ),
            _DataPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('How it works', style: AppTextStyles.headingM),
                  const SizedBox(height: AppSpacing.md),
                  const _ReferralStep(
                    number: '1',
                    text: 'Copy and share your TrustPay referral code.',
                  ),
                  const _ReferralStep(
                    number: '2',
                    text: 'Your friend signs up with the code.',
                  ),
                  const _ReferralStep(
                    number: '3',
                    text:
                        'NGN 100 is tracked as a referral reward after eligibility checks.',
                  ),
                ],
              ),
            ),
            Text('Referral history', style: AppTextStyles.headingM),
            const SizedBox(height: AppSpacing.sm),
            if (data.referrals.isEmpty)
              const _EmptyPanel(
                icon: Icons.group_add_outlined,
                animation: TrustPayAnimationVariant.send,
                title: 'No invites yet',
                detail: 'Friends who sign up with your code will appear here.',
              )
            else
              ...data.referrals.map((reward) {
                return _DataPanel(
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor:
                            AppColors.primary.withValues(alpha: 0.12),
                        child: Icon(
                          Icons.person_add_alt_1_rounded,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              reward.referredName,
                              style: AppTextStyles.labelM,
                            ),
                            Text(
                              reward.status,
                              style: AppTextStyles.bodyS,
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _money(reward.currency, reward.exactAmount),
                        style: AppTextStyles.labelM,
                      ),
                    ],
                  ),
                );
              }),
          ],
        );
      },
    );
  }
}

class _ReferralMetricCard extends StatelessWidget {
  final String label;
  final String value;

  const _ReferralMetricCard({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.bodyS),
          const SizedBox(height: AppSpacing.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: AppTextStyles.headingM),
          ),
        ],
      ),
    );
  }
}

class _ReferralStep extends StatelessWidget {
  final String number;
  final String text;

  const _ReferralStep({
    required this.number,
    required this.text,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: AppColors.primary.withValues(alpha: 0.12),
            child: Text(
              number,
              style: AppTextStyles.labelS.copyWith(color: AppColors.primary),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(text, style: AppTextStyles.bodyM)),
        ],
      ),
    );
  }
}

class _FaqPanel extends StatelessWidget {
  const _FaqPanel();

  static const _items = [
    (
      'How long do bank deposits take?',
      'Most bank transfers arrive within 5-30 minutes after the provider confirms payment.',
    ),
    (
      'Why do I need KYC?',
      'KYC unlocks higher limits, withdrawals, virtual accounts, and regulated money movement.',
    ),
    (
      'What protects my transactions?',
      'Money actions require a freshly entered transaction PIN. Biometrics can unlock the app on supported devices.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('FAQ', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.sm),
          for (final item in _items) ...[
            Text(item.$1, style: AppTextStyles.labelM),
            const SizedBox(height: 2),
            Text(item.$2, style: AppTextStyles.bodyS),
            if (item != _items.last) const SizedBox(height: AppSpacing.md),
          ],
        ],
      ),
    );
  }
}

class _SupportTicketCard extends StatelessWidget {
  final SupportTicket ticket;

  const _SupportTicketCard({required this.ticket});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final date = ticket.createdAt == null
        ? 'Pending'
        : DateFormat('MMM d, y').format(ticket.createdAt!);

    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(ticket.type, style: AppTextStyles.labelM)),
              _SupportStatusPill(status: ticket.status),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            ticket.transactionReference.isEmpty
                ? date
                : '${ticket.transactionReference} • $date',
            style: AppTextStyles.bodyS,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            ticket.description,
            style: AppTextStyles.bodyM,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          if (ticket.resolution.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Text(ticket.resolution, style: AppTextStyles.bodyS),
          ],
        ],
      ),
    );
  }
}

class _SupportStatusPill extends StatelessWidget {
  final String status;

  const _SupportStatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final color = switch (status) {
      'RESOLVED' => AppColors.success,
      'ESCALATED' || 'UNDER_REVIEW' => AppColors.warning,
      'CLOSED' => AppColors.textHint,
      _ => AppColors.primary,
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Text(
        status,
        style: AppTextStyles.labelS.copyWith(color: color),
      ),
    );
  }
}

InputDecoration _supportInputDecoration(String label) {
  return InputDecoration(
    labelText: label,
    labelStyle: AppTextStyles.bodyM,
    filled: true,
    fillColor: AppColors.inputFill,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.primary),
    ),
  );
}

class _ThemeModeChip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  const _ThemeModeChip({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final foreground = active ? Colors.white : AppColors.textSecondary;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.full),
          boxShadow: active
              ? [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 17, color: foreground),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.labelS.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WalletsBody extends StatelessWidget {
  final List<HomeWallet> wallets;

  const _WalletsBody({required this.wallets});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final activeCurrencies =
        wallets.map((wallet) => wallet.currency.toUpperCase()).toSet();
    const supportedCurrencies = ['NGN', 'GHS'];
    const plannedCurrencies = ['USD', 'EUR'];
    final addableCurrencies = supportedCurrencies
        .where((currency) => !activeCurrencies.contains(currency))
        .toList();

    if (wallets.isEmpty) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _EmptyPanel(
            icon: Icons.account_balance_wallet_outlined,
            title: 'No wallets found',
            detail: 'Your NGN and GHS wallets will appear here after setup.',
          ),
          SizedBox(height: AppSpacing.md),
          _WalletAddSection(
            addableCurrencies: supportedCurrencies,
            plannedCurrencies: plannedCurrencies,
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Active wallets', style: AppTextStyles.headingM),
        const SizedBox(height: AppSpacing.sm),
        ...wallets.map((wallet) {
          return _WalletManageCard(wallet: wallet);
        }),
        const SizedBox(height: AppSpacing.lg),
        _WalletAddSection(
          addableCurrencies: addableCurrencies,
          plannedCurrencies: plannedCurrencies,
        ),
      ],
    );
  }
}

class _WalletManageCard extends StatelessWidget {
  final HomeWallet wallet;

  const _WalletManageCard({required this.wallet});

  List<Color> _walletGradient(String curr) {
    if (curr == 'NGN') {
      return [AppColors.primaryDark, AppColors.primary];
    } else {
      return [AppColors.primary, AppColors.primaryLight];
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final currency = wallet.currency.toUpperCase();
    final gradientColors = _walletGradient(currency);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: gradientColors,
        ),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -8,
            bottom: -18,
            child: Text(
              _currencyMark(currency),
              style: AppTextStyles.displayLarge.copyWith(
                color: AppColors.textPrimary.withValues(alpha: 0.05),
                fontSize: 64,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: _walletAccent(currency).withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Center(
                    child: Text(
                      currency,
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(currency, style: AppTextStyles.headingM),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Available balance',
                        style: AppTextStyles.bodyS,
                      ),
                    ],
                  ),
                ),
                Text(
                  _money(currency, wallet.exactBalance),
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

class _WalletAddSection extends StatelessWidget {
  final List<String> addableCurrencies;
  final List<String> plannedCurrencies;

  const _WalletAddSection({
    required this.addableCurrencies,
    required this.plannedCurrencies,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final hasAddable = addableCurrencies.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Add currency wallet', style: AppTextStyles.headingM),
        const SizedBox(height: AppSpacing.xs),
        Text(
          hasAddable
              ? 'Add another wallet when it becomes available.'
              : 'More currency wallets are coming soon.',
          style: AppTextStyles.bodyM,
        ),
        const SizedBox(height: AppSpacing.md),
        if (hasAddable)
          ...addableCurrencies.map((currency) {
            return _WalletCurrencyOption(
              currency: currency,
              status: 'Available',
              enabled: true,
              onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '$currency wallet is not available yet.',
                  ),
                ),
              ),
            );
          })
        else
          const _WalletCurrencyOption(
            currency: 'NGN / GHS',
            status: 'Active',
            enabled: false,
          ),
        ...plannedCurrencies.map((currency) {
          return _WalletCurrencyOption(
            currency: currency,
            status: 'Coming soon',
            enabled: false,
          );
        }),
      ],
    );
  }
}

class _WalletCurrencyOption extends StatelessWidget {
  final String currency;
  final String status;
  final bool enabled;
  final VoidCallback? onTap;

  const _WalletCurrencyOption({
    required this.currency,
    required this.status,
    required this.enabled,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: AppColors.surfaceVariant.withValues(alpha: enabled ? 1 : 0.62),
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Container(
          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Icon(
                enabled
                    ? Icons.add_circle_outline_rounded
                    : Icons.lock_outline_rounded,
                color: enabled ? AppColors.primary : AppColors.textHint,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(currency, style: AppTextStyles.labelL),
              ),
              Text(
                status,
                style: AppTextStyles.caption.copyWith(
                  color: enabled ? AppColors.primaryLight : AppColors.textHint,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VirtualAccountBody extends StatelessWidget {
  final List<HomeVirtualAccount> accounts;
  final String kycStatus;

  const _VirtualAccountBody({
    required this.accounts,
    required this.kycStatus,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (accounts.isEmpty) {
      final verified = kycStatus.toUpperCase() == 'VERIFIED';
      return _EmptyPanel(
        icon: Icons.account_balance_outlined,
        animation: verified
            ? TrustPayAnimationVariant.success
            : TrustPayAnimationVariant.loading,
        title: verified ? 'Ready to provision' : 'KYC required',
        detail: verified
            ? 'Your account number will appear here when it is ready.'
            : 'Complete your verification to unlock this feature.',
      );
    }

    return Column(
      children: accounts.map((account) {
        return _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child:
                        Text(account.bankName, style: AppTextStyles.headingM),
                  ),
                  _StatusPill(label: account.status),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(account.accountName, style: AppTextStyles.bodyM),
              const SizedBox(height: AppSpacing.xs),
              Text(
                '${account.currency} • ${account.accountNumberMasked}',
                style: AppTextStyles.bodyS,
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _ActivityBody extends StatelessWidget {
  final List<HomeTransaction> transactions;

  const _ActivityBody({required this.transactions});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (transactions.isEmpty) {
      return SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.62,
        child: const TpEmptyState(
          variant: TpIllustrationVariant.emptyTransactions,
          illustrationAsset:
              'assets/images/empty_states/empty-transactions.svg',
          title: 'No transactions yet',
          message: 'Your completed activity will appear here.',
          illustrationSize: 220,
        ),
      );
    }
    return _TransactionsHistoryBody(
      transactions: transactions,
      compactTopSpacing: true,
    );
  }
}

class _NotificationsBody extends StatefulWidget {
  final HomeDashboardData data;

  const _NotificationsBody({required this.data});

  @override
  State<_NotificationsBody> createState() => _NotificationsBodyState();
}

class _NotificationsBodyState extends State<_NotificationsBody> {
  final Set<String> _dismissedIds = {};

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final items = _notificationItems(widget.data)
        .where((item) => !_dismissedIds.contains(item.id))
        .toList();

    if (items.isEmpty) {
      return const _HistoryEmptyState();
    }

    return Column(
      children: [
        ...items.map(
          (item) => Dismissible(
            key: ValueKey('notification-${item.id}'),
            direction: DismissDirection.horizontal,
            onDismissed: (_) => _dismiss(item.id),
            background: const _NotificationDismissBackground(
              alignment: Alignment.centerLeft,
              icon: Icons.check_rounded,
            ),
            secondaryBackground: const _NotificationDismissBackground(
              alignment: Alignment.centerRight,
              icon: Icons.close_rounded,
            ),
            child: _NotificationCard(
              item: item,
              onClose: () => _dismiss(item.id),
            ),
          ),
        ),
      ],
    );
  }

  void _dismiss(String id) {
    setState(() {
      _dismissedIds.add(id);
    });
  }
}

class _NotificationCard extends StatelessWidget {
  final _NotificationItem item;
  final VoidCallback onClose;

  const _NotificationCard({
    required this.item,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => context.push(item.route),
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: item.color.withValues(alpha: 0.24)),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: item.color.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(item.icon, color: item.color, size: 22),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        style: AppTextStyles.labelM.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(item.detail, style: AppTextStyles.bodyS),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Dismiss',
                  onPressed: onClose,
                  icon: Icon(
                    Icons.close_rounded,
                    color: AppColors.textHint,
                    size: 20,
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

class _NotificationDismissBackground extends StatelessWidget {
  final Alignment alignment;
  final IconData icon;

  const _NotificationDismissBackground({
    required this.alignment,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      alignment: alignment,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Icon(icon, color: AppColors.primary),
    );
  }
}

class _VtuOrderBody extends StatelessWidget {
  final VtuOrderStatus order;
  final bool isChecking;
  final VoidCallback onCheckStatus;

  const _VtuOrderBody({
    required this.order,
    required this.isChecking,
    required this.onCheckStatus,
  });

  bool get _isTerminal {
    return ['SUCCESS', 'FAILED', 'REVERSED'].contains(order.orderStatus);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final statusTone = _statusTone(order.orderStatus);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: statusTone.background,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      statusTone.icon,
                      color: statusTone.foreground,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          order.orderStatus,
                          style: AppTextStyles.headingM.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          order.provider,
                          style: AppTextStyles.bodyM,
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(label: order.transactionStatus),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              _InfoRow(label: 'Reference', value: order.reference),
              _InfoRow(
                label: 'Amount',
                value: '${order.currency} ${order.amount}',
              ),
              if (order.targetMasked != null)
                _InfoRow(label: 'Recipient', value: order.targetMasked!),
              _InfoRow(label: 'Order ID', value: order.orderId),
              if (order.nextRequeryAt != null)
                _InfoRow(label: 'Next auto-check', value: order.nextRequeryAt!),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        FilledButton.icon(
          onPressed: isChecking || _isTerminal ? null : onCheckStatus,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(54),
          ),
          icon: isChecking
              ? const TrustPayLottie(
                  variant: TrustPayAnimationVariant.loading,
                  size: 22,
                  semanticsLabel: 'Checking VTU status',
                )
              : const Icon(Icons.refresh_rounded),
          label: Text(isChecking ? 'Checking...' : 'Check status'),
        ),
      ],
    );
  }
}

class _TransactionsHistoryBody extends StatelessWidget {
  final List<HomeTransaction> transactions;
  final bool compactTopSpacing;

  const _TransactionsHistoryBody({
    required this.transactions,
    this.compactTopSpacing = false,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (transactions.isEmpty)
          const _HistoryEmptyState()
        else
          ...transactions.map((transaction) {
            return _TransactionHistoryCard(transaction: transaction);
          }),
      ],
    );
  }
}

class _TransactionHistoryCard extends StatelessWidget {
  final HomeTransaction transaction;

  const _TransactionHistoryCard({required this.transaction});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final tone = _transactionTone(transaction);
    final date = transaction.createdAt == null
        ? 'Pending'
        : DateFormat('dd.MM.yyyy').format(transaction.createdAt!.toLocal());
    final amountText = _money(transaction.currency, transaction.exactAmount);
    final signedAmount =
        '${_isCreditType(transaction.type) ? '+' : '-'} $amountText';
    final canTrackVtu = _isVtuTransaction(transaction);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: GestureDetector(
        onTap: canTrackVtu
            ? () => context.push(AppRoutes.vtuOrderFor(transaction.reference))
            : null,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: tone.background,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(
                  tone.icon,
                  color: tone.foreground,
                  size: 20,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _transactionTitle(transaction),
                      style: AppTextStyles.headingM.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _transactionSubtitle(transaction),
                            style: AppTextStyles.bodyM,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    signedAmount,
                    style: AppTextStyles.headingM.copyWith(
                      color: tone.amountColor,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    canTrackVtu ? 'Track order' : date,
                    style: AppTextStyles.bodyS,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HistoryEmptyState extends StatelessWidget {
  const _HistoryEmptyState();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          Icon(Icons.history_rounded, color: AppColors.textHint),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'No transactions yet. Completed activity will appear here.',
              style: AppTextStyles.bodyM,
            ),
          ),
        ],
      ),
    );
  }
}

class _TransactionTone {
  final IconData icon;
  final Color foreground;
  final Color background;
  final Color amountColor;

  const _TransactionTone({
    required this.icon,
    required this.foreground,
    required this.background,
    required this.amountColor,
  });
}

class _NotificationItem {
  final String id;
  final String title;
  final String detail;
  final IconData icon;
  final Color color;
  final String route;

  const _NotificationItem({
    required this.id,
    required this.title,
    required this.detail,
    required this.icon,
    required this.color,
    required this.route,
  });
}

List<_NotificationItem> _notificationItems(HomeDashboardData data) {
  return [
    for (final transaction in data.transactions)
      _NotificationItem(
        id: 'transaction-${transaction.reference}-${transaction.status}',
        title:
            '${transaction.type.replaceAll('_', ' ')} · ${transaction.status.replaceAll('_', ' ')}',
        detail: 'Reference: ${transaction.reference}',
        icon: Icons.receipt_long_outlined,
        color: transaction.status == 'SUCCESS'
            ? AppColors.success
            : AppColors.textSecondary,
        route: AppRoutes.activity,
      ),
    if (data.user.kycStatus.toUpperCase() != 'VERIFIED')
      _NotificationItem(
        id: 'kyc-pending',
        title: data.user.kycStatus.toUpperCase() == 'PENDING'
            ? 'KYC pending'
            : 'KYC: ${data.user.kycStatus}',
        detail: 'Open verification to check your current requirements.',
        icon: Icons.assignment_ind_outlined,
        color: AppColors.warning,
        route: AppRoutes.kyc,
      ),
    if (data.transactions.isEmpty)
      _NotificationItem(
        id: 'no-transactions',
        title: 'No recent activity',
        detail:
            'Refresh to check for account updates. Dismissals apply only to this visit.',
        icon: Icons.history_rounded,
        color: AppColors.textSecondary,
        route: AppRoutes.activity,
      ),
  ];
}

class _KycBody extends StatelessWidget {
  final String status;

  const _KycBody({required this.status});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final verified = status.toUpperCase() == 'VERIFIED';
    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                verified
                    ? Icons.verified_user_rounded
                    : Icons.verified_user_outlined,
                color: verified ? AppColors.success : AppColors.warning,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text('Status: $status', style: AppTextStyles.headingM),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            verified
                ? 'Your account can access withdrawals, higher limits, and virtual account provisioning.'
                : 'Submit identity checks before withdrawals and virtual account provisioning can be enabled.',
            style: AppTextStyles.bodyM,
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppTextStyles.bodyM)),
          const SizedBox(width: AppSpacing.md),
          Flexible(
            child: Text(
              value.isEmpty ? 'Not set' : value,
              style: AppTextStyles.labelM,
              textAlign: TextAlign.right,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileActionRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String detail;
  final VoidCallback onTap;

  const _ProfileActionRow({
    required this.icon,
    required this.label,
    required this.detail,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          onTap: onTap,
          child: Ink(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppColors.inputFill,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Icon(icon, color: AppColors.textPrimary, size: 19),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: AppTextStyles.labelM),
                      const SizedBox(height: 2),
                      Text(
                        detail,
                        style: AppTextStyles.bodyS,
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
        ),
      ),
    );
  }
}

class _DataPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const _DataPanel({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _ActiveSessionsPanel extends StatelessWidget {
  const _ActiveSessionsPanel();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Active Sessions',
            style: AppTextStyles.bodyM,
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Icon(Icons.phone_iphone_rounded,
                  size: 16, color: AppColors.textSecondary),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  'This device · Last active: just now',
                  style: AppTextStyles.caption,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  final IconData icon;
  final TrustPayAnimationVariant? animation;
  final String title;
  final String detail;

  const _EmptyPanel({
    required this.icon,
    this.animation,
    required this.title,
    required this.detail,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Column(
        children: [
          animation == null
              ? Icon(icon, color: AppColors.textHint, size: 36)
              : TrustPayLottie(
                  variant: animation!,
                  size: 72,
                  repeat: animation != TrustPayAnimationVariant.success,
                  semanticsLabel: title,
                ),
          const SizedBox(height: AppSpacing.md),
          Text(title, style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(detail, style: AppTextStyles.bodyM, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _LoadingPanel extends StatelessWidget {
  const _LoadingPanel();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.manage_accounts_rounded,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Loading details', style: AppTextStyles.headingM),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Fetching the latest information.',
                  style: AppTextStyles.bodyM,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileSkeletonPanel extends StatelessWidget {
  const _ProfileSkeletonPanel();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    Widget line(double width, {double height = 12}) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.border.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
      );
    }

    return _DataPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: AppColors.primary.withValues(alpha: 0.14),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    line(128, height: 16),
                    const SizedBox(height: AppSpacing.sm),
                    line(190),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          line(double.infinity),
          const SizedBox(height: AppSpacing.sm),
          line(double.infinity),
          const SizedBox(height: AppSpacing.sm),
          line(180),
        ],
      ),
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorPanel({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, color: AppColors.primary),
          const SizedBox(height: AppSpacing.sm),
          Text(message,
              style: AppTextStyles.bodyM, textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.md),
          FilledButton(
            onPressed: onRetry,
            style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _UnauthorizedPanel extends StatefulWidget {
  final Future<void> Function() onRetry;

  const _UnauthorizedPanel({required this.onRetry});

  @override
  State<_UnauthorizedPanel> createState() => _UnauthorizedPanelState();
}

class _UnauthorizedPanelState extends State<_UnauthorizedPanel> {
  bool _isRefreshing = false;

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _DataPanel(
      child: Column(
        children: [
          Icon(Icons.lock_clock_rounded, color: AppColors.warning),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Your session needs to be refreshed before loading history.',
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          FilledButton(
            onPressed: _isRefreshing
                ? null
                : () async {
                    setState(() => _isRefreshing = true);
                    await widget.onRetry();
                    if (mounted) setState(() => _isRefreshing = false);
                  },
            style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
            child: _isRefreshing
                ? const TrustPayLottie(
                    variant: TrustPayAnimationVariant.loading,
                    size: 22,
                    semanticsLabel: 'Refreshing session',
                  )
                : const Text('Refresh session'),
          ),
        ],
      ),
    );
  }
}

class _SessionExpiredScreen extends StatelessWidget {
  final VoidCallback onLogin;

  const _SessionExpiredScreen({required this.onLogin});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Center(
            child: _DataPanel(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.lock_outline_rounded, color: AppColors.primary),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    'Please log in again to continue.',
                    style: AppTextStyles.headingM,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: onLogin,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                    ),
                    child: const Text('Go to login'),
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

class _StatusPill extends StatelessWidget {
  final String label;

  const _StatusPill({required this.label});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: AppColors.inputFill,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: Text(label, style: AppTextStyles.caption),
    );
  }
}

class _DetailConfig {
  final String title;
  final String subtitle;

  const _DetailConfig({required this.title, required this.subtitle});
}

String _money(String currency, MoneyValue amount) {
  return '$currency ${_formatExactAmount(amount.decimalString)}';
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

Map<String, _TransactionVolume> _transactionVolumes(
  List<HomeTransaction> transactions,
) {
  final totals = <String, _TransactionVolume>{};

  for (final transaction in transactions) {
    final status = transaction.status.toUpperCase();
    if (status == 'FAILED' || status == 'REVERSED') continue;

    final currency = transaction.currency.toUpperCase();
    final current = totals[currency] ??
        _TransactionVolume(
          credit: MoneyValue.fromMinorUnits(
            BigInt.zero,
            currency: currency,
          ),
          debit: MoneyValue.fromMinorUnits(
            BigInt.zero,
            currency: currency,
          ),
        );
    final amount = transaction.exactAmount.withCurrency(currency);
    if (_isCreditType(transaction.type)) {
      totals[currency] = _TransactionVolume(
        credit: current.credit + amount,
        debit: current.debit,
      );
    } else {
      totals[currency] = _TransactionVolume(
        credit: current.credit,
        debit: current.debit + amount,
      );
    }
  }

  return totals;
}

String? _readDioErrorMessage(DioException error) {
  final data = error.response?.data;
  if (data is Map<String, dynamic>) {
    final message = data['message'];
    if (message is String) return message;
    if (message is List && message.isNotEmpty) {
      return message.first.toString();
    }
  }
  return null;
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

bool _isCreditType(String type) {
  switch (type.toUpperCase()) {
    case 'FUND':
      return true;
    default:
      return false;
  }
}

_TransactionTone _transactionTone(HomeTransaction transaction) {
  final type = transaction.type.toUpperCase();
  final status = transaction.status.toUpperCase();

  if (status == 'FAILED' || status == 'REVERSED') {
    return _TransactionTone(
      icon: Icons.close_rounded,
      foreground: AppColors.error,
      background: AppColors.error.withValues(alpha: 0.10),
      amountColor: AppColors.error,
    );
  }

  switch (type) {
    case 'FUND':
      return _TransactionTone(
        icon: Icons.south_rounded,
        foreground: AppColors.success,
        background: AppColors.success.withValues(alpha: 0.10),
        amountColor: AppColors.success,
      );
    case 'WITHDRAW':
      return _TransactionTone(
        icon: Icons.north_rounded,
        foreground: AppColors.textPrimary,
        background: AppColors.surfaceVariant,
        amountColor: AppColors.textPrimary,
      );
    case 'TRANSFER':
    case 'INTERNAL_TRANSFER':
      return _TransactionTone(
        icon: Icons.near_me_rounded,
        foreground: AppColors.primary,
        background: AppColors.primary.withValues(alpha: 0.10),
        amountColor: AppColors.textPrimary,
      );
    case 'EXCHANGE':
      return _TransactionTone(
        icon: Icons.currency_exchange_rounded,
        foreground: AppColors.primaryLight,
        background: AppColors.primaryLight.withValues(alpha: 0.10),
        amountColor: AppColors.textPrimary,
      );
    case 'AIRTIME':
      return _TransactionTone(
        icon: Icons.phone_android_rounded,
        foreground: AppColors.warning,
        background: AppColors.warning.withValues(alpha: 0.10),
        amountColor: AppColors.textPrimary,
      );
    case 'DATA':
      return _TransactionTone(
        icon: Icons.signal_cellular_alt_rounded,
        foreground: AppColors.success,
        background: AppColors.success.withValues(alpha: 0.10),
        amountColor: AppColors.textPrimary,
      );
    case 'CABLE':
    case 'ELECTRICITY':
      return _TransactionTone(
        icon: Icons.bolt_rounded,
        foreground: AppColors.warning,
        background: AppColors.warning.withValues(alpha: 0.10),
        amountColor: AppColors.textPrimary,
      );
    default:
      return _TransactionTone(
        icon: Icons.history_rounded,
        foreground: AppColors.textSecondary,
        background: AppColors.surfaceVariant,
        amountColor: AppColors.textPrimary,
      );
  }
}

_TransactionTone _statusTone(String status) {
  switch (status.toUpperCase()) {
    case 'SUCCESS':
      return _TransactionTone(
        icon: Icons.check_rounded,
        foreground: AppColors.success,
        background: AppColors.success.withValues(alpha: 0.10),
        amountColor: AppColors.success,
      );
    case 'FAILED':
    case 'REVERSED':
      return _TransactionTone(
        icon: Icons.close_rounded,
        foreground: AppColors.error,
        background: AppColors.error.withValues(alpha: 0.10),
        amountColor: AppColors.error,
      );
    default:
      return _TransactionTone(
        icon: Icons.hourglass_top_rounded,
        foreground: AppColors.warning,
        background: AppColors.warning.withValues(alpha: 0.10),
        amountColor: AppColors.warning,
      );
  }
}

String _transactionTitle(HomeTransaction transaction) {
  final type = transaction.type.toUpperCase();
  switch (type) {
    case 'FUND':
      return 'Wallet funding';
    case 'WITHDRAW':
      return 'Bank withdrawal';
    case 'TRANSFER':
    case 'INTERNAL_TRANSFER':
      return 'Money transfer';
    case 'EXCHANGE':
      return 'Currency exchange';
    case 'AIRTIME':
      return 'Airtime purchase';
    case 'DATA':
      return 'Data bundle';
    case 'CABLE':
      return 'Cable payment';
    case 'ELECTRICITY':
      return 'Electricity token';
    default:
      return _titleCase(transaction.type);
  }
}

bool _isVtuTransaction(HomeTransaction transaction) {
  final type = transaction.type.toUpperCase();
  return type == 'AIRTIME' ||
      type == 'DATA' ||
      type == 'CABLE' ||
      type == 'ELECTRICITY';
}

String _transactionSubtitle(HomeTransaction transaction) {
  final maskedRef = transaction.reference.length > 12
      ? '${transaction.reference.substring(0, 4)} •••• ${transaction.reference.substring(transaction.reference.length - 4)}'
      : transaction.reference;
  return '${_titleCase(transaction.status)} • $maskedRef';
}

bool _isUnauthorized(Object? error) {
  if (error is DioException) {
    return error.response?.statusCode == 401;
  }
  return false;
}

String _titleCase(String value) {
  final normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}
