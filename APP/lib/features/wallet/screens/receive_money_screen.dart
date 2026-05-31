import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../services/wallet_service.dart';

class ReceiveMoneyScreen extends StatefulWidget {
  const ReceiveMoneyScreen({super.key});

  @override
  State<ReceiveMoneyScreen> createState() => _ReceiveMoneyScreenState();
}

class _ReceiveMoneyScreenState extends State<ReceiveMoneyScreen> {
  final _walletService = WalletService();
  late Future<List<VirtualAccountData>> _accountsFuture;
  late Future<List<DepositRecord>> _depositsFuture;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    _accountsFuture = _walletService.fetchVirtualAccounts();
    _depositsFuture = _walletService.fetchRecentDeposits(limit: 20);
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
      appBar: AppBar(
        title: const Text('Receive Money'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.surface,
        onRefresh: () async => _refresh(),
        child: FutureBuilder<List<VirtualAccountData>>(
          future: _accountsFuture,
          builder: (context, accountsSnapshot) {
            final accounts = accountsSnapshot.data ?? [];

            return FutureBuilder<List<DepositRecord>>(
              future: _depositsFuture,
              builder: (context, depositsSnapshot) {
                final deposits = depositsSnapshot.data ?? [];

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
                          // Virtual account card
                          if (accounts.isNotEmpty)
                            ...accounts.map((account) {
                              return Padding(
                                padding: const EdgeInsets.only(
                                  bottom: AppSpacing.md,
                                ),
                                child: _VirtualAccountCard(
                                  account: account,
                                ),
                              );
                            })
                          else
                            _NoVirtualAccountCard(
                              accounts: accounts,
                              onRefresh: _refresh,
                            ),

                          SizedBox(height: AppSpacing.md),

                          // Deposit instructions
                          Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              borderRadius:
                                  BorderRadius.circular(AppRadius.sm),
                              border: Border.all(
                                color: AppColors.border,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(
                                      Icons.info_outline_rounded,
                                      color: AppColors.primary,
                                      size: 20,
                                    ),
                                    SizedBox(width: AppSpacing.sm),
                                    Text(
                                      'How to receive money',
                                      style: AppTextStyles.labelM,
                                    ),
                                  ],
                                ),
                                SizedBox(height: AppSpacing.md),
                                _InstructionStep(
                                  number: '1',
                                  text:
                                      'Share your virtual account number above with the sender',
                                ),
                                SizedBox(height: AppSpacing.sm),
                                _InstructionStep(
                                  number: '2',
                                  text:
                                      'The sender transfers money to this account number from any Nigerian bank or mobile app',
                                ),
                                SizedBox(height: AppSpacing.sm),
                                _InstructionStep(
                                  number: '3',
                                  text:
                                      'Once the transfer is confirmed, your TrustPay wallet is credited automatically',
                                ),
                                SizedBox(height: AppSpacing.sm),
                                _InstructionStep(
                                  number: '4',
                                  text:
                                      'Bank transfers usually arrive within 5–30 minutes during business hours',
                                ),
                              ],
                            ),
                          ),

                          SizedBox(height: AppSpacing.xl),

                          // Recent deposits header
                          Text(
                            'Recent Deposits',
                            style: AppTextStyles.headingM,
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
                              borderRadius:
                                  BorderRadius.circular(AppRadius.md),
                            ),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.history_rounded,
                                  color: AppColors.textHint,
                                  size: 48,
                                ),
                                SizedBox(height: AppSpacing.md),
                                Text(
                                  'No deposits yet',
                                  style: AppTextStyles.labelM,
                                ),
                                SizedBox(height: AppSpacing.xs),
                                Text(
                                  'Deposits will appear here once someone sends money to your virtual account',
                                  style: AppTextStyles.bodyS,
                                  textAlign: TextAlign.center,
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
                            return _DepositRow(deposit: deposit);
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

class _VirtualAccountCard extends StatelessWidget {
  final VirtualAccountData account;

  const _VirtualAccountCard({required this.account});

  @override
  Widget build(BuildContext context) {
    final isActive = account.status.toUpperCase() == 'ACTIVE';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF1A3A3A),
            Color(0xFF0F2B2B),
          ],
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isActive
              ? AppColors.success.withValues(alpha: 0.3)
              : AppColors.border,
        ),
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
                  color: isActive ? AppColors.success : AppColors.warning,
                  shape: BoxShape.circle,
                ),
              ),
              SizedBox(width: AppSpacing.sm),
              Text(
                account.bankName,
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const Spacer(),
              Text(
                account.currency,
                style: AppTextStyles.caption.copyWith(
                  color: AppColors.textHint,
                ),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.lg),
          // Account number — large and prominent
          GestureDetector(
            onTap: () {
              Clipboard.setData(
                ClipboardData(text: account.accountNumber),
              );
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Account number ${account.accountNumber} copied',
                  ),
                  backgroundColor: AppColors.surface,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  account.accountNumberMasked,
                  style: AppTextStyles.displayMedium.copyWith(
                    fontSize: 28,
                    letterSpacing: 4,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(width: AppSpacing.sm),
                Icon(
                  Icons.copy_rounded,
                  color: AppColors.textHint,
                  size: 20,
                ),
              ],
            ),
          ),
          SizedBox(height: AppSpacing.md),
          Text(
            account.accountName,
            style: AppTextStyles.bodyM.copyWith(
              color: AppColors.textSecondary,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: AppSpacing.lg),
          // Copy button
          SizedBox(
            width: double.infinity,
            child: TapScale(
              onTap: () {
                Clipboard.setData(
                  ClipboardData(text: account.accountNumber),
                );
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Account number copied'),
                    backgroundColor: AppColors.surface,
                    duration: const Duration(seconds: 2),
                  ),
                );
              },
              borderRadius: BorderRadius.circular(AppRadius.full),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.15),
                  borderRadius:
                      BorderRadius.circular(AppRadius.full),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.copy_rounded,
                      color: AppColors.primary,
                      size: 18,
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Text(
                      'Copy Account Number',
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.primary,
                      ),
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

