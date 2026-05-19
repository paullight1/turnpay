import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';

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

  const DashboardDetailScreen({
    super.key,
    required this.kind,
  });

  @override
  State<DashboardDetailScreen> createState() => _DashboardDetailScreenState();
}

class _DashboardDetailScreenState extends State<DashboardDetailScreen> {
  final _homeDataService = HomeDataService();
  late Future<HomeDashboardData> _future;

  @override
  void initState() {
    super.initState();
    _future = _homeDataService.fetchDashboard();
  }

  void _reload() {
    setState(() {
      _future = _homeDataService.fetchDashboard();
    });
  }

  @override
  Widget build(BuildContext context) {
    final config = _configFor(widget.kind);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: FutureBuilder<HomeDashboardData>(
          future: _future,
          builder: (context, snapshot) {
            final children = <Widget>[
              Row(
                children: [
                  _IconButton(
                    icon: Icons.arrow_back_ios_new_rounded,
                    onTap: () => context.pop(),
                  ),
                  SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(config.title, style: AppTextStyles.headingXL),
                  ),
                  _IconButton(icon: Icons.refresh_rounded, onTap: _reload),
                ],
              ),
              SizedBox(height: AppSpacing.sm),
              Text(config.subtitle, style: AppTextStyles.bodyM),
              SizedBox(height: AppSpacing.xl),
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
  const DashboardProfileScreen({super.key});

  @override
  State<DashboardProfileScreen> createState() => _DashboardProfileScreenState();
}

class _DashboardProfileScreenState extends State<DashboardProfileScreen> {
  final _homeDataService = HomeDataService();
  final _authService = AuthService();
  late Future<HomeDashboardData> _future;

  @override
  void initState() {
    super.initState();
    _future = _homeDataService.fetchDashboard();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: FutureBuilder<HomeDashboardData>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _LoadingPanel();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return _ErrorPanel(
                  message: authErrorMessage(
                    snapshot.error ?? 'Could not load profile',
                    'Could not load profile',
                  ),
                  onRetry: () => setState(() {
                    _future = _homeDataService.fetchDashboard();
                  }),
                );
              }

              final user = snapshot.data!.user;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Profile', style: AppTextStyles.headingXL),
                  SizedBox(height: AppSpacing.xl),
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
                      SizedBox(width: AppSpacing.md),
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
                  SizedBox(height: AppSpacing.xl),
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
                  const Spacer(),
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
  const DashboardTransactionsScreen({super.key});

  @override
  State<DashboardTransactionsScreen> createState() =>
      _DashboardTransactionsScreenState();
}

class ProfileActionScreen extends StatefulWidget {
  final ProfileActionKind kind;

  const ProfileActionScreen({
    super.key,
    required this.kind,
  });

  @override
  State<ProfileActionScreen> createState() => _ProfileActionScreenState();
}

class _ProfileActionScreenState extends State<ProfileActionScreen> {
  final _homeDataService = HomeDataService();
  late Future<HomeDashboardData> _future;

  @override
  void initState() {
    super.initState();
    _future = _homeDataService.fetchDashboard();
  }

  @override
  Widget build(BuildContext context) {
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
                  Row(
                    children: [
                      _IconButton(
                        icon: Icons.arrow_back_ios_new_rounded,
                        onTap: () => context.pop(),
                      ),
                      SizedBox(width: AppSpacing.md),
                      Expanded(
                        child:
                            Text(config.title, style: AppTextStyles.headingXL),
                      ),
                    ],
                  ),
                  SizedBox(height: AppSpacing.sm),
                  Text(config.subtitle, style: AppTextStyles.bodyM),
                  SizedBox(height: AppSpacing.xl),
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
                            _future = _homeDataService.fetchDashboard();
                          }),
                        );
                      }
                      return _profileBodyFor(context, widget.kind, snapshot.data!);
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
  final _homeDataService = HomeDataService();
  final _authService = AuthService();
  late Future<List<HomeTransaction>> _future;
  bool _sessionExpired = false;

