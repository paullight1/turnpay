import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../services/wallet_service.dart';

class TransactionDetailScreen extends StatefulWidget {
  final String reference;

  const TransactionDetailScreen({super.key, required this.reference});

  @override
  State<TransactionDetailScreen> createState() =>
      _TransactionDetailScreenState();
}

class _TransactionDetailScreenState extends State<TransactionDetailScreen> {
  final _walletService = WalletService();
  late Future<TransactionDetail?> _detailFuture;

  @override
  void initState() {
    super.initState();
    _detailFuture = _walletService.fetchTransactionDetail(widget.reference);
  }

  void _refresh() {
    setState(() {
      _detailFuture = _walletService.fetchTransactionDetail(widget.reference);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Transaction Details',
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
      body: FutureBuilder<TransactionDetail?>(
        future: _detailFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _DetailLoadingState();
          }

          if (snapshot.hasError || !snapshot.hasData) {
            return _DetailErrorState(onRetry: _refresh);
          }

          final detail = snapshot.data!;
          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () async => _refresh(),
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
                      // Amount hero
                      _AmountHero(detail: detail),
                      SizedBox(height: AppSpacing.lg),

                      // Basic info card
                      _InfoCard(detail: detail),
                      SizedBox(height: AppSpacing.md),

                      // Fee breakdown
                      _FeeBreakdown(detail: detail),
                      SizedBox(height: AppSpacing.md),

                      // Ledger entries
                      if (detail.ledgerEntries.isNotEmpty) ...[
                        _LedgerEntriesCard(
                          entries: detail.ledgerEntries,
                        ),
                        SizedBox(height: AppSpacing.md),
                      ],

                      // Transfer attempts (provider events)
                      if (detail.transferAttempts.isNotEmpty) ...[
                        _TransferAttemptsCard(
                          attempts: detail.transferAttempts,
                        ),
                        SizedBox(height: AppSpacing.md),
                      ],

                      // Exchange receipt
                      if (detail.exchangeReceipt != null) ...[
                        _ExchangeReceiptCard(
                          receipt: detail.exchangeReceipt!,
                        ),
                        SizedBox(height: AppSpacing.md),
                      ],

                      // Exchange payout
                      if (detail.exchangePayout != null) ...[
                        _ExchangePayoutCard(
                          payout: detail.exchangePayout!,
                        ),
                        SizedBox(height: AppSpacing.md),
                      ],

                      // VTU order
                      if (detail.vtuOrder != null) ...[
                        _VtuOrderCard(order: detail.vtuOrder!),
                        SizedBox(height: AppSpacing.md),
                      ],

                      // Status action (retry for failed)
                      if (_canRetry(detail))
                        _RetryAction(reference: detail.reference),

                      // Metadata
                      if (detail.metadata != null &&
                          detail.metadata!.isNotEmpty)
                        _MetadataCard(metadata: detail.metadata!),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  bool _canRetry(TransactionDetail detail) {
    return detail.status.toUpperCase() == 'FAILED';
  }
}

class _AmountHero extends StatelessWidget {
  final TransactionDetail detail;

  const _AmountHero({required this.detail});

  @override
  Widget build(BuildContext context) {
    final symbol = detail.currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = NumberFormat('#,##0.00').format(detail.amount);

    final typeIcon = _iconForType(detail.type);
    final statusColor = _colorForStatus(detail.status);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(typeIcon, color: statusColor, size: 28),
          ),
          SizedBox(height: AppSpacing.md),
          Text(
            '$symbol$formatted',
            style: AppTextStyles.displayMedium.copyWith(
              fontSize: 34,
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: AppSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 4,
            ),
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: Text(
              detail.status.toUpperCase(),
              style: AppTextStyles.labelS.copyWith(
                color: statusColor,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          SizedBox(height: AppSpacing.sm),
          Text(
            _typeLabel(detail.type),
            style: AppTextStyles.bodyM,
          ),
        ],
      ),
    );
  }

  IconData _iconForType(String type) {
    switch (type.toUpperCase()) {
      case 'FUND':
        return Icons.add_card_rounded;
      case 'WITHDRAW':
        return Icons.account_balance_rounded;
      case 'INTERNAL_TRANSFER':
        return Icons.near_me_rounded;
      case 'EXCHANGE':
        return Icons.currency_exchange_rounded;
      case 'AIRTIME':
      case 'DATA':
      case 'ELECTRICITY':
      case 'CABLE':
        return Icons.receipt_long_rounded;
      default:
        return Icons.history_rounded;
    }
  }

  Color _colorForStatus(String status) {
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

  String _typeLabel(String type) {
    switch (type.toUpperCase()) {
      case 'FUND':
        return 'Wallet Deposit';
      case 'WITHDRAW':
        return 'Withdrawal';
      case 'INTERNAL_TRANSFER':
        return 'Internal Transfer';
      case 'EXCHANGE':
        return 'Currency Exchange';
      case 'AIRTIME':
        return 'Airtime Purchase';
      case 'DATA':
        return 'Data Bundle';
      case 'ELECTRICITY':
        return 'Electricity Bill';
      case 'CABLE':
        return 'Cable TV';
      default:
        return type[0].toUpperCase() + type.substring(1).toLowerCase();
    }
  }
}

class _InfoCard extends StatelessWidget {
  final TransactionDetail detail;

  const _InfoCard({required this.detail});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Details', style: AppTextStyles.labelM),
          SizedBox(height: AppSpacing.md),
          _DetailRow(label: 'Reference', value: detail.reference),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(label: 'Type', value: _capitalize(detail.type)),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Currency',
            value: detail.currency,
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Date',
            value: detail.createdAt != null
                ? DateFormat('MMM d, yyyy – HH:mm')
                    .format(detail.createdAt!.toLocal())
                : '—',
          ),
          if (detail.updatedAt != null &&
              detail.updatedAt != detail.createdAt) ...[
            SizedBox(height: AppSpacing.sm),
            _DetailRow(
              label: 'Last updated',
              value: DateFormat('MMM d, yyyy – HH:mm')
                  .format(detail.updatedAt!.toLocal()),
            ),
          ],
        ],
      ),
    );
  }

  String _capitalize(String value) {
    if (value.isEmpty) return value;
    return value[0].toUpperCase() +
        value.substring(1).toLowerCase().replaceAll('_', ' ');
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 100,
          child: Text(label, style: AppTextStyles.bodyS),
        ),
        Expanded(
          child: Text(
            value,
            style: AppTextStyles.labelM,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _FeeBreakdown extends StatelessWidget {
  final TransactionDetail detail;

  const _FeeBreakdown({required this.detail});

  @override
  Widget build(BuildContext context) {
    final symbol = detail.currency == 'NGN' ? '₦' : 'GH₵';
    final feeFormatted = NumberFormat('#,##0.00').format(detail.fee);
    final netAmount = detail.amount - detail.fee;
    final netFormatted = NumberFormat('#,##0.00').format(netAmount);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Amount Breakdown', style: AppTextStyles.labelM),
          SizedBox(height: AppSpacing.md),
          _DetailRow(
            label: 'Amount',
            value: '$symbol${NumberFormat('#,##0.00').format(detail.amount)}',
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Fee',
            value: feeFormatted == '0.00' ? 'Free' : '$symbol$feeFormatted',
          ),
          const Divider(height: AppSpacing.lg),
          _DetailRow(
            label: 'Net',
            value: '$symbol$netFormatted',
          ),
        ],
      ),
    );
  }
}

