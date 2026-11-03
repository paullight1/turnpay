import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/app_theme.dart';
import 'transfer_widgets.dart';

/// The outcome of one purchase, kept separate from composing another top-up.
class VtuPurchaseStatusView extends StatelessWidget {
  final String status, amount, currency, title;
  final String? reference, recipient, network, message;
  final bool isChecking;
  final VoidCallback onCheck, onDone, onSupport;
  final VoidCallback? onStartAnother;
  const VtuPurchaseStatusView(
      {super.key,
      required this.status,
      required this.amount,
      required this.currency,
      required this.title,
      this.reference,
      this.recipient,
      this.network,
      this.message,
      required this.isChecking,
      required this.onCheck,
      required this.onDone,
      required this.onSupport,
      this.onStartAnother});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final success = status == 'SUCCESS';
    final returned = status == 'FAILED' || status == 'REVERSED';
    final terminal = success || returned;
    final color = success
        ? AppColors.success
        : returned
            ? AppColors.textSecondary
            : AppColors.primary;
    final heading = success
        ? 'Top-up successful'
        : returned
            ? 'Top-up not completed'
            : 'Confirming your top-up';
    final explanation = success
        ? 'Your top-up has been confirmed.'
        : returned
            ? 'This top-up did not complete. Check your wallet for the final balance.'
            : 'Your payment is being checked. Please don’t repeat this top-up while we confirm the result.';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
          title: Text(title),
          leading: IconButton(
              tooltip: 'Back',
              onPressed: onDone,
              icon: const Icon(Icons.arrow_back_rounded))),
      body: SafeArea(
          child: LayoutBuilder(
              builder: (context, viewport) => SingleChildScrollView(
                    child: Center(
                        child: ConstrainedBox(
                      constraints: BoxConstraints(
                          maxWidth: 560, minHeight: viewport.maxHeight),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
                        child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Center(
                                  child: Container(
                                      width: 88,
                                      height: 88,
                                      decoration: BoxDecoration(
                                          color: color.withValues(alpha: .10),
                                          shape: BoxShape.circle),
                                      child: Icon(
                                          success
                                              ? Icons.check_rounded
                                              : returned
                                                  ? Icons.undo_rounded
                                                  : Icons.schedule_rounded,
                                          color: color,
                                          size: 42))),
                              const SizedBox(height: 28),
                              Semantics(
                                  liveRegion: true,
                                  child: Text(heading,
                                      textAlign: TextAlign.center,
                                      style: AppTextStyles.headingL)),
                              const SizedBox(height: 12),
                              Text(transferMoneyLabel(amount, currency),
                                  textAlign: TextAlign.center,
                                  style: AppTextStyles.headingXL),
                              if (recipient?.isNotEmpty == true) ...[
                                const SizedBox(height: 12),
                                Text(recipient!,
                                    textAlign: TextAlign.center,
                                    style: AppTextStyles.labelM)
                              ],
                              if (network?.isNotEmpty == true) ...[
                                const SizedBox(height: 4),
                                Text(network!,
                                    textAlign: TextAlign.center,
                                    style: AppTextStyles.bodyM)
                              ],
                              const SizedBox(height: 20),
                              Text(explanation,
                                  textAlign: TextAlign.center,
                                  style: AppTextStyles.bodyM),
                              if (message != null) ...[
                                const SizedBox(height: 16),
                                Semantics(
                                    liveRegion: true,
                                    child: Text(message!,
                                        textAlign: TextAlign.center,
                                        style: AppTextStyles.bodyS))
                              ],
                              const SizedBox(height: 32),
                              if (!terminal) ...[
                                FilledButton.icon(
                                    onPressed: isChecking ? null : onCheck,
                                    style: FilledButton.styleFrom(
                                        minimumSize: const Size.fromHeight(58)),
                                    icon: isChecking
                                        ? const SizedBox(
                                            width: 18,
                                            height: 18,
                                            child: CircularProgressIndicator(
                                                strokeWidth: 2))
                                        : const Icon(Icons.refresh_rounded),
                                    label: Text(isChecking
                                        ? 'Checking…'
                                        : 'Check status')),
                                const SizedBox(height: 12),
                              ],
                              if (terminal && onStartAnother != null) ...[
                                FilledButton(
                                    onPressed: onStartAnother,
                                    style: FilledButton.styleFrom(
                                        minimumSize: const Size.fromHeight(58)),
                                    child: const Text('Start another top-up')),
                                const SizedBox(height: 12),
                              ],
                              OutlinedButton(
                                  onPressed: onDone,
                                  style: OutlinedButton.styleFrom(
                                      minimumSize: const Size.fromHeight(56)),
                                  child: const Text('Back to home')),
                              const SizedBox(height: 20),
                              ExpansionTile(
                                  tilePadding: EdgeInsets.zero,
                                  title: Text('Payment details',
                                      style: AppTextStyles.labelM),
                                  children: [
                                    if (reference?.isNotEmpty == true)
                                      ListTile(
                                          contentPadding: EdgeInsets.zero,
                                          title: const Text('Reference'),
                                          subtitle: SelectableText(reference!),
                                          trailing: IconButton(
                                              tooltip: 'Copy reference',
                                              onPressed: () =>
                                                  Clipboard.setData(
                                                      ClipboardData(
                                                          text: reference!)),
                                              icon: const Icon(
                                                  Icons.copy_outlined))),
                                    TextButton.icon(
                                        onPressed: onSupport,
                                        icon: const Icon(
                                            Icons.support_agent_rounded),
                                        label: const Text('Contact support')),
                                  ]),
                            ]),
                      ),
                    )),
                  ))),
    );
  }
}
