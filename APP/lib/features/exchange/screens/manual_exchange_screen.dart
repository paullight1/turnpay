import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'exchange_converter.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../services/auth_service.dart';
import '../../../services/kyc_service.dart';
import '../../home/widgets/kyc_status_presenter.dart';
import '../../../services/transaction_security_service.dart';
import '../services/manual_exchange_service.dart';
import '../services/ghana_bank_directory.dart';
import '../widgets/manual_exchange_history.dart';
import '../../security/screens/transaction_security_screen.dart';

class ManualExchangeScreen extends StatefulWidget {
  final ManualExchangeService? service;
  final TransactionSecurityService? securityService;
  final AuthService? authService;
  final KycService? kycService;
  final bool showBackButton;
  final bool active;

  const ManualExchangeScreen({
    super.key,
    this.service,
    this.securityService,
    this.authService,
    this.kycService,
    this.showBackButton = true,
    this.active = true,
  });

  @override
  State<ManualExchangeScreen> createState() => _ManualExchangeScreenState();
}

class _ManualExchangeScreenState extends State<ManualExchangeScreen>
    with WidgetsBindingObserver {
  late final ManualExchangeService _service;
  late final TransactionSecurityService _securityService;
  late final AuthService _authService;
  late final KycService _kycService;
  late Future<_ManualExchangePageData> _pageFuture;
  ManualExchangeConfig? _currentConfig;

  final _formKey = GlobalKey<FormState>();
  final _scrollController = ScrollController();
  final _amountController = TextEditingController();
  final _institutionController = TextEditingController();
  final _accountController = TextEditingController();
  final _nameController = TextEditingController();

  ManualSettlementMode _settlementMode = ManualSettlementMode.bank;
  GhanaBankOption? _selectedGhanaBank;
  bool _settlementModeChosen = false;
  String _sourceCurrency = 'GHS';
  int _step = 0;
  bool _isCreating = false;
  bool _isRefreshing = false;
  bool _pendingDraftRestored = false;
  bool _nigerianDestinationVerified = false;
  String? _formMessage;
  Timer? _backgroundRefresh;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _service = widget.service ?? ManualExchangeService();
    _securityService = widget.securityService ?? TransactionSecurityService();
    _authService = widget.authService ?? AuthService();
    _kycService = widget.kycService ?? KycService();
    _pageFuture = _loadPage();
    _backgroundRefresh = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted && widget.active && !_isCreating) _refresh();
    });
  }

  @override
  void didUpdateWidget(covariant ManualExchangeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _backgroundRefresh?.cancel();
    _amountController.dispose();
    _scrollController.dispose();
    _institutionController.dispose();
    _accountController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.active && !_isCreating) {
      _refresh();
    }
  }

  void _centerStep() {
    FocusManager.instance.primaryFocus?.unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(0,
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 240),
          curve: Curves.easeOutCubic);
    });
  }

  bool _canOpenDirection(ManualExchangeConfig config, String currency) =>
      config.enabled && config.supportedSourceCurrencies.contains(currency);

  List<ManualSettlementMode> _receivingModesFor(
      ManualExchangeConfig config, String currency) {
    final modes = config.deliveryModesFor(currency);
    if (modes.isNotEmpty) return modes;
    if (currency == 'GHS' && config.supportedSourceCurrencies.contains('GHS')) {
      return const [ManualSettlementMode.bank];
    }
    return modes;
  }

  Future<_ManualExchangePageData> _loadPage() async {
    final results = await Future.wait<dynamic>([
      _service.fetchConfig(),
      _loadPendingCreate(),
    ]);
    final pendingCreate = results[1] as ManualExchangeAttempt?;
    final config = results[0] as ManualExchangeConfig;
    _currentConfig = config;
    if (!_pendingDraftRestored) {
      if (_step == 0 && !config.canExchangeFrom(_sourceCurrency)) {
        final available =
            config.supportedSourceCurrencies.where(config.canExchangeFrom);
        if (available.isNotEmpty) _sourceCurrency = available.first;
      }
      final modes = config.deliveryModesFor(_sourceCurrency);

      final preserveReceivingSelection = _step == 2 &&
          _settlementModeChosen &&
          modes.contains(_settlementMode);
      if (modes.isNotEmpty && !modes.contains(_settlementMode)) {
        _settlementMode = modes.first;
      }
      if (!preserveReceivingSelection) {
        _settlementModeChosen = modes.length <= 1;
      }
    }
    return _ManualExchangePageData(
      config: results[0] as ManualExchangeConfig,
      orders: _service.listOrders(),
      pendingCreate: pendingCreate,
    );
  }

  Future<ManualExchangeAttempt?> _loadPendingCreate() async {
    try {
      return await _service.pendingCreateAttempt();
    } on StateError {
      // A screen test or an unauthenticated shell can be rendered before a
      // token exists. The protected API remains the source of truth then.
      return null;
    }
  }

  void _openPendingCreate(ManualExchangeAttempt attempt) {
    setState(() {
      _restorePendingCreate(attempt);
      _formMessage = null;
    });
    _centerStep();
  }

  Future<void> _confirmDiscardDraft() async {
    if (_isCreating || _step <= 0) return;
    final discard = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Cancel this exchange?'),
            content: const Text(
              'Your entered exchange details will be cleared. You can keep working or cancel and return to the exchange options.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Keep exchange'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Cancel exchange'),
              ),
            ],
          ),
        ) ??
        false;
    if (!discard || !mounted) return;

    setState(() {
      _step = 0;
      _pendingDraftRestored = false;
      _amountController.clear();
      _institutionController.clear();
      _accountController.clear();
      _nameController.clear();
      _selectedGhanaBank = null;
      _settlementModeChosen = false;
      _nigerianDestinationVerified = false;
      _formMessage = null;
    });
    _centerStep();
  }

  void _restorePendingCreate(ManualExchangeAttempt attempt) {
    if (!mounted || _pendingDraftRestored) return;
    dynamic decoded;
    try {
      decoded = jsonDecode(attempt.fingerprint);
    } catch (_) {
      throw const FormatException('Manual exchange retry data is corrupt.');
    }
    if (decoded is! Map ||
        decoded['amount'] is! String ||
        decoded['settlementMode'] is! String) {
      throw const FormatException('Manual exchange retry data is corrupt.');
    }

    final mode = manualSettlementModeFromValue(decoded['settlementMode']);
    if (mode != ManualSettlementMode.wallet &&
        (decoded['destinationInstitution'] is! String ||
            decoded['destinationAccount'] is! String ||
            decoded['destinationName'] is! String)) {
      throw const FormatException('Manual exchange retry data is corrupt.');
    }
    _pendingDraftRestored = true;
    _sourceCurrency = decoded['sourceCurrency'] == 'GHS' ? 'GHS' : 'NGN';
    _step = 2;
    _settlementModeChosen = true;
    if (_amountController.text.trim().isEmpty) {
      _amountController.text = (decoded['amount'] as String).trim();
      _settlementMode = mode;
      _institutionController.text = decoded['destinationInstitution'] is String
          ? (decoded['destinationInstitution'] as String).trim()
          : '';
      _accountController.text = decoded['destinationAccount'] is String
          ? (decoded['destinationAccount'] as String).trim()
          : '';
      _nameController.text = decoded['destinationName'] is String
          ? (decoded['destinationName'] as String).trim()
          : '';
    }
  }

  Future<void> _refresh() async {
    if (_isRefreshing || _isCreating) return;
    setState(() {
      _isRefreshing = true;
      _pageFuture = _loadPage();
    });
    try {
      await _pageFuture;
    } catch (_) {
      // The FutureBuilder renders the actionable error state.
    } finally {
      if (mounted) setState(() => _isRefreshing = false);
    }
  }

  Future<void> _createOrder() async {
    if (_isCreating) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _formMessage = null);

    if (!_pendingDraftRestored &&
        !(_currentConfig != null &&
            _canOpenDirection(_currentConfig!, _sourceCurrency))) {
      setState(() => _formMessage =
          'This receiving method is not available for a new exchange yet. Your previous exchanges remain available.');
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_step == 1) {
      setState(() => _step = 2);
      _centerStep();
      return;
    }
    if (_settlementMode != ManualSettlementMode.wallet &&
        (_institutionController.text.trim().isEmpty ||
            _accountController.text.trim().isEmpty ||
            _nameController.text.trim().isEmpty)) {
      setState(() {
        _formMessage = 'Enter the destination details before continuing.';
      });
      return;
    }

    setState(() => _isCreating = true);
    try {
      if (!await _ensureKycCanContinue()) return;

      final pin = await _requireTransactionPin();
      if (pin == null || !mounted) return;

      final order = await _service.createOrder(
        sourceCurrency: _sourceCurrency,
        amount: _amountController.text.trim().replaceAll(',', ''),
        settlementMode: _settlementMode,
        transactionPin: pin,
        destinationInstitution: _settlementMode == ManualSettlementMode.wallet
            ? null
            : _institutionController.text,
        destinationAccount: _settlementMode == ManualSettlementMode.wallet
            ? null
            : _accountController.text,
        destinationName: _settlementMode == ManualSettlementMode.wallet
            ? null
            : _nameController.text,
      );
      if (!mounted) return;
      await context.push(AppRoutes.exchangeOrderFor(order.id), extra: order);
      if (!mounted) return;
      setState(() {
        _step = 0;
        _pendingDraftRestored = false;
        _amountController.clear();
        _institutionController.clear();
        _accountController.clear();
        _nameController.clear();
        _nigerianDestinationVerified = false;
        _formMessage = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _formMessage = manualExchangeErrorMessage(
          error,
          'Could not create this exchange. Check your connection and try again.',
        );
      });
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  Future<bool> _ensureKycCanContinue() async {
    try {
      final overview = await _kycService.fetchOverview();
      // External exchange is authorized against its own server-side budget.
      // Historical retries recover their original terms; suspension still blocks authorization.
      final limitGate = (_settlementMode == ManualSettlementMode.wallet &&
                  !_pendingDraftRestored) ||
              overview.isSuspended
          ? kycActionLimitGate(
              overview, _amountController.text.trim(), _sourceCurrency)
          : null;
      if (overview.isVerified &&
          _isTier1OrHigher(overview.tier) &&
          limitGate == null) {
        return true;
      }
      if (!mounted) return false;
      final pending = overview.providerValidationStatus == 'PENDING';
      final title = limitGate?.title ??
          (pending
              ? 'Your BVN check is in progress'
              : 'Verify BVN to continue');
      final message = limitGate?.message ??
          (pending
              ? 'View your verification status. Your exchange has not been submitted.'
              : 'Verify your identity before creating an exchange.');
      final goToKyc = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              backgroundColor: AppColors.surface,
              title: Text(title, style: AppTextStyles.headingM),
              content: Text(message, style: AppTextStyles.bodyM),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(
                    'Not now',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: Text(limitGate != null
                      ? limitGate.upgrade
                          ? 'Upgrade to Tier 2'
                          : 'Contact support'
                      : pending
                          ? 'View verification status'
                          : 'Verify BVN'),
                ),
              ],
            ),
          ) ??
          false;
      if (goToKyc && mounted) {
        await context.push(limitGate != null && !limitGate.upgrade
            ? AppRoutes.profileSupport
            : AppRoutes.kyc);
      }
      return false;
    } catch (error) {
      if (mounted) {
        setState(() {
          _formMessage = manualExchangeErrorMessage(
            error,
            'Could not verify your KYC status. Try again.',
          );
        });
      }
      return false;
    }
  }

  bool _isTier1OrHigher(String tier) {
    final match = RegExp(r'\d+').firstMatch(tier.trim());
    final number = match == null ? null : int.tryParse(match.group(0)!);
    return number != null && number >= 1;
  }

  Future<String?> _requireTransactionPin() async {
    try {
      final server = await _authService.getTransactionPinStatus();

      if (!mounted) return null;
      if (!server.configured) {
        final setup = await showDialog<bool>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                backgroundColor: AppColors.surface,
                title:
                    Text('Set transaction PIN', style: AppTextStyles.headingM),
                content: Text(
                  'Money actions require a transaction PIN. Set it up in Security & Limits first.',
                  style: AppTextStyles.bodyM,
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: Text(
                      'Cancel',
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    child: const Text('Set up'),
                  ),
                ],
              ),
            ) ??
            false;
        if (setup && mounted) await context.push(AppRoutes.transactionSecurity);
        return null;
      }

      if (server.locked) {
        setState(() {
          _formMessage =
              'Transaction PIN is temporarily locked. Try again later.';
        });
        return null;
      }
      final holdUntil = server.resetHoldUntil;
      if (holdUntil != null && holdUntil.isAfter(DateTime.now().toUtc())) {
        setState(() {
          _formMessage =
              'Money actions are temporarily locked after a PIN reset.';
        });
        return null;
      }

      return Navigator.of(context).push<String>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => TransactionPinScreen.collect(
            pinLength: server.pinLength ?? 4,
            title: 'Enter your transaction PIN',
            subtitle:
                'Approve this exchange request before the order is created.',
            securityService: _securityService,
            authService: _authService,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _formMessage = manualExchangeErrorMessage(
            error,
            'Could not verify your transaction PIN. Try again.',
          );
        });
      }
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final pageWidth = MediaQuery.sizeOf(context).width;
    final contentInset = pageWidth > 592 ? (pageWidth - 560) / 2 : 16.0;
    return PopScope(
      canPop: _step == 0 && !_isCreating,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop || _isCreating || _step <= 0) return;
        unawaited(_confirmDiscardDraft());
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: FutureBuilder<_ManualExchangePageData>(
            future: _pageFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting &&
                  !snapshot.hasData) {
                return const _ExchangeLoadingView();
              }
              if (snapshot.hasError || !snapshot.hasData) {
                return _ExchangeLoadError(onRetry: _refresh);
              }

              final page = snapshot.data!;
              return RefreshIndicator(
                onRefresh: _refresh,
                color: AppColors.primary,
                child: CustomScrollView(
                  controller: _scrollController,
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  slivers: [
                    SliverToBoxAdapter(
                      child: TpPageHeader(
                        label: 'Exchange',
                        showBackButton:
                            _step > 0 ? !_isCreating : widget.showBackButton,
                        onBack: _step == 0
                            ? null
                            : () => unawaited(_confirmDiscardDraft()),
                      ),
                    ),
                    SliverPadding(
                      padding: EdgeInsets.fromLTRB(
                        contentInset,
                        AppSpacing.sm,
                        contentInset,
                        AppSpacing.xxl + 80,
                      ),
                      sliver: SliverList.list(
                        children: [
                          if (_step == 0)
                            const _ExchangeChooserIntro()
                          else
                            Text(
                              _step == 1
                                  ? (_sourceCurrency == 'GHS'
                                      ? 'Cedis to naira'
                                      : 'Naira to cedis')
                                  : (_sourceCurrency == 'NGN'
                                      ? 'Receive cedis'
                                      : 'Receive naira'),
                              style: AppTextStyles.headingXL,
                            ),
                          if (_step == 2) ...[
                            const SizedBox(height: 6),
                            Text(
                                _pendingDraftRestored
                                    ? 'Recover your earlier exchange request.'
                                    : _sourceCurrency == 'NGN'
                                        ? 'Choose where to receive your cedis.'
                                        : 'Enter the Nigerian bank account to receive your naira.',
                                style: AppTextStyles.bodyM),
                          ],
                          if (_step == 1) ...[
                            const SizedBox(height: 6),
                            Text('Enter the amount you want to change.',
                                style: AppTextStyles.bodyM),
                          ],
                          const SizedBox(height: AppSpacing.md),
                          if (_pendingDraftRestored) ...[
                            const _PendingExchangeCard(),
                            const SizedBox(height: AppSpacing.md),
                          ],
                          if (_step == 0) ...[
                            if (!page.config.enabled)
                              _ExchangeDisabledCard(
                                  onRetry: _isRefreshing ? null : _refresh)
                            else ...[
                              for (final currency in const ['GHS', 'NGN'])
                                _DirectionChoice(
                                  currency: currency,
                                  enabled:
                                      _canOpenDirection(page.config, currency),
                                  onTap: _canOpenDirection(
                                          page.config, currency)
                                      ? () => setState(() {
                                            if (_sourceCurrency != currency) {
                                              _amountController.clear();
                                              _institutionController.clear();
                                              _accountController.clear();
                                              _nameController.clear();
                                              _nigerianDestinationVerified =
                                                  false;
                                              final modes = _receivingModesFor(
                                                  page.config, currency);
                                              _settlementMode = modes.first;
                                              _selectedGhanaBank = null;
                                              _settlementModeChosen =
                                                  modes.length <= 1;
                                            }
                                            _sourceCurrency = currency;
                                            _step = 1;
                                            _formMessage = null;
                                            _centerStep();
                                          })
                                      : null,
                                ),
                            ],
                            ManualExchangeHistory(
                              orders: page.orders,
                              service: _service,
                              onRetry: _refresh,
                              compact: true,
                              recovery: page.pendingCreate == null
                                  ? null
                                  : _PendingCreateHistoryOrder(
                                      onTap: () => _openPendingCreate(
                                          page.pendingCreate!),
                                    ),
                            ),
                          ] else
                            _ExchangeForm(
                              service: _service,
                              onSwap: _pendingDraftRestored ||
                                      !(_canOpenDirection(page.config, 'GHS') &&
                                          _canOpenDirection(page.config, 'NGN'))
                                  ? null
                                  : () {
                                      setState(() {
                                        _sourceCurrency =
                                            _sourceCurrency == 'NGN'
                                                ? 'GHS'
                                                : 'NGN';
                                        final modes = _receivingModesFor(
                                            page.config, _sourceCurrency);
                                        _settlementMode = modes.first;
                                        _selectedGhanaBank = null;
                                        _settlementModeChosen =
                                            modes.length <= 1;
                                        _amountController.clear();
                                        _institutionController.clear();
                                        _accountController.clear();
                                        _nameController.clear();
                                        _nigerianDestinationVerified = false;
                                      });
                                      _centerStep();
                                    },
                              sourceCurrency: _sourceCurrency,
                              step: _step,
                              formKey: _formKey,
                              amountController: _amountController,
                              institutionController: _institutionController,
                              accountController: _accountController,
                              nameController: _nameController,
                              settlementMode: _settlementMode,
                              selectedGhanaBank: _selectedGhanaBank,
                              settlementModeChosen: _settlementModeChosen,
                              receivingModes: _pendingDraftRestored
                                  ? [_settlementMode]
                                  : _receivingModesFor(
                                      page.config, _sourceCurrency),
                              isSubmitting: _isCreating,
                              hasPendingCreate: _pendingDraftRestored,
                              nigerianDestinationVerified:
                                  _nigerianDestinationVerified,
                              message: _formMessage,
                              onSettlementModeChanged: (mode) {
                                setState(() {
                                  _settlementMode = mode;
                                  _settlementModeChosen = true;
                                  _selectedGhanaBank = null;
                                  _institutionController.clear();
                                  _accountController.clear();
                                  _nameController.clear();
                                  _nigerianDestinationVerified = false;
                                  _formMessage = null;
                                });
                              },
                              onGhanaBankChanged: (bank) {
                                setState(() {
                                  _selectedGhanaBank = bank;
                                  _institutionController.text =
                                      bank?.name ?? '';
                                  _formMessage = null;
                                });
                              },
                              onNigerianDestinationVerificationChanged:
                                  (verified) {
                                if (_nigerianDestinationVerified == verified) {
                                  return;
                                }
                                setState(() =>
                                    _nigerianDestinationVerified = verified);
                              },
                              onSubmit: _createOrder,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ManualExchangePageData {
  final ManualExchangeConfig config;
  final Future<List<ManualExchangeOrder>> orders;
  final ManualExchangeAttempt? pendingCreate;

  const _ManualExchangePageData({
    required this.config,
    required this.orders,
    required this.pendingCreate,
  });
}

class _ExchangeChooserIntro extends StatelessWidget {
  const _ExchangeChooserIntro();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'EXCHANGE MONEY',
          style: AppTextStyles.labelS.copyWith(
            color: AppColors.primary,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.1,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text('Start a new exchange', style: AppTextStyles.headingXL),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Choose a direction below. You can keep exchanging while earlier requests are being reviewed.',
          style: AppTextStyles.bodyM,
        ),
      ],
    );
  }
}

class _PendingCreateHistoryOrder extends StatelessWidget {
  final VoidCallback onTap;

  const _PendingCreateHistoryOrder({required this.onTap});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: AppColors.warning.withValues(alpha: .08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: AppColors.warning.withValues(alpha: .28)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.pending_actions_rounded,
                  color: AppColors.warning, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Incomplete exchange',
                      style: AppTextStyles.labelM
                          .copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text('Continue saved exchange',
                      style: AppTextStyles.bodyS.copyWith(
                        color: AppColors.warning,
                        fontWeight: FontWeight.w700,
                      )),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded,
                color: AppColors.warning, size: 22),
          ]),
        ),
      ),
    );
  }
}

