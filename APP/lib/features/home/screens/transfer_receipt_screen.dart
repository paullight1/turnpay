import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/money/money_value.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_empty_state.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_receipt.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../utils/receipt_exporter.dart';
import '../widgets/transfer_widgets.dart';

/// The sanitized, display-ready view of an internal transfer receipt.
///
/// This model deliberately stores [MoneyValue] instead of a [double]. The
/// receipt is historical financial evidence, so it must render the exact
/// decimal string returned by the API and must never be recalculated from a
/// floating-point value.
class TransferReceiptData {
  const TransferReceiptData({
    required this.reference,
    required this.transactionReference,
    required this.type,
    required this.direction,
    required this.status,
    required this.amount,
    required this.fee,
    required this.counterparty,
    required this.avatarInitials,
    required this.note,
    required this.createdAt,
    required this.updatedAt,
    required this.reversalStatus,
    required this.reversalReference,
  });

  /// Parses both the POST completion payload and the sanitized GET payload.
  ///
  /// Missing status is preserved as `UNKNOWN`; it is never upgraded to
  /// `SUCCESS`. Missing fees are safe for internal transfers because the
  /// current protocol explicitly charges zero internal-transfer fee. Unknown
  /// currencies fail closed instead of being labelled as NGN.
  factory TransferReceiptData.fromJson(
    Map<String, dynamic> json, {
    String? referenceFallback,
  }) {
    final responseReference = _receiptString(json['reference']);
    final responseTransactionReference = _receiptString(
      json['transactionReference'],
      fallback: _receiptString(json['senderTransactionReference']),
    );
    final requestedReference = _receiptString(referenceFallback);
    if (responseReference.isNotEmpty &&
        requestedReference.isNotEmpty &&
        responseReference != requestedReference &&
        responseTransactionReference != requestedReference) {
      throw const FormatException(
        'Transfer receipt reference does not match the requested transfer.',
      );
    }
    final reference =
        responseReference.isNotEmpty ? responseReference : requestedReference;
    if (reference.isEmpty) {
      throw const FormatException('Transfer receipt reference is missing.');
    }

    final currency = _receiptCurrency(json['currency']);
    final amount = MoneyValue.fromJson(
      json['amount'],
      currency: currency,
    ).requirePositive(fieldName: 'transfer amount');
    final fee = _receiptFee(json['fee'], currency);
    final counterpartyMap = _receiptMap(json['counterparty']);
    final recipientMap = _receiptMap(json['recipient']);
    final partyMap =
        counterpartyMap.isNotEmpty ? counterpartyMap : recipientMap;
    final maskedIdentifier = _receiptString(partyMap['maskedIdentifier']);
    final displayName = _receiptString(partyMap['displayName']);
    final avatarInitials = _receiptString(partyMap['avatarInitials']);

    final rawStatus = _receiptString(json['status']).toUpperCase();
    final rawDirection = _receiptString(json['direction']).toUpperCase();

    return TransferReceiptData(
      reference: reference,
      transactionReference: _receiptString(
        json['transactionReference'],
        fallback: _receiptString(json['senderTransactionReference']),
      ),
      type: _receiptString(
        json['type'],
        fallback: 'INTERNAL_TRANSFER',
      ).toUpperCase(),
      direction:
          rawDirection == 'IN' || rawDirection == 'OUT' ? rawDirection : 'OUT',
      status: rawStatus.isEmpty ? 'UNKNOWN' : rawStatus,
      amount: amount,
      fee: fee,
      // Never fall back to an unmasked identifier from a provider payload.
      counterparty: displayName.isNotEmpty
          ? displayName
          : maskedIdentifier.isEmpty
              ? 'TrustPay user'
              : maskedIdentifier,
      avatarInitials: avatarInitials.isEmpty ? null : avatarInitials,
      note: _receiptString(json['note']),
      createdAt: _receiptDateTime(json['createdAt']),
      updatedAt: _receiptDateTime(json['updatedAt']),
      reversalStatus: _receiptString(json['reversalStatus']).toUpperCase(),
      reversalReference: _receiptString(json['reversalReference']),
    );
  }

  final String reference;
  final String transactionReference;
  final String type;
  final String direction;
  final String status;
  final MoneyValue amount;
  final MoneyValue fee;
  final String counterparty;
  final String? avatarInitials;
  final String note;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String reversalStatus;
  final String reversalReference;

  String get currency => amount.currency ?? 'NGN';

  bool get isSuccessful =>
      !isReversed &&
      const {
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'COMPLETE',
        'PAID',
        'SENT',
      }.contains(status);

  /// A completed reversal is returned alongside the original successful
  /// transaction, so the original [status] remains authoritative history but
  /// the receipt must present the resulting financial state as reversed.
  bool get isReversed =>
      status == 'REVERSED' || reversalStatus.toUpperCase() == 'COMPLETED';

