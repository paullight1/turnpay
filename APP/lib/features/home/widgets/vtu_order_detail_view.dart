import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_theme.dart';
import '../../../services/vtu_service.dart';

/// The only outcomes that are safe to show as final on the order detail page.
///
/// The provider order status and TrustPay transaction status are both part of
/// the reconciliation boundary. A final outcome is returned only when they
/// agree exactly; a terminal value on one side cannot make a payment final.
enum VtuOrderResolution {
  confirming,
  success,
  failed,
  reversed,
}

class VtuOrderStatusReconciler {
  const VtuOrderStatusReconciler._();

  static VtuOrderResolution resolve(VtuOrderStatus order) {
    final orderStatus = _normalise(order.orderStatus);
    final transactionStatus = _normalise(order.transactionStatus);

    if (orderStatus != transactionStatus) {
      return VtuOrderResolution.confirming;
    }

    switch (orderStatus) {
      case 'SUCCESS':
        return VtuOrderResolution.success;
      case 'FAILED':
        return VtuOrderResolution.failed;
      case 'REVERSED':
        return VtuOrderResolution.reversed;
      default:
        return VtuOrderResolution.confirming;
    }
  }

  static String _normalise(String value) => value.trim().toUpperCase();
}

/// Presentation for an existing VTU order.
///
/// This widget intentionally has no purchase, refund, or balance action. Its
/// primary action only asks the caller to requery an existing order.
class VtuOrderDetailView extends StatelessWidget {
  final VtuOrderStatus order;
  final bool isChecking;
  final String? errorMessage;
  final VoidCallback onCheckStatus;
  final VoidCallback? onSupport;
  final VoidCallback? onHistory;
  final VoidCallback? onRefreshDetails;

