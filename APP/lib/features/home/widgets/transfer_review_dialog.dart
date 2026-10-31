import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'transfer_widgets.dart';

class TransferReviewEntry {
  final String label;
  final String value;
  const TransferReviewEntry(this.label, this.value);
}

/// A read-only snapshot of the exact details that will be authorized next.
class TransferReviewDialog extends StatelessWidget {
  const TransferReviewDialog(
      {super.key,
      required this.title,
      required this.amount,
      required this.currency,
      required this.entries,
      required this.onEdit,
      required this.onContinue,
      this.amountWords});
  final String title, amount, currency;
  final String? amountWords;
  final List<TransferReviewEntry> entries;
  final VoidCallback onEdit, onContinue;

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return AlertDialog(
      backgroundColor: AppColors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      constraints: const BoxConstraints(maxWidth: 520),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      title: Row(children: [
        Icon(Icons.fact_check_outlined, color: AppColors.primary),
        const SizedBox(width: 12),
        Expanded(child: Text(title, style: AppTextStyles.headingM)),
      ]),
      content: SingleChildScrollView(
          child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
            Container(
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 12),
              decoration: BoxDecoration(
                  color: AppColors.surfaceVariant,
                  borderRadius: BorderRadius.circular(18)),
              child: Column(children: [
                Text('YOU’RE SENDING', style: AppTextStyles.caption),
                const SizedBox(height: 8),
                Text(transferMoneyLabel(amount, currency),
                    textAlign: TextAlign.center,
                    style: AppTextStyles.headingXL),
                if (amountWords != null) ...[
                  const SizedBox(height: 10),
                  Text(amountWords!,
                      textAlign: TextAlign.center, style: AppTextStyles.bodyS),
                ],
              ]),
            ),
            const SizedBox(height: 16),
            for (final entry in entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: _entry(context, entry),
              ),
            const SizedBox(height: 16),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.lock_outline_rounded,
                  size: 18, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(
                      'Next, enter your transaction PIN to confirm this transfer.',
                      style: AppTextStyles.bodyS)),
            ]),
          ])),
      actionsPadding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
      actions: [
        SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
                onPressed: onContinue,
                icon: const Icon(Icons.lock_outline_rounded, size: 18),
                label: const Text('Continue'))),
        SizedBox(
            width: double.infinity,
            child: TextButton(onPressed: onEdit, child: const Text('Edit'))),
      ],
    );
  }

  Widget _entry(BuildContext context, TransferReviewEntry entry) {
    final stacked = MediaQuery.sizeOf(context).width < 380 ||
        MediaQuery.textScalerOf(context).scale(14) > 18;
    final label = Text(entry.label, style: AppTextStyles.bodyS);
    final value = Text(entry.value,
        style: AppTextStyles.labelM,
        textAlign: stacked ? TextAlign.start : TextAlign.end);
    if (stacked) {
      return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [label, const SizedBox(height: 4), value]);
    }
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(flex: 2, child: label),
      const SizedBox(width: 16),
      Expanded(flex: 3, child: value),
    ]);
  }
}

/// Shown with the PIN keypad so confirmation retains its amount/recipient context.
class TransferApprovalSummary extends StatelessWidget {
  const TransferApprovalSummary(
      {super.key,
      required this.amount,
      required this.currency,
      required this.recipient,
      this.destination});
  final String amount, currency, recipient;
  final String? destination;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(16)),
        child: Column(children: [
          Text(transferMoneyLabel(amount, currency),
              style: AppTextStyles.headingM),
          const SizedBox(height: 6),
          Text('To $recipient',
              style: AppTextStyles.labelM, textAlign: TextAlign.center),
          if (destination != null) ...[
            const SizedBox(height: 4),
            Text(destination!,
                style: AppTextStyles.bodyS, textAlign: TextAlign.center)
          ],
        ]),
      );
}