class _ExchangeDisabledCard extends StatelessWidget {
  final VoidCallback? onRetry;
  const _ExchangeDisabledCard({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.currency_exchange_rounded,
              color: AppColors.textSecondary, size: 28),
          const SizedBox(height: AppSpacing.sm),
          Text('Exchange is currently unavailable.',
              style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Please check again later. Your existing exchange history remains available here.',
            style: AppTextStyles.bodyM,
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: Text(onRetry == null
                ? 'Checking availability…'
                : 'Check availability'),
          ),
        ],
      ),
    );
  }
}

class _PendingExchangeCard extends StatelessWidget {
  const _PendingExchangeCard();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.pending_actions_rounded, color: AppColors.warning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Exchange request pending', style: AppTextStyles.headingM),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'A previous exchange request still needs a server response. Its amount and destination are restored below; enter your PIN again to retry it before starting another exchange.',
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

class _ExchangeForm extends StatelessWidget {
  final ManualExchangeService service;
  final VoidCallback? onSwap;
  final String sourceCurrency;
  final int step;
  final GlobalKey<FormState> formKey;
  final TextEditingController amountController;
  final TextEditingController institutionController;
  final TextEditingController accountController;
  final TextEditingController nameController;
  final ManualSettlementMode settlementMode;
  final GhanaBankOption? selectedGhanaBank;
  final bool settlementModeChosen;
  final List<ManualSettlementMode> receivingModes;
  final bool isSubmitting;
  final bool hasPendingCreate;
  final bool nigerianDestinationVerified;
  final String? message;
  final ValueChanged<ManualSettlementMode> onSettlementModeChanged;
  final ValueChanged<GhanaBankOption?> onGhanaBankChanged;
  final ValueChanged<bool> onNigerianDestinationVerificationChanged;
  final VoidCallback onSubmit;

