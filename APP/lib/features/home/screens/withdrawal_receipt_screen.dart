import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../utils/receipt_exporter.dart';
import 'withdrawal_authorization_screen.dart'
    show WithdrawalCompletionDetails;

class WithdrawalReceiptScreen extends StatefulWidget {
  final String reference;
  final WithdrawalCompletionDetails? details;

  const WithdrawalReceiptScreen({
    super.key,
    required this.reference,
    this.details,
  });

  @override
  State<WithdrawalReceiptScreen> createState() =>
      _WithdrawalReceiptScreenState();
}

class _WithdrawalReceiptScreenState extends State<WithdrawalReceiptScreen> {
  final _apiClient = ApiClient();
  final _receiptKey = GlobalKey();

  late Future<WithdrawalCompletionDetails> _receiptFuture;
  bool _isSaving = false;
  bool _isSharing = false;

  @override
  void initState() {
    super.initState();
    _receiptFuture = _loadReceipt();
  }

  Future<WithdrawalCompletionDetails> _loadReceipt() async {
    if (widget.details != null) {
      return widget.details!;
    }

    final response = await _apiClient.client.get(
      '/api/payments/withdrawals/${Uri.encodeComponent(widget.reference)}',
    );
    final data = Map<String, dynamic>.from(response.data as Map);
    return _detailsFromMap(data);
  }

  WithdrawalCompletionDetails _detailsFromMap(Map<String, dynamic> withdrawal) {
    final metadata = _asMap(withdrawal['metadata']);
    final attempts = _asList(withdrawal['transferAttempts']);
    final latestAttempt = attempts.isNotEmpty ? _asMap(attempts.first) : {};
    final attemptMetadata = _asMap(latestAttempt['metadata']);

    return WithdrawalCompletionDetails(
      reference: _asString(withdrawal['reference']),
      status: _asString(withdrawal['status'], fallback: 'PENDING'),
      message: _asString(withdrawal['message']),
      amount: _asString(withdrawal['amount'], fallback: '0.00'),
      currency: _asString(withdrawal['currency'], fallback: 'NGN'),
      bankName: _asString(
        attemptMetadata['bankName'],
        fallback: _asString(metadata['bankName'], fallback: 'Bank'),
      ),
      accountName: _asString(
        attemptMetadata['accountName'],
        fallback: _asString(metadata['accountName'], fallback: 'Account'),
      ),
      accountNumberMasked: _asString(
        attemptMetadata['accountNumberMasked'],
        fallback: _asString(
          metadata['accountNumberMasked'],
          fallback: '******',
        ),
      ),
      providerStatus: _asString(
        latestAttempt['providerStatus'],
        fallback: _asString(withdrawal['status'], fallback: 'PENDING'),
      ),
      providerReference: _asString(
        latestAttempt['providerReference'],
        fallback: _asString(
          metadata['providerTransactionReference'],
          fallback: _asString(withdrawal['reference']),
        ),
      ),
      createdAt: _asDateTime(withdrawal['createdAt']),
      updatedAt: _asDateTime(withdrawal['updatedAt']),
      providerCreatedAt: _asDateTime(latestAttempt['createdAt']),
    );
  }

