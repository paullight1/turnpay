import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../services/manual_exchange_service.dart';
import '../widgets/manual_exchange_progress.dart';
import '../widgets/review_reminder_button.dart';

class ManualExchangeOrderScreen extends StatefulWidget {
  final String orderId;
  final ManualExchangeOrder? initialOrder;
  final ManualExchangeService? service;
  final bool showBackButton;
  final Future<ManualExchangeProofFile?> Function()? pickReceipt;

  const ManualExchangeOrderScreen({
    super.key,
    required this.orderId,
    this.initialOrder,
    this.service,
    this.showBackButton = true,
    this.pickReceipt,
  });

  @override
  State<ManualExchangeOrderScreen> createState() =>
      _ManualExchangeOrderScreenState();
}

class _ManualExchangeOrderScreenState extends State<ManualExchangeOrderScreen>
    with WidgetsBindingObserver {
  late final ManualExchangeService _service;
  late Future<ManualExchangeOrder> _orderFuture;
  final _bankReferenceController = TextEditingController();
  final _scrollController = ScrollController();

  ManualExchangeOrder? _order;
  ManualExchangeProofFile? _selectedFile;
  Timer? _pollTimer;
  bool _isRefreshing = false;
  bool _isSubmittingProof = false;
  bool _isOpeningProof = false;
  bool _showReceiptStep = false;
  bool _paymentConfirmed = false;
  bool _reconcileInitialReceipt = false;
  String? _proofMessage;
  String? _connectionMessage;
  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;
  bool _walletRefreshSignaled = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ManualExchangeService();
    WidgetsBinding.instance.addObserver(this);
    _orderFuture = _loadOrder();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _bankReferenceController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycleState = state;
    if (state == AppLifecycleState.resumed) {
      _schedulePoll();
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
  }

  Future<ManualExchangeOrder> _loadOrder() async {
    try {
      final order = await _service.getOrder(widget.orderId);
      await _restoreReceiptStep(order);
      if (mounted) {
        _order = order;
        _signalWalletRefreshIfCredited(order);
        _schedulePoll();
      }
      return order;
    } catch (error) {
      if (widget.initialOrder != null) {
        await _restoreReceiptStep(widget.initialOrder!);
        if (mounted) {
          _order = widget.initialOrder;
          _signalWalletRefreshIfCredited(widget.initialOrder!);
          _connectionMessage =
              'We could not refresh this order. Showing the last server response.';
          _schedulePoll();
        }
        return widget.initialOrder!;
      }
      rethrow;
    }
  }

  Future<void> _restoreReceiptStep(ManualExchangeOrder order) async {
    if (!order.canSubmitProof ||
        order.status == ManualExchangeOrderStatus.awaitingConfirmation) {
      return;
    }
    try {
      final started = await _service.receiptStepStarted(order.id);
      if (mounted && started) _showReceiptStep = true;
    } catch (_) {
      // Server history remains recoverable if local progress is unavailable.
    }
  }

  void _scrollToTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(0,
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 240),
          curve: Curves.easeOutCubic);
    });
  }

  void _reconcileReceiptStatus(ManualExchangeOrder refreshed) {
    // A new receipt accepted after a lost response is distinguishable from an
    // earlier attachment. Never infer replacement of an already-attached file.
    if (!_reconcileInitialReceipt ||
        !refreshed.hasProof ||
        refreshed.status != ManualExchangeOrderStatus.awaitingConfirmation) {
      return;
    }
    _reconcileInitialReceipt = false;
    _showReceiptStep = false;
    _paymentConfirmed = false;
    _selectedFile = null;
    _proofMessage = null;
    _bankReferenceController.clear();
    unawaited(
        _service.clearReceiptStep(refreshed.id).catchError((Object _) {}));
    _scrollToTop();
  }

  Future<void> _continueToReceipt(ManualExchangeOrder order) async {
    if (_isSubmittingProof) return;
    setState(() {
      _showReceiptStep = true;
      _proofMessage = null;
    });
    _scrollToTop();
    try {
      await _service.markReceiptStepStarted(order.id);
    } catch (_) {
      if (mounted) {
        setState(() => _proofMessage =
            'Keep this exchange reference. If the app closes, reopen this order from exchange history to continue.');
      }
    }
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    final order = _order;
    if (!mounted ||
        order == null ||
        _lifecycleState != AppLifecycleState.resumed) {
      return;
    }
    if (!manualExchangeStatusIsActive(order.status)) return;
    _pollTimer = Timer(const Duration(seconds: 15), _pollOnce);
  }

  Future<void> _pollOnce() async {
    _pollTimer = null;
    if (!mounted || _lifecycleState != AppLifecycleState.resumed) return;
    try {
      final refreshed = await _service.getOrder(widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = refreshed;
        _reconcileReceiptStatus(refreshed);
        _orderFuture = Future<ManualExchangeOrder>.value(refreshed);
        _connectionMessage = null;
      });
      _signalWalletRefreshIfCredited(refreshed);
    } catch (_) {
      if (mounted) {
        setState(() {
          _connectionMessage =
              'Status refresh is unavailable. Pull to refresh when you are online.';
        });
      }
    } finally {
      _schedulePoll();
    }
  }

  Future<void> _refresh() async {
    if (_isRefreshing) return;
    setState(() => _isRefreshing = true);
    try {
      final refreshed = await _service.getOrder(widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = refreshed;
        _reconcileReceiptStatus(refreshed);
        _orderFuture = Future<ManualExchangeOrder>.value(refreshed);
        _connectionMessage = null;
      });
      _signalWalletRefreshIfCredited(refreshed);
    } catch (error) {
      if (mounted) {
        setState(() {
          _connectionMessage = manualExchangeErrorMessage(
            error,
            'Could not refresh this order. Check your connection and try again.',
          );
        });
      }
    } finally {
      if (mounted) {
        setState(() => _isRefreshing = false);
        _schedulePoll();
      }
    }
  }

  void _signalWalletRefreshIfCredited(ManualExchangeOrder order) {
    if (_walletRefreshSignaled ||
        order.status != ManualExchangeOrderStatus.credited) {
      return;
    }
    // The order was parsed from a server response (or a previously parsed
    // server order supplied as fallback). Trigger a passive re-fetch in the
    // balance-driven screens; never add the quoted amount locally.
    _walletRefreshSignaled = true;
    walletRefreshSignal.bump();
  }

  Future<void> _pickReceipt() async {
    if (_isSubmittingProof) return;
    final customPicker = widget.pickReceipt;
    if (customPicker != null) {
      final file = await customPicker();
      if (!mounted || file == null) return;
      if (file.bytes.isEmpty ||
          file.fileSize > manualExchangeMaxProofBytes ||
          _contentTypeFor(file.fileName) == null) {
        setState(() => _proofMessage =
            'Choose a JPEG, PNG, WebP, or PDF receipt up to 8 MiB.');
        return;
      }
      setState(() {
        _selectedFile = file;
        _proofMessage = null;
      });
      return;
    }
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      allowMultiple: false,
      withData: true,
    );
    if (result == null || result.files.isEmpty || !mounted) return;

    final selected = result.files.single;
    final bytes = selected.bytes;
    if (bytes == null || bytes.isEmpty) {
      setState(() {
        _proofMessage = 'Could not read that receipt. Choose the file again.';
      });
      return;
    }
    if (bytes.length > manualExchangeMaxProofBytes) {
      setState(() {
        _proofMessage = 'Receipt must be 8 MiB or smaller.';
      });
      return;
    }
    final contentType = _contentTypeFor(selected.name);
    if (contentType == null) {
      setState(() {
        _proofMessage = 'Receipt must be a JPEG, PNG, WebP, or PDF.';
      });
      return;
    }

    setState(() {
      _selectedFile = ManualExchangeProofFile(
        fileName: selected.name,
        contentType: contentType,
        bytes: bytes,
      );
      _proofMessage = null;
    });
  }

  Future<void> _submitReceipt(ManualExchangeOrder order) async {
    if (_isSubmittingProof) return;
    if (!_paymentConfirmed) {
      setState(() => _proofMessage =
          'Confirm that you have made this transfer before submitting the receipt.');
      return;
    }
    final file = _selectedFile;
    final bankReference = _bankReferenceController.text.trim();
    if (file == null) {
      setState(() => _proofMessage = 'Choose your transfer receipt first.');
      return;
    }
    if (bankReference.isEmpty) {
      setState(
          () => _proofMessage = 'Enter the bank reference for your transfer.');
      return;
    }

    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _isSubmittingProof = true;
      _reconcileInitialReceipt = false;
      _proofMessage = null;
    });

    try {
      final updated = await _service.submitProof(
        orderId: order.id,
        file: file,
        bankReference: bankReference,
      );
      if (!mounted) return;
      setState(() {
        _order = updated;
        _orderFuture = Future<ManualExchangeOrder>.value(updated);
        _selectedFile = null;
        _showReceiptStep = false;
        _paymentConfirmed = false;
        _bankReferenceController.clear();
        _proofMessage = null;
      });
      _scrollToTop();
      showTpSnackbar(
        context,
        'Payment reported. Your receipt is awaiting admin review.',
        type: TpSnackbarType.success,
      );
      try {
        await _service.clearReceiptStep(order.id);
      } catch (_) {}
      _schedulePoll();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _reconcileInitialReceipt = !order.hasProof;
        _proofMessage =
            '${manualExchangeErrorMessage(error, 'Receipt submission could not be confirmed.')} Your exchange and selected receipt are kept here. Do not make another transfer. Retry this receipt when you are online.';
      });
    } finally {
      if (mounted) setState(() => _isSubmittingProof = false);
    }
  }

  Future<void> _openReceipt(ManualExchangeOrder order) async {
    if (_isOpeningProof) return;
    setState(() => _isOpeningProof = true);
    try {
      final rawUrl = await _service.getProofUrl(order.id);
      final opened = await launchUrl(
        Uri.parse(rawUrl),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        showTpSnackbar(context, 'Could not open the receipt.',
            type: TpSnackbarType.error);
      }
    } catch (error) {
      if (mounted) {
        showTpSnackbar(
          context,
          manualExchangeErrorMessage(error, 'Could not open the receipt.'),
          type: TpSnackbarType.error,
        );
      }
    } finally {
      if (mounted) setState(() => _isOpeningProof = false);
    }
  }

  Future<void> _copy(String value, String label) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (mounted) {
      showTpSnackbar(context, '$label copied.', type: TpSnackbarType.info);
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: FutureBuilder<ManualExchangeOrder>(
          future: _orderFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting &&
                _order == null) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError && _order == null) {
              return _OrderLoadError(onRetry: _refresh);
            }
            final order = _order ?? snapshot.data;
            if (order == null) return _OrderLoadError(onRetry: _refresh);
            return RefreshIndicator(
              onRefresh: _refresh,
              color: AppColors.primary,
              child: CustomScrollView(
                controller: _scrollController,
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                slivers: [
                  SliverToBoxAdapter(
                    child: TpPageHeader(
                      label: 'Exchange',
                      showBackButton: widget.showBackButton,
                      menuActions: [
                        TpPageMenuAction(
                          label: 'Refresh status',
                          icon: Icons.refresh_rounded,
                          onTap: _refresh,
                        ),
                      ],
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      AppSpacing.sm,
                      AppSpacing.md,
                      AppSpacing.xxl,
                    ),
                    sliver: SliverList.list(
                      children: [
                        ManualExchangeProgress(
                            order: order, receiptStep: _showReceiptStep),
                        if (_connectionMessage != null) ...[
                          _InfoMessage(
                              message:
                                  '$_connectionMessage Your exchange reference is unchanged. Do not pay again if you already transferred.'),
                          const SizedBox(height: 16),
                        ],
                        if (!_showReceiptStep &&
                            order.status ==
                                ManualExchangeOrderStatus.awaitingTransfer &&
                            order.collectionAccount != null) ...[
                          _CollectionAccountCard(order: order, onCopy: _copy),
                          const SizedBox(height: 20),
                          SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                  onPressed: () => _continueToReceipt(order),
                                  child:
                                      const Text('I’ve made this transfer'))),
                          const SizedBox(height: 10),
                          Text(
                              'Already paid? Continue with your receipt. Do not send the payment twice.',
                              style: AppTextStyles.bodyS,
                              textAlign: TextAlign.center),
                        ],
                        if (order.status ==
                                ManualExchangeOrderStatus.needsMoreInfo &&
                            !_showReceiptStep)
                          SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                  onPressed: () => _continueToReceipt(order),
                                  child:
                                      const Text('Update transfer receipt'))),
                        if (_showReceiptStep ||
                            order.status !=
                                ManualExchangeOrderStatus.awaitingTransfer)
                          _ReceiptCard(
                            order: order,
                            selectedFile: _selectedFile,
                            bankReferenceController: _bankReferenceController,
                            isSubmitting: _isSubmittingProof,
                            isOpeningProof: _isOpeningProof,
                            paymentConfirmed: _paymentConfirmed,
                            onPaymentConfirmed: (value) =>
                                setState(() => _paymentConfirmed = value),
                            editable: _showReceiptStep && order.canSubmitProof,
                            message: _proofMessage,
                            onPick: _pickReceipt,
                            onSubmit: () => _submitReceipt(order),
                            onOpenReceipt: () => _openReceipt(order),
                          ),
                        if (_showReceiptStep)
                          TextButton(
                              onPressed: _isSubmittingProof
                                  ? null
                                  : () =>
                                      setState(() => _showReceiptStep = false),
                              child:
                                  const Text('View original transfer account')),
                        if (order.status ==
                                ManualExchangeOrderStatus
                                    .awaitingConfirmation &&
                            !_showReceiptStep) ...[
                          const SizedBox(height: 16),
                          const _InfoMessage(
                              message:
                                  'No further payment is needed. We’ll update this exchange after admin review.'),
                          const SizedBox(height: 12),
                          OutlinedButton.icon(
                              onPressed: _isRefreshing ? null : _refresh,
                              icon: const Icon(Icons.refresh_rounded),
                              label: const Text('Refresh review status')),
                          TextButton(
                              onPressed: () => _continueToReceipt(order),
                              child: const Text('Update receipt')),
                        ],
                        ReviewReminderButton(order: order, service: _service),
                        const SizedBox(height: 20),
                        ExpansionTile(
                            tilePadding: EdgeInsets.zero,
                            title: Text('Exchange details',
                                style: AppTextStyles.labelL),
                            children: [
                              _OrderSummaryCard(order: order),
                              _DestinationCard(order: order),
                            ]),
                        if (order.events.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.xl),
                          _OrderTimeline(events: order.events),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

String? _contentTypeFor(String fileName) {
  final extension = fileName.split('.').last.toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'pdf' => 'application/pdf',
    _ => null,
  };
}

class _OrderSummaryCard extends StatelessWidget {
  final ManualExchangeOrder order;

  const _OrderSummaryCard({required this.order});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        children: [
          _SummaryRow(
            label: 'You send',
            value: '${order.sourceCurrency} ${order.amount}',
            strong: true,
          ),
          const Divider(height: AppSpacing.lg),
          _SummaryRow(
            label: 'You receive',
            value: '${order.targetCurrency} ${order.targetAmount}',
            strong: true,
          ),
          const SizedBox(height: AppSpacing.md),
          _SummaryRow(label: 'Rate', value: order.rate),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
            label: 'Fee',
            value: '${order.sourceCurrency} ${order.fee}',
          ),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
            label: 'Order reference',
            value: order.reference.isEmpty ? order.id : order.reference,
          ),
          if (order.expiresAt != null) ...[
            const SizedBox(height: AppSpacing.sm),
            _SummaryRow(
              label: 'Instruction expiry',
              value: _formatDate(order.expiresAt!),
            ),
          ],
        ],
      ),
    );
  }
}