  const _ExchangeForm({
    required this.service,
    required this.onSwap,
    required this.sourceCurrency,
    required this.step,
    required this.formKey,
    required this.amountController,
    required this.institutionController,
    required this.accountController,
    required this.nameController,
    required this.settlementMode,
    required this.selectedGhanaBank,
    required this.settlementModeChosen,
    required this.receivingModes,
    required this.isSubmitting,
    required this.hasPendingCreate,
    required this.nigerianDestinationVerified,
    required this.message,
    required this.onSettlementModeChanged,
    required this.onGhanaBankChanged,
    required this.onNigerianDestinationVerificationChanged,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final canEdit = !isSubmitting && !hasPendingCreate;
    return Form(
      key: formKey,
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (step == 1) ...[
              ExchangeConverter(
                  source: sourceCurrency,
                  amount: amountController,
                  service: service,
                  onSwap: onSwap,
                  enabled: canEdit),
            ],
            if (step == 2) ...[
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(settlementModeChosen ? 20 : 0),
                decoration: settlementModeChosen
                    ? BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        border: Border.all(color: AppColors.border),
                      )
                    : null,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (hasPendingCreate &&
                          settlementMode == ManualSettlementMode.wallet) ...[
                        Text('Recover your earlier request',
                            style: AppTextStyles.headingM),
                        const SizedBox(height: 16),
                      ],
                      if (receivingModes.length > 1) ...[
                        LayoutBuilder(builder: (context, constraints) {
                          final stack = !settlementModeChosen ||
                              constraints.maxWidth < 320 ||
                              MediaQuery.textScalerOf(context).scale(1) > 1.3;
                          final choices = receivingModes
                              .map((mode) => _SettlementChoice(
                                  mode: mode,
                                  showDescription: !settlementModeChosen,
                                  selected: settlementModeChosen &&
                                      settlementMode == mode,
                                  enabled: canEdit,
                                  onTap: () => onSettlementModeChanged(mode)))
                              .toList();
                          return stack
                              ? Column(children: [
                                  for (var i = 0; i < choices.length; i++) ...[
                                    if (i > 0) const SizedBox(height: 8),
                                    choices[i]
                                  ]
                                ])
                              : Row(children: [
                                  for (var i = 0; i < choices.length; i++) ...[
                                    if (i > 0) const SizedBox(width: 8),
                                    Expanded(child: choices[i])
                                  ]
                                ]);
                        }),
                        const SizedBox(height: 24),
                      ],
                      if (!settlementModeChosen && receivingModes.length > 1)
                        Text(
                          'Select a receiving method to enter its details.',
                          style: AppTextStyles.bodyM,
                        ),
                      if (settlementModeChosen &&
                          settlementMode == ManualSettlementMode.wallet) ...[
                        Icon(Icons.account_balance_wallet_outlined,
                            color: AppColors.primary, size: 28),
                        const SizedBox(height: 12),
                        Text('Earlier exchange destination',
                            style: AppTextStyles.labelL),
                        const SizedBox(height: 8),
                        Text(
                            'This saved request keeps its original TrustPay wallet destination. Retry only this request; do not create another payment.',
                            style: AppTextStyles.bodyM),
                      ] else if (settlementModeChosen) ...[
                        _ExternalDestinationForm(
                          targetCurrency:
                              sourceCurrency == 'GHS' ? 'NGN' : 'GHS',
                          service: service,
                          mode: settlementMode,
                          institutionController: institutionController,
                          accountController: accountController,
                          nameController: nameController,
                          selectedBank: selectedGhanaBank,
                          enabled: canEdit,
                          allowExistingBankValue: hasPendingCreate,
                          onBankChanged: onGhanaBankChanged,
                          onVerificationChanged:
                              onNigerianDestinationVerificationChanged,
                        ),
                      ],
                    ]),
              ),
              if (settlementMode != ManualSettlementMode.wallet) ...[
                const SizedBox(height: 12),
                Text(
                    sourceCurrency == 'NGN'
                        ? 'We send your cedis after your naira payment is confirmed.'
                        : 'We send your naira after your cedi payment is confirmed.',
                    style: AppTextStyles.bodyS),
              ],
            ],
            const SizedBox(height: AppSpacing.md),
            if (step == 2 && settlementModeChosen)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.fact_check_outlined,
                      size: 18, color: AppColors.textSecondary),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      'Check the receiving details before you continue.',
                      style: AppTextStyles.bodyS,
                    ),
                  ),
                ],
              ),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.md),
              _InlineExchangeMessage(message: message!),
            ],
            if (step == 1 || settlementModeChosen) ...[
              const SizedBox(height: AppSpacing.lg),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                      minimumSize: const Size(double.infinity, 56),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 14),
                      textStyle: AppTextStyles.labelL
                          .copyWith(fontWeight: FontWeight.w700)),
                  onPressed: isSubmitting ||
                          (!hasPendingCreate && receivingModes.isEmpty) ||
                          (!hasPendingCreate &&
                              step == 2 &&
                              sourceCurrency == 'GHS' &&
                              settlementMode == ManualSettlementMode.bank &&
                              !nigerianDestinationVerified)
                      ? null
                      : onSubmit,
                  icon: isSubmitting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.arrow_forward_rounded),
                  label: Text(
                    isSubmitting
                        ? 'Creating order…'
                        : hasPendingCreate
                            ? 'Retry exchange'
                            : step == 1
                                ? 'Continue'
                                : 'View transfer account',
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ExternalDestinationForm extends StatefulWidget {
  final String targetCurrency;
  final ManualExchangeService service;
  final ManualSettlementMode mode;
  final TextEditingController institutionController;
  final TextEditingController accountController;
  final TextEditingController nameController;
  final GhanaBankOption? selectedBank;
  final bool enabled;
  final ValueChanged<GhanaBankOption?> onBankChanged;
  final ValueChanged<bool> onVerificationChanged;
  final bool allowExistingBankValue;

  const _ExternalDestinationForm({
    required this.targetCurrency,
    required this.service,
    required this.mode,
    required this.institutionController,
    required this.accountController,
    required this.nameController,
    required this.selectedBank,
    required this.enabled,
    required this.allowExistingBankValue,
    required this.onBankChanged,
    required this.onVerificationChanged,
  });

  @override
  State<_ExternalDestinationForm> createState() =>
      _ExternalDestinationFormState();
}

class _ExternalDestinationFormState extends State<_ExternalDestinationForm> {
  Future<List<ManualGhanaMomoOperator>>? _operatorsFuture;
  Future<List<ManualNigerianBankOption>>? _nigerianBanksFuture;
  ManualGhanaMomoOperator? _selectedOperator;
  ManualNigerianBankOption? _selectedNigerianBank;
  String? _resolutionError;
  bool _resolving = false;
  String? _resolvedInput;
  Timer? _lookupTimer;
  int _lookupGeneration = 0;

  @override
  void initState() {
    super.initState();
    _prepareMode();
  }

  @override
  void didUpdateWidget(covariant _ExternalDestinationForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mode != widget.mode ||
        oldWidget.targetCurrency != widget.targetCurrency ||
        oldWidget.enabled != widget.enabled) {
      _prepareMode();
    }
    if (!widget.enabled && oldWidget.enabled) {
      _lookupTimer?.cancel();
      _lookupGeneration++;
      _resolving = false;
    }
  }

  @override
  void dispose() {
    _lookupTimer?.cancel();
    _lookupGeneration++;
    super.dispose();
  }

  void _scheduleNameCheck() {
    _lookupTimer?.cancel();
    if (!widget.enabled || _selectedOperator == null) return;
    try {
      normalizeGhanaMobileNumber(widget.accountController.text);
    } on FormatException {
      return;
    }
    _lookupTimer =
        Timer(const Duration(milliseconds: 500), _resolveMomoRecipient);
  }

  void _prepareMode() {
    _lookupTimer?.cancel();
    _lookupGeneration++;
    _resolving = false;
    _selectedOperator = null;
    _selectedNigerianBank = null;
    _resolutionError = null;
    _resolvedInput = null;
    if (widget.mode == ManualSettlementMode.momo) {
      final future = widget.service.fetchGhanaMomoOperators();
      _operatorsFuture = future;
      future.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    } else {
      _operatorsFuture = null;
    }
    if (widget.mode == ManualSettlementMode.bank &&
        widget.targetCurrency == 'NGN' &&
        widget.enabled &&
        !widget.allowExistingBankValue) {
      final future = widget.service.fetchNigerianBanks();
      _nigerianBanksFuture = future;
      future.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    } else {
      _nigerianBanksFuture = null;
    }
  }

  void _clearResolvedName() {
    _lookupTimer?.cancel();
    _lookupGeneration++;
    _resolving = false;
    if (_resolvedInput != null || widget.nameController.text.isNotEmpty) {
      widget.nameController.clear();
    }
    if (mounted) {
      setState(() {
        _resolvedInput = null;
        _resolutionError = null;
      });
    }
    if (widget.targetCurrency == 'NGN') {
      widget.onVerificationChanged(false);
    }
  }

  void _selectNigerianBank(ManualNigerianBankOption bank) {
    _lookupTimer?.cancel();
    _lookupGeneration++;
    widget.nameController.clear();
    setState(() {
      _selectedNigerianBank = bank;
      widget.institutionController.text = bank.name;
      _resolvedInput = null;
      _resolutionError = null;
      _resolving = false;
    });
    widget.onVerificationChanged(false);
    _scheduleNigerianAccountResolve();
  }

  void _onNigerianAccountChanged(String _) {
    _clearResolvedName();
    _scheduleNigerianAccountResolve();
  }

  void _scheduleNigerianAccountResolve() {
    _lookupTimer?.cancel();
    if (!widget.enabled ||
        widget.targetCurrency != 'NGN' ||
        widget.mode != ManualSettlementMode.bank ||
        _selectedNigerianBank == null ||
        !RegExp(r'^\d{10}$').hasMatch(widget.accountController.text.trim())) {
      return;
    }
    setState(() => _resolving = true);
    _lookupTimer = Timer(
      const Duration(milliseconds: 450),
      _resolveNigerianAccount,
    );
  }

  Future<void> _resolveNigerianAccount() async {
    _lookupTimer?.cancel();
    final bank = _selectedNigerianBank;
    final account = widget.accountController.text.trim();
    if (!widget.enabled ||
        widget.targetCurrency != 'NGN' ||
        widget.mode != ManualSettlementMode.bank ||
        bank == null ||
        !RegExp(r'^\d{10}$').hasMatch(account)) {
      return;
    }
    final input = '${bank.code}|$account';
    final generation = ++_lookupGeneration;
    setState(() {
      _resolving = true;
      _resolutionError = null;
    });
    try {
      final resolved = await widget.service.resolveNigerianBankAccount(
        accountNumber: account,
        bankCode: bank.code,
      );
      if (!mounted ||
          generation != _lookupGeneration ||
          _selectedNigerianBank?.code != bank.code ||
          widget.accountController.text.trim() != account) {
        return;
      }
      widget.nameController.text = resolved.accountName;
      setState(() {
        _resolvedInput = input;
        _resolutionError = null;
      });
      widget.onVerificationChanged(true);
    } catch (_) {
      if (!mounted || generation != _lookupGeneration) return;
      widget.nameController.clear();
      setState(() {
        _resolvedInput = null;
        _resolutionError =
            'We could not confirm this account name. Check the details and retry.';
      });
      widget.onVerificationChanged(false);
    } finally {
      if (mounted && generation == _lookupGeneration) {
        setState(() => _resolving = false);
      }
    }
  }

  void _reloadNigerianBanks() {
    final future = widget.service.fetchNigerianBanks();
    setState(() => _nigerianBanksFuture = future);
    future.then<void>((_) {}, onError: (Object _, StackTrace __) {});
  }

  Future<void> _resolveMomoRecipient() async {
    _lookupTimer?.cancel();
    if (!widget.enabled || widget.mode != ManualSettlementMode.momo) return;
    final generation = ++_lookupGeneration;
    final operator = _selectedOperator;
    if (operator == null) {
      setState(() {
        _resolutionError =
            'Choose an available Ghana MoMo network before checking the name.';
      });
      return;
    }
    final number = widget.accountController.text.trim();
    try {
      normalizeGhanaMobileNumber(number);
    } on FormatException catch (error) {
      setState(() => _resolutionError = error.message);
      return;
    }
    setState(() {
      _resolving = true;
      _resolutionError = null;
    });
    try {
      final resolved = await widget.service.resolveGhanaMomoRecipient(
        number: number,
        operator: operator.slug,
      );
      if (!mounted ||
          generation != _lookupGeneration ||
          !widget.enabled ||
          widget.mode != ManualSettlementMode.momo ||
          widget.accountController.text.trim() != number ||
          _selectedOperator?.slug != operator.slug) {
        return;
      }
      setState(() {
        widget.nameController.text = resolved.name;
        _resolvedInput = '$number|${operator.slug}';
        _resolutionError = null;
      });
    } catch (_) {
      if (!mounted || generation != _lookupGeneration || !widget.enabled) {
        return;
      }
      widget.nameController.clear();
      setState(() {
        _resolvedInput = null;
        _resolutionError =
            'We could not verify this MoMo name. Enter it exactly as shown by the recipient for manual review.';
      });
    } finally {
      if (mounted && generation == _lookupGeneration) {
        setState(() => _resolving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.mode == ManualSettlementMode.bank) {
      return _buildBankForm(context);
    }
    return _buildMomoForm(context);
  }

  Widget _buildBankForm(BuildContext context) {
    final naira = widget.targetCurrency == 'NGN';
    if (naira) return _buildNigerianBankForm(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextFormField(
          key: const ValueKey('exchange-bank-account-field'),
          style: AppTextStyles.labelL
              .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
          controller: widget.accountController,
          enabled: widget.enabled,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            floatingLabelBehavior: FloatingLabelBehavior.always,
            labelText: 'Account number',
            hintText: 'Enter Ghana bank account number',
          ),
          validator: (value) {
            final account = value?.trim() ?? '';
            // Retry the original immutable payload; server replay precedes new delivery rules.
            if (widget.allowExistingBankValue && !widget.enabled) return null;
            if (!RegExp(r'^\d{7,20}$').hasMatch(account)) {
              return 'Enter a valid account number.';
            }
            return null;
          },
        ),
        const SizedBox(height: AppSpacing.md),
        _GhanaBankSearchField(
          controller: widget.institutionController,
          selected: widget.selectedBank,
          enabled: widget.enabled,
          allowExistingValue: widget.allowExistingBankValue,
          onSelected: widget.onBankChanged,
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          'Enter the name shown by the recipient’s bank. Our team checks these details before sending the payment.',
          style: AppTextStyles.bodyS,
        ),
        const SizedBox(height: AppSpacing.sm),
        _destinationNameField(
          helper: '',
        ),
      ],
    );
  }

  Widget _buildNigerianBankForm(BuildContext context) {
    final immutableRecovery = widget.allowExistingBankValue && !widget.enabled;
    final currentInput = _selectedNigerianBank == null
        ? null
        : '${_selectedNigerianBank!.code}|${widget.accountController.text.trim()}';
    final verified = immutableRecovery ||
        (_resolvedInput != null && _resolvedInput == currentInput);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (immutableRecovery)
          TextFormField(
            key: const ValueKey('exchange-nigerian-bank-field'),
            controller: widget.institutionController,
            enabled: false,
            decoration: const InputDecoration(
              floatingLabelBehavior: FloatingLabelBehavior.always,
              labelText: 'Nigerian bank',
            ),
          )
        else
          FutureBuilder<List<ManualNigerianBankOption>>(
            future: _nigerianBanksFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _NigerianBankLoadingField();
              }
              if (snapshot.hasError || (snapshot.data?.isEmpty ?? true)) {
                return _NigerianBankLoadError(onRetry: _reloadNigerianBanks);
              }
              return _NigerianBankSearchField(
                banks: snapshot.data!,
                selected: _selectedNigerianBank,
                controller: widget.institutionController,
                enabled: widget.enabled,
                onSelected: _selectNigerianBank,
              );
            },
          ),
        const SizedBox(height: AppSpacing.md),
        TextFormField(
          key: const ValueKey('exchange-bank-account-field'),
          style: AppTextStyles.labelL
              .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
          controller: widget.accountController,
          enabled: widget.enabled,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(10),
          ],
          onChanged: _onNigerianAccountChanged,
          onEditingComplete: _resolveNigerianAccount,
          decoration: const InputDecoration(
            floatingLabelBehavior: FloatingLabelBehavior.always,
            labelText: 'Account number',
            hintText: 'Enter Nigerian bank account number',
          ),
          validator: (value) {
            if (immutableRecovery) return null;
            return RegExp(r'^\d{10}$').hasMatch(value?.trim() ?? '')
                ? null
                : 'Enter a ten-digit Nigerian account number.';
          },
        ),
        const SizedBox(height: AppSpacing.md),
        TextFormField(
          key: const ValueKey('exchange-nigerian-account-name-field'),
          controller: widget.nameController,
          enabled: immutableRecovery || widget.enabled,
          readOnly: true,
          style: AppTextStyles.labelL
              .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            floatingLabelBehavior: FloatingLabelBehavior.always,
            labelText: 'Account name',
            hintText: _resolving
                ? 'Checking account name…'
                : 'Account name will appear here',
            prefixIcon: _resolving
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : const Icon(Icons.account_circle_outlined),
            suffixIcon: verified && !immutableRecovery
                ? Icon(Icons.verified_rounded, color: AppColors.success)
                : null,
            helperText:
                verified && !immutableRecovery ? 'Recipient confirmed' : null,
          ),
          validator: (_) =>
              verified ? null : 'Confirm the account name before continuing.',
        ),
        if (_resolutionError != null) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(_resolutionError!,
              style: AppTextStyles.bodyS.copyWith(color: AppColors.error)),
          TextButton.icon(
            onPressed: _resolving ? null : _resolveNigerianAccount,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Retry lookup'),
          ),
        ] else if (!verified) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Choose the bank and enter the account number. We will confirm the recipient before continuing.',
            style: AppTextStyles.bodyS,
          ),
        ],
      ],
    );
  }

  Widget _buildMomoForm(BuildContext context) {
    return FutureBuilder<List<ManualGhanaMomoOperator>>(
      future: _operatorsFuture,
      builder: (context, snapshot) {
        final operators = snapshot.data ?? const <ManualGhanaMomoOperator>[];
        final providerUnavailable = snapshot.hasError;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextFormField(
              key: const ValueKey('exchange-momo-number-field'),
              style: AppTextStyles.labelL
                  .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
              controller: widget.accountController,
              enabled: widget.enabled,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                floatingLabelBehavior: FloatingLabelBehavior.always,
                labelText: 'Mobile money number',
                hintText: '024 123 4567',
              ),
              onChanged: (_) {
                _clearResolvedName();
                _scheduleNameCheck();
              },
              onEditingComplete: _resolveMomoRecipient,
              validator: (value) {
                try {
                  normalizeGhanaMobileNumber(value ?? '');
                  return null;
                } on FormatException catch (error) {
                  return error.message;
                }
              },
            ),
            const SizedBox(height: AppSpacing.md),
            if (snapshot.connectionState == ConnectionState.waiting)
              const LinearProgressIndicator()
            else if (providerUnavailable)
              TextFormField(
                controller: widget.institutionController,
                enabled: widget.enabled,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  floatingLabelBehavior: FloatingLabelBehavior.always,
                  labelText: 'Mobile money network',
                  hintText: 'Enter the network name',
                ),
                validator: (value) => value?.trim().isNotEmpty == true
                    ? null
                    : 'Enter the mobile money network.',
              )
            else
              DropdownButtonFormField<String>(
                initialValue: _selectedOperator?.slug,
                isExpanded: true,
                decoration: const InputDecoration(
                  floatingLabelBehavior: FloatingLabelBehavior.always,
                  labelText: 'Mobile money network',
                ),
                items: operators
                    .map((operator) => DropdownMenuItem<String>(
                          value: operator.slug,
                          child: Text(operator.name),
                        ))
                    .toList(growable: false),
                onChanged: widget.enabled
                    ? (slug) {
                        final selected = operators.firstWhere(
                          (operator) => operator.slug == slug,
                        );
                        setState(() => _selectedOperator = selected);
                        widget.institutionController.text = selected.name;
                        _clearResolvedName();
                        _scheduleNameCheck();
                      }
                    : null,
                validator: (_) => _selectedOperator == null &&
                        !(widget.allowExistingBankValue &&
                            widget.institutionController.text.trim().isNotEmpty)
                    ? 'Choose the mobile money network.'
                    : null,
              ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              providerUnavailable
                  ? 'Automatic name check unavailable. Enter the recipient name for manual review.'
                  : 'We check the recipient name with the provider after you choose a network.',
              style: AppTextStyles.bodyS,
            ),
            const SizedBox(height: AppSpacing.sm),
            if (!providerUnavailable && _selectedOperator != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: widget.enabled && !_resolving
                      ? _resolveMomoRecipient
                      : null,
                  icon: _resolving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.verified_user_outlined),
                  label: Text(
                      _resolving ? 'Checking name…' : 'Check recipient name'),
                ),
              ),
            if (_resolutionError != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                _resolutionError!,
                style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
              ),
            ],
            const SizedBox(height: AppSpacing.xs),
            _destinationNameField(
              readOnly: _resolvedInput != null,
              helper: _resolvedInput != null
                  ? 'Recipient name confirmed.'
                  : 'Enter the recipient name if automatic verification is unavailable.',
              suffix: _resolvedInput != null
                  ? Icon(Icons.verified_rounded, color: AppColors.success)
                  : null,
            ),
          ],
        );
      },
    );
  }

  Widget _destinationNameField({
    bool readOnly = false,
    required String helper,
    Widget? suffix,
  }) {
    return TextFormField(
      controller: widget.nameController,
      style: AppTextStyles.labelL
          .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      enabled: widget.enabled,
      readOnly: readOnly,
      textInputAction: TextInputAction.done,
      decoration: InputDecoration(
        floatingLabelBehavior: FloatingLabelBehavior.always,
        labelText: 'Recipient name',
        hintText: 'Full name',
        helperText: helper.isEmpty ? null : helper,
        helperMaxLines: 3,
        suffixIcon: suffix,
      ),
      validator: (value) {
        final name = value?.trim() ?? '';
        return name.length >= 2 && name.length <= 120
            ? null
            : 'Enter the destination name.';
      },
    );
  }
}