class _LedgerEntriesCard extends StatelessWidget {
  final List<LedgerEntryData> entries;

  const _LedgerEntriesCard({required this.entries});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.book_rounded,
                color: AppColors.textSecondary,
                size: 18,
              ),
              SizedBox(width: AppSpacing.sm),
              Text('Ledger Entries', style: AppTextStyles.labelM),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          ...entries.map((entry) {
            final isDebit = entry.direction.toUpperCase() == 'DEBIT';
            final entryColor = isDebit ? AppColors.error : AppColors.success;
            final prefix = isDebit ? '−' : '+';
            final symbol = entry.currency == 'NGN' ? '₦' : 'GH₵';
            final amountFormatted =
                NumberFormat('#,##0.00').format(entry.amount);

            return Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: AppColors.surface.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(AppRadius.xs),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: entryColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                      ),
                      child: Icon(
                        isDebit
                            ? Icons.arrow_upward_rounded
                            : Icons.arrow_downward_rounded,
                        color: entryColor,
                        size: 16,
                      ),
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            entry.source,
                            style: AppTextStyles.labelS,
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Balance: $symbol${NumberFormat('#,##0.00').format(entry.balanceBefore)} → $symbol${NumberFormat('#,##0.00').format(entry.balanceAfter)}',
                            style: AppTextStyles.caption,
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '$prefix$symbol$amountFormatted',
                      style: AppTextStyles.labelM.copyWith(
                        color: entryColor,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _TransferAttemptsCard extends StatelessWidget {
  final List<TransferAttemptData> attempts;

  const _TransferAttemptsCard({required this.attempts});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.swap_horiz_rounded,
                color: AppColors.textSecondary,
                size: 18,
              ),
              SizedBox(width: AppSpacing.sm),
              Text(
                'Provider Events',
                style: AppTextStyles.labelM,
              ),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          ...attempts.map((attempt) {
            return Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _DetailRow(
                label: attempt.provider,
                value:
                    '${attempt.providerStatus} (attempt #${attempt.attemptNo})',
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _ExchangeReceiptCard extends StatelessWidget {
  final ExchangeReceiptData receipt;

  const _ExchangeReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.currency_exchange_rounded,
                color: AppColors.textSecondary,
                size: 18,
              ),
              SizedBox(width: AppSpacing.sm),
              Text('Exchange Receipt', style: AppTextStyles.labelM),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _DetailRow(
            label: 'Status',
            value: receipt.status,
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Rate',
            value: NumberFormat('#,##0.0000').format(receipt.rate),
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Sender',
            value: receipt.senderName,
          ),
          if (receipt.senderBankName != null &&
              receipt.senderBankName!.isNotEmpty) ...[
            SizedBox(height: AppSpacing.sm),
            _DetailRow(
              label: 'Bank',
              value: receipt.senderBankName!,
            ),
          ],
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Expected',
            value:
                '${receipt.targetCurrency} ${NumberFormat('#,##0.00').format(receipt.expectedCreditAmount)}',
          ),
          if (receipt.creditedAt != null) ...[
            SizedBox(height: AppSpacing.sm),
            _DetailRow(
              label: 'Credited',
              value: DateFormat('MMM d, HH:mm').format(
                receipt.creditedAt!.toLocal(),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExchangePayoutCard extends StatelessWidget {
  final ExchangePayoutData payout;

  const _ExchangePayoutCard({required this.payout});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.outbound_rounded,
                color: AppColors.textSecondary,
                size: 18,
              ),
              SizedBox(width: AppSpacing.sm),
              Text(
                'Exchange Payout',
                style: AppTextStyles.labelM,
              ),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _DetailRow(
            label: 'Status',
            value: payout.status,
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'To Bank',
            value: payout.destinationBankName,
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Account',
            value:
                '*****${payout.destinationAccountNumber.substring(payout.destinationAccountNumber.length - 4)}',
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'To Send',
            value:
                '${payout.destinationCurrency} ${NumberFormat('#,##0.00').format(payout.destinationAmount)}',
          ),
        ],
      ),
    );
  }
}

class _VtuOrderCard extends StatelessWidget {
  final VtuOrderData order;

  const _VtuOrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.receipt_long_rounded,
                color: AppColors.textSecondary,
                size: 18,
              ),
              SizedBox(width: AppSpacing.sm),
              Text('VTU Order', style: AppTextStyles.labelM),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _DetailRow(
            label: 'Service',
            value: _serviceLabel(order.serviceType),
          ),
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Provider',
            value: order.provider,
          ),
          if (order.targetMasked != null && order.targetMasked!.isNotEmpty) ...[
            SizedBox(height: AppSpacing.sm),
            _DetailRow(
              label: 'Target',
              value: order.targetMasked!,
            ),
          ],
          SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: 'Status',
            value: order.status,
          ),
        ],
      ),
    );
  }

  String _serviceLabel(String type) {
    switch (type.toUpperCase()) {
      case 'AIRTIME':
        return 'Airtime Top-up';
      case 'DATA':
        return 'Data Bundle';
      case 'ELECTRICITY':
        return 'Electricity Bill';
      case 'CABLE':
        return 'Cable TV';
      default:
        return type;
    }
  }
}

