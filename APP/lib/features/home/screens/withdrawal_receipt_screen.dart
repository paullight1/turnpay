import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_empty_state.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_receipt.dart';
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
          title: 'TrustPay withdrawal receipt',
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
    Haptics.light();
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
                Container(
                  width: 44,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                ),
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
            return TpEmptyState(
              variant: TpIllustrationVariant.error,
              title: 'Could not load this receipt',
              message:
                  'Something interrupted the request. Refresh and try again.',
              primaryActionLabel: 'Retry',
              onPrimaryAction: () => setState(() {
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
                      TpReceiptHero(
                        tone: _tone(details),
                        title: 'Withdrawal receipt',
                        message: _heroMessage(details),
                        statusLabel: details.status,
                        amountLabel: _amountLabel(details),
                        reference: details.reference,
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      RepaintBoundary(
                        key: _receiptKey,
                        child: TpReceiptCard(
                          tone: _tone(details),
                          headerTitle: 'Withdrawal details',
                          headerSubtitle:
                              'Keep this record for your bank transfer history.',
                          statusLabel: details.status,
                          entries: _entries(details),
                          footerNote:
                              'Only share this receipt with people who need to verify the transfer.',
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      TpReceiptActions(
                        isSaving: _isSaving,
                        isSharing: _isSharing,
                        onSave: () => _showSaveSheet(details),
                        onShare: () => _shareReceipt(details),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      const TpReceiptInfoPanel(
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

  TpReceiptTone _tone(WithdrawalCompletionDetails details) =>
      TpReceiptToneX.fromStatus(details.status);

  String _amountLabel(WithdrawalCompletionDetails details) {
    final amount = NumberFormat('#,##0.00').format(
      double.tryParse(details.amount) ?? 0,
    );
    return '${details.currency} $amount';
  }

  String _heroMessage(WithdrawalCompletionDetails details) {
    switch (_tone(details)) {
      case TpReceiptTone.success:
        return 'Your payout cleared successfully.';
      case TpReceiptTone.failed:
        return 'This payout expired before approval was completed.';
      case TpReceiptTone.pending:
        return 'This receipt is ready while Monnify finishes confirmation.';
    }
  }

  List<TpReceiptEntry> _entries(WithdrawalCompletionDetails details) {
    final happenedAt =
        details.updatedAt ?? details.createdAt ?? details.providerCreatedAt;
    final timeValue = happenedAt == null
        ? '—'
        : DateFormat('dd MMM yyyy • HH:mm').format(happenedAt.toLocal());

    return [
      TpReceiptEntry('Reference', details.reference),
      TpReceiptEntry('Amount', _amountLabel(details), emphasize: true),
      TpReceiptEntry('Bank', details.bankName),
      TpReceiptEntry('Account name', details.accountName),
      TpReceiptEntry('Masked account', details.accountNumberMasked),
      if (details.providerReference.isNotEmpty)
        TpReceiptEntry('Provider ref', details.providerReference),
      TpReceiptEntry('Time', timeValue),
    ];
  }

  String _receiptFileName(WithdrawalCompletionDetails details, String ext) {
    final safeReference =
        details.reference.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'trustpay-withdrawal-$safeReference.$ext';
  }

  String _shareText(WithdrawalCompletionDetails details) {
    return 'TrustPay withdrawal receipt - ${details.reference}';
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
