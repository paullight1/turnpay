import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../services/manual_exchange_service.dart';
import 'review_reminder_button.dart';

class ManualExchangeHistory extends StatelessWidget {
  final Future<List<ManualExchangeOrder>> orders;
  final ManualExchangeService service;
  final VoidCallback onRetry;
  final Widget? recovery;
  final bool compact;
  final int? maxItems;
  const ManualExchangeHistory(
      {super.key,
      required this.orders,
      required this.service,
      required this.onRetry,
      this.recovery,
      this.compact = false,
      this.maxItems});
  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
        padding: EdgeInsets.only(top: compact ? AppSpacing.md : 28),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
                child: Text(compact ? 'Recent exchanges' : 'Exchange history',
                    style: AppTextStyles.headingM
                        .copyWith(fontWeight: FontWeight.w800))),
            IconButton(
                tooltip: 'Refresh exchange history',
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded))
          ]),
          Text(
              compact
                  ? 'Pick up an exchange or check where it stands.'
                  : 'Open a previous exchange to continue or check its progress. You can start another exchange while one is under review.',
              style: AppTextStyles.bodyS),
          SizedBox(height: compact ? 12 : 16),
          if (recovery != null) ...[
            recovery!,
            const SizedBox(height: 10),
          ],
          FutureBuilder<List<ManualExchangeOrder>>(
              future: orders,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                            'History could not load. Your exchanges remain saved. Reconnect and try again.',
                            style: AppTextStyles.bodyM),
                        const SizedBox(height: 12),
                        OutlinedButton(
                            onPressed: onRetry,
                            child: const Text('Retry history')),
                      ]);
                }
                if (!snapshot.hasData) {
                  return Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14)),
                    child: Semantics(
                      liveRegion: true,
                      child: Text('Loading exchange history…',
                          style: AppTextStyles.bodyM),
                    ),
                  );
                }
                final rows = snapshot.data!;
                if (rows.isEmpty) {
                  if (recovery != null) return const SizedBox.shrink();
                  return const _EmptyExchangeHistory();
                }
                final visibleRows = maxItems == null
                    ? rows
                    : rows.take(maxItems!).toList(growable: false);
                return Column(children: [
                  for (final order in visibleRows)
                    if (compact)
                      _CompactHistoryOrder(
                          key: ValueKey(order.id), order: order)
                    else
                      _HistoryOrder(
                          key: ValueKey(order.id),
                          order: order,
                          service: service),
                  if (compact && visibleRows.length < rows.length)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text('See all exchanges in History',
                          style: AppTextStyles.labelS.copyWith(
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w700)),
                    ),
                ]);
              }),
        ]));
  }
}

class _EmptyExchangeHistory extends StatelessWidget {
  const _EmptyExchangeHistory();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: .09),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(Icons.receipt_long_outlined, color: AppColors.primary),
          ),
          const SizedBox(height: AppSpacing.md),
          Text('No exchanges yet',
              style: AppTextStyles.headingM, textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Choose a direction above to get started. Come back here to resume an exchange or check its status.',
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final label in [
                'Transfer details',
                'Receipts',
                'Status updates'
              ])
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    child: Text(label, style: AppTextStyles.labelS),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CompactHistoryOrder extends StatelessWidget {
  final ManualExchangeOrder order;

  const _CompactHistoryOrder({super.key, required this.order});

  @override
  Widget build(BuildContext context) {
    final pending = manualExchangeStatusIsActive(order.status);
    final success = order.status == ManualExchangeOrderStatus.completed ||
        order.status == ManualExchangeOrderStatus.credited;
    final tone = pending
        ? AppColors.primary
        : success
            ? AppColors.success
            : AppColors.textSecondary;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => context.push(
            AppRoutes.exchangeOrderFor(order.id),
            extra: order,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: .09),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.currency_exchange_rounded,
                    color: tone, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${order.sourceCurrency} ${order.amount} → '
                      '${order.targetCurrency} ${order.targetAmount}',
                      style: AppTextStyles.labelM
                          .copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      manualExchangeStatusLabel(order.status),
                      style: AppTextStyles.bodyS.copyWith(color: tone),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded,
                  color: AppColors.textHint, size: 22),
            ]),
          ),
        ),
      ),
    );
  }
}

class _HistoryOrder extends StatelessWidget {
  final ManualExchangeOrder order;
  final ManualExchangeService service;
  const _HistoryOrder({super.key, required this.order, required this.service});
  @override
  Widget build(BuildContext context) {
    final pending = manualExchangeStatusIsActive(order.status);
    final success = order.status == ManualExchangeOrderStatus.completed ||
        order.status == ManualExchangeOrderStatus.credited;
    final tone = pending
        ? AppColors.primary
        : success
            ? AppColors.success
            : AppColors.textSecondary;
    void open() =>
        context.push(AppRoutes.exchangeOrderFor(order.id), extra: order);
    final label = switch (order.status) {
      ManualExchangeOrderStatus.awaitingTransfer => 'Continue exchange',
      ManualExchangeOrderStatus.awaitingConfirmation => 'View review status',
      ManualExchangeOrderStatus.needsMoreInfo => 'Update receipt',
      _ => pending ? 'Track payout' : 'View details',
    };
    return Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border)),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              runSpacing: 10,
              children: [
                Text('${order.sourceCurrency} → ${order.targetCurrency}',
                    style: AppTextStyles.labelL
                        .copyWith(fontWeight: FontWeight.w700)),
                Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                        color: tone.withValues(alpha: .08),
                        borderRadius: BorderRadius.circular(6)),
                    child: Text(manualExchangeStatusLabel(order.status),
                        style: AppTextStyles.labelS.copyWith(
                            color: tone, fontWeight: FontWeight.w700))),
              ]),
          const SizedBox(height: 16),
          Text('${order.sourceCurrency} ${order.amount}',
              style: AppTextStyles.headingM),
          const SizedBox(height: 4),
          Text('Receive ${order.targetCurrency} ${order.targetAmount}',
              style: AppTextStyles.bodyM),
          const SizedBox(height: 12),
          if (order.createdAt != null)
            Text(DateFormat('d MMM, HH:mm').format(order.createdAt!.toLocal()),
                style: AppTextStyles.bodyS),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: open, child: Text(label)),
          ReviewReminderButton(order: order, service: service),
        ]));
  }
}