class _CollectionAccountCard extends StatelessWidget {
  final ManualExchangeOrder order;
  final Future<void> Function(String value, String label) onCopy;

  const _CollectionAccountCard({required this.order, required this.onCopy});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final account = order.collectionAccount!;
    final paymentReference =
        order.reference.isEmpty ? order.id : order.reference;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.account_balance_rounded, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text('Transfer to this account',
                    style: AppTextStyles.headingM),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Transfer the exact amount from your bank and include the unique payment reference.',
            style: AppTextStyles.bodyM,
          ),
          const SizedBox(height: 20),
          Text('${order.sourceCurrency} ${order.amount}',
              style: AppTextStyles.displayMedium
                  .copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 20),
          _CopyValueRow(label: 'Bank', value: account.bankName, onCopy: onCopy),
          _CopyValueRow(
              label: 'Account name',
              value: account.accountName,
              onCopy: onCopy),
          _CopyValueRow(
              label: 'Account number',
              value: account.accountNumber,
              onCopy: onCopy),
          _CopyValueRow(
              label: 'Currency', value: account.currency, onCopy: onCopy),
          _CopyValueRow(
            label: 'Payment reference',
            value: paymentReference,
            onCopy: onCopy,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Use only these transfer details for this exchange. Keep the receipt from your bank or mobile money provider.',
            style: AppTextStyles.bodyS,
          ),
        ],
      ),
    );
  }
}