class _GhanaBankSearchField extends StatelessWidget {
  final TextEditingController controller;
  final GhanaBankOption? selected;
  final bool enabled;
  final bool allowExistingValue;
  final ValueChanged<GhanaBankOption?> onSelected;
  const _GhanaBankSearchField(
      {required this.controller,
      required this.selected,
      required this.enabled,
      required this.allowExistingValue,
      required this.onSelected});

  Future<void> _chooseBank(BuildContext context) async {
    final bank = await showModalBottomSheet<GhanaBankOption>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) {
        var query = '';
        return StatefulBuilder(builder: (context, setSheetState) {
          final banks = searchGhanaBanks(query);
          return Padding(
            padding: EdgeInsets.only(
                bottom: MediaQuery.viewInsetsOf(context).bottom),
            child: SizedBox(
                height: MediaQuery.sizeOf(context).height * .65,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: Text('Choose your bank',
                              style: AppTextStyles.headingL)),
                      Padding(
                          padding: const EdgeInsets.all(24),
                          child: TextField(
                            key: const ValueKey('exchange-bank-search'),
                            decoration: const InputDecoration(
                                hintText: 'Search Ghana banks',
                                prefixIcon: Icon(Icons.search_rounded)),
                            onChanged: (value) =>
                                setSheetState(() => query = value),
                          )),
                      Expanded(
                          child: banks.isEmpty
                              ? const Center(
                                  child: Text(
                                      'No matching bank. Try another name.'))
                              : ListView.builder(
                                  itemCount: banks.length,
                                  itemBuilder: (context, index) {
                                    final option = banks[index];
                                    return ListTile(
                                      contentPadding:
                                          const EdgeInsets.symmetric(
                                              horizontal: 24, vertical: 6),
                                      leading: _GhanaBankMark(bank: option),
                                      title: Text(option.name,
                                          style: AppTextStyles.labelM),
                                      trailing: selected == option
                                          ? const Icon(Icons.check_rounded)
                                          : null,
                                      onTap: () =>
                                          Navigator.pop(context, option),
                                    );
                                  })),
                    ])),
          );
        });
      },
    );
    if (bank != null) onSelected(bank);
  }

  @override
  Widget build(BuildContext context) => TextFormField(
        key: const ValueKey('exchange-bank-field'),
        style: AppTextStyles.labelL
            .copyWith(fontSize: 18, fontWeight: FontWeight.w600),
        controller: controller,
        enabled: enabled,
        readOnly: true,
        onTap: enabled ? () => _chooseBank(context) : null,
        decoration: InputDecoration(
          floatingLabelBehavior: FloatingLabelBehavior.always,
          labelText: 'Bank',
          hintText: 'Choose your bank',
          prefixIcon: selected == null
              ? const Icon(Icons.account_balance_outlined)
              : Padding(
                  padding: const EdgeInsets.all(10),
                  child: _GhanaBankMark(bank: selected!)),
          suffixIcon: const Icon(Icons.keyboard_arrow_down_rounded),
        ),
        validator: (_) => selected == null && !allowExistingValue
            ? 'Choose a bank from the list.'
            : null,
      );
}

