import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';
import '../../../services/wallet_service.dart';

class ReceiveMoneyScreen extends StatefulWidget {
  const ReceiveMoneyScreen({super.key});

  @override
  State<ReceiveMoneyScreen> createState() => _ReceiveMoneyScreenState();
}

class _ReceiveMoneyScreenState extends State<ReceiveMoneyScreen> {
  final _walletService = WalletService();
  final _homeDataService = HomeDataService();
  final _accountRequestAttempt = MoneyAttemptIdempotency();
  late Future<List<VirtualAccountData>> _accountsFuture;
  late Future<List<DepositRecord>> _depositsFuture;
  bool _isRequestingAccount = false;

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

  Future<void> _requestVirtualAccount() async {
    if (_isRequestingAccount) return;

    setState(() => _isRequestingAccount = true);

    try {
      final dashboard = await _homeDataService.fetchDashboard();
      final names = _virtualAccountNameParts(dashboard.user);

      await _homeDataService.provisionVirtualAccount(
        firstName: names.firstName,
        lastName: names.lastName,
        middleName: names.middleName,
        idempotencyKey:
            _accountRequestAttempt.keyFor('receive-account|monnify|NGN'),
      );
      _accountRequestAttempt.markFinalOutcome();

      if (!mounted) return;
      showTpSnackbar(
        context,
        'Virtual account requested successfully.',
        type: TpSnackbarType.success,
      );
      _refresh();
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(
          error,
          'Could not request your virtual account. Complete KYC and try again.',
        ),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isRequestingAccount = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Receive Money',
        menuActions: [
          TpPageMenuAction(
            label: 'Refresh',
            icon: Icons.refresh_rounded,
            onTap: _refresh,
          ),
        ],
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
                              isRequesting: _isRequestingAccount,
                              onRequest: _requestVirtualAccount,
                            ),

                          SizedBox(height: AppSpacing.md),

                          // Deposit instructions
                          Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                              border: Border.all(
                                color: AppColors.border,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
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
                              borderRadius: BorderRadius.circular(AppRadius.md),
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

_VirtualAccountNameParts _virtualAccountNameParts(HomeUser user) {
  final source = user.fullName.trim().isNotEmpty
      ? user.fullName.trim()
      : user.email.split('@').first.trim();
  final parts = source
      .split(RegExp(r'\s+|[._-]+'))
      .where((part) => part.trim().isNotEmpty)
      .toList();

  return _VirtualAccountNameParts(
    firstName: parts.isNotEmpty ? parts.first : 'TrustPay',
    lastName: parts.length > 1 ? parts.last : 'User',
    middleName:
        parts.length > 2 ? parts.sublist(1, parts.length - 1).join(' ') : null,
  );
}

class _VirtualAccountNameParts {
  final String firstName;
  final String lastName;
  final String? middleName;

  const _VirtualAccountNameParts({
    required this.firstName,
    required this.lastName,
    this.middleName,
  });
}

class _VirtualAccountCard extends StatelessWidget {
  final VirtualAccountData account;

  const _VirtualAccountCard({required this.account});

  String get _displayAccountNumber {
    final fullNumber = account.accountNumber.trim();
    if (fullNumber.isNotEmpty) return fullNumber;
    return account.accountNumberMasked.trim();
  }

  Future<void> _copyAccountNumber(BuildContext context) async {
    final value = _displayAccountNumber;
    if (value.isEmpty) return;

    await Clipboard.setData(ClipboardData(text: value));
    if (!context.mounted) return;
    showTpSnackbar(
      context,
      'Account number copied',
      type: TpSnackbarType.success,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isActive = account.status.toUpperCase() == 'ACTIVE';
    final accountNumber = _displayAccountNumber;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: AppColors.primary,
                  size: 20,
                ),
              ),
              SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      account.bankName.isEmpty ? 'Bank account' : account.bankName,
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: isActive
                                ? AppColors.success
                                : AppColors.warning,
                            shape: BoxShape.circle,
                          ),
                        ),
                        SizedBox(width: AppSpacing.xs),
                        Flexible(
                          child: Text(
                            isActive ? 'Active receiving account' : account.status,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.caption.copyWith(
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
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
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text(
                  account.currency,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              )
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _AccountDetailRow(
            label: 'Account name',
            value: account.accountName.isEmpty ? 'TrustPay user' : account.accountName,
          ),
          SizedBox(height: AppSpacing.sm),
          TapScale(
            onTap: () => _copyAccountNumber(context),
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _AccountDetailRow(
                      label: 'Account number',
                      value: accountNumber.isEmpty ? 'Not available' : accountNumber,
                      isLarge: true,
                    ),
                  ),
                  SizedBox(width: AppSpacing.sm),
                  Icon(
                    Icons.copy_rounded,
                    color: AppColors.primary,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
          SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _copyAccountNumber(context),
              icon: const Icon(Icons.copy_rounded, size: 18),
              label: const Text('Copy account number'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primary,
                side: BorderSide(
                  color: AppColors.primary.withValues(alpha: 0.35),
                ),
                minimumSize: const Size.fromHeight(44),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isLarge;

  const _AccountDetailRow({
    required this.label,
    required this.value,
    this.isLarge = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w700,
          ),
        ),
        SizedBox(height: 3),
        Text(
          value,
          maxLines: isLarge ? 1 : 2,
          overflow: TextOverflow.ellipsis,
          style: (isLarge ? AppTextStyles.headingL : AppTextStyles.labelM)
              .copyWith(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}

class _NoVirtualAccountCard extends StatelessWidget {
  final bool isRequesting;
  final VoidCallback onRequest;

  const _NoVirtualAccountCard({
    required this.isRequesting,
    required this.onRequest,
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
            'Request a virtual account to receive bank transfers directly into your TrustPay wallet.',
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.center,
          ),
          SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: isRequesting ? null : onRequest,
            child: isRequesting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Request virtual account'),
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
    final formatted = NumberFormat('#,##0.00').format(deposit.amount);
    final dateFormatted = deposit.createdAt != null
        ? DateFormat('MMM d, HH:mm').format(deposit.createdAt!.toLocal())
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