class _CopyValueRow extends StatelessWidget {
  final String label;
  final String value;
  final Future<void> Function(String value, String label) onCopy;

  const _CopyValueRow({
    required this.label,
    required this.value,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 104, child: Text(label, style: AppTextStyles.bodyS)),
          Expanded(child: Text(value, style: AppTextStyles.labelM)),
          IconButton(
            tooltip: 'Copy $label',
            visualDensity: VisualDensity.compact,
            onPressed: value.isEmpty ? null : () => onCopy(value, label),
            icon: const Icon(Icons.copy_rounded, size: 18),
          ),
        ],
      ),
    );
  }
}

class _DestinationCard extends StatelessWidget {
  final ManualExchangeOrder order;

  const _DestinationCard({required this.order});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (order.settlementMode == ManualSettlementMode.wallet) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            Icon(Icons.account_balance_wallet_rounded,
                color: AppColors.primary),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                'Confirmed ${order.targetCurrency} will be credited to your TrustPay wallet after deposit approval.',
                style: AppTextStyles.bodyM,
              ),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            order.settlementMode == ManualSettlementMode.bank
                ? 'Payout destination'
                : 'Mobile money destination',
            style: AppTextStyles.headingM,
          ),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
            label: 'Institution',
            value: order.destinationInstitution ?? 'Not available',
          ),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
            label: 'Account',
            value: order.destinationAccountMasked ?? 'Not available',
          ),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(
            label: 'Name',
            value: order.destinationName ?? 'Not available',
          ),
        ],
      ),
    );
  }
}

