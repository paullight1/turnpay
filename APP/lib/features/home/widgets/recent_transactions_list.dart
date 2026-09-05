import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';

class RecentTransactionsList extends StatefulWidget {
  final HomeDataService homeDataService;

  RecentTransactionsList({
    super.key,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  State<RecentTransactionsList> createState() => _RecentTransactionsListState();
}

class _RecentTransactionsListState extends State<RecentTransactionsList> {
  late Future<List<HomeTransaction>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchTransactions(limit: 5);
  }

  void _reload() {
    setState(() {
      _future = widget.homeDataService.fetchTransactions(limit: 5);
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Recent transactions', style: AppTextStyles.headingM),
            GestureDetector(
              onTap: () => context.push(AppRoutes.activity),
              child: Text(
                'See all',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        FutureBuilder<List<HomeTransaction>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const _TransactionsLoadingState();
            }

            if (snapshot.hasError) {
              return _TransactionsMessage(
                variant: TpIllustrationVariant.connectionLost,
                title: authErrorMessage(
                  snapshot.error ?? 'Could not load transactions',
                  'Could not load transactions',
                ),
                actionLabel: 'Retry',
                onAction: _reload,
              );
            }

            final transactions = snapshot.data ?? const <HomeTransaction>[];
            if (transactions.isEmpty) {
              return _TransactionsMessage(
                variant: TpIllustrationVariant.emptyTransactions,
                title: 'No transactions yet',
                detail: 'Fund your wallet to start moving money.',
                actionLabel: 'Fund wallet',
                onAction: () => context.push(AppRoutes.fund),
              );
            }

            return Column(
              children: transactions
                  .map((transaction) => _TransactionRow(tx: transaction))
                  .toList(),
            );
          },
        ),
      ],
    );
  }
}

class _TransactionsLoadingState extends StatelessWidget {
  const _TransactionsLoadingState();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return const TrustPayAnimatedState(
      variant: TrustPayAnimationVariant.loading,
      title: 'Loading recent activity',
      detail: 'Fetching the latest wallet movements.',
      animationSize: 72,
    );
  }
}

class _TransactionsMessage extends StatelessWidget {
  final TpIllustrationVariant variant;
  final String title;
  final String? detail;
  final String actionLabel;
  final VoidCallback onAction;

  const _TransactionsMessage({
    required this.variant,
    required this.title,
    this.detail,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          TpIllustration(variant: variant, size: 132, semanticLabel: title),
          const SizedBox(height: AppSpacing.sm),
          Text(title, style: AppTextStyles.labelM, textAlign: TextAlign.center),
          if (detail != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              detail!,
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextButton(
            onPressed: () {
              Haptics.selection();
              onAction();
            },
            child: Text(actionLabel),
          ),
        ],
      ),
    );
  }
}

class _TransactionRow extends StatelessWidget {
  final HomeTransaction tx;

  const _TransactionRow({required this.tx});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final isCredit = tx.type.toUpperCase() == 'FUND';
    final normalizedType = tx.type.toUpperCase();
    final color = _iconColor(normalizedType, isCredit);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child:
                Icon(_icon(normalizedType, isCredit), color: color, size: 20),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_title(tx.type), style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(
                  tx.reference.isEmpty ? tx.status : tx.reference,
                  style: AppTextStyles.bodyS,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${isCredit ? '+' : '-'}${_money(tx.currency, tx.amount)}',
                style: AppTextStyles.labelM.copyWith(
                  color: isCredit ? AppColors.success : AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(_date(tx.createdAt), style: AppTextStyles.bodyS),
            ],
          ),
        ],
      ),
    );
  }

  String _title(String type) {
    return type.replaceAll('_', ' ').toLowerCase().split(' ').map((part) {
      if (part.isEmpty) return part;
      return '${part[0].toUpperCase()}${part.substring(1)}';
    }).join(' ');
  }

  String _money(String currency, double amount) {
    return NumberFormat.currency(
      name: currency,
      symbol: currency == 'NGN' ? 'NGN ' : '$currency ',
      decimalDigits: 2,
    ).format(amount);
  }

  String _date(DateTime? date) {
    if (date == null) return 'Pending';
    return DateFormat.MMMd().format(date);
  }

  IconData _icon(String type, bool isCredit) {
    if (isCredit) return Icons.arrow_downward_rounded;
    if (type == 'AIRTIME' || type == 'DATA') return Icons.phone_android_rounded;
    if (type == 'ELECTRICITY') return Icons.bolt_rounded;
    if (type == 'WITHDRAW' || type == 'INTERNAL_TRANSFER') {
      return Icons.send_rounded;
    }
    return Icons.receipt_long_rounded;
  }

  Color _iconColor(String type, bool isCredit) {
    if (isCredit) return AppColors.success;
    if (type == 'AIRTIME' || type == 'DATA') return AppColors.warning;
    if (type == 'ELECTRICITY') return AppColors.error;
    return AppColors.primary;
  }
}
