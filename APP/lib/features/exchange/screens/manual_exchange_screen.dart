import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
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
  GhanaBankOption? _selectedGhanaBank;
  bool _settlementModeChosen = false;
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
      final preserveReceivingSelection = _step == 2 &&
          _settlementModeChosen &&
          modes.contains(_settlementMode);
      if (!modes.contains(_settlementMode)) _settlementMode = modes.first;
      if (!preserveReceivingSelection) {
        _settlementModeChosen = modes.length <= 1;
      }
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
                                            _selectedGhanaBank = null;
                                            _settlementModeChosen = page.config
                                                    .deliveryModesFor(currency)
                                                    .length <=
                                                1;
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
                                        _selectedGhanaBank = null;
                                        _settlementModeChosen = page.config
                                                .deliveryModesFor(
                                                    _sourceCurrency)
                                                .length <=
                                            1;
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
                              selectedGhanaBank: _selectedGhanaBank,
                              settlementModeChosen: _settlementModeChosen,
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
                                  _settlementModeChosen = true;
                                  _selectedGhanaBank = null;
                                  _institutionController.clear();
                                  _accountController.clear();
                                  _nameController.clear();
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
  final GhanaBankOption? selectedGhanaBank;
  final bool settlementModeChosen;
  final List<ManualSettlementMode> receivingModes;
  final bool isSubmitting;
  final bool hasPendingCreate;
  final String? message;
  final ValueChanged<ManualSettlementMode> onSettlementModeChanged;
  final ValueChanged<GhanaBankOption?> onGhanaBankChanged;
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
    required this.message,
    required this.onSettlementModeChanged,
    required this.onGhanaBankChanged,
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
                      ] else if (settlementModeChosen) ...[
                        _ExternalDestinationForm(
                          service: service,
                          mode: settlementMode,
                          institutionController: institutionController,
                          accountController: accountController,
                          nameController: nameController,
                          selectedBank: selectedGhanaBank,
                          enabled: canEdit,
                          allowExistingBankValue: hasPendingCreate,
                          onBankChanged: onGhanaBankChanged,
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
          ],
        ),
      ),
    );
  }
}

class _ExternalDestinationForm extends StatefulWidget {
  final ManualExchangeService service;
  final ManualSettlementMode mode;
  final TextEditingController institutionController;
  final TextEditingController accountController;
  final TextEditingController nameController;
  final GhanaBankOption? selectedBank;
  final bool enabled;
  final ValueChanged<GhanaBankOption?> onBankChanged;
  final bool allowExistingBankValue;

  const _ExternalDestinationForm({
    required this.service,
    required this.mode,
    required this.institutionController,
    required this.accountController,
    required this.nameController,
    required this.selectedBank,
    required this.enabled,
    required this.allowExistingBankValue,
    required this.onBankChanged,
  });

  @override
  State<_ExternalDestinationForm> createState() =>
      _ExternalDestinationFormState();
}

class _ExternalDestinationFormState extends State<_ExternalDestinationForm> {
  Future<List<ManualGhanaMomoOperator>>? _operatorsFuture;
  ManualGhanaMomoOperator? _selectedOperator;
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
    if (oldWidget.mode != widget.mode) _prepareMode();
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
    _resolutionError = null;
    _resolvedInput = null;
    if (widget.mode == ManualSettlementMode.momo) {
      final future = widget.service.fetchGhanaMomoOperators();
      _operatorsFuture = future;
      future.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    } else {
      _operatorsFuture = null;
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
          'Name lookup is not available for bank accounts yet. Enter the name shown by the recipient’s bank.',
          style: AppTextStyles.bodyS,
        ),
        const SizedBox(height: AppSpacing.sm),
        _destinationNameField(
          helper: '',
        ),
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