class _ReceiptCard extends StatelessWidget {
  final ManualExchangeOrder order;
  final ManualExchangeProofFile? selectedFile;
  final TextEditingController bankReferenceController;
  final bool isSubmitting;
  final bool isOpeningProof;
  final bool paymentConfirmed, editable;
  final ValueChanged<bool> onPaymentConfirmed;
  final String? message;
  final VoidCallback onPick;
  final VoidCallback onSubmit;
  final VoidCallback onOpenReceipt;

  const _ReceiptCard({
    required this.order,
    required this.selectedFile,
    required this.bankReferenceController,
    required this.isSubmitting,
    required this.isOpeningProof,
    required this.paymentConfirmed,
    required this.editable,
    required this.onPaymentConfirmed,
    required this.message,
    required this.onPick,
    required this.onSubmit,
    required this.onOpenReceipt,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final canSubmit = order.canSubmitProof && editable;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.receipt_long_rounded, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  order.hasProof ? 'Your transfer receipt' : 'Payment receipt',
                  style: AppTextStyles.headingM,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            order.hasProof
                ? 'Your receipt is attached to this order for review.'
                : 'Upload the receipt for this exchange. If you reopened the app, select the same receipt again. Your payment will be checked by our team.',
            style: AppTextStyles.bodyM,
          ),
          if (order.hasProof) ...[
            const SizedBox(height: AppSpacing.md),
            OutlinedButton.icon(
              onPressed: isOpeningProof ? null : onOpenReceipt,
              icon: isOpeningProof
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.open_in_new_rounded),
              label: Text(isOpeningProof ? 'Opening…' : 'View receipt'),
            ),
          ],
          if (order.reviewReason != null &&
              order.reviewReason!.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _ReviewReason(reason: order.reviewReason!),
          ],
          if (canSubmit) ...[
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: bankReferenceController,
              enabled: !isSubmitting,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(
                labelText: 'Bank reference',
                hintText: 'Enter the reference on your transfer receipt',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton.icon(
              onPressed: isSubmitting ? null : onPick,
              icon: const Icon(Icons.attach_file_rounded),
              label: Text(
                  selectedFile == null ? 'Choose receipt' : 'Change receipt'),
            ),
            if (selectedFile != null) ...[
              const SizedBox(height: AppSpacing.sm),
              _SelectedFile(file: selectedFile!),
            ],
            if (message != null) ...[
              const SizedBox(height: AppSpacing.sm),
              _InfoMessage(message: message!, error: true),
            ],
            const SizedBox(height: 16),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: paymentConfirmed,
              onChanged: isSubmitting
                  ? null
                  : (value) => onPaymentConfirmed(value ?? false),
              title: Text(
                  'I confirm I transferred ${order.sourceCurrency} ${order.amount} to the account shown for this exchange.',
                  style: AppTextStyles.bodyS),
            ),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: isSubmitting || !paymentConfirmed ? null : onSubmit,
                icon: isSubmitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.upload_file_rounded),
                label: Text(isSubmitting
                    ? 'Submitting receipt…'
                    : 'Confirm payment & submit receipt'),
              ),
            ),
          ] else if (message != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoMessage(message: message!, error: true),
          ],
        ],
      ),
    );
  }
}