  String get displayStatus => isReversed ? 'REVERSED' : status;

  bool get isFailed =>
      const {
        'FAILED',
        'CANCELLED',
        'REJECTED',
        'ABANDONED',
      }.contains(status) &&
      !isReversed;

  TpReceiptTone get tone {
    if (isReversed) return TpReceiptTone.failed;
    if (isSuccessful) return TpReceiptTone.success;
    if (isFailed) return TpReceiptTone.failed;
    return TpReceiptTone.pending;
  }
}

/// Displays and can re-open a confirmed internal transfer receipt.
class TransferReceiptScreen extends StatefulWidget {
  final String reference;
  final Map<String, dynamic>? initialReceipt;
  final ApiClient? apiClient;

  const TransferReceiptScreen({
    super.key,
    required this.reference,
    this.initialReceipt,
    this.apiClient,
  });

  @override
  State<TransferReceiptScreen> createState() => _TransferReceiptScreenState();
}

class _TransferReceiptScreenState extends State<TransferReceiptScreen> {
  final _receiptKey = GlobalKey();

  late final ApiClient _apiClient;
  TransferReceiptData? _receipt;
  String? _loadError;
  String? _refreshError;
  bool _isLoading = false;
  bool _isRefreshing = false;
  _ReceiptExportKind? _exporting;

  @override
  void initState() {
    super.initState();
    _apiClient = widget.apiClient ?? ApiClient();

    final initial = widget.initialReceipt;
    if (initial == null) {
      _loadFromServer();
      return;
    }

    try {
      _receipt = TransferReceiptData.fromJson(
        initial,
        referenceFallback: widget.reference,
      );
    } catch (error) {
      _loadError = _safeReceiptError(
        error,
        'Could not load this receipt. Refresh and try again.',
      );
    }
  }