class _NigerianBankSearchField extends StatelessWidget {
  final List<ManualNigerianBankOption> banks;
  final ManualNigerianBankOption? selected;
  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<ManualNigerianBankOption> onSelected;

  const _NigerianBankSearchField({
    required this.banks,
    required this.selected,
    required this.controller,
    required this.enabled,
    required this.onSelected,
  });

  Future<void> _chooseBank(BuildContext context) async {
    final bank = await showModalBottomSheet<ManualNigerianBankOption>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) {
        var query = '';
        return StatefulBuilder(builder: (context, setSheetState) {
          final normalizedQuery = query.trim().toLowerCase();
          final matches = normalizedQuery.isEmpty
              ? banks
              : banks
                  .where((bank) =>
                      bank.name.toLowerCase().contains(normalizedQuery) ||
                      bank.code.contains(normalizedQuery))
                  .toList(growable: false);
          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * .65,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      'Choose Nigerian bank',
                      style: AppTextStyles.headingL,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: TextField(
                      key: const ValueKey('exchange-nigerian-bank-search'),
                      autofocus: true,
                      decoration: const InputDecoration(
                        hintText: 'Search banks',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                      onChanged: (value) => setSheetState(() => query = value),
                    ),
                  ),
                  Expanded(
                    child: matches.isEmpty
                        ? const Center(
                            child: Text('No matching bank found.'),
                          )
                        : ListView.separated(
                            itemCount: matches.length,
                            separatorBuilder: (_, __) => const Divider(
                              height: 1,
                              indent: 24,
                              endIndent: 24,
                            ),
                            itemBuilder: (context, index) {
                              final option = matches[index];
                              return ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 24,
                                  vertical: 6,
                                ),
                                leading: CircleAvatar(
                                  backgroundColor:
                                      AppColors.primary.withValues(alpha: .1),
                                  child: Icon(
                                    Icons.account_balance_rounded,
                                    color: AppColors.primary,
                                  ),
                                ),
                                title: Text(
                                  option.name,
                                  style: AppTextStyles.labelM,
                                ),
                                trailing: selected?.code == option.code
                                    ? Icon(
                                        Icons.check_circle_rounded,
                                        color: AppColors.success,
                                      )
                                    : null,
                                onTap: () => Navigator.pop(context, option),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          );
        });
      },
    );
    if (bank != null) onSelected(bank);
  }

  @override
  Widget build(BuildContext context) => TextFormField(
        key: const ValueKey('exchange-nigerian-bank-field'),
        controller: controller,
        enabled: enabled,
        readOnly: true,
        style: AppTextStyles.labelL.copyWith(
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
        onTap: enabled ? () => _chooseBank(context) : null,
        decoration: const InputDecoration(
          floatingLabelBehavior: FloatingLabelBehavior.always,
          labelText: 'Nigerian bank',
          hintText: 'Choose a bank',
          prefixIcon: Icon(Icons.account_balance_outlined),
          suffixIcon: Icon(Icons.keyboard_arrow_down_rounded),
        ),
        validator: (_) => selected == null ? 'Choose a bank.' : null,
      );
}

