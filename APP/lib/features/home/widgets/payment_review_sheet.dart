import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class PaymentReviewEntry {
  final String label, value;
  const PaymentReviewEntry(this.label, this.value);
}

Future<bool> showPaymentReviewSheet(
  BuildContext context, {
  required String title,
  required String amountLabel,
  required List<PaymentReviewEntry> entries,
  String? amountWords,
}) async =>
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      backgroundColor: AppColors.surface,
      constraints: const BoxConstraints(maxWidth: 640),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (sheetContext) => ConstrainedBox(
        constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * .88),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Flexible(
                  child: SingleChildScrollView(
                      child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 4, 24, 0),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(title, style: AppTextStyles.headingL),
                      const SizedBox(height: 28),
                      Text('You pay', style: AppTextStyles.bodyM),
                      const SizedBox(height: 8),
                      Text(amountLabel,
                          style: AppTextStyles.headingXL.copyWith(
                              fontSize: 36, fontWeight: FontWeight.w800)),
                      if (amountWords != null) ...[
                        const SizedBox(height: 8),
                        Text(amountWords, style: AppTextStyles.bodyS)
                      ],
                      const SizedBox(height: 24),
                      Divider(color: AppColors.border),
                      for (final entry in entries)
                        Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: _ReviewEntry(entry: entry)),
                      const SizedBox(height: 16),
                      Text('Check these details before you continue.',
                          style: AppTextStyles.bodyM),
                      const SizedBox(height: 24),
                    ]),
              ))),
              Padding(
                  padding: EdgeInsets.fromLTRB(24, 16, 24,
                      24 + MediaQuery.viewPaddingOf(sheetContext).bottom),
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        FilledButton(
                            onPressed: () =>
                                Navigator.of(sheetContext).pop(true),
                            style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(60),
                                backgroundColor: AppColors.primary,
                                foregroundColor: Colors.white,
                                textStyle: AppTextStyles.labelM.copyWith(
                                    fontSize: 18, fontWeight: FontWeight.w700)),
                            child: const Text('Continue')),
                        const SizedBox(height: 12),
                        OutlinedButton(
                            onPressed: () =>
                                Navigator.of(sheetContext).pop(false),
                            style: OutlinedButton.styleFrom(
                                minimumSize: const Size.fromHeight(56),
                                textStyle: AppTextStyles.labelM.copyWith(
                                    fontSize: 18, fontWeight: FontWeight.w700)),
                            child: const Text('Edit')),
                      ])),
            ]),
      ),
    ) ??
    false;

class _ReviewEntry extends StatelessWidget {
  final PaymentReviewEntry entry;
  const _ReviewEntry({required this.entry});
  @override
  Widget build(BuildContext context) {
    final label = Text(entry.label, style: AppTextStyles.bodyM);
    final value = Text(entry.value,
        style: AppTextStyles.labelM.copyWith(fontWeight: FontWeight.w700));
    if (MediaQuery.sizeOf(context).width < 380 ||
        MediaQuery.textScalerOf(context).scale(14) > 18) {
      return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [label, const SizedBox(height: 6), value]);
    }
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(child: label),
      const SizedBox(width: 20),
      Expanded(child: Align(alignment: Alignment.centerRight, child: value))
    ]);
  }
}