class _NoVirtualAccountCard extends StatelessWidget {
  final List<VirtualAccountData> accounts;
  final VoidCallback onRefresh;

  const _NoVirtualAccountCard({
    required this.accounts,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Icon(
            Icons.account_balance_outlined,
            color: AppColors.textHint,
            size: 48,
          ),
          SizedBox(height: AppSpacing.md),
          Text(
            'No virtual account yet',
            style: AppTextStyles.labelM,
          ),
          SizedBox(height: AppSpacing.xs),
          Text(
            'Provision a virtual account to receive bank transfers directly into your TrustPay wallet.',
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.center,
          ),
          SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: onRefresh,
            child: const Text('Provision Account'),
          ),
        ],
      ),
    );
  }
}

class _InstructionStep extends StatelessWidget {
  final String number;
  final String text;

  const _InstructionStep({
    required this.number,
    required this.text,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          alignment: Alignment.center,
          child: Text(
            number,
            style: AppTextStyles.caption.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        SizedBox(width: AppSpacing.md),
        Expanded(
          child: Text(text, style: AppTextStyles.bodyM),
        ),
      ],
    );
  }
}

class _DepositRow extends StatelessWidget {
  final DepositRecord deposit;

  const _DepositRow({required this.deposit});

  @override
  Widget build(BuildContext context) {
    final symbol = deposit.currency == 'NGN' ? '₦' : 'GH₵';
    final formatted =
        NumberFormat('#,##0.00').format(deposit.amount);
    final dateFormatted = deposit.createdAt != null
        ? DateFormat('MMM d, HH:mm')
            .format(deposit.createdAt!.toLocal())
        : 'recently';

    final statusColor = deposit.status.toUpperCase() == 'SUCCESS'
        ? AppColors.success
        : deposit.status.toUpperCase() == 'FAILED'
            ? AppColors.error
            : AppColors.warning;

    return Container(
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
              color: statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.arrow_downward_rounded,
              color: statusColor,
              size: 20,
            ),
          ),
          SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Bank Transfer', style: AppTextStyles.labelM),
                SizedBox(height: 2),
                Text(dateFormatted, style: AppTextStyles.bodyS),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '$symbol$formatted',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.success,
                  fontWeight: FontWeight.w700,
                ),
              ),
              SizedBox(height: 2),
              Text(
                deposit.status.toUpperCase(),
                style: AppTextStyles.caption.copyWith(
                  color: statusColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