class _NigerianBankLoadingField extends StatelessWidget {
  const _NigerianBankLoadingField();

  @override
  Widget build(BuildContext context) => const TextField(
        enabled: false,
        decoration: InputDecoration(
          floatingLabelBehavior: FloatingLabelBehavior.always,
          labelText: 'Nigerian bank',
          hintText: 'Loading banks…',
          prefixIcon: Padding(
            padding: EdgeInsets.all(14),
            child: SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
      );
}

class _NigerianBankLoadError extends StatelessWidget {
  final VoidCallback onRetry;

  const _NigerianBankLoadError({required this.onRetry});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.error.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.error.withValues(alpha: .22)),
        ),
        child: Row(
          children: [
            Icon(Icons.cloud_off_rounded, color: AppColors.error),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                'Banks could not be loaded. Check your connection and retry.',
                style: AppTextStyles.bodyS,
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
}

class _GhanaBankMark extends StatelessWidget {
  final GhanaBankOption bank;

  const _GhanaBankMark({required this.bank});

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: 20,
      backgroundColor: Color(bank.markColorValue),
      child: Text(bank.monogram,
          style: const TextStyle(
              color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
    );
    final asset = bank.logoAsset;
    return ExcludeSemantics(
        child: Container(
      width: 44,
      height: 44,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(10)),
      child: asset == null
          ? fallback
          : asset.endsWith('.svg')
              ? SvgPicture.asset(asset,
                  fit: BoxFit.contain, placeholderBuilder: (_) => fallback)
              : Image.asset(asset,
                  fit: BoxFit.contain,
                  cacheWidth: 128,
                  errorBuilder: (_, __, ___) => fallback),
    ));
  }
}

class _DirectionChoice extends StatelessWidget {
  final String currency;
  final bool enabled;
  final VoidCallback? onTap;
  const _DirectionChoice(
      {required this.currency, required this.enabled, this.onTap});