class _SelectedFile extends StatelessWidget {
  final ManualExchangeProofFile file;

  const _SelectedFile({required this.file});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final size = file.fileSize >= 1024 * 1024
        ? '${(file.fileSize / (1024 * 1024)).toStringAsFixed(1)} MiB'
        : '${(file.fileSize / 1024).ceil()} KiB';
    return Row(
      children: [
        Icon(Icons.description_outlined, color: AppColors.primary, size: 20),
        const SizedBox(width: AppSpacing.sm),
        Expanded(child: Text(file.fileName, style: AppTextStyles.labelS)),
        Text(size, style: AppTextStyles.caption),
      ],
    );
  }
}

class _ReviewReason extends StatelessWidget {
  final String reason;

  const _ReviewReason({required this.reason});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, color: AppColors.warning, size: 19),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(reason,
                style: AppTextStyles.bodyS.copyWith(color: AppColors.warning)),
          ),
        ],
      ),
    );
  }
}

class _OrderTimeline extends StatelessWidget {
  final List<ManualExchangeOrderEvent> events;

  const _OrderTimeline({required this.events});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Order history', style: AppTextStyles.headingM),
        const SizedBox(height: AppSpacing.sm),
        ...events.reversed.map(
          (event) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: 5),
                  decoration: BoxDecoration(
                    color: _statusColor(event.status),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(manualExchangeStatusLabel(event.status),
                          style: AppTextStyles.labelM),
                      if (event.reason.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(event.reason, style: AppTextStyles.bodyS),
                      ],
                      if (event.createdAt != null) ...[
                        const SizedBox(height: 2),
                        Text(_formatDate(event.createdAt!),
                            style: AppTextStyles.caption),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool strong;

  const _SummaryRow({
    required this.label,
    required this.value,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: AppTextStyles.bodyS)),
        const SizedBox(width: AppSpacing.md),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: strong ? AppTextStyles.headingM : AppTextStyles.labelM,
          ),
        ),
      ],
    );
  }
}