  const VtuOrderDetailView({
    super.key,
    required this.order,
    required this.isChecking,
    required this.onCheckStatus,
    this.errorMessage,
    this.onSupport,
    this.onHistory,
    this.onRefreshDetails,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final resolution = VtuOrderStatusReconciler.resolve(order);
    final needsSupport =
        order.actionRequired && resolution == VtuOrderResolution.confirming;
    final tone = _VtuOrderTone.forResolution(resolution);
    final headline = isChecking
        ? 'Checking payment status…'
        : needsSupport
            ? 'Support review needed'
            : _headlineFor(resolution);
    final explanation = isChecking
        ? 'We’re checking the existing order. This does not start another purchase.'
        : needsSupport
            ? (order.customerAction?.trim().isNotEmpty == true
                ? order.customerAction!
                : 'Keep your payment reference and contact support. Don’t repeat this purchase while it’s unresolved.')
            : _explanationFor(resolution);
    final actionLabel = needsSupport
        ? 'Contact support'
        : errorMessage != null
            ? 'Retry status check'
            : _actionLabel(resolution);
    final primaryAction = needsSupport ? onSupport : onCheckStatus;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _StatusHero(
          order: order,
          tone: tone,
          headline: headline,
          explanation: explanation,
          isChecking: isChecking,
        ),
        if (errorMessage != null && errorMessage!.trim().isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          _InlineError(message: errorMessage!),
        ],
        const SizedBox(height: AppSpacing.md),
        _PaymentSummary(order: order),
        const SizedBox(height: AppSpacing.md),
        _ReferenceExpansion(order: order),
        const SizedBox(height: AppSpacing.lg),
        Semantics(
          button: true,
          enabled: !isChecking && primaryAction != null,
          label: isChecking ? 'Checking payment status' : actionLabel,
          child: FilledButton.icon(
            onPressed: isChecking ? null : primaryAction,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              disabledBackgroundColor: AppColors.primary.withValues(alpha: .5),
              disabledForegroundColor: Colors.white,
              minimumSize: const Size.fromHeight(58),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.button),
              ),
              textStyle: AppTextStyles.labelL.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
            icon: isChecking
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      color: Colors.white,
                    ),
                  )
                : Icon(needsSupport
                    ? Icons.support_agent_rounded
                    : Icons.refresh_rounded),
            label: Text(isChecking ? 'Checking…' : actionLabel),
          ),
        ),
        if (needsSupport && onRefreshDetails != null) ...[
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton.icon(
              onPressed: onRefreshDetails,
              style: _secondaryButtonStyle(),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Refresh details')),
        ],
        if (onHistory != null || onSupport != null) ...[
          const SizedBox(height: AppSpacing.sm),
          if (onHistory != null)
            OutlinedButton.icon(
              onPressed: onHistory,
              style: _secondaryButtonStyle(),
              icon: const Icon(Icons.history_rounded),
              label: const Text('View activity'),
            ),
          if (onSupport != null && !needsSupport) ...[
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton.icon(
              onPressed: onSupport,
              style: _secondaryButtonStyle(),
              icon: const Icon(Icons.support_agent_rounded),
              label: const Text('Contact support'),
            ),
          ],
        ],
        const SizedBox(height: AppSpacing.md),
        Text(
          needsSupport
              ? 'Support will help confirm the final result. Refresh details to see any updates.'
              : 'Status checks only refresh this existing order. They never repeat the purchase.',
          style: AppTextStyles.bodyS,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  static ButtonStyle _secondaryButtonStyle() {
    return OutlinedButton.styleFrom(
      foregroundColor: AppColors.textPrimary,
      minimumSize: const Size.fromHeight(56),
      side: BorderSide(color: AppColors.border),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.button),
      ),
      textStyle: AppTextStyles.labelM,
    );
  }

  static String _headlineFor(VtuOrderResolution resolution) {
    switch (resolution) {
      case VtuOrderResolution.success:
        return 'Payment confirmed';
      case VtuOrderResolution.failed:
        return 'Payment not completed';
      case VtuOrderResolution.reversed:
        return 'Payment reversed';
      case VtuOrderResolution.confirming:
        return 'Still confirming your payment';
    }
  }

  static String _explanationFor(VtuOrderResolution resolution) {
    switch (resolution) {
      case VtuOrderResolution.success:
        return 'Your payment has been confirmed.';
      case VtuOrderResolution.failed:
        return 'This VTU order was not completed. Check your activity for the final record.';
      case VtuOrderResolution.reversed:
        return 'This VTU order was reversed. Check your activity for the final record.';
      case VtuOrderResolution.confirming:
        return 'Your payment is being confirmed. We’ll update this page when the final result is available. Don’t repeat this purchase while it’s unresolved.';
    }
  }

  static String _actionLabel(VtuOrderResolution resolution) {
    switch (resolution) {
      case VtuOrderResolution.confirming:
        return 'Check status';
      case VtuOrderResolution.success:
      case VtuOrderResolution.failed:
      case VtuOrderResolution.reversed:
        return 'Refresh status';
    }
  }
}

class VtuOrderLoadingView extends StatelessWidget {
  const VtuOrderLoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Loading payment details', style: AppTextStyles.headingM),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Fetching the latest status for this order.',
                  style: AppTextStyles.bodyM,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class VtuOrderInitialErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const VtuOrderInitialErrorView({
    super.key,
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, color: AppColors.error, size: 30),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'We couldn’t load this payment',
            style: AppTextStyles.headingM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(message,
              style: AppTextStyles.bodyM, textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.md),
          FilledButton(
            onPressed: onRetry,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              minimumSize: const Size.fromHeight(56),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.button),
              ),
            ),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _StatusHero extends StatelessWidget {
  final VtuOrderStatus order;
  final _VtuOrderTone tone;
  final String headline;
  final String explanation;
  final bool isChecking;

  const _StatusHero({
    required this.order,
    required this.tone,
    required this.headline,
    required this.explanation,
    required this.isChecking,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: tone.background,
                  shape: BoxShape.circle,
                ),
                child: isChecking
                    ? Padding(
                        padding: const EdgeInsets.all(15),
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: tone.foreground,
                        ),
                      )
                    : Icon(tone.icon, color: tone.foreground, size: 27),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(headline, style: AppTextStyles.headingL),
                      const SizedBox(height: AppSpacing.xs),
                      Text(explanation, style: AppTextStyles.bodyM),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Amount', style: AppTextStyles.labelS),
          const SizedBox(height: AppSpacing.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              _money(order.currency, order.amount),
              style: AppTextStyles.headingXL,
            ),
          ),
          if (_hasText(order.targetMasked)) ...[
            const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.person_outline_rounded,
                    size: 20, color: AppColors.textSecondary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    order.targetMasked!,
                    style: AppTextStyles.labelM,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _PaymentSummary extends StatelessWidget {
  final VtuOrderStatus order;

  const _PaymentSummary({required this.order});

  @override
  Widget build(BuildContext context) {
    return _SurfaceSection(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Payment summary', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
              label: 'Provider', value: _displayProvider(order.provider)),
          _SummaryRow(
              label: 'Amount', value: _money(order.currency, order.amount)),
          if (_hasText(order.targetMasked))
            _SummaryRow(label: 'Recipient', value: order.targetMasked!),
        ],
      ),
    );
  }
}

