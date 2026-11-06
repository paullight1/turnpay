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
        padding: EdgeInsets.only(top: compact ? 20 : 28),
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
                  ? 'Continue or track an earlier request without pausing a new exchange.'
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
                    child: Row(children: [
                      Icon(Icons.history_rounded, color: AppColors.textHint),
                      const SizedBox(width: 12),
                      Expanded(
                          child: Text('Loading exchange history…',
                              style: AppTextStyles.bodyM)),
                    ]),
                  );
                }
                final rows = snapshot.data!;
                if (rows.isEmpty) {
                  if (recovery != null) return const SizedBox.shrink();
                  return Container(
                      padding: EdgeInsets.all(compact ? 16 : 24),
                      decoration: BoxDecoration(
                          color: AppColors.surface,
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(14)),
                      child: compact
                          ? Row(children: [
                              Icon(Icons.receipt_long_outlined,
                                  color: AppColors.textHint, size: 26),
                              const SizedBox(width: 12),
                              Expanded(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                    Text('No exchanges yet',
                                        style: AppTextStyles.labelM.copyWith(
                                            fontWeight: FontWeight.w700)),
                                    const SizedBox(height: 3),
                                    Text(
                                        'Your requests and review updates will appear here.',
                                        style: AppTextStyles.bodyS),
                                  ])),
                            ])
                          : Column(children: [
                              Icon(Icons.receipt_long_outlined,
                                  color: AppColors.textHint, size: 32),
                              const SizedBox(height: 12),
                              Text('No exchanges yet',
                                  style: AppTextStyles.labelL),
                              const SizedBox(height: 8),
                              Text(
                                  'Your transfers, receipts and review updates will appear here.',
                                  style: AppTextStyles.bodyS,
                                  textAlign: TextAlign.center),
                            ]));
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
                    Row(children: [
                      Expanded(
                        child: Text(
                          '${order.sourceCurrency} → ${order.targetCurrency}',
                          style: AppTextStyles.labelM
                              .copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      Text('${order.sourceCurrency} ${order.amount}',
                          style: AppTextStyles.labelS
                              .copyWith(fontWeight: FontWeight.w700)),
                    ]),
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
          Text(order.reference,
              style: AppTextStyles.bodyS,
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: open, child: Text(label)),
          ReviewReminderButton(order: order, service: service),
        ]));
  }
}