class _InfoMessage extends StatelessWidget {
  final String message;
  final bool error;

  const _InfoMessage({required this.message, this.error = false});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final color = error ? AppColors.error : AppColors.warning;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(error ? Icons.error_outline_rounded : Icons.info_outline_rounded,
              color: color, size: 19),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(message,
                style: AppTextStyles.bodyS.copyWith(color: color)),
          ),
        ],
      ),
    );
  }
}

class _OrderLoadError extends StatelessWidget {
  final Future<void> Function() onRetry;

  const _OrderLoadError({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_rounded,
                size: 42, color: AppColors.textSecondary),
            const SizedBox(height: AppSpacing.md),
            Text('Order could not load.', style: AppTextStyles.headingM),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Check your connection and try again. The order remains on the server.',
              textAlign: TextAlign.center,
              style: AppTextStyles.bodyM,
            ),
            const SizedBox(height: AppSpacing.lg),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

String _formatDate(DateTime date) =>
    DateFormat('d MMM yyyy, HH:mm').format(date.toLocal());

Color _statusColor(ManualExchangeOrderStatus status) {
  switch (status) {
    case ManualExchangeOrderStatus.credited:
    case ManualExchangeOrderStatus.completed:
      return AppColors.success;
    case ManualExchangeOrderStatus.needsMoreInfo:
    case ManualExchangeOrderStatus.rejected:
      return AppColors.error;
    case ManualExchangeOrderStatus.payoutPending:
    case ManualExchangeOrderStatus.awaitingTransfer:
    case ManualExchangeOrderStatus.awaitingConfirmation:
      return AppColors.warning;
    case ManualExchangeOrderStatus.payoutProcessing:
    case ManualExchangeOrderStatus.payoutSent:
    case ManualExchangeOrderStatus.unknown:
      return AppColors.primary;
  }
}
