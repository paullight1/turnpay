import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../services/manual_exchange_service.dart';

class ManualExchangeProgress extends StatelessWidget {
  final ManualExchangeOrder order;
  final bool receiptStep;
  const ManualExchangeProgress(
      {super.key, required this.order, required this.receiptStep});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final waiting =
        order.status == ManualExchangeOrderStatus.awaitingConfirmation;
    final paying = order.status == ManualExchangeOrderStatus.awaitingTransfer;
    final needsReceipt =
        order.status == ManualExchangeOrderStatus.needsMoreInfo;
    final step = receiptStep && order.canSubmitProof
        ? 1
        : paying
            ? 0
            : needsReceipt
                ? 1
                : 2;
    final title = receiptStep && order.canSubmitProof
        ? 'Upload your receipt'
        : paying
            ? 'Make your transfer'
            : manualExchangeStatusLabel(order.status);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 12),
      Text(title,
          style: AppTextStyles.headingXL.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 10),
      Text(
          receiptStep && order.canSubmitProof
              ? 'Keep using this exchange. Do not make another transfer if you have already paid.'
              : waiting
                  ? order.settlementMode == ManualSettlementMode.wallet
                      ? 'This earlier exchange is awaiting review under its original wallet destination.'
                      : 'Your payment has been reported. Our team will verify it before sending to your receiving account.'
                  : manualExchangeStatusDescription(order.status),
          style: AppTextStyles.bodyM),
      const SizedBox(height: 24),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var index = 0; index < 3; index++) ...[
          if (index > 0) const SizedBox(width: 8),
          Expanded(
              child: Column(children: [
            Container(
                height: 4,
                decoration: BoxDecoration(
                    color: index <= step ? AppColors.primary : AppColors.border,
                    borderRadius: BorderRadius.circular(4))),
            const SizedBox(height: 8),
            Text(['1  Transfer', '2  Receipt', '3  Admin review'][index],
                textAlign: TextAlign.center,
                style: AppTextStyles.caption.copyWith(
                    color: index == step
                        ? AppColors.primary
                        : AppColors.textSecondary,
                    fontWeight: FontWeight.w700)),
          ])),
        ],
      ]),
      const SizedBox(height: 24),
    ]);
  }
}