  @override
  void initState() {
    super.initState();
    _future = _homeDataService.fetchTransactions();
  }

  @override
  Widget build(BuildContext context) {
    if (_sessionExpired) {
      return _SessionExpiredScreen(
        onLogin: () => context.go(AppRoutes.login),
      );
    }

    return TransactionsDetailScaffold(
      future: _future,
      onRetry: () {
        setState(() {
          _future = _homeDataService.fetchTransactions();
        });
      },
      onUnauthorized: () async {
        final refreshed = await _authService.refreshSession();
        if (!mounted) return;
        if (refreshed) {
          setState(() {
            _future = _homeDataService.fetchTransactions();
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
                  Row(
                    children: [
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(AppRadius.full),
                          onTap: () => context.pop(),
                          child: Ink(
                            width: 48,
                            height: 48,
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Icon(
                              Icons.arrow_back_ios_new_rounded,
                              color: AppColors.textPrimary,
                              size: 18,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(
                          'My Transactions',
                          textAlign: TextAlign.center,
                          style: AppTextStyles.headingXL.copyWith(
                            fontSize: 26,
                          ),
                        ),
                      ),
                      SizedBox(width: 48),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
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
                      return _TransactionsHistoryBody(
                        transactions: snapshot.data!,
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
                  Text(title, style: AppTextStyles.headingXL),
                  SizedBox(height: AppSpacing.sm),
                  Text(subtitle, style: AppTextStyles.bodyM),
                  SizedBox(height: AppSpacing.xl),
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
      return const _EmptyPanel(
        icon: Icons.notifications_none_rounded,
        title: 'No notifications',
        detail: 'Security, wallet, KYC, and transfer alerts will appear here.',
      );
  }
}

Widget _profileBodyFor(
  BuildContext context,
  ProfileActionKind kind,
  HomeDashboardData data,
) {
  final user = data.user;

  switch (kind) {
    case ProfileActionKind.account:
      return Column(
        children: [
          _InfoRow(label: 'Full name', value: user.fullName),
          _InfoRow(label: 'Email', value: user.email),
          _InfoRow(label: 'Phone', value: user.phone),
          _InfoRow(label: 'User ID', value: user.id),
        ],
      );
    case ProfileActionKind.appearance:
      return const _AppearanceSettingsPanel();
    case ProfileActionKind.security:
      return Column(
        children: [
          _InfoRow(label: 'Role', value: user.role),
          _InfoRow(label: 'KYC status', value: user.kycStatus),
          const _InfoRow(
            label: 'Auth provider',
            value: 'Supabase Auth',
          ),
          _ProfileActionRow(
            icon: Icons.password_rounded,
            label: 'Transaction approvals',
            detail: 'PIN, Face ID, and fingerprint for withdraw and exchange',
            onTap: () => context.push(AppRoutes.transactionSecurity),
          ),
          _DataPanel(
            child: Text(
              'Withdrawals, virtual account provisioning, and higher limits are controlled by KYC status and backend risk checks.',
              style: AppTextStyles.bodyM,
            ),
          ),
        ],
      );
    case ProfileActionKind.support:
      return Column(
        children: [
          _DataPanel(
            child: Text(
              'Support inbox is not connected yet. For now, use admin operations to review account, payment, or KYC issues.',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          _InfoRow(label: 'App', value: 'TRUSTPAY'),
          _InfoRow(label: 'Support status', value: 'Setup required'),
        ],
      );
  }
}

_DetailConfig _configFor(DashboardDetailKind kind) {
  switch (kind) {
    case DashboardDetailKind.wallets:
      return const _DetailConfig(
        title: 'Wallets',
        subtitle: 'Live balances from your TRUSTPAY backend account.',
      );
    case DashboardDetailKind.virtualAccount:
      return const _DetailConfig(
        title: 'Virtual account',
        subtitle: 'Provider-assigned bank accounts for receiving transfers.',
      );
    case DashboardDetailKind.activity:
      return const _DetailConfig(
        title: 'Recent activity',
        subtitle: 'Your latest wallet and payment transactions.',
      );
    case DashboardDetailKind.kyc:
      return const _DetailConfig(
        title: 'KYC verification',
        subtitle: 'Current verification status and account access.',
      );
    case DashboardDetailKind.notifications:
      return const _DetailConfig(
        title: 'Notifications',
        subtitle: 'Account, security, and transaction alerts.',
      );
  }
}

_DetailConfig _profileConfigFor(ProfileActionKind kind) {
  switch (kind) {
    case ProfileActionKind.account:
      return const _DetailConfig(
        title: 'Account Details',
        subtitle: 'Your saved TRUSTPAY account identity details.',
      );
    case ProfileActionKind.appearance:
      return const _DetailConfig(
        title: 'Appearance',
        subtitle: 'Choose how TRUSTPAY looks across your device.',
      );
    case ProfileActionKind.security:
      return const _DetailConfig(
        title: 'Security & Limits',
        subtitle: 'Session, role, KYC, and access status.',
      );
    case ProfileActionKind.support:
      return const _DetailConfig(
        title: 'Help & Support',
        subtitle: 'Support channels and operational guidance.',
      );
  }
}

class _AppearanceSettingsPanel extends ConsumerWidget {
  const _AppearanceSettingsPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final controller = ref.read(themeModeProvider.notifier);
    final isLight = themeMode == ThemeMode.light;

    return Column(
      children: [
        _DataPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Theme mode', style: AppTextStyles.headingM),
              SizedBox(height: AppSpacing.xs),
              Text(
                'Switch between the default dark interface and a lighter daytime mode.',
                style: AppTextStyles.bodyM,
              ),
              SizedBox(height: AppSpacing.md),
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
                        label: 'Dark',
                        icon: Icons.dark_mode_rounded,
                        active: !isLight,
                        onTap: () => controller.setMode(ThemeMode.dark),
                      ),
                    ),
                    SizedBox(width: AppSpacing.xs),
                    Expanded(
                      child: _ThemeModeChip(
                        label: 'Light',
                        icon: Icons.light_mode_rounded,
                        active: isLight,
                        onTap: () => controller.setMode(ThemeMode.light),
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
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 18,
              color: active ? Colors.white : AppColors.textSecondary,
            ),
            SizedBox(width: AppSpacing.xs),
            Text(
              label,
              style: AppTextStyles.labelM.copyWith(
                color: active ? Colors.white : AppColors.textSecondary,
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
    final activeCurrencies =
        wallets.map((wallet) => wallet.currency.toUpperCase()).toSet();
    const supportedCurrencies = ['NGN', 'GHS'];
    const plannedCurrencies = ['USD', 'EUR'];
    final addableCurrencies = supportedCurrencies
        .where((currency) => !activeCurrencies.contains(currency))
        .toList();

    if (wallets.isEmpty) {
      return Column(
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
        SizedBox(height: AppSpacing.sm),
        ...wallets.map((wallet) {
          return _WalletManageCard(wallet: wallet);
        }),
        SizedBox(height: AppSpacing.lg),
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

  @override
  Widget build(BuildContext context) {
    final currency = wallet.currency.toUpperCase();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
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
                SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(currency, style: AppTextStyles.headingM),
                      SizedBox(height: AppSpacing.xs),
                      Text(
                        'Available balance',
                        style: AppTextStyles.bodyS,
                      ),
                    ],
                  ),
                ),
                Text(
                  _money(currency, wallet.balance),
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
    final hasAddable = addableCurrencies.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Add currency wallet', style: AppTextStyles.headingM),
        SizedBox(height: AppSpacing.xs),
        Text(
          hasAddable
              ? 'Create another supported currency wallet for this account.'
              : 'All currently supported currency wallets are already active.',
          style: AppTextStyles.bodyM,
        ),
        SizedBox(height: AppSpacing.md),
        if (hasAddable)
          ...addableCurrencies.map((currency) {
            return _WalletCurrencyOption(
              currency: currency,
              status: 'Available',
              enabled: true,
              onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '$currency wallet creation needs a backend endpoint before it can be activated.',
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
            status: 'Provider setup required',
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
              SizedBox(width: AppSpacing.md),
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
    if (accounts.isEmpty) {
      final verified = kycStatus.toUpperCase() == 'VERIFIED';
      return _EmptyPanel(
        icon: Icons.account_balance_outlined,
        title: verified ? 'Ready to provision' : 'KYC required',
        detail: verified
            ? 'Provisioning will create a partner bank account through the backend provider flow.'
            : 'Complete KYC before creating a provider-assigned virtual account.',
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
              SizedBox(height: AppSpacing.sm),
              Text(account.accountName, style: AppTextStyles.bodyM),
              SizedBox(height: AppSpacing.xs),
              Text(
                '${account.currency} â€¢ ${account.accountNumberMasked}',
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
    return _TransactionsHistoryBody(
      transactions: transactions,
      compactTopSpacing: true,
    );
  }
}

class _TransactionsHistoryBody extends StatefulWidget {
  final List<HomeTransaction> transactions;
  final bool compactTopSpacing;

  const _TransactionsHistoryBody({
    required this.transactions,
    this.compactTopSpacing = false,
  });

  @override
  State<_TransactionsHistoryBody> createState() =>
      _TransactionsHistoryBodyState();
}

class _TransactionsHistoryBodyState extends State<_TransactionsHistoryBody> {
  _TransactionFilter _selectedFilter = _TransactionFilter.all;

  @override
  Widget build(BuildContext context) {
    final items = widget.transactions
        .where((item) => _selectedFilter.matches(item))
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!widget.compactTopSpacing) ...[
          Text(
            'Transfers, funding, withdrawals, exchanges, and bill payments.',
            style: AppTextStyles.bodyM,
          ),
          SizedBox(height: AppSpacing.lg),
        ],
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _TransactionFilter.values.length,
            separatorBuilder: (_, __) => SizedBox(width: AppSpacing.sm),
            itemBuilder: (context, index) {
              final filter = _TransactionFilter.values[index];
              final active = filter == _selectedFilter;
              return _HistoryFilterChip(
                label: filter.label,
                active: active,
                onTap: () => setState(() => _selectedFilter = filter),
              );
            },
          ),
        ),
        SizedBox(height: AppSpacing.lg),
        if (items.isEmpty)
          _HistoryEmptyState(filter: _selectedFilter)
        else
          Column(
            children: items.map((transaction) {
              return _TransactionHistoryCard(transaction: transaction);
            }).toList(),
          ),
      ],
    );
  }
}

enum _TransactionFilter {
  all('All'),
  funding('Deposit of funds'),
  withdrawal('Withdrawal of funds'),
  transfer('Transfers'),
  exchange('Exchange'),
  bills('Bills');

  final String label;

  const _TransactionFilter(this.label);

  bool matches(HomeTransaction transaction) {
    final type = transaction.type.toUpperCase();
    switch (this) {
      case _TransactionFilter.all:
        return true;
      case _TransactionFilter.funding:
        return type == 'FUND';
      case _TransactionFilter.withdrawal:
        return type == 'WITHDRAW';
      case _TransactionFilter.transfer:
        return type == 'TRANSFER' || type == 'INTERNAL_TRANSFER';
      case _TransactionFilter.exchange:
        return type == 'EXCHANGE';
      case _TransactionFilter.bills:
        return type == 'AIRTIME' ||
            type == 'DATA' ||
            type == 'CABLE' ||
            type == 'ELECTRICITY';
    }
  }
}

class _HistoryFilterChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _HistoryFilterChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(
            color: active ? AppColors.primary : AppColors.border,
          ),
          boxShadow: active
              ? [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.20),
                    blurRadius: 16,
                    offset: const Offset(0, 8),
                  ),
                ]
              : null,
        ),
        child: Center(
          child: Text(
            label,
            style: AppTextStyles.labelM.copyWith(
              color: active ? Colors.white : AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _TransactionHistoryCard extends StatelessWidget {
  final HomeTransaction transaction;

  const _TransactionHistoryCard({required this.transaction});

  @override
  Widget build(BuildContext context) {
    final tone = _transactionTone(transaction);
    final date = transaction.createdAt == null
        ? 'Pending'
        : DateFormat('dd.MM.yyyy').format(transaction.createdAt!.toLocal());
    final amountText = _money(transaction.currency, transaction.amount);
    final signedAmount =
        '${_isCreditType(transaction.type) ? '+' : '-'} $amountText';

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.overlayLight,
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: tone.background,
                shape: BoxShape.circle,
              ),
              child: Icon(
                tone.icon,
                color: tone.foreground,
                size: 24,
              ),
            ),
            SizedBox(width: AppSpacing.md),
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
                  SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          shape: BoxShape.circle,
                        ),
                      ),
                      SizedBox(width: 4),
                      Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: AppColors.warning,
                          shape: BoxShape.circle,
                        ),
                      ),
                      SizedBox(width: AppSpacing.sm),
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
            SizedBox(width: AppSpacing.md),
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
                SizedBox(height: 4),
                Text(date, style: AppTextStyles.bodyS),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryEmptyState extends StatelessWidget {
  final _TransactionFilter filter;

  const _HistoryEmptyState({required this.filter});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.history_toggle_off_rounded,
              color: AppColors.textHint,
              size: 32,
            ),
          ),
          SizedBox(height: AppSpacing.md),
          Text('No ${filter.label.toLowerCase()} yet',
              style: AppTextStyles.headingM),
          SizedBox(height: AppSpacing.xs),
          Text(
            'Transactions matching this filter will appear here when activity starts.',
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
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

class _KycBody extends StatelessWidget {
  final String status;

  const _KycBody({required this.status});

  @override
  Widget build(BuildContext context) {
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
              SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text('Status: $status', style: AppTextStyles.headingM),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.md),
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
    return _DataPanel(
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppTextStyles.bodyM)),
          SizedBox(width: AppSpacing.md),
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
                SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: AppTextStyles.labelM),
                      SizedBox(height: 2),
                      Text(
                        detail,
                        style: AppTextStyles.bodyS,
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
        ),
      ),
    );
  }
}

class _DataPanel extends StatelessWidget {
  final Widget child;

  const _DataPanel({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  final IconData icon;
  final String title;
  final String detail;

  const _EmptyPanel({
    required this.icon,
    required this.title,
    required this.detail,
  });

  @override
  Widget build(BuildContext context) {
    return _DataPanel(
      child: Column(
        children: [
          Icon(icon, color: AppColors.textHint, size: 36),
          SizedBox(height: AppSpacing.md),
          Text(title, style: AppTextStyles.headingM),
          SizedBox(height: AppSpacing.xs),
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
    return Center(
      child: Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: CircularProgressIndicator(color: AppColors.primary),
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
    return _DataPanel(
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, color: AppColors.primary),
          SizedBox(height: AppSpacing.sm),
          Text(message,
              style: AppTextStyles.bodyM, textAlign: TextAlign.center),
          SizedBox(height: AppSpacing.md),
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
    return _DataPanel(
      child: Column(
        children: [
          Icon(Icons.lock_clock_rounded, color: AppColors.warning),
          SizedBox(height: AppSpacing.sm),
          Text(
            'Your session needs to be refreshed before loading history.',
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          SizedBox(height: AppSpacing.md),
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
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.textPrimary,
                    ),
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
                  Icon(Icons.lock_outline_rounded,
                      color: AppColors.primary),
                  SizedBox(height: AppSpacing.md),
                  Text(
                    'Please log in again to continue.',
                    style: AppTextStyles.headingM,
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: AppSpacing.lg),
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

class _IconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _IconButton({required this.icon, required this.onTap});

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

class _DetailConfig {
  final String title;
  final String subtitle;

  const _DetailConfig({required this.title, required this.subtitle});
}

String _money(String currency, double amount) {
  return '$currency ${NumberFormat('#,##0.00').format(amount)}';
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