  Future<void> _shareReceipt(WithdrawalCompletionDetails details) async {
    if (_isSharing) return;

    setState(() => _isSharing = true);

    try {
      final sharePositionOrigin = ReceiptExporter.shareOrigin(context);
      final png = await ReceiptExporter.capturePng(_receiptKey);
      final jpg = ReceiptExporter.encodeJpg(png);
      await ReceiptExporter.shareImage(
        bytes: jpg,
        fileName: _receiptFileName(details, 'jpg'),
        text: _shareText(details),
        sharePositionOrigin: sharePositionOrigin,
      );
      if (!mounted) return;
      showTpSnackbar(
        context,
        'Receipt shared successfully.',
        type: TpSnackbarType.success,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(
          error,
          'Could not share this receipt right now.',
        ),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isSharing = false);
      }
    }
  }

  Future<void> _saveReceipt(
    WithdrawalCompletionDetails details,
    _ReceiptExportChoice choice,
  ) async {
    if (_isSaving) return;

    setState(() => _isSaving = true);

    try {
      final sharePositionOrigin = ReceiptExporter.shareOrigin(context);
      final png = await ReceiptExporter.capturePng(_receiptKey);
      final jpg = ReceiptExporter.encodeJpg(png);

      if (choice == _ReceiptExportChoice.pdf) {
        final pdfBytes = await ReceiptExporter.buildPdf(
          jpg,
          title: 'TRUSTPAY withdrawal receipt',
        );
        await ReceiptExporter.sharePdf(
          bytes: pdfBytes,
          fileName: _receiptFileName(details, 'pdf'),
          text: _shareText(details),
          sharePositionOrigin: sharePositionOrigin,
        );
        if (!mounted) return;
        showTpSnackbar(
          context,
          'PDF receipt prepared successfully.',
          type: TpSnackbarType.success,
        );
      } else {
        await ReceiptExporter.shareImage(
          bytes: jpg,
          fileName: _receiptFileName(details, 'jpg'),
          text: _shareText(details),
          sharePositionOrigin: sharePositionOrigin,
        );
        if (!mounted) return;
        showTpSnackbar(
          context,
          'JPG receipt prepared successfully.',
          type: TpSnackbarType.success,
        );
      }
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(
          error,
          'Could not prepare this receipt for download.',
        ),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Future<void> _showSaveSheet(WithdrawalCompletionDetails details) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.lg),
        ),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Save receipt as',
                  style: AppTextStyles.labelL.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.picture_as_pdf_rounded),
                  title: const Text('PDF'),
                  subtitle: const Text('Best for records and printing'),
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await _saveReceipt(details, _ReceiptExportChoice.pdf);
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.image_rounded),
                  title: const Text('JPG'),
                  subtitle: const Text('Best for quick sharing'),
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await _saveReceipt(details, _ReceiptExportChoice.jpg);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Withdrawal receipt',
        menuActions: [
          TpPageMenuAction(
            label: 'View history',
            icon: Icons.receipt_long_rounded,
            onTap: () => context.go(AppRoutes.activity),
          ),
          TpPageMenuAction(
            label: 'Home',
            icon: Icons.home_rounded,
            onTap: () => context.go(AppRoutes.home),
          ),
        ],
      ),
      body: FutureBuilder<WithdrawalCompletionDetails>(
        future: _receiptFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError || !snapshot.hasData) {
            return _ReceiptErrorState(
              onRetry: () => setState(() {
                _receiptFuture = _loadReceipt();
              }),
            );
          }

          final details = snapshot.data!;

          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () async {
              setState(() {
                _receiptFuture = _loadReceipt();
              });
            },
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
                      _ReceiptHero(details: details),
                      const SizedBox(height: AppSpacing.lg),
                      RepaintBoundary(
                        key: _receiptKey,
                        child: _WithdrawalReceiptCard(details: details),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _ReceiptActions(
                        isSaving: _isSaving,
                        isSharing: _isSharing,
                        onSave: () => _showSaveSheet(details),
                        onShare: () => _shareReceipt(details),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      const _ReceiptInfoPanel(
                        text:
                            'Save the receipt as PDF for records or JPG for quick sharing. The same receipt image is used for both export actions.',
                      ),
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

  String _receiptFileName(WithdrawalCompletionDetails details, String ext) {
    final safeReference = details.reference.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'trustpay-withdrawal-$safeReference.$ext';
  }

  String _shareText(WithdrawalCompletionDetails details) {
    return 'TRUSTPAY withdrawal receipt - ${details.reference}';
  }
}

class _ReceiptHero extends StatelessWidget {
  final WithdrawalCompletionDetails details;

  const _ReceiptHero({required this.details});

  @override
  Widget build(BuildContext context) {
    final status = details.status.toUpperCase();
    final statusColor = _statusColor(status);
    final amount = NumberFormat('#,##0.00').format(
      double.tryParse(details.amount) ?? 0,
    );

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              status == 'SUCCESS'
                  ? Icons.verified_rounded
                  : status == 'FAILED' || status == 'REVERSED'
                      ? Icons.error_outline_rounded
                      : Icons.hourglass_top_rounded,
              color: statusColor,
              size: 38,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Withdrawal receipt',
            style: AppTextStyles.headingL.copyWith(fontWeight: FontWeight.w900),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            status == 'SUCCESS'
                ? 'Your payout cleared successfully.'
                : status == 'FAILED' || status == 'REVERSED'
                    ? 'This payout expired before approval was completed.'
                    : 'This receipt is ready while Monnify finishes confirmation.',
            style: AppTextStyles.bodyM.copyWith(
              color: AppColors.textSecondary,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: Text(
              status.replaceAll('_', ' '),
              style: AppTextStyles.labelS.copyWith(
                color: statusColor,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            '${details.currency} $amount',
            style: AppTextStyles.displayMedium.copyWith(
              fontSize: 34,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Reference ${details.reference}',
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _WithdrawalReceiptCard extends StatelessWidget {
  final WithdrawalCompletionDetails details;

  const _WithdrawalReceiptCard({required this.details});

  @override
  Widget build(BuildContext context) {
    final statusColor = _statusColor(details.status.toUpperCase());
    final amount = NumberFormat('#,##0.00').format(
      double.tryParse(details.amount) ?? 0,
    );
    final happenedAt = details.updatedAt ?? details.createdAt ?? details.providerCreatedAt;
    final timeValue = happenedAt == null
        ? '—'
        : DateFormat('dd MMM yyyy • HH:mm').format(happenedAt.toLocal());

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primary.withValues(alpha: 0.08),
                  AppColors.primary.withValues(alpha: 0.03),
                ],
              ),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadius.xl),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.receipt_long_rounded,
                    color: AppColors.primary,
                    size: 24,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Withdrawal details',
                        style: AppTextStyles.labelL.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Keep this record for your bank transfer history.',
                        style: AppTextStyles.bodyS.copyWith(
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                  child: Text(
                    details.status.toUpperCase(),
                    style: AppTextStyles.caption.copyWith(
                      color: statusColor,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const _ReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ReceiptRow(label: 'Reference', value: details.reference),
                _ReceiptRow(label: 'Amount', value: '${details.currency} $amount'),
                _ReceiptRow(label: 'Bank', value: details.bankName),
                _ReceiptRow(label: 'Account name', value: details.accountName),
                _ReceiptRow(
                  label: 'Masked account',
                  value: details.accountNumberMasked,
                ),
                if (details.providerReference.isNotEmpty)
                  _ReceiptRow(
                    label: 'Provider ref',
                    value: details.providerReference,
                  ),
                _ReceiptRow(label: 'Time', value: timeValue, showDivider: false),
              ],
            ),
          ),
          const _ReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Text(
              'Only share this receipt with people who need to verify the transfer.',
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  final String label;
  final String value;
  final bool showDivider;

  const _ReceiptRow({
    required this.label,
    required this.value,
    this.showDivider = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 108,
                child: Text(
                  label,
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  value,
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        ),
        if (showDivider)
          Divider(
            height: 1,
            thickness: 1,
            color: AppColors.border.withValues(alpha: 0.7),
          ),
      ],
    );
  }
}

class _ReceiptCutLine extends StatelessWidget {
  const _ReceiptCutLine();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 18,
      child: CustomPaint(
        painter: _ReceiptCutLinePainter(),
        child: const SizedBox.expand(),
      ),
    );
  }
}

class _ReceiptCutLinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.border.withValues(alpha: 0.7)
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    const dashWidth = 8.0;
    const dashGap = 6.0;
    double startX = 0;

    while (startX < size.width) {
      final endX = (startX + dashWidth).clamp(0, size.width).toDouble();
      canvas.drawLine(
        Offset(startX, size.height / 2),
        Offset(endX, size.height / 2),
        paint,
      );
      startX += dashWidth + dashGap;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ReceiptActions extends StatelessWidget {
  final bool isSaving;
  final bool isSharing;
  final VoidCallback onSave;
  final VoidCallback onShare;

  const _ReceiptActions({
    required this.isSaving,
    required this.isSharing,
    required this.onSave,
    required this.onShare,
  });

  @override
  Widget build(BuildContext context) {
    final saveButton = OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isSaving ? null : onSave,
      icon: isSaving
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.download_rounded, size: 18),
      label: const Text(
        'Save',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    final shareButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isSharing ? null : onShare,
      icon: isSharing
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.ios_share_rounded, size: 18),
      label: const Text(
        'Share',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 420;

        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              saveButton,
              const SizedBox(height: AppSpacing.sm),
              shareButton,
            ],
          );
        }

        return Row(
          children: [
            Expanded(child: saveButton),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: shareButton),
          ],
        );
      },
    );
  }
}

class _ReceiptInfoPanel extends StatelessWidget {
  final String text;

  const _ReceiptInfoPanel({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        text,
        style: AppTextStyles.bodyS.copyWith(
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _ReceiptErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _ReceiptErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.receipt_long_outlined,
              size: 48,
              color: AppColors.warning,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'Could not load this receipt',
              style: AppTextStyles.labelL,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Refresh and try again.',
              style: AppTextStyles.bodyM.copyWith(
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

enum _ReceiptExportChoice { pdf, jpg }

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<dynamic> _asList(dynamic value) {
  if (value is List) return value;
  return const [];
}

String _asString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

DateTime? _asDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}

Color _statusColor(String status) {
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
