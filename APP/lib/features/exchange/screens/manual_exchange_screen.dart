import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
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
  late Future<List<ManualExchangeOrder>> _ordersFuture;

  final _formKey = GlobalKey<FormState>();
  final _scrollController = ScrollController();
  final _amountController = TextEditingController();
  final _institutionController = TextEditingController();
  final _accountController = TextEditingController();
  final _nameController = TextEditingController();

  ManualSettlementMode _settlementMode = ManualSettlementMode.wallet;
  String _sourceCurrency = 'GHS';
  int _step = 0;
  bool _isCreating = false;
  bool _isRefreshing = false;
  bool _pendingDraftRestored = false;
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
    _ordersFuture = _loadOrders();
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

  Future<_ManualExchangePageData> _loadPage() async {
    final results = await Future.wait<dynamic>([
      _service.fetchConfig(),
      _loadPendingCreate(),
    ]);
    final pendingCreate = results[1] as ManualExchangeAttempt?;
    final config = results[0] as ManualExchangeConfig;
    if (pendingCreate != null) {
      _restorePendingCreate(pendingCreate);
    } else {
      if (!config.supportedSourceCurrencies.contains(_sourceCurrency)) {
        _sourceCurrency = config.sourceCurrency;
      }
      final modes = config.deliveryModesFor(_sourceCurrency);
      if (modes.isEmpty) {
        throw const FormatException(
            'No receiving method is available for this exchange.');
      }
      if (!modes.contains(_settlementMode)) _settlementMode = modes.first;
    }
    return _ManualExchangePageData(
      config: results[0] as ManualExchangeConfig,
      orders: const [],
      pendingCreate: pendingCreate,
    );
  }

  Future<List<ManualExchangeOrder>> _loadOrders() {
    final future = _service.listOrders();
    // Observe early errors while configuration is still loading. The original
    // future retains the error for the history section's retry state.
    future.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return future;
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
      _ordersFuture = _loadOrders();
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
      context.push(
        AppRoutes.exchangeOrderFor(order.id),
        extra: order,
      );
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
      final limitGate = kycActionLimitGate(
          overview, _amountController.text.trim(), _sourceCurrency);
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
              : 'Activate Tier 1 to exchange within your account limits.');
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
      final values = await Future.wait<dynamic>([
        _securityService.getConfig(),
        _authService.getTransactionPinStatus(),
      ]);
      final device = values[0] as TransactionSecurityConfig;
      final server = values[1] as TransactionPinServerStatus;

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
          builder: (_) => TransactionPinScreen.verify(
            pinLength: server.pinLength ?? device.pinLength,
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
    return Scaffold(
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
                      showBackButton: _step > 0
                          ? !_isCreating && page.pendingCreate == null
                          : widget.showBackButton,
                      onBack: _step == 0
                          ? null
                          : () {
                              if (_isCreating ||
                                  page.pendingCreate != null ||
                                  _step <= 0) {
                                return;
                              }
                              setState(() => _step--);
                              _centerStep();
                            },
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
                        Text(
                            _step == 0
                                ? 'Choose your exchange'
                                : _step == 1
                                    ? (_sourceCurrency == 'GHS'
                                        ? 'Cedis to naira'
                                        : 'Naira to cedis')
                                    : (_sourceCurrency == 'NGN'
                                        ? 'Receive cedis'
                                        : 'Receive naira'),
                            style: AppTextStyles.headingXL),
                        if (_step == 2) ...[
                          const SizedBox(height: 6),
                          Text(
                              _sourceCurrency == 'NGN'
                                  ? 'Choose where to receive your cedis.'
                                  : 'Your naira goes to your TrustPay wallet.',
                              style: AppTextStyles.bodyM),
                        ],
                        if (_step == 1) ...[
                          const SizedBox(height: 6),
                          Text('Enter the amount you want to change.',
                              style: AppTextStyles.bodyM),
                        ],
                        const SizedBox(height: AppSpacing.md),
                        if (page.pendingCreate != null) ...[
                          const _PendingExchangeCard(),
                          const SizedBox(height: AppSpacing.md),
                        ],
                        if (!page.config.enabled)
                          _ExchangeDisabledCard(
                              onRetry: _isRefreshing ? null : _refresh)
                        else ...[
                          if (_step == 0) ...[
                            for (final currency in const ['GHS', 'NGN'])
                              _DirectionChoice(
                                currency: currency,
                                enabled: page.config.canExchangeFrom(currency),
                                onTap: page.config.canExchangeFrom(currency)
                                    ? () => setState(() {
                                          if (_sourceCurrency != currency) {
                                            _amountController.clear();
                                            _institutionController.clear();
                                            _accountController.clear();
                                            _nameController.clear();
                                            _settlementMode = page.config
                                                .deliveryModesFor(currency)
                                                .first;
                                          }
                                          _sourceCurrency = currency;
                                          _step = 1;
                                          _formMessage = null;
                                          _centerStep();
                                        })
                                    : null,
                              ),
                          ] else
                            _ExchangeForm(
                              service: _service,
                              onSwap: !(page.config.canExchangeFrom('GHS') &&
                                      page.config.canExchangeFrom('NGN'))
                                  ? null
                                  : () {
                                      setState(() {
                                        _sourceCurrency =
                                            _sourceCurrency == 'NGN'
                                                ? 'GHS'
                                                : 'NGN';
                                        _settlementMode = page.config
                                            .deliveryModesFor(_sourceCurrency)
                                            .first;
                                        _amountController.clear();
                                        _institutionController.clear();
                                        _accountController.clear();
                                        _nameController.clear();
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
                              receivingModes: page.pendingCreate != null
                                  ? [_settlementMode]
                                  : page.config
                                      .deliveryModesFor(_sourceCurrency),
                              isSubmitting: _isCreating,
                              hasPendingCreate: page.pendingCreate != null,
                              message: _formMessage,
                              onSettlementModeChanged: (mode) {
                                setState(() {
                                  _settlementMode = mode;
                                  _formMessage = null;
                                });
                              },
                              onSubmit: _createOrder,
                            ),
                        ],
                        FutureBuilder<List<ManualExchangeOrder>>(
                          future: _ordersFuture,
                          builder: (context, orders) {
                            if (orders.hasError) {
                              return TextButton(
                                  onPressed: _refresh,
                                  child: const Text(
                                      'History could not load · Retry'));
                            }
                            if (!orders.hasData) {
                              return const Padding(
                                padding: EdgeInsets.all(16),
                                child: Text('Loading exchange history…'),
                              );
                            }
                            if (orders.data!.isEmpty) {
                              return const SizedBox.shrink();
                            }
                            return Padding(
                              padding:
                                  const EdgeInsets.only(top: AppSpacing.xl),
                              child: _OrdersSection(orders: orders.data!),
                            );
                          },
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
    );
  }
}

class _ManualExchangePageData {
  final ManualExchangeConfig config;
  final List<ManualExchangeOrder> orders;
  final ManualExchangeAttempt? pendingCreate;

  const _ManualExchangePageData({
    required this.config,
    required this.orders,
    required this.pendingCreate,
  });
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
  final List<ManualSettlementMode> receivingModes;
  final bool isSubmitting;
  final bool hasPendingCreate;
  final String? message;
  final ValueChanged<ManualSettlementMode> onSettlementModeChanged;
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
    required this.receivingModes,
    required this.isSubmitting,
    required this.hasPendingCreate,
    required this.message,
    required this.onSettlementModeChanged,
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
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (hasPendingCreate &&
                          ((sourceCurrency == 'GHS' &&
                                  settlementMode !=
                                      ManualSettlementMode.wallet) ||
                              (sourceCurrency == 'NGN' &&
                                  settlementMode ==
                                      ManualSettlementMode.wallet))) ...[
                        Text('Recover your earlier request',
                            style: AppTextStyles.headingM),
                        const SizedBox(height: 16),
                      ],
                      if (receivingModes.length > 1) ...[
                        LayoutBuilder(builder: (context, constraints) {
                          final stack = constraints.maxWidth < 320 ||
                              MediaQuery.textScalerOf(context).scale(1) > 1.3;
                          final choices = receivingModes
                              .map((mode) => _SettlementChoice(
                                  mode: mode,
                                  selected: settlementMode == mode,
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
                      if (settlementMode == ManualSettlementMode.wallet) ...[
                        Icon(Icons.account_balance_wallet_outlined,
                            color: AppColors.primary, size: 28),
                        const SizedBox(height: 12),
                        Text(
                            sourceCurrency == 'GHS'
                                ? 'Naira goes to your TrustPay wallet'
                                : 'Cedis go to your TrustPay wallet',
                            style: AppTextStyles.labelL),
                        const SizedBox(height: 8),
                        Text(
                            sourceCurrency == 'GHS'
                                ? 'We add your naira after your cedi payment is confirmed.'
                                : 'We add your cedis after your naira payment is confirmed.',
                            style: AppTextStyles.bodyM),
                      ] else ...[
                        TextFormField(
                          controller: institutionController,
                          enabled: canEdit,
                          textInputAction: TextInputAction.next,
                          decoration: InputDecoration(
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            labelText:
                                settlementMode == ManualSettlementMode.bank
                                    ? 'Bank name'
                                    : 'Provider',
                            hintText:
                                settlementMode == ManualSettlementMode.bank
                                    ? (sourceCurrency == 'NGN'
                                        ? 'e.g. GCB Bank'
                                        : 'e.g. Zenith Bank')
                                    : 'e.g. MTN MoMo',
                          ),
                          validator: (value) =>
                              settlementMode == ManualSettlementMode.wallet ||
                                      (value?.trim().isNotEmpty ?? false)
                                  ? null
                                  : 'Enter the institution name.',
                        ),
                        const SizedBox(height: AppSpacing.md),
                        TextFormField(
                          controller: accountController,
                          enabled: canEdit,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.next,
                          decoration: InputDecoration(
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                            labelText:
                                settlementMode == ManualSettlementMode.bank
                                    ? 'Account number'
                                    : 'MoMo number',
                            hintText:
                                settlementMode == ManualSettlementMode.bank
                                    ? 'Enter account number'
                                    : '+233 ...',
                          ),
                          validator: (value) =>
                              settlementMode == ManualSettlementMode.wallet ||
                                      (value?.trim().isNotEmpty ?? false)
                                  ? null
                                  : 'Enter the destination account.',
                        ),
                        const SizedBox(height: AppSpacing.md),
                        TextFormField(
                          controller: nameController,
                          enabled: canEdit,
                          textInputAction: TextInputAction.done,
                          decoration: const InputDecoration(
                            labelText: 'Recipient name',
                            hintText: 'Full name',
                            floatingLabelBehavior: FloatingLabelBehavior.always,
                          ),
                          validator: (value) =>
                              settlementMode == ManualSettlementMode.wallet ||
                                      (value?.trim().isNotEmpty ?? false)
                                  ? null
                                  : 'Enter the destination name.',
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
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline_rounded,
                    size: 18, color: AppColors.textSecondary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    step == 1
                        ? 'Your PIN protects this exchange.'
                        : 'Check the receiving details before you continue.',
                    style: AppTextStyles.bodyS,
                  ),
                ),
              ],
            ),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.md),
              _InlineExchangeMessage(message: message!),
            ],
            const SizedBox(height: AppSpacing.lg),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                    minimumSize: const Size(double.infinity, 54),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 14),
                    textStyle: AppTextStyles.labelL),
                onPressed: isSubmitting ? null : onSubmit,
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
        ),
      ),
    );
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
  final bool enabled;
  final VoidCallback onTap;

  const _SettlementChoice({
    required this.mode,
    required this.selected,
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
          constraints: const BoxConstraints(minHeight: 52),
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
                child: Text(mode.label,
                    style: AppTextStyles.labelM.copyWith(
                      fontWeight: FontWeight.w700,
                      color:
                          selected ? AppColors.primary : AppColors.textPrimary,
                    )),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OrdersSection extends StatelessWidget {
  final List<ManualExchangeOrder> orders;

  const _OrdersSection({required this.orders});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
                child: Text('Your exchange orders',
                    style: AppTextStyles.headingM)),
            Text('${orders.length}', style: AppTextStyles.bodyS),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        ...orders.map(
          (order) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: _OrderListTile(order: order),
          ),
        ),
      ],
    );
  }
}

class _OrderListTile extends StatelessWidget {
  final ManualExchangeOrder order;

  const _OrderListTile({required this.order});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: InkWell(
        onTap: () => context.push(
          AppRoutes.exchangeOrderFor(order.id),
          extra: order,
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.currency_exchange_rounded,
                    color: AppColors.primary),
              ),
              const SizedBox(width: AppSpacing.sm + 2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(order.reference.isEmpty ? order.id : order.reference,
                        style: AppTextStyles.labelM),
                    const SizedBox(height: 2),
                    Text(
                      '${order.sourceCurrency} ${order.amount} → ${order.targetCurrency} ${order.targetAmount}',
                      style: AppTextStyles.bodyS,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Flexible(
                child: Text(
                  manualExchangeStatusLabel(order.status),
                  style: AppTextStyles.labelS.copyWith(
                    color: _statusColor(order.status),
                  ),
                  textAlign: TextAlign.end,
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
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