  Future<void> _loadFromServer({bool refresh = false}) async {
    if (refresh ? _isRefreshing : _isLoading) return;

    if (mounted) {
      setState(() {
        if (refresh) {
          _isRefreshing = true;
        } else {
          _isLoading = true;
          _loadError = null;
        }
      });
    }

    try {
      final response = await _apiClient.client.get(
        '/api/transfers/internal/${Uri.encodeComponent(widget.reference)}',
      );
      final map = _receiptMap(response.data);
      if (map.isEmpty) {
        throw const FormatException('Transfer receipt response is empty.');
      }
      final next = TransferReceiptData.fromJson(
        map,
        referenceFallback: widget.reference,
      );

      if (!mounted) return;
      setState(() {
        // A GET response is authoritative, including a later pending,
        // failed, or reversed state replacing the initial POST response.
        _receipt = next;
        _loadError = null;
        _refreshError = null;
      });
    } catch (error) {
      if (!mounted) return;
      final message = _safeReceiptError(
        error,
        refresh
            ? 'Could not refresh this receipt. Showing the last confirmed status.'
            : 'Could not load this receipt. Refresh and try again.',
      );
      setState(() {
        if (refresh && _receipt != null) {
          _refreshError = message;
        } else {
          _loadError = message;
        }
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _isRefreshing = false;
        });
      }
    }
  }

  Future<void> _copyReference() async {
    final receipt = _receipt;
    if (receipt == null) return;

    try {
      await Clipboard.setData(ClipboardData(text: receipt.reference));
      if (!mounted) return;
      showTpSnackbar(
        context,
        'Reference copied.',
        type: TpSnackbarType.success,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(error, 'Could not copy the reference right now.'),
        type: TpSnackbarType.error,
      );
    }
  }

  Future<void> _shareReceipt(TransferReceiptData receipt) async {
    if (_exporting != null) return;
    final sharePositionOrigin = ReceiptExporter.shareOrigin(context);
    setState(() => _exporting = _ReceiptExportKind.share);

    try {
      final png = await ReceiptExporter.capturePng(_receiptKey);
      final jpg = ReceiptExporter.encodeJpg(png);
      await ReceiptExporter.shareImage(
        bytes: jpg,
        fileName: _receiptFileName(receipt, 'jpg'),
        text: _shareText(receipt),
        sharePositionOrigin: sharePositionOrigin,
      );
      if (!mounted) return;
      showTpSnackbar(
        context,
        'Receipt ready to share.',
        type: TpSnackbarType.success,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(error, 'Could not share this receipt right now.'),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) setState(() => _exporting = null);
    }
  }

  Future<void> _saveReceipt(
    TransferReceiptData receipt,
    _ReceiptExportChoice choice,
  ) async {
    if (_exporting != null) return;
    final sharePositionOrigin = ReceiptExporter.shareOrigin(context);
    setState(() => _exporting = _ReceiptExportKind.save);

    try {
      final png = await ReceiptExporter.capturePng(_receiptKey);
      final jpg = ReceiptExporter.encodeJpg(png);
      if (choice == _ReceiptExportChoice.pdf) {
        final pdf = await ReceiptExporter.buildPdf(
          jpg,
          title: 'TrustPay transfer receipt',
        );
        await ReceiptExporter.sharePdf(
          bytes: pdf,
          fileName: _receiptFileName(receipt, 'pdf'),
          text: _shareText(receipt),
          sharePositionOrigin: sharePositionOrigin,
        );
      } else {
        await ReceiptExporter.shareImage(
          bytes: jpg,
          fileName: _receiptFileName(receipt, 'jpg'),
          text: _shareText(receipt),
          sharePositionOrigin: sharePositionOrigin,
        );
      }

      if (!mounted) return;
      showTpSnackbar(
        context,
        choice == _ReceiptExportChoice.pdf
            ? 'PDF receipt prepared successfully.'
            : 'JPG receipt prepared successfully.',
        type: TpSnackbarType.success,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(error, 'Could not prepare this receipt for download.'),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) setState(() => _exporting = null);
    }
  }

  Future<void> _showSaveSheet(TransferReceiptData receipt) {
    if (_exporting != null) return Future<void>.value();
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
                    await _saveReceipt(receipt, _ReceiptExportChoice.pdf);
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.image_rounded),
                  title: const Text('JPG'),
                  subtitle: const Text('Best for quick sharing'),
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await _saveReceipt(receipt, _ReceiptExportChoice.jpg);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _handleBack() {
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
      return;
    }
    _goToHome();
  }

  void _goToHome() {
    try {
      context.go('/home');
    } catch (_) {
      // A standalone preview/test may not be mounted below GoRouter. There is
      // no alternate route to push in that case, so leave the surface intact.
    }
  }

  void _goToHistory() {
    try {
      context.go('/activity');
    } catch (_) {
      _handleBack();
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        title: const Text('Transfer receipt'),
        leading: IconButton(
          tooltip: 'Back',
          onPressed: _handleBack,
          icon: const Icon(Icons.arrow_back_ios_new_rounded),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _isRefreshing || _isLoading
                ? null
                : () => _loadFromServer(refresh: true),
            icon: _isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.refresh_rounded),
          ),
          PopupMenuButton<String>(
            tooltip: 'Menu',
            onSelected: (value) {
              if (value == 'history') {
                _goToHistory();
              } else if (value == 'home') {
                _goToHome();
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem<String>(
                value: 'history',
                child: Text('View history'),
              ),
              PopupMenuItem<String>(
                value: 'home',
                child: Text('Home'),
              ),
            ],
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading && _receipt == null) {
      return Center(
        child: Semantics(
          label: 'Loading transfer receipt',
          child: const CircularProgressIndicator(),
        ),
      );
    }

    final receipt = _receipt;
    if (receipt == null) {
      return TpEmptyState(
        variant: TpIllustrationVariant.error,
        title: 'Could not load this receipt',
        message: _loadError ?? 'Refresh and try again.',
        primaryActionLabel: 'Retry',
        onPrimaryAction: () => _loadFromServer(),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: () => _loadFromServer(refresh: true),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.xxl,
            ),
            sliver: SliverList.list(
              children: [
                Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 680),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_refreshError != null) ...[
                          _RefreshErrorBanner(
                            message: _refreshError!,
                            isRefreshing: _isRefreshing,
                            onRetry: () => _loadFromServer(refresh: true),
                          ),
                          const SizedBox(height: AppSpacing.md),
                        ],
                        TpReceiptHero(
                          tone: receipt.tone,
                          title: _heroTitle(receipt),
                          message: _heroMessage(receipt),
                          statusLabel: receipt.displayStatus,
                          amountLabel: _amountLabel(receipt),
                          reference: receipt.reference,
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        RepaintBoundary(
                          key: _receiptKey,
                          child: TpReceiptCard(
                            tone: receipt.tone,
                            headerTitle: 'Transfer receipt',
                            headerSubtitle: 'TrustPay transfer',
                            statusLabel: receipt.displayStatus,
                            entries: _entries(receipt),
                            footerNote:
                                'Only share this receipt with people who need to verify the transfer.',
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        OutlinedButton.icon(
                          onPressed: _copyReference,
                          icon: const Icon(Icons.copy_rounded, size: 18),
                          label: const Text('Copy reference'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(50),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        TpReceiptActions(
                          isSaving: _exporting != null,
                          isSharing: _exporting != null,
                          onSave: () => _showSaveSheet(receipt),
                          onShare: () => _shareReceipt(receipt),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        const TpReceiptInfoPanel(
                          text:
                              'Save the receipt as PDF for records or JPG for quick sharing. The same receipt image is used for both export actions.',
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _heroTitle(TransferReceiptData receipt) {
    if (receipt.isReversed) return 'Transfer reversed';
    if (!receipt.isSuccessful) return 'Transfer receipt';
    return receipt.direction == 'IN' ? 'Money received' : 'Money sent';
  }

  String _heroMessage(TransferReceiptData receipt) {
    if (receipt.isReversed) {
      return 'This transfer was reversed. No second transfer was sent.';
    }
    if (receipt.isSuccessful) {
      return receipt.direction == 'IN'
          ? 'Money received from ${receipt.counterparty}.'
          : 'Your transfer to ${receipt.counterparty} is complete.';
    }
    if (receipt.isFailed) {
      return 'This transfer was not completed. No second transfer was sent.';
    }
    if (receipt.status == 'UNKNOWN') {
      return 'The transfer status is not confirmed yet. Refresh to check the latest status.';
    }
    return 'Your transfer is still being confirmed. Refresh to check the latest status.';
  }

  String _amountLabel(TransferReceiptData receipt) {
    return transferMoneyLabel(receipt.amount.decimalString, receipt.currency);
  }

  List<TpReceiptEntry> _entries(TransferReceiptData receipt) {
    final happenedAt = receipt.createdAt ?? receipt.updatedAt;
    final timeValue = happenedAt == null
        ? 'Not provided'
        : DateFormat('dd MMM yyyy • HH:mm').format(happenedAt.toLocal());
    final counterpartyLabel = receipt.direction == 'IN' ? 'From' : 'Recipient';
    final directionLabel = receipt.direction == 'IN' ? 'Received' : 'Sent';

    return [
      TpReceiptEntry('Reference', receipt.reference),
      if (receipt.transactionReference.isNotEmpty &&
          receipt.transactionReference != receipt.reference)
        TpReceiptEntry('Transaction ref', receipt.transactionReference),
      TpReceiptEntry('Amount', _amountLabel(receipt), emphasize: true),
      TpReceiptEntry('Fee', _amountLabelFor(receipt.fee, receipt.currency)),
      TpReceiptEntry('Direction', directionLabel),
      TpReceiptEntry(counterpartyLabel, receipt.counterparty),
      TpReceiptEntry('Date', timeValue),
      if (receipt.note.isNotEmpty) TpReceiptEntry('Note', receipt.note),
      if (receipt.reversalStatus.isNotEmpty)
        TpReceiptEntry('Reversal status', receipt.reversalStatus),
      if (receipt.reversalReference.isNotEmpty)
        TpReceiptEntry('Reversal ref', receipt.reversalReference),
    ];
  }

  String _amountLabelFor(MoneyValue amount, String currency) {
    return transferMoneyLabel(amount.decimalString, currency);
  }

  String _receiptFileName(TransferReceiptData receipt, String extension) {
    final safeReference =
        receipt.reference.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'trustpay-transfer-$safeReference.$extension';
  }

  String _shareText(TransferReceiptData receipt) {
    return 'TrustPay transfer receipt - ${receipt.reference}';
  }
}

class _RefreshErrorBanner extends StatelessWidget {
  const _RefreshErrorBanner({
    required this.message,
    required this.isRefreshing,
    required this.onRetry,
  });

  final String message;
  final bool isRefreshing;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.sync_problem_rounded, color: AppColors.warning, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Latest status unavailable',
                  style: AppTextStyles.labelM,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(message, style: AppTextStyles.bodyS),
                const SizedBox(height: AppSpacing.xs),
                TextButton(
                  onPressed: isRefreshing ? null : onRetry,
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  child: isRefreshing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Retry'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _ReceiptExportKind { save, share }

enum _ReceiptExportChoice { pdf, jpg }

Map<String, dynamic> _receiptMap(dynamic value) {
  if (value is Map<String, dynamic>) return Map<String, dynamic>.from(value);
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

String _receiptString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  if (value is String) {
    final text = value.trim();
    return text.isEmpty ? fallback : text;
  }
  if (value is num || value is DateTime) return value.toString();
  return fallback;
}

String _receiptCurrency(dynamic value) {
  final raw = _receiptString(value).toUpperCase();
  if (raw.isEmpty) {
    throw const FormatException('Transfer receipt currency is missing.');
  }
  if (raw != 'NGN' && raw != 'GHS') {
    throw FormatException('Unsupported transfer receipt currency: $raw');
  }
  return raw;
}

MoneyValue _receiptFee(dynamic value, String currency) {
  if (value == null || (value is String && value.trim().isEmpty)) {
    return MoneyValue.parse('0.00', currency: currency);
  }
  final fee = MoneyValue.fromJson(value, currency: currency);
  if (fee.isNegative) {
    throw const FormatException('Transfer receipt fee cannot be negative.');
  }
  return fee;
}

DateTime? _receiptDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}

String _safeReceiptError(Object error, String fallback) {
  return authErrorMessage(error, fallback);
}
