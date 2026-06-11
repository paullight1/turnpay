import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/wallet_service.dart';

class WalletDetailScreen extends StatefulWidget {
  final String currency;

  const WalletDetailScreen({super.key, required this.currency});

  @override
  State<WalletDetailScreen> createState() => _WalletDetailScreenState();
}

class _WalletDetailScreenState extends State<WalletDetailScreen> {
  final _walletService = WalletService();
  late Future<WalletData?> _walletFuture;
  late Future<List<DepositRecord>> _depositsFuture;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    _walletFuture = _walletService.fetchWallet(widget.currency);
    _depositsFuture = _walletService.fetchRecentDeposits();
  }

  void _refresh() {
    setState(() {
      _loadData();
    });
  }

  @override
  Widget build(BuildContext context) {
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
                final deposits = depositSnapshot.data ?? [];

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
                            balance: wallet.balance,
                          ),
                          SizedBox(height: AppSpacing.lg),

                          // Action buttons
                          Row(
                            children: [
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.near_me_rounded,
                                  label: 'Send Money',
                                  color: AppColors.primary,
                                  onTap: () => context.push(AppRoutes.send),
                                ),
                              ),
                              SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.qr_code_2_rounded,
                                  label: 'Receive Money',
                                  color: AppColors.success,
                                  onTap: () => context.push(
                                    AppRoutes.receiveMoney,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: AppSpacing.lg),

                          // Virtual account section
                          _VirtualAccountSection(
                            currency: wallet.currency,
                          ),
                          SizedBox(height: AppSpacing.xl),

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
                          SizedBox(height: AppSpacing.md),
                        ],
                      ),
                    ),

                    // Deposits list
                    if (deposits.isEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg,
                        ),
                        sliver: SliverToBoxAdapter(
                          child: Container(
                            padding: const EdgeInsets.all(AppSpacing.xl),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              borderRadius: BorderRadius.circular(AppRadius.md),
                            ),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.receipt_long_outlined,
                                  color: AppColors.textHint,
                                  size: 48,
                                ),
                                SizedBox(height: AppSpacing.md),
                                Text(
                                  'No transactions yet',
                                  style: AppTextStyles.labelM,
                                ),
                                SizedBox(height: AppSpacing.xs),
                                Text(
                                  'Your transactions will appear here',
                                  style: AppTextStyles.bodyS,
                                ),
                              ],
                            ),
                          ),
                        ),
                      )
                    else
                      SliverPadding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg,
                        ),
                        sliver: SliverList.separated(
                          itemCount: deposits.length,
                          separatorBuilder: (_, __) =>
                              SizedBox(height: AppSpacing.sm),
                          itemBuilder: (context, index) {
                            final deposit = deposits[index];
                            return _TransactionRow(
                              reference: deposit.reference,
                              amount: deposit.amount,
                              currency: deposit.currency,
                              status: deposit.status,
                              type: 'FUND',
                              date: deposit.createdAt,
                            );
                          },
                        ),
                      ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _BalanceHero extends StatelessWidget {
  final String currency;
  final double balance;

  const _BalanceHero({
    required this.currency,
    required this.balance,
  });

  @override
  Widget build(BuildContext context) {
    final symbol = currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = NumberFormat('#,##0.00').format(balance);
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
            SizedBox(height: AppSpacing.xs),
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

  const _VirtualAccountSection({required this.currency});

  @override
  State<_VirtualAccountSection> createState() => _VirtualAccountSectionState();
}

class _VirtualAccountSectionState extends State<_VirtualAccountSection> {
  final _walletService = WalletService();
  late Future<List<VirtualAccountData>> _accountsFuture;

  @override
  void initState() {
    super.initState();
    _accountsFuture = _walletService.fetchVirtualAccounts();
  }

  @override
  Widget build(BuildContext context) {
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
                SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'No virtual account yet — provision one to receive bank transfers',
                    style: AppTextStyles.bodyS,
                  ),
                ),
                SizedBox(width: AppSpacing.sm),
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
              SizedBox(width: AppSpacing.sm),
              Text(
                'Virtual Account — Active',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.success,
                ),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _AccountDetailRow(
            label: 'Bank',
            value: account.bankName,
          ),
          SizedBox(height: AppSpacing.sm),
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
                Clipboard.setData(
                  ClipboardData(text: account.accountNumber),
                );
                showTpSnackbar(
                  context,
                  'Account number copied',
                  type: TpSnackbarType.success,
                );
              },
            ),
          ),
          SizedBox(height: AppSpacing.sm),
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
  final double amount;
  final String currency;
  final String status;
  final String type;
  final DateTime? date;

  const _TransactionRow({
    required this.reference,
    required this.amount,
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
    final symbol = currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = NumberFormat('#,##0.00').format(amount);
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
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _typeLabel(type),
                    style: AppTextStyles.labelM,
                  ),
                  SizedBox(height: 2),
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
                SizedBox(height: 2),
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
        SizedBox(height: AppSpacing.lg),
        Row(
          children: [
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 48,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            SizedBox(width: AppSpacing.sm),
            Expanded(
              child: ShimmerBlock(
                width: double.infinity,
                height: 48,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
          ],
        ),
        SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 80,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        SizedBox(height: AppSpacing.xl),
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
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: AppColors.primary,
            size: 48,
          ),
          SizedBox(height: AppSpacing.md),
          Text(
            'Could not load wallet',
            style: AppTextStyles.labelM,
          ),
          SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: onRetry,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