class _RetryAction extends StatelessWidget {
  final String reference;

  const _RetryAction({required this.reference});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: SizedBox(
        width: double.infinity,
        child: TapScale(
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Retry initiated for $reference',
                ),
                backgroundColor: AppColors.surface,
              ),
            );
          },
          borderRadius: BorderRadius.circular(AppRadius.full),
          child: Container(
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.full),
              border: Border.all(
                color: AppColors.primary.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.refresh_rounded,
                  color: AppColors.primary,
                  size: 20,
                ),
                SizedBox(width: AppSpacing.sm),
                Text(
                  'Retry Transaction',
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.primary,
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

class _MetadataCard extends StatelessWidget {
  final Map<String, dynamic> metadata;

  const _MetadataCard({required this.metadata});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Provider Metadata', style: AppTextStyles.labelM),
          SizedBox(height: AppSpacing.md),
          ...metadata.entries
              .where((e) => e.value != null && e.key != 'rawPayload')
              .map((entry) {
            final value = entry.value is String
                ? entry.value as String
                : entry.value.toString();
            // Mask sensitive keys
            final displayValue = _isSensitiveKey(entry.key)
                ? '*****${value.substring(value.length > 4 ? value.length - 4 : 0)}'
                : value;

            return Padding(
              padding: const EdgeInsets.only(
                bottom: AppSpacing.sm,
              ),
              child: _DetailRow(
                label: _formatKey(entry.key),
                value: displayValue,
              ),
            );
          }),
        ],
      ),
    );
  }

  bool _isSensitiveKey(String key) {
    final lower = key.toLowerCase();
    return lower.contains('account') ||
        lower.contains('card') ||
        lower.contains('secret') ||
        lower.contains('token') ||
        lower.contains('pin');
  }

  String _formatKey(String key) {
    return key
        .replaceAllMapped(
          RegExp(r'([A-Z])'),
          (m) => ' ${m.group(0)}',
        )
        .trim()
        .split(' ')
        .map(
            (w) => w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1)}' : '')
        .join(' ');
  }
}

class _DetailLoadingState extends StatelessWidget {
  const _DetailLoadingState();

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
          height: 200,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 160,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        SizedBox(height: AppSpacing.md),
        ShimmerBlock(
          width: double.infinity,
          height: 120,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        SizedBox(height: AppSpacing.md),
        ShimmerBlock(
          width: double.infinity,
          height: 140,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
      ],
    );
  }
}

class _DetailErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _DetailErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.error_outline_rounded,
            color: AppColors.error,
            size: 48,
          ),
          SizedBox(height: AppSpacing.md),
          Text(
            'Could not load transaction',
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
