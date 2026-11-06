import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/wallet_service.dart';

class WalletDetailScreen extends StatefulWidget {
  final String currency;
  final WalletService walletService;

  WalletDetailScreen({
    super.key,
    required this.currency,
    WalletService? walletService,
  }) : walletService = walletService ?? WalletService();

  @override
  State<WalletDetailScreen> createState() => _WalletDetailScreenState();
}

class _WalletDetailScreenState extends State<WalletDetailScreen> {
  late Future<WalletData?> _walletFuture;
  late Future<List<DepositRecord>> _depositsFuture;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    _walletFuture = widget.walletService.fetchWallet(widget.currency);
    _depositsFuture = widget.walletService.fetchRecentDeposits();
    // Deposit history is rendered after the wallet future. Attach an early
    // observer so a fast failed history request is still delivered to the
    // later FutureBuilder without becoming an unhandled asynchronous error.
    _depositsFuture.catchError((Object _, StackTrace __) {
      return <DepositRecord>[];
    });
  }

  void _refresh() {
    setState(() {
      _loadData();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: '${widget.currency} Wallet',
        menuActions: [
          TpPageMenuAction(
            label: 'Refresh',
            icon: Icons.refresh_rounded,
            onTap: _refresh,
          ),
          TpPageMenuAction(
            label: 'Home',
            icon: Icons.home_rounded,
            onTap: () => context.go(AppRoutes.home),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.surface,
        onRefresh: () async => _refresh(),
        child: FutureBuilder<WalletData?>(
          future: _walletFuture,
          builder: (context, walletSnapshot) {
            if (walletSnapshot.connectionState == ConnectionState.waiting) {
              return const _WalletDetailLoadingState();
            }

            if (walletSnapshot.hasError || !walletSnapshot.hasData) {
              return _WalletDetailErrorState(onRetry: _refresh);
            }

            final wallet = walletSnapshot.data!;

            return FutureBuilder<List<DepositRecord>>(
              future: _depositsFuture,
              builder: (context, depositSnapshot) {
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
                      sliver: SliverList.list(
                        children: [
                          // Balance card
                          _BalanceHero(
                            currency: wallet.currency,
                            balanceDecimalString: wallet.balanceDecimalString,
                          ),
                          const SizedBox(height: AppSpacing.lg),

                          // Action buttons
                          Row(
                            children: [
                              if (LaunchCapabilities.moneyOutEnabled) ...[
                                Expanded(
                                  child: _ActionButton(
                                    icon: Icons.near_me_rounded,
                                    label: 'Send Money',
                                    color: AppColors.primary,
                                    onTap: () => context.push(AppRoutes.send),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                              ],
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.add_rounded,
                                  label: LaunchCapabilities.moneyOutEnabled
                                      ? 'Receive Money'
                                      : 'Add funds',
                                  color: AppColors.success,
                                  onTap: () => context.push(
                                    AppRoutes.receiveMoney,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.lg),

                          // Virtual account section
                          _VirtualAccountSection(
                            currency: wallet.currency,
                            walletService: widget.walletService,
                          ),
                          const SizedBox(height: AppSpacing.xl),

                          // Transaction history header
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Transaction History',
                                  style: AppTextStyles.headingM,
                                ),
                              ),
                              TapScale(
                                onTap: () => context.push(AppRoutes.activity),
                                borderRadius: BorderRadius.circular(
                                  AppRadius.full,
                                ),
                                child: Text(
                                  'See all',
                                  style: AppTextStyles.labelM.copyWith(
                                    color: AppColors.primary,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.md),
                        ],
                      ),
                    ),

                    // Deposit history keeps loading, empty, and unavailable
                    // states distinct so a failed refresh never looks like a
                    // successful empty collection.
                    _buildDepositHistorySliver(depositSnapshot),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }

  Widget _buildDepositHistorySliver(
    AsyncSnapshot<List<DepositRecord>> snapshot,
  ) {
    if (snapshot.connectionState == ConnectionState.waiting &&
        !snapshot.hasData) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverList.separated(
          itemCount: 3,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) => ShimmerBlock(
            width: double.infinity,
            height: 68,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
        ),
      );
    }

    if (snapshot.hasError || !snapshot.hasData) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverToBoxAdapter(
          child: _DepositHistoryErrorState(onRetry: _refresh),
        ),
      );
    }

    final deposits = snapshot.data!;
    if (deposits.isEmpty) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverToBoxAdapter(
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Column(
              children: [
                const TpIllustration(
                  variant: TpIllustrationVariant.emptyTransactions,
                  size: 128,
                  semanticLabel: 'No deposits yet',
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'No deposits yet',
                  style: AppTextStyles.labelM,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Your deposit history will appear here',
                  style: AppTextStyles.bodyS,
                ),
              ],
            ),
          ),
        ),
      );
    }

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      sliver: SliverList.separated(
        itemCount: deposits.length,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (context, index) {
          final deposit = deposits[index];
          return _TransactionRow(
            reference: deposit.reference,
            amountDecimalString: deposit.amountDecimalString,
            currency: deposit.currency,
            status: deposit.status,
            type: 'FUND',
            date: deposit.createdAt,
          );
        },
      ),
    );
  }
}

class _BalanceHero extends StatelessWidget {
  final String currency;
  final String balanceDecimalString;

  const _BalanceHero({
    required this.currency,
    required this.balanceDecimalString,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final symbol = currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = _formatExactAmount(balanceDecimalString);
    final isLight = Theme.of(context).brightness == Brightness.light;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isLight
              ? [
                  AppColors.primary.withValues(alpha: 0.92),
                  AppColors.primaryLight,
                  AppColors.primaryDark,
                ]
              : [
                  AppColors.primaryDark,
                  AppColors.primary,
                  AppColors.primaryLight,
                ],
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.3),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.8),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                'Available Balance',
                style: AppTextStyles.bodyM.copyWith(
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: Text(
                  currency,
                  style: AppTextStyles.labelS.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            '$symbol$formatted',
            style: AppTextStyles.displayMedium.copyWith(
              fontSize: 36,
              letterSpacing: -1.5,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                '$currency Wallet',
                style: AppTextStyles.labelS.copyWith(
                  color: Colors.white.withValues(alpha: 0.82),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return TapScale(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      pressedScale: 0.95,
      child: Container(
        padding: const EdgeInsets.symmetric(
          vertical: AppSpacing.md,
          horizontal: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: AppSpacing.xs),
            Text(
              label,
              style: AppTextStyles.labelS.copyWith(
                color: color,
                fontWeight: FontWeight.w700,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class _VirtualAccountSection extends StatefulWidget {
  final String currency;
  final WalletService walletService;

  const _VirtualAccountSection({
    required this.currency,
    required this.walletService,
  });

  @override
  State<_VirtualAccountSection> createState() => _VirtualAccountSectionState();
}

class _VirtualAccountSectionState extends State<_VirtualAccountSection> {
  late Future<List<VirtualAccountData>> _accountsFuture;

  @override
  void initState() {
    super.initState();
    _accountsFuture = widget.walletService.fetchVirtualAccounts();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return FutureBuilder<List<VirtualAccountData>>(
      future: _accountsFuture,
      builder: (context, snapshot) {
        final accounts = snapshot.data ?? [];
        final activeAccount = accounts
            .where((a) => a.status.toUpperCase() == 'ACTIVE')
            .cast<VirtualAccountData?>()
            .firstOrNull;

        if (!snapshot.hasData &&
            snapshot.connectionState == ConnectionState.waiting) {
          return const SizedBox.shrink();
        }

        if (activeAccount == null) {
          return Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.account_balance_outlined,
                  color: AppColors.textHint,
                  size: 22,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'No virtual account yet — provision one to receive bank transfers',
                    style: AppTextStyles.bodyS,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                TapScale(
                  onTap: () => context.push(AppRoutes.virtualAccount),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  child: Text(
                    'Setup',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.primary,
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        return _ActiveVirtualAccountCard(account: activeAccount);
      },
    );
  }
}

class _ActiveVirtualAccountCard extends StatelessWidget {
  final VirtualAccountData account;

  const _ActiveVirtualAccountCard({required this.account});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                'Virtual Account — Active',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _AccountDetailRow(
            label: 'Bank',
            value: account.bankName,
          ),
          const SizedBox(height: AppSpacing.sm),
          _AccountDetailRow(
            label: 'Account Number',
            value: account.accountNumberMasked,
            trailing: IconButton(
              icon: Icon(
                Icons.copy_rounded,
                color: AppColors.primary,
                size: 18,
              ),
              tooltip: 'Copy account number',
              onPressed: () {
                final fullNumber = account.accountNumber.trim();
                final copyValue = fullNumber.isNotEmpty
                    ? fullNumber
                    : account.accountNumberMasked.trim();
                if (copyValue.isEmpty) return;
                Clipboard.setData(
                  ClipboardData(text: copyValue),
                );
                showTpSnackbar(
                  context,
                  'Account number copied',
                  type: TpSnackbarType.success,
                );
              },
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _AccountDetailRow(
            label: 'Account Name',
            value: account.accountName,
          ),
        ],
      ),
    );
  }
}

class _AccountDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Widget? trailing;

  const _AccountDetailRow({
    required this.label,
    required this.value,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: AppTextStyles.bodyS,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: AppTextStyles.labelM,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class _TransactionRow extends StatelessWidget {
  final String reference;
  final String amountDecimalString;
  final String currency;
  final String status;
  final String type;
  final DateTime? date;

  const _TransactionRow({
    required this.reference,
    required this.amountDecimalString,
    required this.currency,
    required this.status,
    required this.type,
    this.date,
  });

  IconData get _icon {
    switch (type.toUpperCase()) {
      case 'FUND':
        return Icons.add_card_rounded;
      case 'WITHDRAW':
        return Icons.account_balance_rounded;
      case 'TRANSFER':
        return Icons.near_me_rounded;
      case 'EXCHANGE':
        return Icons.currency_exchange_rounded;
      default:
        return Icons.receipt_long_rounded;
    }
  }

  Color get _statusColor {
    switch (status.toUpperCase()) {
      case 'SUCCESS':
        return AppColors.success;
      case 'FAILED':
      case 'REVERSED':
        return AppColors.error;
      default:
        return AppColors.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final symbol = currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = _formatExactAmount(amountDecimalString);
    final dateFormatted = date != null
        ? DateFormat('MMM d, HH:mm').format(date!.toLocal())
        : 'recently';

    return TapScale(
      onTap: () => context.push(
        AppRoutes.transactionDetailFor(reference),
      ),
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: _statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Icon(_icon, color: _statusColor, size: 20),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _typeLabel(type),
                    style: AppTextStyles.labelM,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    dateFormatted,
                    style: AppTextStyles.bodyS,
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '$symbol$formatted',
                  style: AppTextStyles.labelM.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: _statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: AppTextStyles.caption.copyWith(
                      color: _statusColor,
                      fontWeight: FontWeight.w700,
                      fontSize: 9,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _typeLabel(String type) {
    switch (type.toUpperCase()) {
      case 'FUND':
        return 'Wallet Deposit';
      case 'WITHDRAW':
        return 'Withdrawal';
      case 'INTERNAL_TRANSFER':
        return 'Transfer';
      case 'EXCHANGE':
        return 'Exchange';
      case 'AIRTIME':
        return 'Airtime';
      case 'DATA':
        return 'Data Bundle';
      case 'ELECTRICITY':
        return 'Electricity';
      case 'CABLE':
        return 'Cable TV';
      default:
        return type[0].toUpperCase() + type.substring(1).toLowerCase();
    }
  }
}

class _WalletDetailLoadingState extends StatelessWidget {
  const _WalletDetailLoadingState();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xxl,
      ),
      children: [
        ShimmerBlock(
          width: double.infinity,
          height: 160,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        const SizedBox(height: AppSpacing.lg),
        Row(
          children: [
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 48,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 48,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 80,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        const SizedBox(height: AppSpacing.xl),
        ...List.generate(5, (_) {
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ShimmerBlock(
              width: double.infinity,
              height: 68,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
          );
        }),
      ],
    );
  }
}

class _WalletDetailErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _WalletDetailErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: AppColors.primary,
            size: 48,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Could not load wallet',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: onRetry,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _DepositHistoryErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _DepositHistoryErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: AppColors.primary,
            size: 40,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Deposit history unavailable',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'We could not load your deposit history. Try again when you are online.',
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Retry'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: BorderSide(
                color: AppColors.primary.withValues(alpha: 0.35),
              ),
              minimumSize: const Size.fromHeight(56),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.button),
              ),
            ),
          ),
        ],
      ),
    );
  }
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