  @override
  Widget build(BuildContext context) {
    final naira = currency == 'NGN';
    final ink = naira ? const Color(0xFF124B38) : const Color(0xFF653918);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Semantics(
        button: true,
        enabled: enabled,
        child: Material(
          borderRadius: BorderRadius.circular(16),
          clipBehavior: Clip.antiAlias,
          child: Ink(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: naira
                    ? const [Color(0xFFE2F3E8), Color(0xFFB9DFD0)]
                    : const [Color(0xFFFFF0CE), Color(0xFFF1CEAB)],
              ),
            ),
            child: InkWell(
              onTap: enabled ? onTap : null,
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                child: Row(children: [
                  ExcludeSemantics(
                      child: SizedBox(
                    width: 62,
                    child: Stack(children: [
                      Text(naira ? '🇳🇬' : '🇬🇭',
                          style: const TextStyle(fontSize: 29)),
                      Padding(
                          padding: const EdgeInsets.only(left: 26, top: 18),
                          child: Text(naira ? '🇬🇭' : '🇳🇬',
                              style: const TextStyle(fontSize: 25))),
                    ]),
                  )),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(naira ? 'Naira to cedis' : 'Cedis to naira',
                          style: AppTextStyles.labelM.copyWith(
                              color: ink, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text(
                          enabled
                              ? (naira ? 'Nigeria → Ghana' : 'Ghana → Nigeria')
                              : 'Not available yet',
                          style: AppTextStyles.bodyS.copyWith(color: ink)),
                    ],
                  )),
                  const SizedBox(width: 8),
                  Icon(
                      enabled
                          ? Icons.arrow_forward_rounded
                          : Icons.schedule_rounded,
                      color: ink,
                      size: 20),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SettlementChoice extends StatelessWidget {
  final ManualSettlementMode mode;
  final bool selected;
  final bool showDescription;
  final bool enabled;
  final VoidCallback onTap;

  const _SettlementChoice({
    required this.mode,
    required this.selected,
    this.showDescription = false,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final color = selected ? AppColors.primary : AppColors.border;
    return Semantics(
      selected: selected,
      button: true,
      label: mode.label,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: double.infinity,
          constraints: BoxConstraints(minHeight: showDescription ? 96 : 56),
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 12,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primary.withValues(alpha: 0.07)
                : AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: color, width: selected ? 1.5 : 1),
          ),
          child: Row(
            children: [
              Icon(
                  switch (mode) {
                    ManualSettlementMode.wallet =>
                      Icons.account_balance_wallet_outlined,
                    ManualSettlementMode.bank => Icons.account_balance_outlined,
                    ManualSettlementMode.momo => Icons.phone_iphone_rounded,
                  },
                  size: 20,
                  color:
                      selected ? AppColors.primary : AppColors.textSecondary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(mode.label,
                          style: AppTextStyles.labelM.copyWith(
                              fontSize: showDescription ? 18 : null,
                              fontWeight: FontWeight.w700,
                              color: selected
                                  ? AppColors.primary
                                  : AppColors.textPrimary)),
                      if (showDescription) ...[
                        const SizedBox(height: 6),
                        Text(
                            mode == ManualSettlementMode.bank
                                ? 'Receive in a Ghana bank account'
                                : mode == ManualSettlementMode.momo
                                    ? 'Receive in a mobile money wallet'
                                    : 'Receive in your TrustPay wallet',
                            style: AppTextStyles.bodyS),
                      ],
                    ]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineExchangeMessage extends StatelessWidget {
  final String message;

  const _InlineExchangeMessage({required this.message});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline_rounded, color: AppColors.error, size: 19),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExchangeLoadingView extends StatelessWidget {
  const _ExchangeLoadingView();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return const Center(child: CircularProgressIndicator());
  }
}

class _ExchangeLoadError extends StatelessWidget {
  final Future<void> Function() onRetry;

  const _ExchangeLoadError({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.cloud_off_rounded,
                size: 42, color: AppColors.textSecondary),
            const SizedBox(height: AppSpacing.md),
            Text('Exchange could not load.', style: AppTextStyles.headingM),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'We could not retrieve exchange details. Try again shortly. If this continues, contact support before sending money.',
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