class _ReferenceExpansion extends StatelessWidget {
  final VtuOrderStatus order;

  const _ReferenceExpansion({required this.order});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            childrenPadding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.sm,
            ),
            title: Text('Payment references', style: AppTextStyles.labelL),
            subtitle: Text(
              'Use these details if you contact support.',
              style: AppTextStyles.bodyS,
            ),
            children: [
              _CopyableReference(
                label: 'Reference',
                value: order.reference,
              ),
              _CopyableReference(
                label: 'Order ID',
                value: order.orderId,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CopyableReference extends StatelessWidget {
  final String label;
  final String value;

  const _CopyableReference({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text(label, style: AppTextStyles.bodyS),
      subtitle: SelectableText(
        value.isEmpty ? 'Not available' : value,
        style: AppTextStyles.labelM,
      ),
      trailing: IconButton(
        tooltip: 'Copy $label',
        onPressed: value.isEmpty
            ? null
            : () async {
                await Clipboard.setData(ClipboardData(text: value));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('$label copied')),
                );
              },
        icon: const Icon(Icons.copy_outlined),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  final String message;

  const _InlineError({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.error.withValues(alpha: .5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline_rounded, color: AppColors.error),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.bodyM.copyWith(color: AppColors.error),
            ),
          ),
        ],
      ),
    );
  }
}

class _SurfaceSection extends StatelessWidget {
  final Widget child;

  const _SurfaceSection({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;

  const _SummaryRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: AppTextStyles.bodyM)),
          const SizedBox(width: AppSpacing.md),
          Flexible(
            child: Text(
              value.isEmpty ? 'Not available' : value,
              style: AppTextStyles.labelM,
              textAlign: TextAlign.right,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _VtuOrderTone {
  final IconData icon;
  final Color foreground;
  final Color background;

  const _VtuOrderTone({
    required this.icon,
    required this.foreground,
    required this.background,
  });

  factory _VtuOrderTone.forResolution(VtuOrderResolution resolution) {
    switch (resolution) {
      case VtuOrderResolution.success:
        return _VtuOrderTone(
          icon: Icons.check_rounded,
          foreground: AppColors.success,
          background: AppColors.success.withValues(alpha: .12),
        );
      case VtuOrderResolution.failed:
        return _VtuOrderTone(
          icon: Icons.close_rounded,
          foreground: AppColors.error,
          background: AppColors.error.withValues(alpha: .12),
        );
      case VtuOrderResolution.reversed:
        return _VtuOrderTone(
          icon: Icons.undo_rounded,
          foreground: AppColors.warning,
          background: AppColors.warning.withValues(alpha: .14),
        );
      case VtuOrderResolution.confirming:
        return _VtuOrderTone(
          icon: Icons.schedule_rounded,
          foreground: AppColors.warning,
          background: AppColors.warning.withValues(alpha: .14),
        );
    }
  }
}

String _money(String currency, String amount) {
  final cleanCurrency = currency.trim();
  final cleanAmount = amount.trim();
  if (cleanCurrency.isEmpty) {
    return cleanAmount.isEmpty ? 'Amount unavailable' : cleanAmount;
  }
  if (cleanAmount.isEmpty) return cleanCurrency;
  return '$cleanCurrency $cleanAmount';
}

String _displayProvider(String provider) {
  final clean = provider.trim();
  return clean.isEmpty ? 'Provider unavailable' : clean;
}

bool _hasText(String? value) => value != null && value.trim().isNotEmpty;
