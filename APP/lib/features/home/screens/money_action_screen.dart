import '../../ghana/ghana_money_screen.dart';
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';
import 'package:crypto/crypto.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/router/app_router.dart';
import '../../../core/money/money_value.dart';
import '../../../core/money/amount_words.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/api_client.dart';
import '../../../services/home_data_service.dart';
import '../../../services/kyc_service.dart';
import '../widgets/kyc_status_presenter.dart';
import '../../wallet/widgets/account_setup_presenter.dart';
import '../../../services/payment_attempt_store.dart';
import '../../../services/payment_recovery_service.dart';
import '../../../services/paystack_checkout_recovery.dart';
import '../../../services/transaction_security_service.dart';
import '../../../services/vtu_service.dart';
import '../../../services/wallet_service.dart';
import '../../security/screens/transaction_security_screen.dart';
import '../widgets/vtu_phone.dart';
import '../widgets/transfer_widgets.dart';
import '../widgets/transfer_review_dialog.dart';
import '../widgets/payment_review_sheet.dart';
import '../widgets/vtu_purchase_status_view.dart';
import '../widgets/vtu_purchase_widgets.dart';
import 'extended_vtu_form.dart';
import 'transfer_receipt_screen.dart';

enum MoneyActionKind {
  fund,
  send,
  withdraw,
  exchange,
  airtime,
  data,
  cable,
  electricity,
}

enum MoneyActionFeedbackType { info, success, error, warning }

/// Prefill payload for the withdraw flow when it is opened from a saved
/// beneficiary (e.g. tapping a recent recipient on the dashboard).
class WithdrawPrefill {
  final String beneficiaryId;
  final String bankCode;
  final String bankName;
  final String accountName;
  final String accountNumberMasked;
  final String currency;

  const WithdrawPrefill({
    required this.beneficiaryId,
    required this.bankCode,
    required this.bankName,
    required this.accountName,
    required this.accountNumberMasked,
    this.currency = 'NGN',
  });
}

class MoneyActionScreen extends StatefulWidget {
  final MoneyActionKind kind;
  final bool showBackButton;
  final ApiClient? apiClient;
  final TransactionSecurityService? transactionSecurityService;
  final WithdrawPrefill? withdrawPrefill;
  final PaymentAttemptStore? paymentAttemptStore;
  final PaymentRecoveryService? paymentRecoveryService;
  final String? paymentRecoveryUserId;
  final PaystackCheckoutAttemptStore? paystackCheckoutAttemptStore;

  const MoneyActionScreen({
    super.key,
    required this.kind,
    this.showBackButton = true,
    this.apiClient,
    this.transactionSecurityService,
    this.withdrawPrefill,
    this.paymentAttemptStore,
    this.paymentRecoveryService,
    this.paymentRecoveryUserId,
    this.paystackCheckoutAttemptStore,
  });

  @override
  State<MoneyActionScreen> createState() => _MoneyActionScreenState();
}

class _MoneyActionScreenState extends State<MoneyActionScreen> {
  late final ApiClient _apiClient;
  late final HomeDataService _homeDataService;
  late final AuthService _authService;
  Future<TransactionPinServerStatus>? _pinStatusRequest;
  DateTime? _pinStatusRequestedAt;
  late final TransactionSecurityService _transactionSecurityService;
  late final PaymentAttemptStore _paymentAttemptStore;
  late final PaymentRecoveryService _paymentRecoveryService;
  late final PaystackCheckoutAttemptStore _paystackCheckoutAttemptStore;
  late final PaystackCheckoutRecoveryService _paystackCheckoutRecoveryService;
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _accountNumberController = TextEditingController();
  final _accountNameController = TextEditingController();
  final _bankCodeController = TextEditingController();
  final _withdrawBankController = TextEditingController();
  final _withdrawBankFocusNode = FocusNode();
  final _sendAmountFocusNode = FocusNode(debugLabel: 'send amount');
  final _sendRecipientFocusNode = FocusNode(debugLabel: 'send recipient');
  final _sendNoteFocusNode = FocusNode(debugLabel: 'send note');
  final _noteController = TextEditingController();
  final _cablePhoneController = TextEditingController();
  final _electricityPhoneController = TextEditingController();
  final _attemptIdempotency = MoneyAttemptIdempotency();
  final _submissionGate = MoneySubmissionGate();
  late final VtuService _vtuService;
  late final WalletService _walletService;
  PaymentAttempt? _activeVtuRecoveryAttempt;
  String? _vtuStatusError;
  String? _paymentRecoveryUser;
  List<PaymentAttempt> _unresolvedPaymentAttempts = const [];
  bool _isLoadingPaymentRecovery = false;
  String? _paymentRecoveryError;

  static const _countryLabels = {
    'NG': 'Nigeria',
    'GH': 'Ghana',
    'KE': 'Kenya',
    'ZA': 'South Africa',
    'US': 'United States',
    'GB': 'United Kingdom',
  };
  static const _dataCountryOptions = ['NG', 'GH', 'KE', 'ZA', 'US', 'GB'];
  static const _electricityCountryOptions = ['NG', 'GH', 'KE', 'ZA'];
  static const _enabledAirtimeCountries = <String>{};
  static const _enabledDataCountries = {'NG'};
  static const _enabledElectricityCountries = {'NG'};

  String _currency = 'NGN';
  String _exchangeFrom = 'GHS';
  String _exchangeTo = 'NGN';
  // New withdrawals are routed through the server-selected Paystack adapter.
  // Historical Monnify transfers remain provider-tagged in the ledger and are
  // never retried through this new flow.
  final String _provider = 'paystack';
  String _vtuProvider = '';
  String _lastMobileRecipient = '';
  bool _networkSelectedManually = false;
  String? _returnCoreProvider;
  bool _returnCoreManual = false;
  int _vtuCatalogRequestId = 0;
  int _dataPackageRequestId = 0;
  int _cablePackageRequestId = 0;
  String _airtimeScope = 'local';
  String _airtimeCountryCode = 'GH';
  final _foreignCountryMenu = ValueNotifier<VtuCountryMenu?>(null);
  String _airtimeOperatorId = '';
  bool _isAirtimeAmountStep = false;
  bool _isDataPlanStep = false;
  bool _isDataPaymentStep = false;
  bool _isWithdrawalDetailsStep = false;
  String _dataCountryCode = 'NG';
  String _dataOperatorId = '';
  String _electricityCountryCode = 'NG';
  String _electricityBillerId = '';
  String _meterType = 'prepaid';
  final String _cableSubscriptionType = 'change';
  String? _dataPackageId;
  bool _isElectricityPaymentStep = false;
  bool _isVerifyingMeter = false;
  String? _meterCustomerName;
  String? _meterCustomerAddress;
  bool _meterVerifySkippable = false;
  bool _isCablePaymentStep = false;
  bool _isCableRecipientStep = false;
  bool _isVerifyingCard = false;
  String? _cableCustomerName;
  bool _cableVerifySkippable = false;
  String? _cablePackageId;
  List<VtuPackageOption> _cablePackages = const [];
  List<VtuProviderOption> _localCableProviders = const [];
  Timer? _orderPollTimer;
  int _orderPollAttempts = 0;
  Map<String, dynamic>? _extendedVtuPayload;
  Map<String, String> _extendedVtuReview = {};
  String? _message;
  MoneyActionFeedbackType _messageType = MoneyActionFeedbackType.info;
  bool _messageCanRetry = false;
  bool _isLoadingExchangeRate = false;
  String? _exchangeRateError;
  double? _exchangeEffectiveRate;
  int _exchangeRateRequestId = 0;
  bool _isLoadingFundingAccounts = false;
  bool _isLoadingWithdrawalBanks = false;
  bool _isResolvingWithdrawalAccount = false;
  bool _isRequestingFundingAccount = false;
  bool _fundingAccountConsent = false;
  bool _isLoadingPaymentCapabilities = false;
  bool _isOpeningPaystackCheckout = false;
  String? _checkoutMessage;
  static const _missingCheckoutLinkMessage =
      'This payment has no checkout link yet. Check its status; if it stays unresolved, contact support with the payment reference below before starting another payment.';
  String? _checkoutReference;
  String? _checkoutAmount;
  Uri? _checkoutAuthorizationUrl;
  String? _checkoutRecoveryUser;
  PaystackCheckoutAttempt? _checkoutAttempt;
  PaystackCapabilities? _paymentCapabilities;
  bool _paymentCapabilitiesFailed = false;
  String? _vtuCatalogMessage;
  String? _fundingAccountMessage;
  String? _withdrawalBankMessage;
  String? _withdrawalResolveError;
  String? _withdrawalAccountName;
  String? _pendingOrderReference;
  VtuOrderStatus? _trackedOrder;
  bool _isSubmitting = false;
  bool _isAwaitingTransferApproval = false;
  String? _lastInternalTransferReference;
  bool _isLoadingVtuPackages = false;
  bool _isLoadingVtuProviders = false;
  bool get _isLoadingVtuCatalog =>
      _isLoadingVtuPackages || _isLoadingVtuProviders;
  bool _isCheckingOrder = false;
  List<VtuProviderOption> _localAirtimeProviders = const [];
  List<VtuProviderOption> _localDataProviders = const [];
  List<VtuProviderOption> _localElectricityProviders = const [];
  final Map<String, List<VtuProviderOption>> _airtimeOperatorsByCountry =
      const {};
  final Map<String, List<VtuProviderOption>> _dataOperatorsByCountry = const {};
  final Map<String, List<VtuProviderOption>> _electricityBillersByCountry =
      const {};
  List<VtuPackageOption> _dataPackages = const [];
  List<_SettlementBankOption> _withdrawalBanks = const [];
  _SettlementBankOption? _selectedWithdrawalBank;
  HomeUser? _fundingUser;
  HomeVirtualAccountProvisioning? _fundingProvisioning;
  Timer? _withdrawalResolveDebounce;
  int _withdrawalResolveRequestId = 0;
  Timer? _recipientResolveDebounce;
  int _recipientResolveRequestId = 0;
  String? _verifiedBankInput;
  String? _verifiedRecipientInput;
  List<WalletData> _transferWallets = const [];
  bool _isLoadingTransferWallets = false;
  bool _isSendRecipientStep = false;
  int _transferWalletRequestId = 0;
  bool _isResolvingRecipient = false;
  String? _recipientResolveError;
  String? _resolvedRecipientName;
  String? _resolvedRecipientMasked;
  WithdrawPrefill? _activeBeneficiary;
  bool _paymentRecoveryLoaded = false;
  int _paymentRecoveryOutcomeVersion = 0;
  Future<void>? _paymentRecoveryLoadInFlight;

  @override
  void initState() {
    super.initState();
    _apiClient = widget.apiClient ?? ApiClient();
    _transactionSecurityService =
        widget.transactionSecurityService ?? TransactionSecurityService();
    _paymentAttemptStore = widget.paymentRecoveryService?.store ??
        widget.paymentAttemptStore ??
        PaymentAttemptStore();
    _paymentRecoveryService = widget.paymentRecoveryService ??
        PaymentRecoveryService(
          apiClient: _apiClient,
          store: _paymentAttemptStore,
        );
    _authService = AuthService(apiClient: _apiClient);
    if (widget.kind != MoneyActionKind.fund) {
      _preparedTransactionPinStatus()
          .then<void>((_) {}, onError: (Object _, StackTrace __) {});
    }
    _homeDataService = HomeDataService(apiClient: _apiClient);
    _vtuService = VtuService(apiClient: _apiClient);
    _walletService = WalletService(apiClient: _apiClient);
    _paystackCheckoutAttemptStore =
        widget.paystackCheckoutAttemptStore ?? PaystackCheckoutAttemptStore();
    _paystackCheckoutRecoveryService = PaystackCheckoutRecoveryService(
      store: _paystackCheckoutAttemptStore,
      initialize: ({required amount, required idempotencyKey}) =>
          _walletService.initializePaystackCheckout(
        amount: amount,
        idempotencyKey: idempotencyKey,
      ),
      verify: _walletService.verifyPaystackPayment,
    );
    final prefill = widget.withdrawPrefill;
    if (widget.kind == MoneyActionKind.withdraw &&
        prefill != null &&
        prefill.beneficiaryId.isNotEmpty) {
      _activeBeneficiary = prefill;
      _isWithdrawalDetailsStep = false;
      // Paystack bank withdrawals are NGN-only. Keep legacy prefill records
      // from selecting an unsupported GHS payout route.
      _currency = 'NGN';
    }
    _amountController.addListener(_onAmountChanged);
    _recipientController.addListener(_onRecipientChanged);
    _accountNumberController.addListener(_scheduleWithdrawalAccountResolve);
    _withdrawBankController.addListener(_onWithdrawalBankTyped);
    _loadFundingAccounts();
    _loadPaymentCapabilities();
    _loadExchangeRate();
    _loadVtuCatalogs();
    _loadWithdrawalBanks();
    _restorePaymentAttempts();
    if (_isTransferAction) {
      _loadTransferWallets();
      walletRefreshSignal.addListener(_onTransferWalletRefresh);
    }
  }

  List<HomeVirtualAccount> _fundingAccounts = const [];

  @override
  void dispose() {
    _foreignCountryMenu.dispose();
    walletRefreshSignal.removeListener(_onTransferWalletRefresh);
    _withdrawalResolveDebounce?.cancel();
    _recipientResolveDebounce?.cancel();
    _orderPollTimer?.cancel();
    _amountController.removeListener(_onAmountChanged);
    _recipientController.removeListener(_onRecipientChanged);
    _accountNumberController.removeListener(_scheduleWithdrawalAccountResolve);
    _amountController.dispose();
    _recipientController.dispose();
    _accountNumberController.dispose();
    _accountNameController.dispose();
    _withdrawBankController.removeListener(_onWithdrawalBankTyped);
    _withdrawBankController.dispose();
    _withdrawBankFocusNode.dispose();
    _sendAmountFocusNode.dispose();
    _sendRecipientFocusNode.dispose();
    _sendNoteFocusNode.dispose();
    _bankCodeController.dispose();
    _noteController.dispose();
    _cablePhoneController.dispose();
    _electricityPhoneController.dispose();
    super.dispose();
  }

  PaymentAttemptOperation? get _paymentOperation {
    switch (widget.kind) {
      case MoneyActionKind.send:
        return PaymentAttemptOperation.internalTransfer;
      case MoneyActionKind.withdraw:
        return PaymentAttemptOperation.withdrawal;
      case MoneyActionKind.airtime:
      case MoneyActionKind.data:
      case MoneyActionKind.cable:
      case MoneyActionKind.electricity:
        return PaymentAttemptOperation.vtuPurchase;
      case MoneyActionKind.fund:
      case MoneyActionKind.exchange:
        return null;
    }
  }

  List<PaymentAttempt> get _relevantUnresolvedPaymentAttempts {
    final operation = _paymentOperation;
    if (operation == null) return const [];
    return _unresolvedPaymentAttempts
        .where((attempt) => attempt.operation == operation)
        .toList(growable: false);
  }

  Future<void> _restorePaymentAttempts() async {
    if (widget.kind == MoneyActionKind.fund) {
      await _restorePaystackCheckout();
      return;
    }
    if (_paymentOperation == null) return;

    final configuredUserId = widget.paymentRecoveryUserId?.trim();
    final userId = configuredUserId == null || configuredUserId.isEmpty
        ? await _paymentRecoveryService.authenticatedUserId()
        : configuredUserId;
    if (userId == null || userId.isEmpty) return;
    await _restorePaymentAttemptsForUser(userId);
  }

  Future<void> _restorePaystackCheckout() async {
    final configuredUserId = widget.paymentRecoveryUserId?.trim();
    final userId = configuredUserId == null || configuredUserId.isEmpty
        ? await _paymentRecoveryService.authenticatedUserId()
        : configuredUserId;
    if (userId == null || userId.isEmpty) return;

    final normalizedUserId = userId.trim();
    _checkoutRecoveryUser = normalizedUserId;
    try {
      final attempt =
          await _paystackCheckoutAttemptStore.findUnresolved(normalizedUserId);
      if (!mounted || attempt == null) return;
      setState(() {
        _checkoutAttempt = attempt;
        _checkoutAmount = attempt.amount;
        _checkoutReference = attempt.reference;
        _checkoutAuthorizationUrl = attempt.authorizationUrl;
        _checkoutMessage = attempt.reference == null
            ? 'A previous checkout is ready to resume with the same payment key.'
            : 'A previous checkout was restored. Checking its status securely.';
      });
      if (attempt.reference != null && attempt.reference!.isNotEmpty) {
        await _verifyPaystackCheckout(restoredAttempt: attempt);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _checkoutMessage =
            'Saved checkout data could not be read safely. This flow is paused until it can be checked.';
      });
    }
  }

  Future<void> _restorePaymentAttemptsForUser(String userId) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty || _paymentOperation == null) return;
    if (_paymentRecoveryLoaded && _paymentRecoveryUser == normalizedUserId) {
      return;
    }

    final inFlight = _paymentRecoveryLoadInFlight;
    if (inFlight != null) {
      await inFlight;
      if (_paymentRecoveryLoaded && _paymentRecoveryUser == normalizedUserId) {
        return;
      }
    }

    _paymentRecoveryUser = normalizedUserId;
    final load = _loadPaymentAttempts(normalizedUserId);
    _paymentRecoveryLoadInFlight = load;
    try {
      await load;
    } finally {
      if (identical(_paymentRecoveryLoadInFlight, load)) {
        _paymentRecoveryLoadInFlight = null;
      }
    }
  }

  Future<void> _loadPaymentAttempts(String userId) async {
    if (mounted) {
      setState(() {
        _isLoadingPaymentRecovery = true;
        _paymentRecoveryError = null;
      });
    }

    try {
      final terminalOutcomes = <PaymentAttempt>[];
      final attempts = await _paymentRecoveryService.restoreAndResolve(userId,
          onResolved: (attempt) {
        if (attempt.state.isTerminal &&
            attempt.operation == _paymentOperation) {
          terminalOutcomes.add(attempt);
        }
      });
      _paymentRecoveryLoaded = true;
      if (!mounted) return;
      setState(() {
        _unresolvedPaymentAttempts = attempts;
      });
      if (terminalOutcomes.isNotEmpty) {
        _showRecoveredPaymentOutcome(terminalOutcomes.last);
      }
    } catch (error) {
      _paymentRecoveryLoaded = false;
      if (!mounted) return;
      setState(() {
        _paymentRecoveryError =
            'Payment recovery data could not be read safely. Sending is paused until it can be checked.';
        _unresolvedPaymentAttempts = const [];
      });
    } finally {
      if (mounted) {
        setState(() => _isLoadingPaymentRecovery = false);
      }
    }
  }

  Future<void> _refreshPaymentRecovery() async {
    final userId = _paymentRecoveryUser;
    if (userId == null || userId.isEmpty) return;
    _paymentRecoveryLoaded = false;
    await _restorePaymentAttemptsForUser(userId);
  }

  Future<void> _checkPaymentAttempt(PaymentAttempt attempt) async {
    final userId = _paymentRecoveryUser;
    if (userId == null || userId.isEmpty || _isLoadingPaymentRecovery) return;

    setState(() {
      _isLoadingPaymentRecovery = true;
      _paymentRecoveryError = null;
    });
    try {
      final resolved = await _paymentRecoveryService.resolveAttempt(
        userId: userId,
        attempt: attempt,
      );
      if (!mounted) return;
      final remaining = _unresolvedPaymentAttempts
          .map(
            (item) => item.attemptKey == resolved.attemptKey ? resolved : item,
          )
          .where((item) => item.isUnresolved)
          .toList(growable: false);
      setState(() {
        _unresolvedPaymentAttempts = remaining;
      });
      if (resolved.state.isTerminal) {
        _showRecoveredPaymentOutcome(resolved);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _paymentRecoveryError =
            'Status could not be checked. The payment remains unresolved and will not be sent automatically.';
      });
    } finally {
      if (mounted) setState(() => _isLoadingPaymentRecovery = false);
    }
  }

  void _showRecoveredPaymentOutcome(PaymentAttempt resolved) {
    if (!mounted) return;
    walletRefreshSignal.bump();
    final reference = resolved.reference;
    final message = switch (resolved.state) {
      PaymentAttemptState.success =>
        'Payment confirmed. ${reference == null ? '' : 'Reference: $reference. '}No second payment was sent.',
      PaymentAttemptState.failed =>
        'Payment failed. No second payment was sent.',
      PaymentAttemptState.reversed =>
        'Payment was reversed. No second payment was sent.',
      _ => null,
    };
    if (message == null) return;
    setState(() {
      _paymentRecoveryOutcomeVersion++;
      if (resolved.operation == PaymentAttemptOperation.internalTransfer &&
          reference?.isNotEmpty == true) {
        _lastInternalTransferReference = reference;
      }
      _setMessageState(message,
          type: resolved.state == PaymentAttemptState.success
              ? MoneyActionFeedbackType.success
              : MoneyActionFeedbackType.error);
    });
  }

  void _onAmountChanged() {
    if (mounted &&
        (widget.kind == MoneyActionKind.exchange ||
            widget.kind == MoneyActionKind.airtime ||
            widget.kind == MoneyActionKind.electricity ||
            _isTransferAction)) {
      setState(() {});
    }
  }

  void _onRecipientChanged() {
    if (!mounted) return;
    if (widget.kind == MoneyActionKind.send) {
      _scheduleRecipientPreview();
    }
    if (_isLocalMobileTopup && !_isSubmitting) {
      final phone = VtuPhone.normalize(_recipientController.text);
      if (phone != _lastMobileRecipient) {
        _lastMobileRecipient = phone;
        _networkSelectedManually = false;
        _suggestMobileNetwork();
      }
      setState(() {});
    }
    if (widget.kind == MoneyActionKind.electricity &&
        (_meterCustomerName != null || _meterVerifySkippable)) {
      setState(() {
        _meterCustomerName = null;
        _meterCustomerAddress = null;
        _meterVerifySkippable = false;
      });
    }
    if (widget.kind == MoneyActionKind.cable &&
        (_cableCustomerName != null || _cableVerifySkippable)) {
      setState(() {
        _cableCustomerName = null;
        _cableVerifySkippable = false;
      });
    }
  }

  bool get _isLocalMobileTopup =>
      (widget.kind == MoneyActionKind.airtime && _airtimeScope == 'local') ||
      (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG');

  bool get _hasConfirmedMobileNetwork =>
      _networkSelectedManually ||
      (VtuPhone.suggest(_recipientController.text) != null &&
          VtuPhone.suggest(_recipientController.text) == _vtuProvider);

  void _suggestMobileNetwork() {
    if (!_isLocalMobileTopup || _networkSelectedManually) return;
    final suggested = VtuPhone.suggest(_recipientController.text);
    if (suggested == null || suggested == _vtuProvider) return;
    if (_providersForCurrentFlow().any((p) => p.id == suggested)) {
      _setVtuProvider(suggested, manual: false);
    }
  }

  Widget _mobileNetworkHint() {
    final valid = VtuPhone.isValid(_recipientController.text);
    final confirmed = valid && _hasConfirmedMobileNetwork;
    final name = _providerName(_providersForCurrentFlow(), _vtuProvider);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(
            confirmed
                ? Icons.check_circle_outline_rounded
                : Icons.info_outline_rounded,
            size: 18,
            color: confirmed ? AppColors.success : AppColors.textSecondary),
        const SizedBox(width: 8),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
              confirmed
                  ? (_networkSelectedManually
                      ? '$name selected manually'
                      : '$name suggested from number')
                  : valid
                      ? 'Choose the network for this number'
                      : 'Your network will be suggested automatically',
              style: AppTextStyles.bodyS.copyWith(
                  color: confirmed
                      ? AppColors.textPrimary
                      : AppColors.textSecondary)),
          if (valid)
            Text('Ported number? Select your current network below.',
                style: AppTextStyles.bodyS),
        ])),
      ]),
    );
  }

  Widget _mobilePurchaseFooter() {
    final data = widget.kind == MoneyActionKind.data;
    final finished = _trackedOrder != null &&
        _terminalOrderStatuses.contains(_trackedOrder!.orderStatus);
    final review = data ? _isDataPaymentStep : _isAirtimeAmountStep;
    final recipientReady = VtuPhone.isValid(_recipientController.text) &&
        _hasConfirmedMobileNetwork &&
        _hasSelectedProvider(_providersForCurrentFlow(), _vtuProvider);
    final planReady = !_isLoadingVtuCatalog &&
        _dataPackages.any((plan) => plan.id == _dataPackageId);
    final ready = !_isSubmitting &&
        !_isLoadingPaymentRecovery &&
        _paymentRecoveryError == null &&
        !_submissionGate.isClaimed &&
        !_isLoadingVtuProviders &&
        !_isCheckingOrder &&
        (_pendingOrderReference == null || finished) &&
        (finished ||
            (recipientReady &&
                (data
                    ? (!_isDataPlanStep || planReady)
                    : (!review ||
                        MoneyActionFormValidator.validateAmount(
                                    _amountController.text)
                                .error ==
                            null))));
    final label = finished
        ? 'Start another top-up'
        : review
            ? (data ? 'Buy data' : 'Buy airtime')
            : data
                ? (_isDataPlanStep
                    ? 'Continue to payment'
                    : 'Continue to plans')
                : 'Continue to amount';
    return Container(
      decoration: BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.divider))),
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
      child: SafeArea(
          top: false,
          child: Align(
              heightFactor: 1,
              child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: FilledButton(
                    onPressed: !ready
                        ? null
                        : finished
                            ? _startAnotherMobileTopup
                            : review
                                ? _submit
                                : data
                                    ? (_isDataPlanStep
                                        ? _continueToDataPayment
                                        : _continueToDataPlans)
                                    : _continueToAirtimeAmount,
                    style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                        backgroundColor: AppColors.primaryDark,
                        foregroundColor: Colors.white),
                    child: _isSubmitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text(label),
                  )))),
    );
  }

  bool get _isTransferAction =>
      widget.kind == MoneyActionKind.send ||
      widget.kind == MoneyActionKind.withdraw;
  bool get _transferLocked => _isSubmitting || _submissionGate.isClaimed;
  String get _bankInput =>
      '${_bankCodeController.text.trim()}|${_accountNumberController.text.trim()}';
  bool get _bankRecipientVerified =>
      _activeBeneficiary != null ||
      (!_isResolvingWithdrawalAccount &&
          !_isLoadingWithdrawalBanks &&
          _selectedWithdrawalBank != null &&
          _withdrawalBanks
              .any((b) => b.code == _selectedWithdrawalBank!.code) &&
          _verifiedBankInput == _bankInput &&
          (_withdrawalAccountName?.isNotEmpty ?? false));
  bool get _trustpayRecipientVerified =>
      !_isResolvingRecipient &&
      _verifiedRecipientInput ==
          _recipientController.text.trim().toLowerCase() &&
      (_resolvedRecipientName?.isNotEmpty ?? false);

  WalletData? get _transferWallet {
    for (final wallet in _transferWallets) {
      if (wallet.currency == _currency) return wallet;
    }
    return null;
  }

  String? get _transferAmountError {
    if (_amountController.text.trim().isEmpty) return null;
    final result =
        MoneyActionFormValidator.validateAmount(_amountController.text);
    if (result.error != null) return result.error;
    if (_isLoadingTransferWallets) return 'Loading your available balance…';
    final balance = _transferWallet?.exactBalance;
    if (balance == null) {
      return 'Refresh your wallet balance before continuing.';
    }
    if (MoneyValue.parse(result.value!, currency: _currency)
            .compareTo(balance) >
        0) {
      return 'Amount exceeds your available $_currency balance.';
    }
    return null;
  }

  void _onTransferWalletRefresh() {
    if (mounted && _isTransferAction) _loadTransferWallets();
  }

  Future<void> _loadTransferWallets() async {
    final requestId = ++_transferWalletRequestId;
    setState(() => _isLoadingTransferWallets = true);
    try {
      final wallets = await _walletService.fetchWallets();
      if (!mounted || requestId != _transferWalletRequestId) return;
      setState(() => _transferWallets = wallets);
    } catch (_) {
      if (!mounted || requestId != _transferWalletRequestId) return;
      setState(() => _transferWallets = const []);
    } finally {
      if (mounted && requestId == _transferWalletRequestId) {
        setState(() => _isLoadingTransferWallets = false);
      }
    }
  }

  Widget _transferAmountSection() => TransferSection(
        title: 'How much are you sending?',
        children: [
          Row(children: [
            Icon(Icons.account_balance_wallet_outlined,
                size: 20, color: AppColors.textSecondary),
            const SizedBox(width: 8),
            Expanded(child: Text('Pay from', style: AppTextStyles.bodyS)),
            if (widget.kind == MoneyActionKind.send)
              DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                value: _currency,
                items: const [
                  DropdownMenuItem(value: 'NGN', child: Text('NGN wallet')),
                  DropdownMenuItem(value: 'GHS', child: Text('GHS wallet'))
                ],
                onChanged: _transferLocked
                    ? null
                    : (value) => setState(() {
                          _currency = value!;
                          _setMessageState(null);
                        }),
              ))
            else
              Text('NGN wallet', style: AppTextStyles.labelM),
          ]),
          const SizedBox(height: 12),
          TextField(
            controller: _amountController,
            enabled: !_transferLocked,
            focusNode: widget.kind == MoneyActionKind.send
                ? _sendAmountFocusNode
                : null,
            textInputAction: widget.kind == MoneyActionKind.send
                ? TextInputAction.next
                : TextInputAction.done,
            onSubmitted: (_) {
              if (widget.kind == MoneyActionKind.send) {
                _continueToSendRecipient();
              } else if (_transferAmountError == null) {
                _continueToWithdrawalDetails();
              }
            },
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: const [MoneyAmountInputFormatter()],
            style: AppTextStyles.displayMedium,
            decoration: InputDecoration(
                labelText: 'Amount',
                floatingLabelBehavior: FloatingLabelBehavior.always,
                prefixText: _currency == 'NGN' ? '₦ ' : 'GH₵ ',
                hintText: '0.00',
                errorText: _amountController.text.endsWith('.')
                    ? null
                    : _transferAmountError,
                errorMaxLines: 3),
          ),
          if (moneyAmountInWords(_amountController.text, _currency)
              case final words?) ...[
            const SizedBox(height: 12),
            Semantics(
                liveRegion: true,
                child: Text(words,
                    key: const ValueKey('transfer-amount-words'),
                    style: AppTextStyles.bodyS
                        .copyWith(color: AppColors.primary))),
          ],
          const SizedBox(height: 10),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
                child: Text(
                    _isLoadingTransferWallets
                        ? 'Loading available balance…'
                        : _transferWallet == null
                            ? 'Balance unavailable'
                            : 'Available ${transferMoneyLabel(_transferWallet!.balanceDecimalString, _currency)}',
                    style: AppTextStyles.bodyS)),
            SizedBox(
                width: 48,
                height: 48,
                child: IconButton(
                    tooltip: 'Refresh balance',
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    onPressed: _transferLocked || _isLoadingTransferWallets
                        ? null
                        : _loadTransferWallets)),
          ]),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final amount in (_currency == 'NGN'
                ? ['1000', '5000', '10000']
                : ['50', '100', '500']))
              ActionChip(
                  label: Text(transferMoneyLabel(amount, _currency)
                      .replaceFirst('.00', '')),
                  materialTapTargetSize: MaterialTapTargetSize.padded,
                  onPressed: _transferLocked
                      ? null
                      : () => _amountController.text = amount),
          ]),
        ],
      );

  Widget _buildTransferAvailability({required bool bank}) {
    final loading = _isLoadingPaymentCapabilities;
    final failed = !loading &&
        (_paymentCapabilitiesFailed || _paymentCapabilities == null);
    final name = bank ? 'Bank transfers' : 'TrustPay transfers';
    return TransferAvailabilityView(
      bank: bank,
      loading: loading,
      failed: failed,
      title: loading
          ? 'Checking transfer availability'
          : failed
              ? 'Couldn’t load ${name.toLowerCase()}'
              : '$name are unavailable',
      message: loading
          ? 'This will only take a moment.'
          : failed
              ? 'Check your connection and try again.'
              : 'This service isn’t available right now. Contact TrustPay support for help.',
      onBack: _handlePageBack,
      onRetry: _loadPaymentCapabilities,
      onSupport: () => context.push(AppRoutes.profileSupport),
      recovery: _relevantUnresolvedPaymentAttempts.isEmpty
          ? null
          : ExpansionTile(
              title: const Text('Check a previous payment'),
              children: [
                _PaymentRecoveryPanel(
                  attempts: _relevantUnresolvedPaymentAttempts,
                  isChecking: _isLoadingPaymentRecovery,
                  onCheckStatus: _checkPaymentAttempt,
                  onSupport: () => context.push(AppRoutes.profileSupport),
                )
              ],
            ),
      outcome: _message == null && _paymentRecoveryError == null
          ? null
          : Column(children: [
              if (_paymentRecoveryError != null)
                _MessagePanel(
                    message: _paymentRecoveryError!,
                    type: MoneyActionFeedbackType.warning,
                    onRetry: _refreshPaymentRecovery),
              if (_message != null)
                _MessagePanel(message: _message!, type: _messageType),
              if (!bank && _lastInternalTransferReference != null)
                TextButton.icon(
                    onPressed: () => _showInternalTransferReceipt(
                        _lastInternalTransferReference!),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: const Text('View transfer receipt')),
            ]),
    );
  }

  Widget _buildTransferScaffold(BuildContext context) {
    final bank = widget.kind == MoneyActionKind.withdraw;
    final available = bank
        ? _paymentCapabilities?.withdrawals
        : _paymentCapabilities?.internalTransfers;
    if (_isLoadingPaymentCapabilities ||
        _paymentCapabilities == null ||
        available != true) {
      return _buildTransferAvailability(bank: bank);
    }
    final details = bank ? _isWithdrawalDetailsStep : _isSendRecipientStep;
    final validAmount = _amountController.text.trim().isNotEmpty &&
        _transferAmountError == null;
    final ready = !_transferLocked &&
        validAmount &&
        (!details ||
            (!_isLoadingPaymentRecovery &&
                _paymentRecoveryError == null &&
                (bank
                    ? _paymentCapabilities?.withdrawals == true
                    : _paymentCapabilities?.internalTransfers == true) &&
                (bank ? _bankRecipientVerified : _trustpayRecipientVerified)));
    final beneficiary = _activeBeneficiary;
    final horizontal = MediaQuery.sizeOf(context).width > 600
        ? (MediaQuery.sizeOf(context).width - 552) / 2
        : 24.0;
    return Scaffold(
      backgroundColor: AppColors.background,
      bottomNavigationBar: Padding(
        padding:
            EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: Container(
          decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.divider))),
          padding: EdgeInsets.fromLTRB(horizontal, 12, horizontal, 12),
          child: SafeArea(
              top: false,
              child: FilledButton(
                onPressed: !ready
                    ? null
                    : !details
                        ? (bank
                            ? _continueToWithdrawalDetails
                            : _continueToSendRecipient)
                        : _submit,
                style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(54)),
                child: _isSubmitting && !_isAwaitingTransferApproval
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(_isLoadingPaymentRecovery
                        ? 'Checking previous payments…'
                        : _transferLocked
                            ? 'Awaiting approval…'
                            : !details
                                ? (bank
                                    ? 'Continue to bank details'
                                    : 'Continue to recipient')
                                : 'Review transfer'),
              )),
        ),
      ),
      body: SafeArea(
          child: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(horizontal, 16, horizontal, 24),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TransferHeader(
              bank: bank,
              locked: _transferLocked,
              showBack: widget.showBackButton,
              onBack: _handlePageBack),
          const SizedBox(height: 20),
          Text(
              details
                  ? 'Step 2 of 2 · Confirm the recipient.'
                  : 'Step 1 of 2 · Choose an amount to send.',
              style: AppTextStyles.bodyS),
          const SizedBox(height: 16),
          if (_relevantUnresolvedPaymentAttempts.isNotEmpty) ...[
            _PaymentRecoveryPanel(
                attempts: _relevantUnresolvedPaymentAttempts,
                isChecking: _isLoadingPaymentRecovery,
                onCheckStatus: _checkPaymentAttempt,
                onSupport: () => context.push(AppRoutes.profileSupport)),
            const SizedBox(height: 16),
          ],
          if (bank && !details && beneficiary != null) ...[
            _BeneficiaryPrefillPanel(
                beneficiary: beneficiary,
                onUseAnother: () {
                  if (!_transferLocked) {
                    setState(() => _activeBeneficiary = null);
                  }
                }),
            const SizedBox(height: 16),
          ],
          if (!details)
            _transferAmountSection()
          else ...[
            _WithdrawalTransferSummary(
                amount: _amountController.text,
                currency: _currency,
                onEdit: () {
                  if (!_transferLocked) {
                    setState(() {
                      if (bank) {
                        _isWithdrawalDetailsStep = false;
                      } else {
                        _isSendRecipientStep = false;
                      }
                    });
                  }
                }),
            const SizedBox(height: 16),
          ],
          if (bank && details && beneficiary != null)
            _BeneficiaryPrefillPanel(
                beneficiary: beneficiary,
                onUseAnother: () {
                  if (!_transferLocked) {
                    setState(() => _activeBeneficiary = null);
                  }
                })
          else if (bank && details)
            TransferSection(
                title: 'Recipient details',
                subtitle:
                    'Choose a bank. We’ll confirm the name from the account number.',
                children: [
                  TransferBankPicker(
                      banks: _withdrawalBanks
                          .map((b) => TransferBankChoice(
                              code: b.code, name: b.name, slug: b.slug))
                          .toList(),
                      selectedCode: _selectedWithdrawalBank?.code,
                      loading: _isLoadingWithdrawalBanks,
                      enabled: !_transferLocked,
                      onSelect: (code) => _selectWithdrawalBank(
                          _withdrawalBanks.firstWhere((b) => b.code == code)),
                      onRetry: _loadWithdrawalBanks),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _accountNumberController,
                    enabled: !_transferLocked,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(10)
                    ],
                    decoration: InputDecoration(
                        labelText: 'Account number',
                        hintText: '10-digit account number',
                        helperText:
                            '${_accountNumberController.text.length}/10 digits'),
                    style: AppTextStyles.headingM.copyWith(letterSpacing: 1),
                  ),
                  const SizedBox(height: 16),
                  TransferRecipientCard(
                      bank: true,
                      name: _bankRecipientVerified
                          ? _withdrawalAccountName
                          : null,
                      detail:
                          '${_selectedWithdrawalBank?.name ?? ''} · ${_maskAccountNumber(_accountNumberController.text)}',
                      loading: _isResolvingWithdrawalAccount,
                      error: _withdrawalResolveError,
                      idleText: _selectedWithdrawalBank == null
                          ? 'Choose a bank to verify the recipient.'
                          : 'Enter 10 digits to confirm the account name.',
                      canRetry: !_transferLocked &&
                          _accountNumberController.text.length == 10 &&
                          _selectedWithdrawalBank != null,
                      onRetry: _resolveWithdrawalAccount),
                ])
          else if (!bank && details) ...[
            const SizedBox(height: 16),
            TransferSection(title: 'Who are you sending to?', children: [
              _InputField(
                  controller: _recipientController,
                  enabled: !_transferLocked,
                  label: 'Recipient email',
                  inputFormatters: [LengthLimitingTextInputFormatter(254)],
                  keyboardType: TextInputType.emailAddress,
                  focusNode: _sendRecipientFocusNode,
                  textInputAction: TextInputAction.next,
                  onSubmitted: (_) => _sendNoteFocusNode.requestFocus()),
              const SizedBox(height: 16),
              TransferRecipientCard(
                  bank: false,
                  name: _trustpayRecipientVerified
                      ? _resolvedRecipientLabel
                      : null,
                  loading: _isResolvingRecipient,
                  error: _recipientResolveError,
                  idleText: 'Enter a TrustPay email to see the recipient.',
                  canRetry: !_transferLocked &&
                      MoneyActionFormValidator.isValidEmail(
                          _recipientController.text),
                  onRetry: _resolveRecipientPreview),
              const SizedBox(height: 16),
              _InputField(
                  controller: _noteController,
                  enabled: !_transferLocked,
                  label: 'Note optional',
                  maxCodePoints: 120,
                  focusNode: _sendNoteFocusNode,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => FocusScope.of(context).unfocus(),
                  onChanged: (_) => setState(() {})),
            ]),
          ],
          if (bank &&
              details &&
              _withdrawalBanks.isEmpty &&
              _withdrawalBankMessage != null) ...[
            const SizedBox(height: 16),
            _MessagePanel(
                message: 'Could not load the bank list. Reload it to continue.',
                type: MoneyActionFeedbackType.warning,
                onRetry: _loadWithdrawalBanks),
          ],
          if (_paymentRecoveryError != null) ...[
            const SizedBox(height: 16),
            _MessagePanel(
                message: _paymentRecoveryError!,
                type: MoneyActionFeedbackType.warning,
                onRetry: _refreshPaymentRecovery),
          ],
          if (!bank && _lastInternalTransferReference != null) ...[
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () =>
                  _showInternalTransferReceipt(_lastInternalTransferReference!),
              icon: const Icon(Icons.receipt_long_outlined),
              label: const Text('View transfer receipt'),
            ),
          ],
          if (_message != null) ...[
            const SizedBox(height: 16),
            _MessagePanel(
                message: _message!,
                type: _messageType,
                onRetry: _messageCanRetry ? _retryLastSubmission : null),
          ],
        ]),
      )),
    );
  }

  void _showInternalTransferReceipt(
    String reference, {
    Map<String, dynamic>? initialReceipt,
    bool replace = false,
  }) {
    if (!mounted) return;
    final route = MaterialPageRoute<void>(
        builder: (_) => TransferReceiptScreen(
            reference: reference,
            initialReceipt: initialReceipt,
            apiClient: _apiClient));
    if (replace) {
      unawaited(Navigator.of(context).pushReplacement<void, void>(route));
    } else {
      unawaited(Navigator.of(context).push<void>(route));
    }
  }

  Future<void> _loadExchangeRate() async {
    if (widget.kind != MoneyActionKind.exchange ||
        _exchangeFrom == _exchangeTo) {
      return;
    }

    final requestId = ++_exchangeRateRequestId;
    setState(() {
      _isLoadingExchangeRate = true;
      _exchangeRateError = null;
    });

    try {
      final response = await _apiClient.client.get(
        '/api/exchange/rate',
        queryParameters: {'from': _exchangeFrom, 'to': _exchangeTo},
      );
      if (!mounted || requestId != _exchangeRateRequestId) return;

      final data = Map<String, dynamic>.from(response.data as Map);
      if (data['configured'] == false) {
        setState(() {
          _exchangeEffectiveRate = null;
          _exchangeRateError = 'This exchange rate is not set yet.';
        });
        return;
      }
      final baseRate = _readDouble(data['baseRate']) ?? 0;
      final markup = _readDouble(data['markupPercent']) ?? 0;
      final effectiveRate =
          _readDouble(data['effectiveRate']) ?? baseRate * (1 + markup / 100);

      setState(() {
        _exchangeEffectiveRate = effectiveRate;
        _exchangeRateError = null;
      });
    } catch (error) {
      if (!mounted || requestId != _exchangeRateRequestId) return;
      setState(() {
        _exchangeEffectiveRate = null;
        _exchangeRateError = authErrorMessage(
          error,
          'Could not load the live exchange rate.',
        );
      });
    } finally {
      if (mounted && requestId == _exchangeRateRequestId) {
        setState(() => _isLoadingExchangeRate = false);
      }
    }
  }

  double? _readDouble(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse('$value');
  }

  void _changeExchangePair({String? from, String? to}) {
    setState(() {
      if (from != null) {
        _exchangeFrom = from;
        if (_exchangeTo == from) {
          _exchangeTo = from == 'NGN' ? 'GHS' : 'NGN';
        }
      }
      if (to != null) {
        _exchangeTo = to;
        if (_exchangeFrom == to) {
          _exchangeFrom = to == 'NGN' ? 'GHS' : 'NGN';
        }
      }
      _exchangeEffectiveRate = null;
      _exchangeRateError = null;
    });
    _loadExchangeRate();
  }

  Future<void> _loadVtuCatalogs() async {
    if (!_isVtuAction) {
      return;
    }

    final requestId = ++_vtuCatalogRequestId;
    setState(() {
      _isLoadingVtuProviders = true;
      _vtuCatalogMessage = null;
    });

    try {
      final results = await Future.wait([
        _vtuService.getProviders('airtime'),
        _vtuService.getProviders('data'),
        _vtuService.getProviders('electricity'),
        _vtuService.getProviders('cable'),
      ]);

      if (!mounted || requestId != _vtuCatalogRequestId) return;

      setState(() {
        _localAirtimeProviders = results[0];
        _localDataProviders = results[1];
        _localElectricityProviders = results[2];
        _localCableProviders = results[3];
        final available = _providersForCurrentFlow();
        if (!available.any((p) => p.id == _vtuProvider)) {
          _vtuProvider = _firstProviderId(available);
          _networkSelectedManually = false;
        }
        final suggested = VtuPhone.suggest(_recipientController.text);
        if (!_networkSelectedManually &&
            suggested != null &&
            available.any((p) => p.id == suggested)) {
          _vtuProvider = suggested;
        }
      });
    } catch (error) {
      if (!mounted || requestId != _vtuCatalogRequestId) return;
      setState(() {
        _localAirtimeProviders = const [];
        _localDataProviders = const [];
        _localElectricityProviders = const [];
        _localCableProviders = const [];
        _vtuProvider = '';
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load live VTU providers.',
        );
      });
    } finally {
      if (mounted && requestId == _vtuCatalogRequestId) {
        setState(() => _isLoadingVtuProviders = false);
      }
    }
    if (!mounted || extendedVtuProviders.contains(_vtuProvider)) return;
    if (widget.kind == MoneyActionKind.data &&
        _dataCountryCode == 'NG' &&
        _vtuProvider.isNotEmpty) {
      await _loadDataPackages(_vtuProvider);
    } else if (widget.kind == MoneyActionKind.cable &&
        _vtuProvider.isNotEmpty) {
      await _loadCablePackages(_vtuProvider);
    }
  }

  Future<void> _loadFundingAccounts() async {
    if (widget.kind != MoneyActionKind.fund) {
      return;
    }

    setState(() {
      _isLoadingFundingAccounts = true;
      _fundingAccountMessage = null;
    });

    try {
      final dashboard = await _homeDataService.fetchDashboard();
      HomeVirtualAccountProvisioning? provisioning;
      try {
        provisioning = await _homeDataService.fetchVirtualAccountProvisioning();
      } on DioException {
        // The account list remains useful if an older deployment does not
        // expose the optional provisioning-status endpoint yet. Never infer
        // a ready account from a missing status response.
      }
      if (!mounted) return;
      setState(() {
        _fundingUser = dashboard.user;
        _fundingAccounts = dashboard.virtualAccounts;
        _fundingProvisioning = provisioning;
        if (_preferredFundingAccount() == null) {
          _fundingAccountMessage = provisioning?.isActionRequired == true
              ? AccountSetupCopy.actionRequiredBody(bvnVerified: null)
              : provisioning?.isPending == true
                  ? AccountSetupCopy.pendingBody
                  : _canRevealFundingAccount
                      ? 'Request your NGN funding account before making a bank transfer.'
                      : 'Complete BVN and bank verification before requesting a funding account.';
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _fundingAccountMessage = authErrorMessage(
          error,
          'Could not load your funding account details.',
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isLoadingFundingAccounts = false);
      }
    }
  }

  Future<void> _loadPaymentCapabilities() async {
    if (widget.kind != MoneyActionKind.fund &&
        widget.kind != MoneyActionKind.withdraw &&
        widget.kind != MoneyActionKind.send) {
      return;
    }
    setState(() {
      _isLoadingPaymentCapabilities = true;
      _paymentCapabilitiesFailed = false;
    });
    try {
      final capabilities = await _walletService.fetchPaystackCapabilities();
      if (!mounted) return;
      setState(() => _paymentCapabilities = capabilities);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _paymentCapabilities = null;
        _paymentCapabilitiesFailed = true;
        _checkoutMessage = authErrorMessage(
          error,
          'Funding options are temporarily unavailable.',
        );
      });
    } finally {
      if (mounted) setState(() => _isLoadingPaymentCapabilities = false);
    }
  }

  Future<void> _openPaystackCheckout(String rawAmount) async {
    final amount = rawAmount.trim();
    if (_isOpeningPaystackCheckout) return;
    if (_checkoutReference != null && _checkoutReference!.isNotEmpty) {
      _showMessage(
        'Check the saved payment status before starting another attempt.',
        type: MoneyActionFeedbackType.info,
      );
      return;
    }
    final minimumAmount =
        double.tryParse(_paymentCapabilities?.checkoutMinimumAmount ?? '') ??
            50;
    if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(amount) ||
        (double.tryParse(amount) ?? 0) < minimumAmount) {
      _showMessage(
        'Enter at least NGN ${minimumAmount.toStringAsFixed(2)} for checkout.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    if (_paymentCapabilities?.checkout != true) {
      _showMessage(
        'Secure checkout is not available for this account yet.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    setState(() {
      _isOpeningPaystackCheckout = true;
      _checkoutMessage = null;
    });
    String? userId;
    try {
      userId = await _resolvePaystackCheckoutUser();
      if (userId == null || userId.isEmpty) {
        throw const PaystackCheckoutRecoveryException(
          'Sign in again before starting secure checkout.',
        );
      }
      final result = await _paystackCheckoutRecoveryService.initializeCheckout(
        userId: userId,
        amount: amount,
        currency: 'NGN',
      );
      if (!mounted) return;
      final attempt = result.attempt;
      setState(() {
        _checkoutAttempt = attempt;
        _checkoutAmount = attempt.amount;
        _checkoutReference = attempt.reference;
        _checkoutAuthorizationUrl = attempt.authorizationUrl;
      });
      final checkout = result.checkout;
      if (checkout == null) {
        await _verifyPaystackCheckout(restoredAttempt: attempt);
        return;
      }
      if (checkout.status == 'SUCCESS') {
        walletRefreshSignal.bump();
        setState(() {
          _checkoutAttempt = null;
          _checkoutAmount = null;
          _checkoutReference = null;
          _checkoutAuthorizationUrl = null;
          _checkoutMessage =
              'This payment is already confirmed. Your wallet will refresh shortly.';
        });
        return;
      }
      if (checkout.status == 'FAILED') {
        setState(() {
          _checkoutAttempt = null;
          _checkoutAmount = null;
          _checkoutReference = null;
          _checkoutAuthorizationUrl = null;
          _checkoutMessage = checkout.message.isNotEmpty
              ? checkout.message
              : 'The payment provider marked this payment as failed. You can start a new attempt.';
        });
        return;
      }
      final authorizationUrl = checkout.authorizationUrl;
      if (authorizationUrl == null) {
        setState(() {
          _checkoutMessage = checkout.message.isNotEmpty
              ? checkout.message
              : 'Payment is pending. We will credit your wallet after provider confirmation.';
        });
        return;
      }
      final opened = await launchUrl(
        authorizationUrl,
        mode: LaunchMode.externalApplication,
      );
      if (!opened) throw StateError('Could not open Paystack checkout.');
      setState(() {
        _checkoutMessage =
            'Checkout opened securely. Return here and check status after payment.';
      });
    } catch (error) {
      if (userId != null && userId.isNotEmpty) {
        try {
          await _syncPaystackCheckoutAttempt(userId);
        } catch (_) {
          // Keep the original checkout error visible. A failed journal read
          // must remain fail-closed and cannot permit a replacement payment.
        }
      }
      if (!mounted) return;
      setState(() {
        _checkoutMessage = authErrorMessage(
          error,
          'Could not open secure checkout. Retry the same amount to resume safely.',
        );
      });
    } finally {
      if (mounted) setState(() => _isOpeningPaystackCheckout = false);
    }
  }

  Future<void> _verifyPaystackCheckout({
    PaystackCheckoutAttempt? restoredAttempt,
  }) async {
    final attempt = restoredAttempt ?? _checkoutAttempt;
    final reference = attempt?.reference ?? _checkoutReference;
    if (reference == null ||
        reference.isEmpty ||
        (_isOpeningPaystackCheckout && restoredAttempt == null)) {
      _showMessage(
        'Start checkout first, then return here to check its status.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    setState(() => _isOpeningPaystackCheckout = true);
    try {
      final userId = await _resolvePaystackCheckoutUser();
      if (userId == null || userId.isEmpty || attempt == null) {
        throw const PaystackCheckoutRecoveryException(
          'Sign in again before checking payment status.',
        );
      }
      final resolved = await _paystackCheckoutRecoveryService.verifyCheckout(
        userId: userId,
        attempt: attempt,
      );
      if (!mounted) return;
      final normalized = resolved.state.wireName;
      setState(() {
        _checkoutAttempt = resolved;
        _checkoutAmount = resolved.amount;
        _checkoutReference = resolved.reference;
        _checkoutAuthorizationUrl = resolved.authorizationUrl;
      });
      if (normalized == 'SUCCESS') {
        walletRefreshSignal.bump();
        setState(() {
          _checkoutAttempt = null;
          _checkoutAmount = null;
          _checkoutReference = null;
          _checkoutAuthorizationUrl = null;
          _checkoutMessage =
              'Payment confirmed. Your wallet balance will refresh shortly.';
        });
      } else if (normalized == 'FAILED') {
        setState(() {
          _checkoutAttempt = null;
          _checkoutAmount = null;
          _checkoutReference = null;
          _checkoutAuthorizationUrl = null;
          _checkoutMessage =
              'The payment provider marked this payment as failed. You can start a new attempt.';
        });
      } else {
        setState(() {
          _checkoutMessage = resolved.authorizationUrl == null
              ? _missingCheckoutLinkMessage
              : 'Payment is still pending. Complete checkout or check again shortly.';
        });
      }
    } catch (error) {
      if (mounted) {
        _showMessage(
          authErrorMessage(error, 'Could not verify payment status.'),
          type: MoneyActionFeedbackType.warning,
        );
        if (_checkoutAuthorizationUrl == null) {
          setState(() => _checkoutMessage = _missingCheckoutLinkMessage);
        }
      }
    } finally {
      if (mounted) setState(() => _isOpeningPaystackCheckout = false);
    }
  }

  Future<String?> _resolvePaystackCheckoutUser() async {
    final current = _checkoutRecoveryUser?.trim();
    if (current != null && current.isNotEmpty) return current;

    final configured = widget.paymentRecoveryUserId?.trim();
    final userId = configured == null || configured.isEmpty
        ? await _paymentRecoveryService.authenticatedUserId()
        : configured;
    if (userId == null || userId.trim().isEmpty) return null;
    _checkoutRecoveryUser = userId.trim();
    return _checkoutRecoveryUser;
  }

  Future<void> _syncPaystackCheckoutAttempt(String userId) async {
    final attempt = await _paystackCheckoutAttemptStore.findUnresolved(userId);
    if (!mounted) return;
    setState(() {
      _checkoutAttempt = attempt;
      _checkoutAmount = attempt?.amount;
      _checkoutReference = attempt?.reference;
      _checkoutAuthorizationUrl = attempt?.authorizationUrl;
    });
  }

  Future<void> _reopenPaystackCheckout() async {
    final authorizationUrl = _checkoutAuthorizationUrl;
    if (authorizationUrl == null) {
      _showMessage(
        _missingCheckoutLinkMessage,
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    try {
      final opened = await launchUrl(
        authorizationUrl,
        mode: LaunchMode.externalApplication,
      );
      if (!opened) throw StateError('Could not open Paystack checkout.');
      if (!mounted) return;
      setState(() {
        _checkoutMessage =
            'Checkout reopened securely. Return here and check status after payment.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _checkoutMessage = authErrorMessage(
          error,
          'Could not reopen secure checkout. Check your payment status before retrying.',
        );
      });
    }
  }

  Future<void> _loadWithdrawalBanks() async {
    if (widget.kind != MoneyActionKind.withdraw) return;

    setState(() {
      _isLoadingWithdrawalBanks = true;
      _withdrawalBankMessage = null;
    });

    try {
      final banks = await _fetchWithdrawalBanks('/api/payments/banks');

      if (!mounted) return;
      setState(() {
        _withdrawalBanks = banks;
        if (banks.isEmpty) {
          _withdrawalBankMessage =
              'Bank list is unavailable. Enter the bank code manually.';
        }
      });
    } catch (primaryError) {
      try {
        final banks = await _fetchWithdrawalBanks('/api/banking/banks');

        if (!mounted) return;
        setState(() {
          _withdrawalBanks = banks;
          _withdrawalBankMessage = banks.isEmpty
              ? 'Bank list is unavailable. Enter the bank code manually.'
              : 'Using backup bank list while payout bank lookup is unavailable.';
        });
      } catch (fallbackError) {
        if (!mounted) return;
        setState(() {
          _withdrawalBankMessage = authErrorMessage(
            fallbackError,
            authErrorMessage(
              primaryError,
              'Could not load bank list. Enter the bank code manually.',
            ),
          );
        });
      }
    } finally {
      if (mounted) {
        setState(() => _isLoadingWithdrawalBanks = false);
      }
    }
  }

  Future<List<_SettlementBankOption>> _fetchWithdrawalBanks(String path) async {
    final response = await _apiClient.client.get(path);
    final data = response.data;
    final items = data is List ? data : const [];
    return items
        .whereType<Map>()
        .map(
          (item) =>
              _SettlementBankOption.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((bank) => bank.name.isNotEmpty && bank.code.isNotEmpty)
        .toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  void _setWithdrawalAccountResolveSuccess(String accountName) {
    setState(() {
      _withdrawalAccountName = accountName;
      _accountNameController.text = accountName;
    });
  }

  void _setWithdrawalAccountResolveFailure(Object error) {
    setState(() {
      _withdrawalAccountName = null;
      _accountNameController.clear();
      _withdrawalResolveError = authErrorMessage(
        error,
        'Could not confirm this account name.',
      );
    });
  }

  Future<String> _resolveWithdrawalAccountName({
    required String accountNumber,
    required String bankCode,
  }) async {
    dynamic body;
    try {
      body = (await _apiClient.client.post('/api/payments/banks/resolve',
              data: {'accountNumber': accountNumber, 'bankCode': bankCode}))
          .data;
    } on DioException catch (error) {
      if (![404, 405, 501].contains(error.response?.statusCode)) rethrow;
      body = (await _apiClient.client.post('/api/banking/banks/resolve', data: {
        'accountNumber': accountNumber,
        'bankCode': bankCode,
        'provider': 'paystack',
      }))
          .data;
    }
    final data = _asResponseMap(body);
    final name = _responseString(data['accountName']);
    if (name.isEmpty ||
        (data['accountNumber'] != null &&
            '${data['accountNumber']}' != accountNumber) ||
        (data['bankCode'] != null && '${data['bankCode']}' != bankCode)) {
      throw const FormatException('Account confirmation is incomplete.');
    }
    return name;
  }

  void _onWithdrawalBankTyped() {
    if (_activeBeneficiary != null) return;
    final query = _withdrawBankController.text.trim().toLowerCase();
    _SettlementBankOption? exactMatch;
    for (final bank in _withdrawalBanks) {
      if (bank.name.toLowerCase() == query ||
          bank.code.toLowerCase() == query ||
          bank.slug.toLowerCase() == query) {
        exactMatch = bank;
        break;
      }
    }

    if (_selectedWithdrawalBank?.code != exactMatch?.code) {
      setState(() {
        _selectedWithdrawalBank = exactMatch;
        _withdrawalAccountName = null;
        _withdrawalResolveError = null;
        if (exactMatch == null) {
          _accountNameController.clear();
        }
        _bankCodeController.text = exactMatch?.code ?? '';
      });
      _scheduleWithdrawalAccountResolve();
    }
  }

  void _selectWithdrawalBank(_SettlementBankOption bank) {
    setState(() {
      _selectedWithdrawalBank = bank;
      _withdrawalAccountName = null;
      _withdrawalResolveError = null;
      _accountNameController.clear();
      _withdrawBankController.text = bank.name;
      _withdrawBankController.selection = TextSelection.collapsed(
        offset: bank.name.length,
      );
      _bankCodeController.text = bank.code;
    });
    _scheduleWithdrawalAccountResolve();
  }

  void _scheduleWithdrawalAccountResolve() {
    _withdrawalResolveDebounce?.cancel();
    if (widget.kind != MoneyActionKind.withdraw) return;
    if (_activeBeneficiary != null) return;
    _withdrawalResolveRequestId++;

    if (mounted) {
      setState(() {
        _verifiedBankInput = null;
        _isResolvingWithdrawalAccount = false;
        _accountNameController.clear();
        _withdrawalAccountName = null;
        _withdrawalResolveError = null;
      });
    }

    final accountNumber = _accountNumberController.text.trim();
    final bankCode = _bankCodeController.text.trim();
    if (accountNumber.length != 10 || bankCode.isEmpty) {
      return;
    }

    setState(() => _isResolvingWithdrawalAccount = true);
    _withdrawalResolveDebounce = Timer(
      const Duration(milliseconds: 450),
      _resolveWithdrawalAccount,
    );
  }

  Future<void> _resolveWithdrawalAccount() async {
    final accountNumber = _accountNumberController.text.trim();
    final bankCode = _bankCodeController.text.trim();
    if (widget.kind != MoneyActionKind.withdraw ||
        accountNumber.length != 10 ||
        bankCode.isEmpty) {
      return;
    }

    final requestId = ++_withdrawalResolveRequestId;
    setState(() {
      _isResolvingWithdrawalAccount = true;
      _withdrawalResolveError = null;
    });

    try {
      final accountName = await _resolveWithdrawalAccountName(
        accountNumber: accountNumber,
        bankCode: bankCode,
      );
      if (!mounted || requestId != _withdrawalResolveRequestId) return;

      if (_bankInput != '$bankCode|$accountNumber') return;
      _verifiedBankInput = _bankInput;
      _setWithdrawalAccountResolveSuccess(accountName);
    } catch (error) {
      if (!mounted || requestId != _withdrawalResolveRequestId) return;
      _setWithdrawalAccountResolveFailure(error);
    } finally {
      if (mounted && requestId == _withdrawalResolveRequestId) {
        setState(() => _isResolvingWithdrawalAccount = false);
      }
    }
  }

  void _scheduleRecipientPreview() {
    _recipientResolveDebounce?.cancel();
    if (widget.kind != MoneyActionKind.send) return;
    _recipientResolveRequestId++;

    if (mounted) {
      setState(() {
        _verifiedRecipientInput = null;
        _isResolvingRecipient = false;
        _resolvedRecipientName = null;
        _resolvedRecipientMasked = null;
        _recipientResolveError = null;
      });
    }

    if (!MoneyActionFormValidator.isValidEmail(_recipientController.text)) {
      return;
    }

    setState(() => _isResolvingRecipient = true);
    _recipientResolveDebounce = Timer(
      const Duration(milliseconds: 450),
      _resolveRecipientPreview,
    );
  }

  Future<void> _resolveRecipientPreview() async {
    final email = _recipientController.text.trim().toLowerCase();
    if (widget.kind != MoneyActionKind.send ||
        !MoneyActionFormValidator.isValidEmail(email)) {
      return;
    }

    final requestId = ++_recipientResolveRequestId;
    setState(() {
      _isResolvingRecipient = true;
      _recipientResolveError = null;
    });

    try {
      final response = await _apiClient.client.post(
        '/api/transfers/recipient/preview',
        data: {'recipientEmail': email},
      );
      if (!mounted || requestId != _recipientResolveRequestId) return;

      final data = _asResponseMap(response.data);
      if (data['found'] != true) {
        setState(() {
          _resolvedRecipientName = null;
          _resolvedRecipientMasked = null;
          _recipientResolveError =
              'Recipient cannot be found or used for this transfer.';
        });
        return;
      }
      final masked = _responseString(data['maskedIdentifier']);
      final displayName = _responseString(data['displayName']);
      if (displayName.isEmpty && masked.isEmpty) {
        throw const FormatException('Recipient confirmation is incomplete.');
      }
      if (_recipientController.text.trim().toLowerCase() != email) return;
      _verifiedRecipientInput = email;
      setState(() {
        _resolvedRecipientName = _responseString(
          data['displayName'],
          fallback: masked.isEmpty ? 'TrustPay user' : masked,
        );
        _resolvedRecipientMasked = masked;
        _recipientResolveError = null;
      });
    } catch (error) {
      if (!mounted || requestId != _recipientResolveRequestId) return;
      setState(() {
        _resolvedRecipientName = null;
        _resolvedRecipientMasked = null;
        _recipientResolveError = _recipientPreviewErrorMessage(error);
      });
    } finally {
      if (mounted && requestId == _recipientResolveRequestId) {
        setState(() => _isResolvingRecipient = false);
      }
    }
  }

  String _recipientPreviewErrorMessage(Object error) {
    if (error is DioException) {
      final statusCode = error.response?.statusCode;
      if (statusCode == 404) {
        return 'No TrustPay user found with this email.';
      }
      if (statusCode == 400) {
        return authErrorMessage(error, 'Cannot transfer to yourself.');
      }
    }
    return authErrorMessage(error, 'Could not confirm this recipient.');
  }

  String? get _resolvedRecipientLabel {
    final name = _resolvedRecipientName;
    if (name == null || name.isEmpty) return null;
    final masked = _resolvedRecipientMasked ?? '';
    if (masked.isEmpty || masked == name) return name;
    return '$name • $masked';
  }

  Future<void> _requestFundingAccount() async {
    if (_isRequestingFundingAccount) return;

    if (_fundingProvisioning?.isPending == true) {
      _showMessage(
        AccountSetupCopy.pendingBody,
        type: MoneyActionFeedbackType.info,
      );
      await _loadFundingAccounts();
      return;
    }

    if (!_canRevealFundingAccount) {
      _showMessage(
        'Complete BVN and bank verification before requesting a funding account.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    if (!_fundingAccountConsent) {
      _showMessage(
        'Confirm that you authorize TRUSTPAY to create a dedicated Paystack NGN receiving account.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    setState(() {
      _isRequestingFundingAccount = true;
      _fundingAccountMessage = null;
      _setMessageState(null);
    });

    try {
      final account = await _homeDataService.provisionVirtualAccount(
        consentAccepted: true,
        idempotencyKey: _attemptIdempotency.keyFor(
          'funding-account|paystack|NGN',
        ),
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted) return;
      setState(() {
        _fundingProvisioning = HomeVirtualAccountProvisioning(
          provider: account.provider.isEmpty ? 'PAYSTACK' : account.provider,
          status: account.status,
        );
        _fundingAccounts = [
          account,
          ..._fundingAccounts.where(
            (item) =>
                item.provider.toUpperCase() != 'PAYSTACK' ||
                item.currency.toUpperCase() != 'NGN',
          ),
        ];
        _fundingAccountMessage = null;
        final status = account.status.trim().toUpperCase();
        final isPending =
            {'PENDING', 'PROCESSING', 'PROVISIONING'}.contains(status);
        final isActionRequired =
            {'ACTION_REQUIRED', 'FAILED', 'REJECTED'}.contains(status);
        _setMessageState(
          isPending
              ? AccountSetupCopy.pendingBody
              : isActionRequired
                  ? AccountSetupCopy.actionRequiredBody(bvnVerified: null)
                  : 'Funding account is ready. Transfer NGN to this account and your wallet will update after payment confirmation.',
          type: isPending
              ? MoneyActionFeedbackType.info
              : isActionRequired
                  ? MoneyActionFeedbackType.warning
                  : MoneyActionFeedbackType.success,
        );
      });
    } catch (error) {
      if (error is DioException &&
          (error.response?.statusCode ?? 0) >= 400 &&
          (error.response?.statusCode ?? 0) < 500) {
        // Provider/eligibility responses are known terminal outcomes for this
        // attempt. A user-confirmed retry should receive a fresh key; network
        // failures keep the key so the same request can be safely replayed.
        _attemptIdempotency.markFinalOutcome();
      }
      if (!mounted) return;
      setState(() {
        _setMessageState(
          authErrorMessage(
            error,
            'Could not request your funding account. Complete BVN and bank verification, then try again.',
          ),
          type: MoneyActionFeedbackType.error,
          canRetry: true,
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isRequestingFundingAccount = false);
      }
    }
  }

  bool get _canRevealFundingAccount {
    final user = _fundingUser;
    return user != null &&
        KycGatePolicy.canRevealVirtualAccount(
          status: user.kycStatus,
          kycTier: user.kycTier,
        );
  }

  Future<void> _loadDataPackages(String provider) async {
    final requestId = ++_dataPackageRequestId;
    if (provider.isEmpty) {
      setState(() {
        _dataPackageId = null;
        _dataPackages = const [];
        _vtuCatalogMessage = 'Select a network to load data packages.';
      });
      return;
    }

    setState(() {
      _isLoadingVtuPackages = true;
      _vtuCatalogMessage = null;
      _dataPackageId = null;
      _dataPackages = const [];
    });

    try {
      final packages = await _vtuService.getPackages(provider);
      if (!mounted ||
          requestId != _dataPackageRequestId ||
          provider != _vtuProvider) {
        return;
      }
      setState(() {
        _dataPackages = packages;
      });
    } catch (error) {
      if (!mounted ||
          requestId != _dataPackageRequestId ||
          provider != _vtuProvider) {
        return;
      }
      setState(() {
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load data packages for this provider.',
        );
      });
    } finally {
      if (mounted && requestId == _dataPackageRequestId) {
        setState(() => _isLoadingVtuPackages = false);
      }
    }
  }

  void _selectDataPackage(String packageId) {
    final selected = _dataPackages.where((item) => item.id == packageId);
    if (selected.isEmpty) return;
    final package = selected.first;
    _dataPackageId = package.id;
    _amountController.text = package.price;
  }

  Future<void> _loadCablePackages(String provider) async {
    final requestId = ++_cablePackageRequestId;
    if (provider.isEmpty) {
      setState(() {
        _cablePackageId = null;
        _cablePackages = const [];
        _vtuCatalogMessage = 'Select a provider to load bouquets.';
      });
      return;
    }

    setState(() {
      _isLoadingVtuPackages = true;
      _vtuCatalogMessage = null;
      _cablePackageId = null;
      _cablePackages = const [];
    });

    try {
      final packages = await _vtuService.getPackages(provider);
      if (!mounted ||
          requestId != _cablePackageRequestId ||
          provider != _vtuProvider) {
        return;
      }
      setState(() {
        _cablePackages = packages;
        if (packages.isNotEmpty) {
          _selectCablePackage(packages.first.id);
        }
      });
    } catch (error) {
      if (!mounted ||
          requestId != _cablePackageRequestId ||
          provider != _vtuProvider) {
        return;
      }
      setState(() {
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load bouquets for this provider.',
        );
      });
    } finally {
      if (mounted && requestId == _cablePackageRequestId) {
        setState(() => _isLoadingVtuPackages = false);
      }
    }
  }

  void _selectCablePackage(String packageId) {
    final selected = _cablePackages.where((item) => item.id == packageId);
    if (selected.isEmpty) return;
    final package = selected.first;
    _cablePackageId = package.id;
    _amountController.text = package.price;
  }

  void _leaveSpecialistVtu() {
    final providers = _providersForCurrentFlow()
        .where((p) => !extendedVtuProviders.contains(p.id))
        .toList();
    final restore = providers.any((p) => p.id == _returnCoreProvider);
    final suggestion = VtuPhone.suggest(_recipientController.text);
    final next = restore
        ? _returnCoreProvider!
        : providers.any((p) => p.id == suggestion)
            ? suggestion!
            : _firstProviderId(providers);
    _setVtuProvider(next, manual: restore && _returnCoreManual);
  }

  void _setVtuProvider(String provider, {bool manual = true}) {
    if (_isSubmitting) return;
    if (provider == _vtuProvider) {
      setState(() => _networkSelectedManually = manual);
      return;
    }
    if (extendedVtuProviders.contains(provider) &&
        !extendedVtuProviders.contains(_vtuProvider)) {
      _returnCoreProvider = _vtuProvider;
      _returnCoreManual = _networkSelectedManually;
    }
    _foreignCountryMenu.value = null;
    _dataPackageRequestId++;
    _cablePackageRequestId++;
    setState(() {
      _networkSelectedManually = manual;
      _isLoadingVtuPackages = false;
      _extendedVtuPayload = null;
      _extendedVtuReview = {};
      if (provider == 'foreign-airtime') _airtimeScope = 'local';
      _vtuProvider = provider;
      _dataPackageId = null;
      _dataPackages = const [];
      _isDataPlanStep = false;
      _isDataPaymentStep = false;
      if (widget.kind == MoneyActionKind.electricity) {
        _isElectricityPaymentStep = false;
      }
      if (widget.kind == MoneyActionKind.cable) {
        _isCablePaymentStep = false;
        _isCableRecipientStep = false;
        _cableCustomerName = null;
        _cableVerifySkippable = false;
        _cablePackageId = null;
        _cablePackages = const [];
      }
      _setMessageState(null);
    });

    if (extendedVtuProviders.contains(provider)) return;
    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
      _loadDataPackages(provider);
    } else if (widget.kind == MoneyActionKind.cable) {
      _loadCablePackages(provider);
    }
  }

  void _setMessageState(
    String? message, {
    MoneyActionFeedbackType type = MoneyActionFeedbackType.info,
    bool canRetry = false,
  }) {
    _message = message;
    _messageType = type;
    _messageCanRetry = message != null && canRetry;
  }

  void _showMessage(
    String message, {
    MoneyActionFeedbackType type = MoneyActionFeedbackType.info,
    bool canRetry = false,
  }) {
    setState(() {
      _setMessageState(message, type: type, canRetry: canRetry);
    });
  }

  void _retryLastSubmission() {
    if (_isSubmitting) return;
    if (widget.kind == MoneyActionKind.fund) {
      _requestFundingAccount();
      return;
    }
    _submit(explicitRetry: true);
  }

  void _setAirtimeScope(String scope) {
    if (scope == 'international' &&
        _localAirtimeProviders.any((item) => item.id == 'foreign-airtime')) {
      _setVtuProvider('foreign-airtime');
      return;
    }
    setState(() {
      _airtimeScope = scope;
      _isAirtimeAmountStep = false;
      if (scope == 'local' &&
          !_hasSelectedProvider(_localAirtimeProviders, _vtuProvider)) {
        _vtuProvider = _firstProviderId(_localAirtimeProviders);
        _networkSelectedManually = false;
      } else if (scope != 'local') {
        _airtimeCountryCode = 'GH';
        _airtimeOperatorId = _firstProviderId(
          _airtimeOperatorsForCountry(_airtimeCountryCode),
          fallback: '',
        );
      }
    });
    if (scope == 'local') _suggestMobileNetwork();
  }

  void _setDataCountryCode(String countryCode) {
    setState(() {
      _dataCountryCode = countryCode;
      _isDataPlanStep = false;
      _isDataPaymentStep = false;
      _dataPackageId = null;
      _dataPackages = const [];
      if (countryCode == 'GH') {
        _dataOperatorId = _firstProviderId(
          _dataOperatorsForCountry(countryCode),
          fallback: '',
        );
        _amountController.clear();
      } else {
        _vtuProvider = _firstProviderId(_localDataProviders);
        if (countryCode != 'NG') {
          _amountController.clear();
        }
      }
    });

    if (countryCode == 'NG') {
      if (_vtuProvider.isNotEmpty) {
        _loadDataPackages(_vtuProvider);
      }
    }
  }

  void _setElectricityCountryCode(String countryCode) {
    setState(() {
      _electricityCountryCode = countryCode;
      _isElectricityPaymentStep = false;
      if (countryCode == 'GH') {
        _electricityBillerId = _firstProviderId(
          _electricityBillersForCountry(countryCode),
          fallback: '',
        );
      } else {
        _vtuProvider = _firstProviderId(_localElectricityProviders);
      }
    });
  }

  void _handlePageBack() {
    FocusScope.of(context).unfocus();
    if (widget.kind == MoneyActionKind.send && _isSendRecipientStep) {
      setState(() {
        _isSendRecipientStep = false;
        _setMessageState(null);
      });
      return;
    }
    if (widget.kind == MoneyActionKind.withdraw && _isWithdrawalDetailsStep) {
      setState(() {
        _isWithdrawalDetailsStep = false;
        _setMessageState(null);
      });
      return;
    }

    if (widget.kind == MoneyActionKind.airtime && _isAirtimeAmountStep) {
      setState(() {
        _isAirtimeAmountStep = false;
        _setMessageState(null);
      });
      return;
    }
    if (widget.kind == MoneyActionKind.data &&
        (_isDataPlanStep || _isDataPaymentStep)) {
      FocusScope.of(context).unfocus();
      setState(() {
        if (_isDataPaymentStep) {
          _isDataPaymentStep = false;
        } else {
          _isDataPlanStep = false;
        }
        _setMessageState(null);
      });
      return;
    }

    if (widget.kind == MoneyActionKind.electricity &&
        _isElectricityPaymentStep) {
      setState(() {
        _isElectricityPaymentStep = false;
        _setMessageState(null);
      });
      return;
    }

    if (widget.kind == MoneyActionKind.cable && _isCablePaymentStep) {
      setState(() {
        _isCablePaymentStep = false;
        _setMessageState(null);
      });
      return;
    }

    if (widget.kind == MoneyActionKind.cable && _isCableRecipientStep) {
      setState(() {
        _isCableRecipientStep = false;
        _setMessageState(null);
      });
      return;
    }

    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    } else {
      context.go(AppRoutes.home);
    }
  }

  void _continueToAirtimeAmount() {
    if (_isLoadingVtuCatalog) {
      _showMessage(
        'Wait for airtime networks to finish loading.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (_airtimeScope == 'international' &&
        !_enabledAirtimeCountries.contains(_airtimeCountryCode)) {
      _showMessage('${_countryName(_airtimeCountryCode)} is coming soon.');
      return;
    }

    final providers = _providersForCurrentFlow();
    if (providers.isEmpty) {
      _showMessage(
        'No live airtime network is available yet.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    if (!_hasSelectedProvider(providers, _vtuSelectionId())) {
      _showMessage(
        'Select an available airtime network before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final fieldError = MoneyActionFormValidator.validateFields(
      kind: MoneyActionKind.airtime,
      recipient: _recipientController.text,
    );
    if (fieldError != null) {
      _showMessage(fieldError, type: MoneyActionFeedbackType.warning);
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _isAirtimeAmountStep = true;
      _setMessageState(null);
    });
  }

  void _continueToSendRecipient() {
    if (_transferLocked ||
        _amountController.text.trim().isEmpty ||
        _transferAmountError != null) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _isSendRecipientStep = true;
      _setMessageState(null);
    });
  }

  void _continueToWithdrawalDetails() {
    if (_transferAmountError != null) {
      _showMessage(_transferAmountError!,
          type: MoneyActionFeedbackType.warning);
      return;
    }
    final amountResult = MoneyActionFormValidator.validateAmount(
      _amountController.text,
    );
    if (amountResult.error != null) {
      _showMessage(amountResult.error!, type: MoneyActionFeedbackType.error);
      return;
    }

    if (_currency != 'NGN') {
      _showMessage(
        'Exchange GHS to NGN before sending to a bank account.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    setState(() {
      _isWithdrawalDetailsStep = true;
      _setMessageState(null);
    });
  }

  void _continueToDataPlans() {
    if (_isSubmitting ||
        _isLoadingVtuProviders ||
        !VtuPhone.isValid(_recipientController.text) ||
        !_hasConfirmedMobileNetwork ||
        !_hasSelectedProvider(_localDataProviders, _vtuProvider)) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _isDataPlanStep = true;
      _setMessageState(null);
    });
  }

  void _continueToDataPayment() {
    if (_dataCountryCode != 'NG' ||
        _isLoadingVtuCatalog ||
        !_dataPackages.any((plan) => plan.id == _dataPackageId)) {
      _showMessage('Choose an available data plan first.',
          type: MoneyActionFeedbackType.warning);
      return;
    }
    final error = MoneyActionFormValidator.validateFields(
      kind: MoneyActionKind.data,
      recipient: _recipientController.text,
    );
    if (error != null) {
      _showMessage(error, type: MoneyActionFeedbackType.warning);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _isDataPaymentStep = true;
      _setMessageState(null);
    });
  }

  void _continueToCableRecipientDetails() {
    if (_isLoadingVtuCatalog) {
      _showMessage(
        'Wait for cable TV providers to finish loading.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final providers = _providersForCurrentFlow();
    if (providers.isEmpty) {
      _showMessage(
        'No live cable TV provider is available yet.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }
    if (!_hasSelectedProvider(providers, _vtuProvider)) {
      _showMessage(
        'Select a cable TV provider before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    setState(() {
      _isCableRecipientStep = true;
      _setMessageState(null);
    });
  }

  Future<void> _continueToElectricityPayment({
    bool skipVerification = false,
  }) async {
    if (_isVerifyingMeter) return;

    final providers = _providersForCurrentFlow();
    if (providers.isEmpty) {
      _showMessage(
        'No live electricity provider is available for this country yet.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (!_hasSelectedProvider(providers, _vtuSelectionId())) {
      _showMessage(
        'Select an available electricity provider before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final meterNumber = _recipientController.text.trim();
    if (meterNumber.isEmpty) {
      _showMessage(
        'Enter the meter number before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final contactPhone = _electricityPhoneController.text.trim();
    if (contactPhone.isEmpty) {
      _showMessage(
        'Enter a contact phone number before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    // Meter-name lookup is only wired for the Nigerian (VTPass) route today.
    if (_electricityCountryCode == 'NG' && !skipVerification) {
      setState(() {
        _isVerifyingMeter = true;
        _setMessageState(null);
      });

      try {
        final customer = await _vtuService.validateMeter(
          provider: _vtuProvider,
          meterNumber: meterNumber,
          meterType: _meterType,
          contactPhone: _normalizedPhone(contactPhone, 'NG'),
          idempotencyKey: _attemptIdempotency.keyFor(
            'vtu-meter-validation|$_vtuProvider|$meterNumber|$_meterType|$contactPhone',
          ),
        );
        if (!mounted) return;
        setState(() {
          _isVerifyingMeter = false;
          _meterCustomerName =
              customer.name.isEmpty ? 'Unknown customer' : customer.name;
          _meterCustomerAddress = customer.address;
          _meterVerifySkippable = false;
          _isElectricityPaymentStep = true;
          _setMessageState(null);
        });
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _isVerifyingMeter = false;
          _meterVerifySkippable = true;
          _setMessageState(
            authErrorMessage(
              error,
              'We could not verify this meter number. Check it and try again.',
            ),
            type: MoneyActionFeedbackType.warning,
          );
        });
      }
      return;
    }

    setState(() {
      if (skipVerification) {
        _meterCustomerName = null;
        _meterCustomerAddress = null;
      }
      _isElectricityPaymentStep = true;
      _setMessageState(null);
    });
  }

  List<VtuProviderOption> _providersForCurrentFlow() {
    if (widget.kind == MoneyActionKind.airtime) {
      return _airtimeScope == 'international'
          ? _airtimeOperatorsForCountry(_airtimeCountryCode)
          : _localAirtimeProviders;
    }
    if (widget.kind == MoneyActionKind.data) {
      return _dataCountryCode == 'GH'
          ? _dataOperatorsForCountry(_dataCountryCode)
          : _localDataProviders;
    }
    if (widget.kind == MoneyActionKind.cable) {
      return _localCableProviders;
    }
    if (widget.kind == MoneyActionKind.electricity) {
      return _electricityCountryCode == 'GH'
          ? _electricityBillersForCountry(_electricityCountryCode)
          : _localElectricityProviders;
    }
    return const [];
  }

  Future<void> _continueToCablePayment({bool skipVerification = false}) async {
    if (_isVerifyingCard) return;

    final providers = _providersForCurrentFlow();
    if (providers.isEmpty) {
      _showMessage(
        'No live cable TV provider is available yet.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (!_hasSelectedProvider(providers, _vtuProvider)) {
      _showMessage(
        'Select a cable TV provider before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final smartCardNumber = _recipientController.text.trim();
    if (smartCardNumber.length < 5) {
      _showMessage(
        'Enter the smart card / IUC number before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final contactPhone = _cablePhoneController.text.trim();
    if (contactPhone.isEmpty) {
      _showMessage(
        'Enter a contact phone number before continuing.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (!skipVerification) {
      setState(() {
        _isVerifyingCard = true;
        _setMessageState(null);
      });

      try {
        final customer = await _vtuService.validateSmartCard(
          provider: _vtuProvider,
          smartCardNumber: smartCardNumber,
          subscriptionType: _cableSubscriptionType,
          contactPhone: _normalizedPhone(contactPhone, 'NG'),
          idempotencyKey: _attemptIdempotency.keyFor(
            'vtu-card-validation|$_vtuProvider|$smartCardNumber|$_cableSubscriptionType|$contactPhone',
          ),
        );
        if (_cableSubscriptionType == 'renew' &&
            (customer.renewalAmount == null ||
                double.tryParse(customer.renewalAmount!) == null ||
                double.parse(customer.renewalAmount!) <= 0)) {
          throw StateError('VTpass did not return a valid renewal amount.');
        }
        if (!mounted) return;
        setState(() {
          _isVerifyingCard = false;
          _cableCustomerName =
              customer.name.isEmpty ? 'Unknown customer' : customer.name;
          _cableVerifySkippable = false;
          if (_cableSubscriptionType == 'renew' &&
              customer.renewalAmount != null) {
            _amountController.text = customer.renewalAmount!;
          }
          _isCablePaymentStep = true;
          _setMessageState(null);
        });
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _isVerifyingCard = false;
          _cableVerifySkippable = true;
          _setMessageState(
            authErrorMessage(
              error,
              'We could not verify this smart card number. Check it and try again.',
            ),
            type: MoneyActionFeedbackType.warning,
          );
        });
      }
      return;
    }

    setState(() {
      if (skipVerification) {
        _cableCustomerName = null;
      }
      _isCablePaymentStep = true;
      _setMessageState(null);
    });
  }

  List<VtuProviderOption> _airtimeOperatorsForCountry(String countryCode) {
    return _airtimeOperatorsByCountry[countryCode] ?? const [];
  }

  List<VtuProviderOption> _dataOperatorsForCountry(String countryCode) {
    return _dataOperatorsByCountry[countryCode] ?? const [];
  }

  List<VtuProviderOption> _electricityBillersForCountry(String countryCode) {
    return _electricityBillersByCountry[countryCode] ?? const [];
  }

  String _firstProviderId(
    List<VtuProviderOption> providers, {
    String? fallback,
  }) {
    return providers.isEmpty ? (fallback ?? '') : providers.first.id;
  }

  bool _hasSelectedProvider(List<VtuProviderOption> providers, String id) {
    return id.isNotEmpty && providers.any((provider) => provider.id == id);
  }

  String _countryName(String countryCode) {
    return _countryLabels[countryCode] ?? countryCode;
  }

  String _providerName(List<VtuProviderOption> providers, String id) {
    for (final provider in providers) {
      if (provider.id == id) return provider.name;
    }
    return id;
  }

  String? _selectedDataPackageName() {
    final packageId = _dataPackageId;
    if (packageId == null) return null;
    for (final package in _dataPackages) {
      if (package.id == packageId) {
        return '${package.name} (${package.validity})';
      }
    }
    return null;
  }

  String? _resolvedAmountText() {
    if (_extendedVtuPayload != null) {
      return _extendedVtuPayload!['amount'] as String;
    }
    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
      final packageId = _dataPackageId;
      if (packageId == null) return null;
      final selected = _dataPackages.where((item) => item.id == packageId);
      if (selected.isEmpty) return null;
      return selected.first.price;
    }

    if (widget.kind == MoneyActionKind.cable &&
        _cableSubscriptionType == 'renew') {
      return _amountController.text;
    }

    if (widget.kind == MoneyActionKind.cable) {
      final packageId = _cablePackageId;
      if (packageId == null) return null;
      final selected = _cablePackages.where((item) => item.id == packageId);
      if (selected.isEmpty) return null;
      return selected.first.price;
    }

    return _amountController.text;
  }

  Future<void> _submit({bool explicitRetry = false}) async {
    if (_isSubmitting ||
        _submissionGate.isClaimed ||
        (_paymentOperation != null && _isLoadingPaymentRecovery)) {
      return;
    }

    if (widget.kind == MoneyActionKind.send &&
        _paymentCapabilities?.internalTransfers != true) {
      _showMessage('TrustPay transfers are temporarily unavailable. Try again.',
          type: MoneyActionFeedbackType.warning);
      return;
    }

    if (widget.kind == MoneyActionKind.withdraw &&
        _paymentCapabilities?.withdrawals != true) {
      _showMessage(
        'NGN withdrawals are temporarily unavailable for this account.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (widget.kind == MoneyActionKind.exchange) {
      await _submitExchange();
      return;
    }

    if (widget.kind == MoneyActionKind.fund) {
      final account = _preferredFundingAccount();
      if (account == null) {
        _showMessage(
          'Request your funding account first.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
      _copyFundingValue(account.displayAccountNumber);
      return;
    }

    if (_isLoadingVtuCatalog && _isVtuAction) {
      _showMessage(
        'Wait for VTU options to finish loading.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (widget.kind == MoneyActionKind.airtime &&
        _airtimeScope == 'international' &&
        !_enabledAirtimeCountries.contains(_airtimeCountryCode)) {
      _showMessage('${_countryName(_airtimeCountryCode)} is coming soon.');
      return;
    }

    if (widget.kind == MoneyActionKind.data &&
        !_enabledDataCountries.contains(_dataCountryCode)) {
      _showMessage('${_countryName(_dataCountryCode)} is coming soon.');
      return;
    }

    if (widget.kind == MoneyActionKind.electricity &&
        !_enabledElectricityCountries.contains(_electricityCountryCode)) {
      _showMessage('${_countryName(_electricityCountryCode)} is coming soon.');
      return;
    }

    if (_isVtuAction) {
      final providers = _providersForCurrentFlow();
      if (providers.isEmpty) {
        _showMessage(
          'No live provider is available for this service yet.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
      if (!_hasSelectedProvider(providers, _vtuSelectionId())) {
        _showMessage(
          'Select an available provider before continuing.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
    }

    if (widget.kind == MoneyActionKind.withdraw && _currency != 'NGN') {
      _showMessage(
        'Exchange GHS to NGN before sending to a bank account.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final resolvedAmount = _resolvedAmountText();
    if (resolvedAmount == null) {
      _showMessage(
        widget.kind == MoneyActionKind.cable
            ? 'Select a bouquet.'
            : 'Select a data package.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final amountResult = MoneyActionFormValidator.validateAmount(
      resolvedAmount,
    );
    if (amountResult.error != null) {
      _showMessage(amountResult.error!, type: MoneyActionFeedbackType.error);
      return;
    }
    final amount = amountResult.value!;

    if (_isTransferAction && _transferAmountError != null) {
      _showMessage(_transferAmountError!,
          type: MoneyActionFeedbackType.warning);
      return;
    }
    if (widget.kind == MoneyActionKind.withdraw && !_bankRecipientVerified) {
      _showMessage(
          _withdrawalResolveError ??
              'Confirm the bank and recipient name before sending.',
          type: MoneyActionFeedbackType.warning);
      return;
    }
    if (widget.kind == MoneyActionKind.send && !_trustpayRecipientVerified) {
      _showMessage(
          _recipientResolveError ?? 'Confirm the recipient before sending.',
          type: MoneyActionFeedbackType.warning);
      return;
    }

    final fieldError = (_extendedVtuPayload != null ||
            (widget.kind == MoneyActionKind.withdraw &&
                _activeBeneficiary != null))
        ? null
        : MoneyActionFormValidator.validateFields(
            kind: widget.kind,
            recipient: _recipientController.text,
            accountNumber: _accountNumberController.text,
            accountName: _accountNameController.text,
            bankCode: _bankCodeController.text,
            note: _noteController.text,
          );
    if (fieldError != null) {
      _showMessage(fieldError, type: MoneyActionFeedbackType.error);
      return;
    }

    if (_paymentRecoveryError != null) {
      _showMessage(
        _paymentRecoveryError!,
        type: MoneyActionFeedbackType.warning,
        canRetry: true,
      );
      return;
    }

    if (!_submissionGate.tryClaim()) return;
    if (_isTransferAction) {
      FocusScope.of(context).unfocus();
      setState(() {});
    }
    var confirmed = false;
    try {
      final recoveryVersion = _paymentRecoveryOutcomeVersion;
      final kycCanConfirm = await _ensureKycCanConfirm(amount);
      if (!kycCanConfirm || !mounted) return;
      // A previous uncertain payment just reached a final state. Let the user
      // inspect that result before intentionally starting a different payment.
      if (_paymentOperation != null &&
          (recoveryVersion != _paymentRecoveryOutcomeVersion ||
              _paymentRecoveryError != null ||
              !_paymentRecoveryLoaded)) {
        return;
      }
      confirmed = await _confirmSubmission(amount);
    } finally {
      _submissionGate.release();
      if (_isTransferAction && mounted) setState(() {});
    }
    if (!confirmed || !mounted) return;

    setState(() {
      _isSubmitting = true;
      _setMessageState(null);
    });

    final paymentOperation = _paymentOperation;
    final paymentUserId = _paymentRecoveryUser;
    final canonicalPayload =
        paymentOperation == null ? null : _canonicalPaymentPayload(amount);
    PaymentAttempt? matchingPaymentAttempt;

    try {
      if (paymentOperation != null) {
        if (paymentUserId == null || paymentUserId.isEmpty) {
          if (mounted) {
            setState(() {
              _isSubmitting = false;
              _setMessageState(
                'Your account could not be identified for payment protection. Sign in again before sending.',
                type: MoneyActionFeedbackType.error,
              );
            });
          }
          return;
        }

        matchingPaymentAttempt = await _paymentAttemptStore.findUnresolved(
          paymentUserId,
          paymentOperation,
          canonicalPayload!,
        );
        if (!mounted) return;

        if (matchingPaymentAttempt != null && !explicitRetry) {
          final retry = await _confirmExistingPaymentRetry(
            matchingPaymentAttempt,
          );
          if (!retry) {
            if (mounted) setState(() => _isSubmitting = false);
            return;
          }
        } else if (matchingPaymentAttempt == null &&
            _relevantUnresolvedPaymentAttempts.isNotEmpty &&
            !explicitRetry) {
          final separatePayment = await _confirmSeparatePayment();
          if (!separatePayment) {
            if (mounted) setState(() => _isSubmitting = false);
            return;
          }
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _setMessageState(
              'Payment protection could not be checked. Try again before sending.',
              type: MoneyActionFeedbackType.error,
              canRetry: true);
        });
      }
      return;
    }

    final transactionPin = await _requireTransactionApproval(
      title: _isTransferAction
          ? 'Confirm transfer'
          : 'Approve ${_configFor(widget.kind).title.toLowerCase()}',
      subtitle: _isTransferAction
          ? 'Enter your transaction PIN.'
          : 'Confirm this money action before it is submitted.',
    );
    if (transactionPin == null || !mounted) {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
      return;
    }

    String? paymentAttemptKey;
    var requestStarted = false;
    PaymentAttemptState? receivedPaymentState;
    Map<String, dynamic>? receivedPaymentData;
    try {
      final idempotencyKey = paymentOperation == null
          ? _attemptIdempotency.keyFor(_attemptFingerprint(amount))
          : await _paymentAttemptStore.prepare(
              paymentUserId!,
              paymentOperation,
              canonicalPayload!,
            );
      if (paymentOperation != null) {
        paymentAttemptKey = idempotencyKey;
        await _paymentAttemptStore.markSubmitted(
          paymentUserId!,
          paymentAttemptKey,
        );
      }
      requestStarted = true;
      final response = await _request(amount, idempotencyKey, transactionPin);
      final responseData = _asResponseMap(response.data);
      final serverState = paymentOperation == null
          ? null
          : _paymentAttemptStateFromResponse(responseData);
      receivedPaymentState = serverState;
      receivedPaymentData = responseData;
      if (paymentOperation != null) {
        final updatedAttempt = await _paymentAttemptStore.recordServerState(
          userId: paymentUserId!,
          attemptKey: paymentAttemptKey!,
          state: serverState!,
          reference: _responseString(responseData['reference']),
        );
        _replacePaymentAttempt(updatedAttempt);
      } else {
        _attemptIdempotency.markFinalOutcome();
      }
      // Send, withdraw and VTU purchases all move wallet money; let
      // balance-driven screens (e.g. the home dashboard) re-fetch.
      walletRefreshSignal.bump();

      if (!mounted) return;

      if (serverState == PaymentAttemptState.unknown ||
          serverState == PaymentAttemptState.submitted ||
          serverState == PaymentAttemptState.prepared) {
        setState(() {
          _setMessageState(
            'We could not confirm this payment. It will not be sent again automatically. Check status or contact support.',
            type: MoneyActionFeedbackType.warning,
            canRetry: true,
          );
        });
        return;
      }

      if (widget.kind == MoneyActionKind.withdraw) {
        final withdrawalStatus = _responseString(
          responseData['status'],
          fallback: 'PENDING',
        ).toUpperCase();
        final reference = _responseString(responseData['reference']);

        if (withdrawalStatus == 'PENDING' && reference.isNotEmpty) {
          context.pushReplacement(AppRoutes.withdrawAuthorizeFor(reference));
          return;
        }

        if (withdrawalStatus == 'SUCCESS') {
          context.pushReplacement(
            AppRoutes.withdrawSuccess,
            extra: responseData,
          );
          return;
        }

        if (withdrawalStatus == 'FAILED' || withdrawalStatus == 'REVERSED') {
          setState(() {
            _setMessageState(
              withdrawalStatus == 'REVERSED'
                  ? 'This withdrawal was reversed. No second withdrawal was sent.'
                  : 'This withdrawal was not completed. No second withdrawal was sent.',
              type: MoneyActionFeedbackType.error,
              canRetry: false,
            );
          });
          return;
        }
      }

      if (widget.kind == MoneyActionKind.send) {
        if (serverState != PaymentAttemptState.success) {
          setState(() {
            _setMessageState(
              serverState == PaymentAttemptState.reversed
                  ? 'This transfer was reversed. No second transfer was sent.'
                  : 'This transfer was not completed. No second transfer was sent.',
              type: MoneyActionFeedbackType.error,
            );
          });
          return;
        }
        final reference = _responseString(responseData['reference']);
        if (reference.isEmpty) {
          _showMessage(
              'Your transfer was confirmed, but its reference is unavailable. Check your history before sending again.',
              type: MoneyActionFeedbackType.warning);
          return;
        }
        _showInternalTransferReceipt(reference,
            initialReceipt: responseData, replace: true);
        return;
      }

      setState(() {
        _captureVtuOrder(responseData);
        _setMessageState(
          _successMessage(responseData),
          type: _feedbackTypeForPaymentState(serverState),
        );
      });
      _orderPollAttempts = 0;
      _scheduleVtuOrderAutoCheck();
    } catch (error) {
      final pinRejection = transactionPinRejectionMessage(error);
      if (pinRejection != null) _pinStatusRequest = null;
      if (requestStarted &&
          receivedPaymentState?.isTerminal != true &&
          paymentAttemptKey != null &&
          paymentUserId != null) {
        try {
          final unresolved = await _paymentAttemptStore.recordServerState(
            userId: paymentUserId,
            attemptKey: paymentAttemptKey,
            // These exact 403 messages come from the server PIN guard before
            // any money mutation. Its idempotency layer caches that rejection
            // as final; corrected credentials require a new attempt. Transport
            // errors and all other failures remain unresolved on the same key.
            state: pinRejection != null
                ? PaymentAttemptState.failed
                : PaymentAttemptState.unknown,
          );
          _replacePaymentAttempt(unresolved);
        } catch (_) {
          // Keep the original error visible. A failed journal write also
          // prevents a replacement send because the record remains submitted
          // or the screen is blocked by the recovery error on next load.
        }
      }
      if (mounted) {
        setState(() {
          _setMessageState(
            pinRejection ??
                (receivedPaymentState == PaymentAttemptState.success
                    ? 'Payment confirmed. Reference: ${_responseString(receivedPaymentData?['reference'])}. Open your history for the receipt.'
                    : receivedPaymentState?.isTerminal == true
                        ? 'This payment is ${receivedPaymentState!.wireName.toLowerCase()}. Check your history for the final details.'
                        : !requestStarted
                            ? 'Payment protection could not prepare the transfer. No transfer request was sent. Try again.'
                            : paymentOperation == null
                                ? authErrorMessage(error, 'Request failed')
                                : 'We could not confirm this payment. It is still unresolved and will not be sent again automatically.'),
            type: receivedPaymentState == PaymentAttemptState.success
                ? MoneyActionFeedbackType.success
                : !requestStarted || paymentOperation == null
                    ? MoneyActionFeedbackType.error
                    : MoneyActionFeedbackType.warning,
            canRetry: receivedPaymentState?.isTerminal != true,
          );
        });
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  bool get _isVtuAction {
    return [
      MoneyActionKind.airtime,
      MoneyActionKind.data,
      MoneyActionKind.cable,
      MoneyActionKind.electricity,
    ].contains(widget.kind);
  }

  String _vtuSelectionId() {
    if (widget.kind == MoneyActionKind.airtime &&
        _airtimeScope == 'international') {
      return _airtimeOperatorId;
    }
    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'GH') {
      return _dataOperatorId;
    }
    if (widget.kind == MoneyActionKind.electricity &&
        _electricityCountryCode == 'GH') {
      return _electricityBillerId;
    }
    return _vtuProvider;
  }

  void _captureVtuOrder(dynamic data) {
    if (!_isVtuAction || data is! Map<String, dynamic>) return;

    final orderId = data['orderId'];
    final reference = data['reference'];
    if (orderId is String && orderId.isNotEmpty) {
      _pendingOrderReference = orderId;
      _trackedOrder = null;
    } else if (reference is String && reference.isNotEmpty) {
      _pendingOrderReference = reference;
      _trackedOrder = null;
    }
    if (_pendingOrderReference != null) {
      final state = _responseString(data['orderStatus'] ?? data['status'],
          fallback: 'PENDING');
      final known = {
        'SUCCESS',
        'FAILED',
        'REVERSED',
        'PENDING',
        'PROCESSING',
        'UNKNOWN'
      }.contains(state)
          ? state
          : 'PENDING';
      _trackedOrder = VtuOrderStatus(
          orderId: _pendingOrderReference!,
          reference:
              _responseString(reference, fallback: _pendingOrderReference!),
          orderStatus: known,
          transactionStatus: known,
          provider: _vtuProvider,
          amount:
              _responseString(data['amount'], fallback: _amountController.text),
          currency: _currency,
          targetMasked: null,
          nextRequeryAt: null,
          purchasedCode: null);
    }
  }

  Map<String, dynamic> _asResponseMap(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    return const {};
  }

  String _responseString(dynamic value, {String fallback = ''}) {
    if (value == null) return fallback;
    final text = value.toString().trim();
    return text.isEmpty ? fallback : text;
  }

  static const _terminalOrderStatuses = {'SUCCESS', 'FAILED', 'REVERSED'};

  void _scheduleVtuOrderAutoCheck() {
    _orderPollTimer?.cancel();
    if (!_isVtuAction ||
        _pendingOrderReference == null ||
        _orderPollAttempts >= 4) {
      return;
    }
    final status = _trackedOrder?.orderStatus;
    if (status != null && _terminalOrderStatuses.contains(status)) {
      return;
    }

    final delay = Duration(seconds: _orderPollAttempts == 0 ? 4 : 7);
    _orderPollTimer = Timer(delay, () async {
      final reference = _pendingOrderReference;
      if (!mounted || reference == null) return;
      _orderPollAttempts++;
      try {
        final order = await _vtuService.getOrderStatus(reference);
        if (!mounted || reference != _pendingOrderReference) return;
        setState(() {
          _trackedOrder = order;
          if (_terminalOrderStatuses.contains(order.orderStatus)) {
            _setMessageState(
              _orderStatusMessage(order),
              type: _feedbackTypeForOrder(order),
            );
          }
        });
      } catch (_) {
        // Background refresh only; the panel keeps its manual check button.
      }
      _scheduleVtuOrderAutoCheck();
    });
  }

  Future<void> _checkVtuOrderStatus() async {
    final pendingReference = _pendingOrderReference;
    final reference = _trackedOrder?.orderId ?? _pendingOrderReference;
    if (reference == null || _isCheckingOrder) return;

    setState(() {
      _isCheckingOrder = true;
      _vtuStatusError = null;
      _setMessageState(null);
    });

    try {
      final order = await _vtuService.requeryOrder(
        reference,
        idempotencyKey: _attemptIdempotency.keyFor('vtu-requery|$reference'),
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted || pendingReference != _pendingOrderReference) return;
      setState(() {
        _trackedOrder = order;
        _pendingOrderReference = order.orderId;
        _setMessageState(
          _orderStatusMessage(order),
          type: _feedbackTypeForOrder(order),
        );
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _vtuStatusError =
            'We could not update the status. Your payment is still being checked.';
        _setMessageState(
          authErrorMessage(error, 'Unable to refresh VTU order status'),
          type: MoneyActionFeedbackType.error,
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isCheckingOrder = false);
      }
    }
  }

  Future<void> _submitExchange() async {
    if (_isSubmitting) return;

    final amountResult = MoneyActionFormValidator.validateAmount(
      _amountController.text,
    );
    if (amountResult.error != null) {
      _showMessage(amountResult.error!, type: MoneyActionFeedbackType.error);
      return;
    }
    final amount = amountResult.value!;

    if (_exchangeFrom == _exchangeTo) {
      _showMessage(
        'Choose two different currencies.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    if (_exchangeEffectiveRate == null) {
      await _loadExchangeRate();
      if (!mounted) return;
    }

    if (_exchangeEffectiveRate == null) {
      _showMessage(
        'Wait for the live exchange rate before submitting.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    final kycCanConfirm = await _ensureKycCanConfirm(amount);
    if (!kycCanConfirm) return;

    final confirmed = await _confirmSubmission(amount);
    if (!confirmed) return;

    setState(() {
      _isSubmitting = true;
      _setMessageState(null);
    });

    final transactionPin = await _requireTransactionApproval(
      title: 'Enter your transaction PIN',
      subtitle: 'Approve this exchange request before the quote is created.',
    );
    if (transactionPin == null) {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
      return;
    }

    try {
      final response = await _apiClient.client.post(
        '/api/exchange/quote',
        options: Options(
          headers: {
            'Idempotency-Key': _attemptIdempotency.keyFor(
              _attemptFingerprint(amount),
            ),
          },
        ),
        data: {'from': _exchangeFrom, 'to': _exchangeTo, 'amount': amount},
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted) return;

      final data = Map<String, dynamic>.from(response.data as Map);
      final receipt = ExchangeReceipt.fromApi(
        data,
        destinationLabel: _defaultDestinationLabel(_exchangeTo),
        destinationAccount: 'To be added',
        destinationInstitution: _defaultDestinationInstitution(_exchangeTo),
        note: '',
      );
      context.push(AppRoutes.exchangeSettlement, extra: receipt);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _setMessageState(
          authErrorMessage(error, 'Could not create exchange quote'),
          type: MoneyActionFeedbackType.error,
          canRetry: true,
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<dynamic> _request(
    String amount,
    String idempotencyKey,
    String transactionPin,
  ) {
    final options = Options(headers: {'Idempotency-Key': idempotencyKey});
    final data = _paymentRequestPayload(amount);
    if (widget.kind != MoneyActionKind.fund) {
      data['transactionPin'] = transactionPin;
    }

    switch (widget.kind) {
      case MoneyActionKind.fund:
        return Future.error(
          StateError('Bank-transfer funding uses virtual accounts.'),
        );
      case MoneyActionKind.send:
        return _apiClient.client.post(
          '/api/transfers/internal',
          options: options,
          data: data,
        );
      case MoneyActionKind.withdraw:
        return _apiClient.client.post(
          '/api/payments/withdraw',
          options: options,
          data: data,
        );
      case MoneyActionKind.exchange:
        return _apiClient.client.post(
          '/api/exchange/quote',
          options: options,
          data: data,
        );
      case MoneyActionKind.airtime:
      case MoneyActionKind.data:
      case MoneyActionKind.cable:
      case MoneyActionKind.electricity:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          options: options,
          data: data,
        );
    }
  }

  Map<String, dynamic> _paymentRequestPayload(String amount) {
    if (_extendedVtuPayload != null) {
      return Map<String, dynamic>.from(_extendedVtuPayload!);
    }
    switch (widget.kind) {
      case MoneyActionKind.fund:
        return <String, dynamic>{};
      case MoneyActionKind.send:
        return {
          'recipientEmail': _recipientController.text.trim(),
          'amount': amount,
          'currency': _currency,
          if (_noteController.text.trim().isNotEmpty)
            'note': _noteController.text.trim(),
        };
      case MoneyActionKind.withdraw:
        final beneficiary = _activeBeneficiary;
        return {
          'amount': amount,
          'currency': _currency,
          'provider': _provider,
          if (beneficiary != null)
            'beneficiaryId': beneficiary.beneficiaryId
          else ...{
            'bankCode': _bankCodeController.text.trim(),
            'accountNumber': _accountNumberController.text.trim(),
            'accountName': _accountNameController.text.trim(),
          },
        };
      case MoneyActionKind.exchange:
        return {
          'from': _currency,
          'to': _currency == 'NGN' ? 'GHS' : 'NGN',
          'amount': amount,
        };
      case MoneyActionKind.airtime:
        final phone = _normalizedPhone(_recipientController.text, 'NG');
        return {
          'type': 'airtime',
          'provider': _vtuProvider,
          'contactPhone': phone,
          'recipientNumber': phone,
          'amount': amount,
        };
      case MoneyActionKind.data:
        final phone = _normalizedPhone(_recipientController.text, 'NG');
        return {
          'type': 'data',
          'provider': _vtuProvider,
          'contactPhone': phone,
          'packageId': _dataPackageId,
          'recipientNumber': phone,
          'amount': amount,
        };
      case MoneyActionKind.cable:
        return {
          'type': 'cable',
          'provider': _vtuProvider,
          'contactPhone': _normalizedPhone(
            _cablePhoneController.text,
            'NG',
          ),
          if (_cableSubscriptionType == 'change') 'packageId': _cablePackageId,
          'smartCardNumber': _recipientController.text.trim(),
          'subscriptionType': _cableSubscriptionType,
          'amount': amount,
        };
      case MoneyActionKind.electricity:
        return {
          'type': 'electricity',
          'provider': _vtuProvider,
          'contactPhone': _normalizedPhone(
            _electricityPhoneController.text,
            'NG',
          ),
          'meterNumber': _recipientController.text.trim(),
          'meterType': _meterType,
          'amount': amount,
        };
    }
  }

  /// Payload persisted in the encrypted journal. It keeps exact string money
  /// values and stable recipient identity while removing raw account/utility
  /// identifiers that are not needed to resolve an attempt.
  Map<String, dynamic> _canonicalPaymentPayload(String amount) {
    final payload = _paymentRequestPayload(amount);
    switch (widget.kind) {
      case MoneyActionKind.send:
        payload['recipientEmail'] =
            _recipientController.text.trim().toLowerCase();
        break;
      case MoneyActionKind.withdraw:
        final beneficiary = _activeBeneficiary;
        if (beneficiary != null) {
          return {
            'amount': amount,
            'currency': _currency,
            'provider': _provider,
            'beneficiaryId': beneficiary.beneficiaryId,
          };
        }
        final accountNumber = _accountNumberController.text.trim();
        payload
          ..remove('accountNumber')
          ..['accountNumberHash'] = _identifierDigest(accountNumber)
          ..['accountNumberMasked'] = _maskAccountNumber(accountNumber);
        break;
      case MoneyActionKind.airtime:
      case MoneyActionKind.data:
      case MoneyActionKind.cable:
      case MoneyActionKind.electricity:
        _hashPayloadIdentifier(payload, 'contactPhone');
        _hashPayloadIdentifier(payload, 'recipientNumber');
        _hashPayloadIdentifier(payload, 'smartCardNumber');
        _hashPayloadIdentifier(payload, 'meterNumber');
        _hashPayloadIdentifier(payload, 'smileEmail');
        _hashPayloadIdentifier(payload, 'smileAccountId');
        break;
      case MoneyActionKind.fund:
      case MoneyActionKind.exchange:
        break;
    }
    return payload;
  }

  void _hashPayloadIdentifier(Map<String, dynamic> payload, String key) {
    final value = payload.remove(key);
    if (value is! String || value.trim().isEmpty) return;
    payload['${key}Hash'] = _identifierDigest(value);
    payload['${key}Masked'] = _maskIdentifier(value);
  }

  String _identifierDigest(String value) {
    return sha256.convert(utf8.encode(value.trim().toLowerCase())).toString();
  }

  String _maskIdentifier(String value) {
    final normalized = value.trim();
    if (normalized.length <= 4) return '****';
    return '${'*' * (normalized.length - 4)}${normalized.substring(normalized.length - 4)}';
  }

  PaymentAttemptState _paymentAttemptStateFromResponse(
    Map<String, dynamic> data,
  ) {
    final status = _responseString(data['status']).toUpperCase();
    switch (status) {
      case 'SUCCESS':
        return PaymentAttemptState.success;
      case 'PENDING':
        return PaymentAttemptState.pending;
      case 'FAILED':
        return PaymentAttemptState.failed;
      case 'REVERSED':
        return PaymentAttemptState.reversed;
    }

    if (data['success'] == true) return PaymentAttemptState.success;
    // A reference without a final status is a provider-side in-flight
    // response. Keep it pending until the resolver gives us a final state.
    if (_responseString(data['reference']).isNotEmpty) {
      return PaymentAttemptState.pending;
    }
    return PaymentAttemptState.unknown;
  }

  MoneyActionFeedbackType _feedbackTypeForPaymentState(
    PaymentAttemptState? state,
  ) {
    switch (state) {
      case PaymentAttemptState.success:
        return MoneyActionFeedbackType.success;
      case PaymentAttemptState.failed:
      case PaymentAttemptState.reversed:
        return MoneyActionFeedbackType.error;
      case PaymentAttemptState.pending:
      case PaymentAttemptState.unknown:
      case PaymentAttemptState.prepared:
      case PaymentAttemptState.submitted:
      case null:
        return MoneyActionFeedbackType.warning;
    }
  }

  void _replacePaymentAttempt(PaymentAttempt updated) {
    final index = _unresolvedPaymentAttempts.indexWhere(
      (attempt) => attempt.attemptKey == updated.attemptKey,
    );
    final next = [..._unresolvedPaymentAttempts];
    if (updated.isUnresolved) {
      if (index >= 0) {
        next[index] = updated;
      } else {
        next.add(updated);
      }
    } else if (index >= 0) {
      next.removeAt(index);
    }
    _unresolvedPaymentAttempts = next;
  }

  Future<bool> _confirmExistingPaymentRetry(PaymentAttempt attempt) async {
    final reference = attempt.reference;
    final status = attempt.state.wireName.toLowerCase();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Payment still unresolved'),
        content: Text(
          'This $status payment${reference == null ? '' : ' ($reference)'} '
          'has no confirmed final result. Retry with a fresh transaction PIN using the same payment key?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Check status later'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Retry this payment'),
          ),
        ],
      ),
    );
    return result == true;
  }

  Future<bool> _confirmSeparatePayment() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Previous payment unresolved'),
        content: const Text(
          'A previous payment of this type is still unresolved. Starting another can create a second debit. Continue only if this is a separate payment.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Start separate payment'),
          ),
        ],
      ),
    );
    return result == true;
  }

  /// Convert a locally formatted number (e.g. 0803...) into the E.164 form
  /// the backend validates against, using the flow's country code.
  String _normalizedPhone(String raw, String countryCode) {
    final trimmed = countryCode == 'NG' ? VtuPhone.normalize(raw) : raw.trim();
    if (trimmed.startsWith('+')) return trimmed;
    const prefixes = {
      'NG': '+234',
      'GH': '+233',
      'KE': '+254',
      'ZA': '+27',
      'US': '+1',
      'GB': '+44',
    };
    final prefix = prefixes[countryCode];
    if (prefix != null && trimmed.startsWith('0') && trimmed.length > 1) {
      return '$prefix${trimmed.substring(1)}';
    }
    return trimmed;
  }

  String _attemptFingerprint(String amount) {
    return [
      widget.kind.name,
      amount,
      _currency,
      _exchangeFrom,
      _exchangeTo,
      _provider,
      _vtuProvider,
      _airtimeScope,
      _airtimeCountryCode,
      _airtimeOperatorId,
      _dataCountryCode,
      _dataOperatorId,
      _electricityCountryCode,
      _electricityBillerId,
      _dataPackageId,
      _cablePackageId,
      _cableSubscriptionType,
      _cablePhoneController.text.trim(),
      _meterType,
      _electricityPhoneController.text.trim(),
      _recipientController.text.trim().toLowerCase(),
      _bankCodeController.text.trim(),
      _accountNumberController.text.trim(),
      _activeBeneficiary?.beneficiaryId ?? '',
    ].join('|');
  }

  Future<bool> _ensureKycCanConfirm(String amount) async {
    final route = _routeForKycGate();
    if (route == null) return true;

    HomeUser user;
    try {
      user = await _fetchCurrentUserForKycGate();
    } catch (error) {
      if (!mounted) return false;
      _showMessage(
        authErrorMessage(error, 'Could not verify your KYC status.'),
        type: MoneyActionFeedbackType.error,
        canRetry: true,
      );
      return false;
    }

    final isBlocked = KycGatePolicy.isBlocked(
      route: route,
      status: user.kycStatus,
      kycTier: user.kycTier,
    );
    if (!isBlocked) {
      if (user.kycTier != 'TIER_1') return true;
      try {
        final overview =
            await KycService(apiClient: _apiClient).fetchOverview();
        final gate = kycActionLimitGate(
            overview,
            amount,
            widget.kind == MoneyActionKind.exchange
                ? _exchangeFrom
                : _currency);
        if (gate == null) return true;
        if (!mounted) return false;
        final proceed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
                  title: Text(gate.title),
                  content: Text(gate.message),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        child: const Text('Back')),
                    FilledButton(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        child: Text(gate.upgrade
                            ? 'Upgrade to Tier 2'
                            : 'Contact support'))
                  ],
                ));
        if (proceed == true && mounted) {
          await context
              .push(gate.upgrade ? AppRoutes.kyc : AppRoutes.profileSupport);
        }
        return false;
      } catch (error) {
        if (mounted) {
          _showMessage(
              authErrorMessage(
                  error, 'Could not check your account limits. Try again.'),
              type: MoneyActionFeedbackType.error);
        }
        return false;
      }
    }
    if (!mounted) return false;

    final pendingVerification = user.kycStatus.toUpperCase() == 'SUBMITTED';
    final goToKyc = await _showKycConfirmationGate(
      pendingVerification: pendingVerification,
    );
    if (goToKyc == true && mounted) {
      context.push(AppRoutes.kyc);
    }
    return false;
  }

  Future<HomeUser> _fetchCurrentUserForKycGate() async {
    final response = await _apiClient.client.post<dynamic>(
      '/api/auth/bootstrap',
      options: Options(
        headers: const {'Cache-Control': 'no-cache', 'Pragma': 'no-cache'},
      ),
    );
    final data = response.data;
    final user = data is Map ? data['user'] : null;
    if (user is! Map) {
      throw StateError('KYC status was not available.');
    }
    final currentUser = HomeUser.fromJson(Map<String, dynamic>.from(user));
    if (currentUser.id.isNotEmpty) {
      await _restorePaymentAttemptsForUser(currentUser.id);
    }
    return currentUser;
  }

  String? _routeForKycGate() {
    switch (widget.kind) {
      case MoneyActionKind.send:
        return AppRoutes.sendTrustpay;
      case MoneyActionKind.withdraw:
        return AppRoutes.withdraw;
      case MoneyActionKind.exchange:
        return AppRoutes.exchange;
      case MoneyActionKind.airtime:
        return AppRoutes.airtime;
      case MoneyActionKind.data:
        return AppRoutes.data;
      case MoneyActionKind.cable:
        return AppRoutes.cable;
      case MoneyActionKind.electricity:
        return AppRoutes.electricity;
      case MoneyActionKind.fund:
        return null;
    }
  }

  Future<bool?> _showKycConfirmationGate({required bool pendingVerification}) {
    final title = pendingVerification
        ? 'Your BVN check is in progress'
        : 'Verify BVN to continue';
    final message = pendingVerification
        ? 'View your verification status. This transaction has not been submitted.'
        : 'Activate Tier 1 to use this service within your account limits.';

    return showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
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
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
              ),
              child: Text(pendingVerification
                  ? 'View verification status'
                  : 'Verify BVN'),
            ),
          ],
        );
      },
    );
  }

  Future<bool> _confirmSubmission(String amount) async {
    final config = _configFor(widget.kind);
    final rows = _reviewRows(amount);

    return showPaymentReviewSheet(
      context,
      title: 'Review ${config.title.toLowerCase()}',
      amountLabel: _isTransferAction
          ? transferMoneyLabel(amount, _currency)
          : rows.first.value,
      amountWords: moneyAmountInWords(amount, _currency),
      entries: rows
          .skip(1)
          .map((row) => PaymentReviewEntry(row.label, row.value))
          .toList(),
    );
  }

  List<_ReviewRowData> _reviewRows(String amount) {
    if (_extendedVtuPayload != null) {
      return _extendedVtuReview.entries
          .map((entry) => _ReviewRowData(entry.key, entry.value))
          .toList();
    }
    switch (widget.kind) {
      case MoneyActionKind.fund:
        final account = _preferredFundingAccount();
        return [
          _ReviewRowData('Amount', '$amount $_currency'),
          if (account != null) ...[
            _ReviewRowData('Bank', account.bankName),
            _ReviewRowData('Account', account.accountNumberMasked),
          ] else
            const _ReviewRowData('Funding account', 'Not available'),
        ];
      case MoneyActionKind.send:
        return [
          ...InternalTransferReviewContract.financialRows(
            amount: amount,
            currency: _currency,
          ).map((row) => _ReviewRowData(row.label, row.value)),
          if (_resolvedRecipientName != null &&
              _resolvedRecipientName!.isNotEmpty)
            _ReviewRowData('Name', _resolvedRecipientName!),
          _ReviewRowData('Recipient', _recipientController.text.trim()),
          if (_noteController.text.trim().isNotEmpty)
            _ReviewRowData('Note', _noteController.text.trim()),
        ];
      case MoneyActionKind.withdraw:
        final beneficiary = _activeBeneficiary;
        if (beneficiary != null) {
          return [
            _ReviewRowData('Amount', '$amount $_currency'),
            _ReviewRowData('Bank', beneficiary.bankName),
            _ReviewRowData('Account', beneficiary.accountNumberMasked),
            _ReviewRowData('Name', beneficiary.accountName),
          ];
        }
        final bankLabel =
            _selectedWithdrawalBank?.name ?? _bankCodeController.text.trim();
        return [
          _ReviewRowData('Amount', '$amount $_currency'),
          _ReviewRowData('Bank', bankLabel),
          _ReviewRowData(
            'Account',
            _maskAccountNumber(_accountNumberController.text.trim()),
          ),
          _ReviewRowData('Name', _accountNameController.text.trim()),
        ];
      case MoneyActionKind.exchange:
        final sendAmount = double.tryParse(amount) ?? 0;
        final estimatedReceive = _estimateReceiveAmount(sendAmount);
        return [
          _ReviewRowData('You send', '$amount $_exchangeFrom'),
          _ReviewRowData(
            'You receive',
            estimatedReceive > 0
                ? '${_formatAmount(estimatedReceive)} $_exchangeTo'
                : _exchangeTo,
          ),
          _ReviewRowData(
            'Rate',
            _exchangeEffectiveRate == null
                ? 'Live rate required'
                : '1 $_exchangeFrom = ${_formatRate(_exchangeEffectiveRate!)} $_exchangeTo',
          ),
        ];
      case MoneyActionKind.airtime:
        return [
          _ReviewRowData('You pay', _formatNairaAmount(amount)),
          _ReviewRowData(
            'Destination',
            _airtimeScope == 'international'
                ? _countryName(_airtimeCountryCode)
                : 'Nigeria',
          ),
          _ReviewRowData(
            _airtimeScope == 'international' ? 'Operator' : 'Network',
            _airtimeScope == 'international'
                ? _providerName(
                    _airtimeOperatorsForCountry(_airtimeCountryCode),
                    _airtimeOperatorId,
                  )
                : _providerName(_localAirtimeProviders, _vtuProvider),
          ),
          _ReviewRowData('Phone', _recipientController.text.trim()),
        ];
      case MoneyActionKind.data:
        return [
          _ReviewRowData('You pay', _formatNairaAmount(amount)),
          _ReviewRowData('Country', _countryName(_dataCountryCode)),
          _ReviewRowData(
            _dataCountryCode == 'GH' ? 'Operator' : 'Network',
            _dataCountryCode == 'GH'
                ? _providerName(
                    _dataOperatorsForCountry(_dataCountryCode),
                    _dataOperatorId,
                  )
                : _providerName(_localDataProviders, _vtuProvider),
          ),
          if (_dataCountryCode == 'NG' && _selectedDataPackageName() != null)
            _ReviewRowData('Package', _selectedDataPackageName()!),
          _ReviewRowData('Phone', _recipientController.text.trim()),
        ];
      case MoneyActionKind.cable:
        final matchingPackages = _cablePackages.where(
          (item) => item.id == _cablePackageId,
        );
        final packageName =
            matchingPackages.isEmpty ? null : matchingPackages.first.name;
        return [
          _ReviewRowData('You pay', _formatNairaAmount(amount)),
          _ReviewRowData(
            'Provider',
            _providerName(_localCableProviders, _vtuProvider),
          ),
          if (packageName != null) _ReviewRowData('Bouquet', packageName),
          _ReviewRowData('Smart card', _recipientController.text.trim()),
          if (_cableCustomerName != null)
            _ReviewRowData('Customer', _cableCustomerName!),
        ];
      case MoneyActionKind.electricity:
        return [
          _ReviewRowData('You pay', _formatNairaAmount(amount)),
          _ReviewRowData('Country', _countryName(_electricityCountryCode)),
          _ReviewRowData(
            _electricityCountryCode == 'GH' ? 'Biller' : 'Provider',
            _electricityCountryCode == 'GH'
                ? _providerName(
                    _electricityBillersForCountry(_electricityCountryCode),
                    _electricityBillerId,
                  )
                : _providerName(_localElectricityProviders, _vtuProvider),
          ),
          _ReviewRowData('Meter', _recipientController.text.trim()),
          if (_meterCustomerName != null)
            _ReviewRowData('Customer', _meterCustomerName!),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (_isVtuAction && extendedVtuProviders.contains(_vtuProvider)) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
            actions: [
              Padding(
                  padding: const EdgeInsets.only(right: 16),
                  child: _vtuProvider == 'foreign-airtime'
                      ? ValueListenableBuilder<VtuCountryMenu?>(
                          valueListenable: _foreignCountryMenu,
                          builder: (context, menu, _) => VtuCountrySelector(
                              enabled: !_isSubmitting &&
                                  _pendingOrderReference == null,
                              menu: menu ??
                                  VtuCountryMenu(
                                      countries: const {},
                                      value: null,
                                      onChanged: (_) {})))
                      : _vtuCountrySelector())
            ],
            title:
                Text(_providerName(_providersForCurrentFlow(), _vtuProvider)),
            leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: _isSubmitting ? null : _leaveSpecialistVtu)),
        body: ListView(padding: const EdgeInsets.all(24), children: [
          ExtendedVtuForm(
              key: ValueKey(_vtuProvider),
              client: _apiClient.client,
              onCountryMenuChanged: (menu) {
                if (mounted) _foreignCountryMenu.value = menu;
              },
              provider: _vtuProvider,
              type: widget.kind == MoneyActionKind.airtime
                  ? 'airtime'
                  : widget.kind == MoneyActionKind.data
                      ? 'data'
                      : 'cable',
              disabled: _isSubmitting || _pendingOrderReference != null,
              onReady: (payload, review) async {
                setState(() {
                  _extendedVtuPayload = payload;
                  _extendedVtuReview = review;
                });
                await _submit();
              }),
          if (_pendingOrderReference != null)
            _VtuOrderStatusPanel(
                reference: _pendingOrderReference!,
                order: _trackedOrder,
                isChecking: _isCheckingOrder,
                onCheckStatus: _checkVtuOrderStatus),
          if (_message != null)
            _MessagePanel(
                message: _message!,
                type: _messageType,
                onRetry: _messageCanRetry ? _retryLastSubmission : null),
        ]),
      );
    }

    if (widget.kind == MoneyActionKind.exchange) {
      return _buildExchangeScaffold(context);
    }
    if (_isTransferAction) {
      final details = widget.kind == MoneyActionKind.send
          ? _isSendRecipientStep
          : _isWithdrawalDetailsStep;
      return PopScope(
        canPop: !_transferLocked && !details,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && !_transferLocked && details) _handlePageBack();
        },
        child: _buildTransferScaffold(context),
      );
    }
    if (_isLocalMobileTopup) return _buildMobileTopupScaffold(context);

    final config = _configFor(widget.kind);
    final isAirtimeAmountPage =
        widget.kind == MoneyActionKind.airtime && _isAirtimeAmountStep;
    final isAirtimeRecipientPage =
        widget.kind == MoneyActionKind.airtime && !_isAirtimeAmountStep;
    final isElectricityPaymentPage =
        widget.kind == MoneyActionKind.electricity && _isElectricityPaymentStep;
    final isWithdrawalDetailsPage =
        widget.kind == MoneyActionKind.withdraw && _isWithdrawalDetailsStep;
    final isCableRecipientPage =
        widget.kind == MoneyActionKind.cable && _isCableRecipientStep;
    final isCablePaymentPage =
        widget.kind == MoneyActionKind.cable && _isCablePaymentStep;
    final pageSubtitle = isAirtimeAmountPage
        ? 'Step 2 of 2 · Choose how much airtime to send.'
        : isAirtimeRecipientPage
            ? 'Step 1 of 2 · Choose a network and enter the phone number.'
            : widget.kind == MoneyActionKind.data
                ? (_isDataPaymentStep
                    ? 'Step 2 of 2 · Confirm your number and payment.'
                    : 'Step 1 of 2 · Choose a country, network, and plan.')
                : widget.kind == MoneyActionKind.withdraw
                    ? isWithdrawalDetailsPage
                        ? 'Step 2 of 2 · Enter the bank details.'
                        : 'Step 1 of 2 · Choose the payout currency and amount.'
                    : isCableRecipientPage
                        ? 'Step 2 of 3 · Enter the smart card and contact number.'
                        : isCablePaymentPage
                            ? 'Step 3 of 3 · Choose a bouquet for the verified smart card.'
                            : isElectricityPaymentPage
                                ? 'Enter the amount to recharge the selected meter.'
                                : config.subtitle;

    return Scaffold(
      backgroundColor: AppColors.background,
      bottomNavigationBar: _isLocalMobileTopup
          ? Padding(
              padding: EdgeInsets.only(
                  bottom: MediaQuery.viewInsetsOf(context).bottom),
              child: _mobilePurchaseFooter())
          : null,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
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
                  if (_isVtuAction)
                    VtuPageHeader(
                        title: config.title,
                        onBack: _handlePageBack,
                        showBackButton: widget.showBackButton,
                        trailing: _vtuCountrySelector())
                  else
                    TpPageHeader(
                      label: config.title,
                      showBackButton: widget.showBackButton,
                      onBack: _handlePageBack,
                      menuActions: widget.kind == MoneyActionKind.withdraw
                          ? [
                              TpPageMenuAction(
                                  label: 'Withdraw cedis',
                                  icon: Icons.payments_outlined,
                                  onTap: () => Navigator.of(context).push(
                                      MaterialPageRoute(
                                          builder: (_) =>
                                              const GhanaMoneyScreen(
                                                  withdraw: true))))
                            ]
                          : widget.kind == MoneyActionKind.fund
                              ? [
                                  TpPageMenuAction(
                                      label: 'Add cedis',
                                      icon: Icons.payments_outlined,
                                      onTap: () => Navigator.of(context).push(
                                          MaterialPageRoute(
                                              builder: (_) =>
                                                  const GhanaMoneyScreen())))
                                ]
                              : const [],
                    ),
                  const SizedBox(height: AppSpacing.lg),
                  if (_isVtuAction) ...[
                    VtuProgress(
                      step: widget.kind == MoneyActionKind.airtime
                          ? (_isAirtimeAmountStep ? 1 : 0)
                          : widget.kind == MoneyActionKind.data
                              ? (_isDataPaymentStep ? 1 : 0)
                              : widget.kind == MoneyActionKind.cable
                                  ? (_isCablePaymentStep
                                      ? 2
                                      : _isCableRecipientStep
                                          ? 1
                                          : 0)
                                  : (_isElectricityPaymentStep ? 1 : 0),
                      labels: widget.kind == MoneyActionKind.cable
                          ? const ['Provider', 'Account', 'Payment']
                          : widget.kind == MoneyActionKind.data
                              ? const ['Number & plan', 'Payment']
                              : const ['Recipient', 'Amount'],
                    ),
                  ] else
                    Text(pageSubtitle, style: AppTextStyles.bodyL),
                  const SizedBox(height: AppSpacing.lg),
                  if (_isLoadingPaymentRecovery &&
                      _paymentRecoveryUser != null) ...[
                    const _InfoPanel(
                      text: 'Checking unresolved payment status...',
                      isLoading: true,
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  if (_relevantUnresolvedPaymentAttempts.isNotEmpty) ...[
                    _PaymentRecoveryPanel(
                      attempts: _relevantUnresolvedPaymentAttempts,
                      isChecking: _isLoadingPaymentRecovery,
                      onCheckStatus: _checkPaymentAttempt,
                      onSupport: () => context.push(AppRoutes.profileSupport),
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  if (_paymentRecoveryError != null) ...[
                    _MessagePanel(
                      message: _paymentRecoveryError!,
                      type: MoneyActionFeedbackType.warning,
                      onRetry: _refreshPaymentRecovery,
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  if (widget.kind == MoneyActionKind.send ||
                      (widget.kind == MoneyActionKind.withdraw &&
                          !isWithdrawalDetailsPage)) ...[
                    _CurrencySelector(
                      value: _currency,
                      values: widget.kind == MoneyActionKind.withdraw
                          ? const ['NGN']
                          : const ['NGN', 'GHS'],
                      onChanged: (value) => setState(() => _currency = value),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _InputField(
                      controller: _amountController,
                      label: 'Amount',
                      focusNode: widget.kind == MoneyActionKind.send
                          ? _sendAmountFocusNode
                          : null,
                      textInputAction: widget.kind == MoneyActionKind.send
                          ? TextInputAction.next
                          : null,
                      onSubmitted: widget.kind == MoneyActionKind.send
                          ? (_) => _sendRecipientFocusNode.requestFocus()
                          : null,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                      ],
                    ),
                  ],
                  if (widget.kind == MoneyActionKind.withdraw &&
                      !isWithdrawalDetailsPage) ...[
                    const SizedBox(height: AppSpacing.md),
                    _TransferCurrencyNotice(
                      onExchange: () => context.push(AppRoutes.exchange),
                    ),
                  ],
                  ..._extraFields(),
                  if (_isVtuAction &&
                      widget.kind != MoneyActionKind.electricity &&
                      widget.kind != MoneyActionKind.cable &&
                      (!isAirtimeRecipientPage || isAirtimeAmountPage))
                    ..._vtuAmountSection(),
                  if (isAirtimeRecipientPage && !_isLocalMobileTopup) ...[
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed:
                          _isSubmitting ? null : _continueToAirtimeAmount,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(54),
                      ),
                      child: const Text('Continue to amount'),
                    ),
                  ],
                  if (widget.kind == MoneyActionKind.data &&
                      !_isLocalMobileTopup &&
                      !_isDataPaymentStep) ...[
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: _isSubmitting ? null : _continueToDataPayment,
                      style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(54)),
                      child: const Text('Continue to payment'),
                    ),
                  ],
                  if (widget.kind == MoneyActionKind.data &&
                      !_isLocalMobileTopup &&
                      _isDataPaymentStep) ...[
                    const SizedBox(height: AppSpacing.lg),
                    _buildSubmitButton('Buy data', 'Data'),
                  ],
                  if (widget.kind == MoneyActionKind.withdraw &&
                      !isWithdrawalDetailsPage) ...[
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed:
                          _isSubmitting ? null : _continueToWithdrawalDetails,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(54),
                      ),
                      child: const Text('Continue to bank details'),
                    ),
                  ] else if (widget.kind != MoneyActionKind.fund &&
                      widget.kind != MoneyActionKind.data &&
                      widget.kind != MoneyActionKind.electricity &&
                      widget.kind != MoneyActionKind.cable &&
                      !_isLocalMobileTopup &&
                      !isAirtimeRecipientPage) ...[
                    const SizedBox(height: AppSpacing.lg),
                    _buildSubmitButton(config.buttonLabel, config.title),
                  ],
                  if (_vtuCatalogMessage != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    _MessagePanel(
                      message: _vtuCatalogMessage!,
                      type: MoneyActionFeedbackType.warning,
                      onRetry: _loadVtuCatalogs,
                    ),
                  ],
                  if (_pendingOrderReference != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    _VtuOrderStatusPanel(
                      reference: _pendingOrderReference!,
                      order: _trackedOrder,
                      isChecking: _isCheckingOrder,
                      onCheckStatus: _checkVtuOrderStatus,
                    ),
                  ],
                  if (_message != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    _MessagePanel(
                      message: _message!,
                      type: _messageType,
                      onRetry: _messageCanRetry ? _retryLastSubmission : null,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool get _mobileTopupConfirmedTerminal {
    final order = _trackedOrder;
    if (order != null) {
      return _terminalOrderStatuses.contains(order.orderStatus) &&
          _terminalOrderStatuses.contains(order.transactionStatus);
    }
    return _activeVtuRecoveryAttempt?.state.isTerminal == true;
  }

  void _startAnotherMobileTopup() {
    if (_isSubmitting || _isCheckingOrder || !_mobileTopupConfirmedTerminal) {
      return;
    }
    FocusScope.of(context).unfocus();
    _orderPollTimer?.cancel();
    _attemptIdempotency.markFinalOutcome();
    setState(() {
      _pendingOrderReference = null;
      _trackedOrder = null;
      _activeVtuRecoveryAttempt = null;
      _vtuStatusError = null;
      _orderPollAttempts = 0;
      _isAirtimeAmountStep = false;
      _isDataPaymentStep = false;
      _isDataPlanStep = false;
      _dataPackageId = null;
      _amountController.clear();
      _setMessageState(null);
    });
    if (widget.kind == MoneyActionKind.data) {
      _loadDataPackages(_vtuProvider);
    }
    _refreshPaymentRecovery();
  }

  void _editDataRecipient() {
    if (_isSubmitting) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _isDataPaymentStep = false;
      _isDataPlanStep = false;
      _setMessageState(null);
    });
  }

  Widget _vtuCountrySelector() {
    final airtime = widget.kind == MoneyActionKind.airtime;
    final data = widget.kind == MoneyActionKind.data;
    final electricity = widget.kind == MoneyActionKind.electricity;
    final foreignAvailable =
        airtime && _localAirtimeProviders.any((p) => p.id == 'foreign-airtime');
    final countries = foreignAvailable
        ? const {'NG': 'Nigeria', 'INT': 'International'}
        : {
            for (final code in electricity
                ? _electricityCountryOptions
                : _dataCountryOptions)
              code: _countryLabels[code]!
          };
    final value = airtime
        ? (_airtimeScope == 'local' ? 'NG' : _airtimeCountryCode)
        : data
            ? _dataCountryCode
            : electricity
                ? _electricityCountryCode
                : 'NG';
    return VtuCountrySelector(
      enabled: !_isSubmitting && _pendingOrderReference == null,
      menu: VtuCountryMenu(
          countries: countries,
          value: value,
          disabledCountries: {
            for (final code in countries.keys)
              if (code != 'NG' && code != 'INT') code
          },
          onChanged: (code) {
            if (_isSubmitting ||
                _pendingOrderReference != null ||
                code == value) {
              return;
            }
            if (airtime) {
              _setAirtimeScope(code == 'NG' ? 'local' : 'international');
            } else if (data) {
              _setDataCountryCode(code);
            } else if (electricity) {
              _setElectricityCountryCode(code);
            }
          }),
    );
  }

  void _leaveMobileTopupStatus() {
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    } else {
      context.go(AppRoutes.home);
    }
  }

  Future<void> _viewRecoveredTopup(PaymentAttempt attempt) async {
    final userId = _paymentRecoveryUser;
    if (userId == null || _isCheckingOrder) return;
    setState(() {
      _activeVtuRecoveryAttempt = attempt;
      _isCheckingOrder = true;
      _vtuStatusError = null;
    });
    try {
      final resolved = await _paymentRecoveryService.resolveAttempt(
          userId: userId, attempt: attempt);
      if (!mounted) return;
      _replacePaymentAttempt(resolved);
      setState(() => _activeVtuRecoveryAttempt = resolved);
      if (resolved.reference?.isNotEmpty == true) {
        final order = await _vtuService.getOrderStatus(resolved.reference!);
        if (!mounted) return;
        setState(() {
          _pendingOrderReference = order.orderId;
          _trackedOrder = order;
        });
        _orderPollAttempts = 0;
        _scheduleVtuOrderAutoCheck();
      }
    } catch (_) {
      if (mounted) {
        setState(() => _vtuStatusError = _activeVtuRecoveryAttempt
                    ?.state.isTerminal ==
                true
            ? 'Your payment result is confirmed. Additional details are temporarily unavailable.'
            : 'We could not update the status. Your original payment has been kept.');
      }
    } finally {
      if (mounted) setState(() => _isCheckingOrder = false);
    }
  }

  Widget _mobileTopupStatus() {
    final order = _trackedOrder;
    final attempt = _activeVtuRecoveryAttempt;
    final status =
        order?.transactionStatus ?? attempt?.state.wireName ?? 'PENDING';
    final terminal = _mobileTopupConfirmedTerminal;
    return VtuPurchaseStatusView(
      status: status,
      amount: order?.amount ??
          '${attempt?.canonicalPayload['amount'] ?? _amountController.text}',
      currency: order?.currency ?? _currency,
      title: widget.kind == MoneyActionKind.data
          ? 'Data top-up'
          : 'Airtime top-up',
      reference: order?.reference ?? attempt?.reference,
      recipient: order?.targetMasked ??
          (attempt == null ? _maskIdentifier(_recipientController.text) : null),
      network: order == null || order.provider == 'VTPASS'
          ? null
          : _providerName(_providersForCurrentFlow(), order.provider),
      message: _vtuStatusError,
      isChecking: _isCheckingOrder,
      onCheck: _pendingOrderReference != null
          ? _checkVtuOrderStatus
          : () {
              if (attempt != null) _viewRecoveredTopup(attempt);
            },
      onDone: _leaveMobileTopupStatus,
      onSupport: () => context.push(AppRoutes.profileSupport),
      onStartAnother:
          terminal && !_isCheckingOrder ? _startAnotherMobileTopup : null,
    );
  }

  Widget _buildMobileTopupScaffold(BuildContext context) {
    if (_pendingOrderReference != null || _activeVtuRecoveryAttempt != null) {
      return _mobileTopupStatus();
    }
    final data = widget.kind == MoneyActionKind.data;
    final step = data
        ? (_isDataPaymentStep
            ? 2
            : _isDataPlanStep
                ? 1
                : 0)
        : (_isAirtimeAmountStep ? 1 : 0);
    final title = data ? 'Data' : 'Airtime';
    final heading = step == 0
        ? 'Who is it for?'
        : data
            ? (step == 1 ? 'Find your data plan' : 'Review your top-up')
            : 'How much airtime?';
    return PopScope(
      canPop: step == 0 && !_isSubmitting,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && !_isSubmitting && step > 0) _handlePageBack();
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        bottomNavigationBar: Padding(
          padding:
              EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: _mobilePurchaseFooter(),
        ),
        body: SafeArea(
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
              child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 560),
                      child: Column(children: [
                        VtuPageHeader(
                            title: title,
                            onBack: () {
                              if (!_isSubmitting) _handlePageBack();
                            },
                            showBackButton: widget.showBackButton || step > 0,
                            trailing: _vtuCountrySelector()),
                        const SizedBox(height: 20),
                        VtuProgress(
                            step: step,
                            labels: data
                                ? const ['Recipient', 'Plan', 'Payment']
                                : const ['Recipient', 'Amount']),
                      ]))),
            ),
            Expanded(
                child: SingleChildScrollView(
              key: ValueKey('mobile-topup-${widget.kind.name}-$step'),
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(heading, style: AppTextStyles.headingM),
                        const SizedBox(height: 8),
                        Text(
                            step == 0
                                ? 'Enter a phone number, then confirm the network.'
                                : data && step == 1
                                    ? 'Choose a bundle that fits. Prices are loaded from your network.'
                                    : 'Check the recipient and amount before continuing.',
                            style: AppTextStyles.bodyM),
                        const SizedBox(height: 16),
                        if (_isLoadingPaymentRecovery &&
                            _paymentRecoveryUser != null)
                          const _InfoPanel(
                              text: 'Checking unresolved payment status...',
                              isLoading: true),
                        if (_relevantUnresolvedPaymentAttempts.isNotEmpty)
                          Padding(
                              padding: const EdgeInsets.only(bottom: 16),
                              child: ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: Icon(Icons.schedule_rounded,
                                    color: AppColors.primary),
                                title: Text('Previous top-up needs checking',
                                    style: AppTextStyles.labelM),
                                trailing: TextButton(
                                    onPressed: () => _viewRecoveredTopup(
                                        _relevantUnresolvedPaymentAttempts
                                            .first),
                                    child: const Text('View status')),
                              )),
                        if (_paymentRecoveryError != null)
                          _MessagePanel(
                              message: _paymentRecoveryError!,
                              type: MoneyActionFeedbackType.warning,
                              onRetry: _refreshPaymentRecovery),
                        ..._extraFields(),
                        if (step > 0) ..._vtuAmountSection(),
                        if (_vtuCatalogMessage != null) ...[
                          const SizedBox(height: 16),
                          _MessagePanel(
                              message: _vtuCatalogMessage!,
                              type: MoneyActionFeedbackType.warning,
                              onRetry: _loadVtuCatalogs),
                        ],
                        if (_message != null) ...[
                          const SizedBox(height: 16),
                          _MessagePanel(
                              message: _message!,
                              type: _messageType,
                              onRetry: _messageCanRetry
                                  ? _retryLastSubmission
                                  : null),
                        ],
                      ]),
                ),
              ),
            )),
          ]),
        ),
      ),
    );
  }

  Widget _buildExchangeScaffold(BuildContext context) {
    final amount = double.tryParse(
          _amountController.text.replaceAll(',', '').trim(),
        ) ??
        0;
    final estimatedReceive = _estimateReceiveAmount(amount);
    final config = _configFor(MoneyActionKind.exchange);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
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
                  TpPageHeader(
                    label: config.title,
                    showBackButton: widget.showBackButton,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(config.subtitle, style: AppTextStyles.bodyL),
                  const SizedBox(height: AppSpacing.lg),
                  _ExchangeSwapPanel(
                    fromCurrency: _exchangeFrom,
                    toCurrency: _exchangeTo,
                    amountController: _amountController,
                    estimatedReceive: estimatedReceive,
                    isRateLoading: _isLoadingExchangeRate,
                    rateError: _exchangeRateError,
                    onFromChanged: (value) => _changeExchangePair(from: value),
                    onToChanged: (value) => _changeExchangePair(to: value),
                    onSwap: () {
                      setState(() {
                        final nextFrom = _exchangeTo;
                        _exchangeTo = _exchangeFrom;
                        _exchangeFrom = nextFrom;
                        _exchangeEffectiveRate = null;
                        _exchangeRateError = null;
                      });
                      _loadExchangeRate();
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: _isSubmitting ? null : _submitExchange,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    child: _isSubmitting
                        ? const TrustPayLottie(
                            variant: TrustPayAnimationVariant.loading,
                            size: 20,
                          )
                        : const Text('Submit for review'),
                  ),
                  if (_message != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    _MessagePanel(
                      message: _message!,
                      type: _messageType,
                      onRetry: _messageCanRetry ? _retryLastSubmission : null,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  double _estimateReceiveAmount(double amount) {
    if (amount <= 0 || _exchangeEffectiveRate == null) return 0;
    return amount * _exchangeEffectiveRate!;
  }

  String _formatAmount(double amount) {
    return NumberFormat('#,##0.00').format(amount);
  }

  String _formatNairaAmount(String amount) {
    final parsed = double.tryParse(amount);
    return parsed == null ? '₦$amount' : '₦${_formatAmount(parsed)}';
  }

  String _formatRate(double rate) {
    if (rate >= 1) return rate.toStringAsFixed(4);
    return rate.toStringAsFixed(6);
  }

  String _defaultDestinationLabel(String currency) {
    return currency == 'NGN' ? 'Naira payout account' : 'Cedi payout wallet';
  }

  String _defaultDestinationInstitution(String currency) {
    return currency == 'NGN' ? 'Bank account' : 'Mobile money wallet';
  }

  Future<TransactionPinServerStatus> _preparedTransactionPinStatus() {
    final now = DateTime.now();
    if (_pinStatusRequest == null ||
        _pinStatusRequestedAt == null ||
        now.difference(_pinStatusRequestedAt!) > const Duration(seconds: 30)) {
      _pinStatusRequestedAt = now;
      _pinStatusRequest = _authService.getTransactionPinStatus();
    }
    return _pinStatusRequest!;
  }

  Future<String?> _requireTransactionApproval({
    required String title,
    required String subtitle,
  }) async {
    if (_isTransferAction && mounted) {
      setState(() => _isAwaitingTransferApproval = true);
    }
    try {
      final serverStatus = await _preparedTransactionPinStatus();

      if (!mounted) {
        return null;
      }

      if (!serverStatus.configured) {
        final shouldSetup = await showDialog<bool>(
              context: context,
              builder: (dialogContext) {
                return AlertDialog(
                  backgroundColor: AppColors.surface,
                  title: Text(
                    'Set transaction PIN',
                    style: AppTextStyles.headingM,
                  ),
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
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                      ),
                      child: const Text('Set up'),
                    ),
                  ],
                );
              },
            ) ??
            false;

        if (shouldSetup && mounted) {
          await context.push(AppRoutes.transactionSecurity);
          _pinStatusRequest = null;
        }
        return null;
      }

      if (serverStatus.locked) {
        _showMessage(
          'Transaction PIN is temporarily locked. Try again later.',
          type: MoneyActionFeedbackType.warning,
        );
        return null;
      }
      final resetHoldUntil = serverStatus.resetHoldUntil;
      if (resetHoldUntil != null &&
          resetHoldUntil.isAfter(DateTime.now().toUtc())) {
        _showMessage(
          'Money actions are temporarily locked after a PIN reset.',
          type: MoneyActionFeedbackType.warning,
        );
        return null;
      }

      final approvedPin = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => TransactionPinScreen.collect(
            pinLength: serverStatus.pinLength ?? 4,
            title: title,
            subtitle: subtitle,
            securityService: _transactionSecurityService,
            authService: _authService,
            confirmationSummary: !_isTransferAction
                ? null
                : TransferApprovalSummary(
                    amount: MoneyActionFormValidator.validateAmount(
                            _amountController.text)
                        .value!,
                    currency: _currency,
                    recipient: widget.kind == MoneyActionKind.send
                        ? (_resolvedRecipientName ?? 'TrustPay recipient')
                        : (_activeBeneficiary?.accountName ??
                            _withdrawalAccountName ??
                            'Bank recipient'),
                    destination: widget.kind == MoneyActionKind.send
                        ? _resolvedRecipientMasked
                        : '${_activeBeneficiary?.bankName ?? _selectedWithdrawalBank?.name ?? ''} · ${_activeBeneficiary?.accountNumberMasked ?? _maskAccountNumber(_accountNumberController.text)}',
                  ),
          ),
          fullscreenDialog: true,
        ),
      );

      return approvedPin;
    } catch (_) {
      if (mounted) {
        _showMessage('Could not check your transaction security. Try again.',
            type: MoneyActionFeedbackType.error);
      }
      return null;
    } finally {
      if (_isTransferAction && mounted) {
        setState(() => _isAwaitingTransferApproval = false);
      }
    }
  }

  List<Widget> _cableTotalSection() {
    final amountText = _resolvedAmountText();
    final amount = double.tryParse(amountText ?? '');
    if (amount == null || amount <= 0) return const [];
    return [
      const SizedBox(height: AppSpacing.md),
      _TotalDueLine(amountLabel: '₦${_formatAmount(amount)}'),
    ];
  }

  List<Widget> _vtuAmountSection() {
    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
      if (!_isDataPaymentStep) return const [];
      final amountText = _resolvedAmountText();
      final amount = double.tryParse(amountText ?? '');
      if (amount == null || amount <= 0) return const [];
      return [
        const SizedBox(height: AppSpacing.md),
        _TotalDueLine(amountLabel: '₦${_formatAmount(amount)}'),
      ];
    }

    return [
      const SizedBox(height: AppSpacing.md),
      _InputField(
        controller: _amountController,
        label: 'Amount',
        prefixText: '₦ ',
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
      ),
      if (widget.kind == MoneyActionKind.airtime) ...[
        const SizedBox(height: AppSpacing.sm),
        _QuickAmountChips(
          amounts: const [100, 200, 500, 1000, 2000, 5000],
          selectedText: _amountController.text.trim(),
          onSelected: (value) {
            setState(() => _amountController.text = value);
          },
        ),
      ],
    ];
  }

  List<Widget> _extraFields() {
    switch (widget.kind) {
      case MoneyActionKind.fund:
        return [
          const SizedBox(height: AppSpacing.md),
          _FundingAccountPanel(
            user: _fundingUser,
            account: _preferredFundingAccount(),
            isLoading: _isLoadingFundingAccounts,
            isRequesting: _isRequestingFundingAccount,
            message: _fundingAccountMessage,
            provisioningPending: _fundingProvisioning?.isPending == true,
            provisioningActionRequired:
                _fundingProvisioning?.isActionRequired == true,
            canRevealAccountNumber: _canRevealFundingAccount,
            accountConsentAccepted: _fundingAccountConsent,
            onAccountConsentChanged: (accepted) =>
                setState(() => _fundingAccountConsent = accepted),
            onRefresh: _loadFundingAccounts,
            onRequest: _requestFundingAccount,
            onCompleteKyc: () => context.push(AppRoutes.kyc),
            onCopy: _copyFundingValue,
          ),
          if (_paymentCapabilities?.checkout == true) ...[
            const SizedBox(height: AppSpacing.md),
            _PaystackCheckoutPanel(
              isLoadingCapabilities: _isLoadingPaymentCapabilities,
              isOpening: _isOpeningPaystackCheckout,
              minimumAmount:
                  _paymentCapabilities?.checkoutMinimumAmount ?? '50.00',
              amount: _checkoutAmount,
              hasPendingAttempt: _checkoutAttempt?.isUnresolved == true,
              reference: _checkoutReference,
              authorizationUrl: _checkoutAuthorizationUrl,
              message: _checkoutMessage,
              onOpen: _openPaystackCheckout,
              onReopen: _reopenPaystackCheckout,
              onVerify: _verifyPaystackCheckout,
            ),
          ],
        ];
      case MoneyActionKind.send:
        return [
          const SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Recipient email',
            keyboardType: TextInputType.emailAddress,
            focusNode: _sendRecipientFocusNode,
            textInputAction: TextInputAction.next,
            onSubmitted: (_) => _sendNoteFocusNode.requestFocus(),
          ),
          const SizedBox(height: AppSpacing.md),
          _ResolvedAccountPanel(
            accountName: _resolvedRecipientLabel,
            isResolving: _isResolvingRecipient,
            error: _recipientResolveError,
            canResolve: MoneyActionFormValidator.isValidEmail(
              _recipientController.text,
            ),
            onRetry: _resolveRecipientPreview,
            resolvingLabel: 'Finding TrustPay user...',
            idleLabel: 'Recipient name will appear here',
          ),
          const SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _noteController,
            label: 'Note optional',
            maxCodePoints: 120,
            focusNode: _sendNoteFocusNode,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => FocusScope.of(context).unfocus(),
            onChanged: (_) => setState(() {}),
          ),
        ];
      case MoneyActionKind.withdraw:
        if (!_isWithdrawalDetailsStep) {
          return const [];
        }
        final beneficiary = _activeBeneficiary;
        if (beneficiary != null) {
          return [
            const SizedBox(height: AppSpacing.md),
            _BeneficiaryPrefillPanel(
              beneficiary: beneficiary,
              onUseAnother: () {
                setState(() => _activeBeneficiary = null);
              },
            ),
          ];
        }
        return [
          const SizedBox(height: AppSpacing.md),
          _WithdrawalTransferSummary(
            amount: _amountController.text,
            currency: _currency,
            onEdit: () {
              setState(() {
                _isWithdrawalDetailsStep = false;
                _setMessageState(null);
              });
            },
          ),
          const SizedBox(height: AppSpacing.md),
          if (_withdrawalBanks.isNotEmpty || _isLoadingWithdrawalBanks)
            _SettlementBankSearchField(
              controller: _withdrawBankController,
              focusNode: _withdrawBankFocusNode,
              banks: _withdrawalBanks,
              isLoading: _isLoadingWithdrawalBanks,
              onSelected: _selectWithdrawalBank,
            )
          else
            _InputField(
              controller: _bankCodeController,
              label: 'Bank code',
              onChanged: (_) => _scheduleWithdrawalAccountResolve(),
            ),
          if (_withdrawalBankMessage != null) ...[
            const SizedBox(height: AppSpacing.sm),
            _InfoPanel(text: _withdrawalBankMessage!),
          ],
          const SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _accountNumberController,
            label: 'Account number',
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(10),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (_withdrawalBanks.isNotEmpty || _selectedWithdrawalBank != null)
            _ResolvedAccountPanel(
              accountName: _withdrawalAccountName,
              isResolving: _isResolvingWithdrawalAccount,
              error: _withdrawalResolveError,
              canResolve: _bankCodeController.text.trim().isNotEmpty &&
                  _accountNumberController.text.trim().length == 10,
              onRetry: _resolveWithdrawalAccount,
            )
          else
            _InputField(
              controller: _accountNameController,
              label: 'Account name',
            ),
        ];
      case MoneyActionKind.exchange:
        return const [
          SizedBox(height: AppSpacing.md),
          _InfoPanel(
            text:
                'This creates a live exchange quote. Quote execution will be wired to a confirmation step before wallet debit.',
          ),
        ];
      case MoneyActionKind.airtime:
        if (_isAirtimeAmountStep) {
          final providers = _providersForCurrentFlow();
          final selectedNetwork = _airtimeScope == 'international'
              ? _providerName(providers, _airtimeOperatorId)
              : _providerName(providers, _vtuProvider);
          return [
            const SizedBox(height: AppSpacing.md),
            _AirtimeRecipientSummary(
              providerId: _vtuProvider,
              network: selectedNetwork,
              phoneNumber: _recipientController.text.trim(),
              onEdit: () {
                setState(() {
                  _isAirtimeAmountStep = false;
                  _setMessageState(null);
                });
              },
            ),
          ];
        }

        final airtimeOperators = _airtimeOperatorsForCountry(
          _airtimeCountryCode,
        );
        final isLocalAirtime = _airtimeScope != 'international';
        return [
          const SizedBox(height: AppSpacing.md),
          if (isLocalAirtime) ...[
            VtuPhoneField(
                controller: _recipientController, enabled: !_isSubmitting),
            _mobileNetworkHint(),
            const VtuSectionLabel('Choose network'),
          ] else
            _InputField(
                controller: _recipientController,
                label: 'Phone number',
                keyboardType: TextInputType.phone),
          if (!isLocalAirtime) ...[
            if (_isLoadingVtuCatalog && airtimeOperators.isEmpty) ...[
              const _InfoPanel(
                text: 'Loading available operators...',
                isLoading: true,
              ),
              const SizedBox(height: AppSpacing.md),
            ] else if (airtimeOperators.isEmpty) ...[
              _InfoPanel(
                text:
                    'No ${_countryName(_airtimeCountryCode)} operators are available yet.',
              ),
              const SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Operator',
                value: _airtimeOperatorId,
                providers: airtimeOperators,
                onChanged: (value) =>
                    setState(() => _airtimeOperatorId = value),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ] else ...[
            if (_isLoadingVtuCatalog && _localAirtimeProviders.isEmpty) ...[
              const _NetworkTilesSkeleton(),
              const SizedBox(height: AppSpacing.md),
            ] else if (_localAirtimeProviders.isEmpty) ...[
              const _InfoPanel(text: 'No airtime networks are available yet.'),
              const SizedBox(height: AppSpacing.md),
            ] else ...[
              VtuNetworkPicker(
                enabled: !_isSubmitting,
                value: _vtuProvider,
                providers: _localAirtimeProviders,
                onChanged: (value) => _setVtuProvider(value),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ],
        ];
      case MoneyActionKind.data:
        if (_isDataPaymentStep) {
          return [
            const SizedBox(height: AppSpacing.md),
            _Panel(
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_providerName(_localDataProviders, _vtuProvider)} · ${_selectedDataPackageName() ?? 'Selected plan'}',
                      style: AppTextStyles.labelM,
                    ),
                  ),
                  TextButton(
                    onPressed: _isSubmitting
                        ? null
                        : () => setState(() => _isDataPaymentStep = false),
                    child: const Text('Change'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _AirtimeRecipientSummary(
              providerId: _vtuProvider,
              network: _providerName(_localDataProviders, _vtuProvider),
              phoneNumber: VtuPhone.normalize(_recipientController.text),
              onEdit: _editDataRecipient,
            ),
          ];
        }
        if (_isDataPlanStep && _dataCountryCode == 'NG') {
          return [
            _AirtimeRecipientSummary(
              providerId: _vtuProvider,
              network: _providerName(_localDataProviders, _vtuProvider),
              phoneNumber: VtuPhone.normalize(_recipientController.text),
              onEdit: _editDataRecipient,
            ),
            const SizedBox(height: AppSpacing.lg),
            if (_isLoadingVtuCatalog)
              const _InfoPanel(
                text: 'Loading live packages and prices...',
                isLoading: true,
              )
            else if (_dataPackages.isEmpty)
              const _InfoPanel(
                text: 'No data packages are available for this network yet.',
              )
            else
              VtuPlanPicker(
                enabled: !_isSubmitting,
                key: ValueKey(_vtuProvider),
                value: _dataPackageId,
                packages: _dataPackages,
                onChanged: (value) => setState(() => _selectDataPackage(value)),
              ),
          ];
        }
        final ghanaDataOperators = _dataOperatorsForCountry('GH');
        return [
          const SizedBox(height: AppSpacing.md),
          if (_dataCountryCode == 'NG') ...[
            VtuPhoneField(
                controller: _recipientController,
                label: 'Recipient phone number',
                enabled: !_isSubmitting),
            _mobileNetworkHint(),
            const VtuSectionLabel('Choose network'),
          ],
          if (_dataCountryCode == 'GH') ...[
            if (_isLoadingVtuCatalog && ghanaDataOperators.isEmpty) ...[
              const _InfoPanel(
                text: 'Loading available data operators...',
                isLoading: true,
              ),
              const SizedBox(height: AppSpacing.md),
            ] else if (ghanaDataOperators.isEmpty) ...[
              const _InfoPanel(
                text: 'No Ghana data operators are available yet.',
              ),
              const SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Operator',
                value: _dataOperatorId,
                providers: ghanaDataOperators,
                onChanged: (value) => setState(() => _dataOperatorId = value),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ] else if (_dataCountryCode != 'NG') ...[
            const _InfoPanel(
              text:
                  'This country is coming soon for mobile data. Nigeria is available now.',
            ),
            const SizedBox(height: AppSpacing.md),
          ] else ...[
            if (_isLoadingVtuCatalog && _localDataProviders.isEmpty) ...[
              const _NetworkTilesSkeleton(),
              const SizedBox(height: AppSpacing.md),
            ] else if (_localDataProviders.isEmpty) ...[
              const _InfoPanel(text: 'No data networks are available yet.'),
              const SizedBox(height: AppSpacing.md),
            ] else ...[
              VtuNetworkPicker(
                enabled: !_isSubmitting,
                value: _vtuProvider,
                providers: _localDataProviders,
                onChanged: (value) => _setVtuProvider(value),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            const SizedBox(height: AppSpacing.md),
          ],
        ];
      case MoneyActionKind.cable:
        if (_isCablePaymentStep) {
          return [
            const SizedBox(height: AppSpacing.md),
            _FormStepSection(
              step: '3',
              title: 'Choose a bouquet',
              subtitle: 'Pick a plan and confirm the payment.',
              children: [
                if (_cableCustomerName != null) ...[
                  _VerifiedCustomerPanel(
                    name: _cableCustomerName!,
                    address: null,
                    detail:
                        'Smart card ${_recipientController.text.trim()} — ${_providerName(_localCableProviders, _vtuProvider)}',
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else ...[
                  _InfoPanel(
                    text:
                        'Smart card ${_recipientController.text.trim()} — continuing without name verification. Double-check the number before paying.',
                    icon: Icons.warning_amber_rounded,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (_cableSubscriptionType == 'renew')
                  _InfoPanel(
                    text:
                        'Renewal amount confirmed by VTpass: ₦${_amountController.text}',
                  )
                else if (_isLoadingVtuCatalog && _cablePackages.isEmpty)
                  const _InfoPanel(
                    text: 'Loading bouquets and prices...',
                    isLoading: true,
                  )
                else if (_cablePackages.isEmpty)
                  const _InfoPanel(
                    text: 'No bouquets are available for this provider yet.',
                  )
                else
                  VtuPlanPicker(
                    enabled: !_isSubmitting,
                    value: _cablePackageId,
                    packages: _cablePackages,
                    onChanged: (value) =>
                        setState(() => _selectCablePackage(value)),
                  ),
                const SizedBox(height: AppSpacing.md),
                ..._cableTotalSection(),
                const SizedBox(height: AppSpacing.lg),
                _buildSubmitButton(
                  _configFor(widget.kind).buttonLabel,
                  _configFor(widget.kind).title,
                ),
              ],
            ),
          ];
        }

        if (_isCableRecipientStep) {
          return [
            const SizedBox(height: AppSpacing.md),
            _FormStepSection(
              step: '2',
              title: 'Card details',
              subtitle: 'Enter the smart card and contact phone number.',
              children: [
                _InputField(
                  controller: _recipientController,
                  label: 'Smart card / IUC number',
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(32),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                VtuPhoneField(
                    controller: _cablePhoneController,
                    label: 'Contact phone number',
                    enabled: !_isSubmitting),
                const SizedBox(height: AppSpacing.lg),
                FilledButton(
                  onPressed: _isVerifyingCard ? null : _continueToCablePayment,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(54),
                  ),
                  child: _isVerifyingCard
                      ? const TrustPayLottie(
                          variant: TrustPayAnimationVariant.loading,
                          size: 20,
                          semanticsLabel: 'Verifying smart card',
                        )
                      : const Text('Verify card & continue'),
                ),
              ],
            ),
          ];
        }

        return [
          const SizedBox(height: AppSpacing.md),
          _FormStepSection(
            step: '1',
            title: 'Choose a provider',
            subtitle: 'Choose your TV service to find available packages.',
            children: [
              if (_isLoadingVtuCatalog && _localCableProviders.isEmpty) ...[
                const _NetworkTilesSkeleton(),
                const SizedBox(height: AppSpacing.md),
              ] else if (_localCableProviders.isEmpty) ...[
                const _InfoPanel(
                  text: 'No cable TV providers are available yet.',
                ),
                const SizedBox(height: AppSpacing.md),
              ] else ...[
                VtuNetworkPicker(
                  enabled: !_isSubmitting,
                  value: _vtuProvider,
                  providers: _localCableProviders,
                  onChanged: (value) => _setVtuProvider(value),
                ),
                const SizedBox(height: AppSpacing.md),
              ],
              const SizedBox(height: AppSpacing.lg),
              FilledButton(
                onPressed: _continueToCableRecipientDetails,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(54),
                ),
                child: const Text('Continue to card details'),
              ),
            ],
          ),
        ];
      case MoneyActionKind.electricity:
        final ghanaElectricityBillers = _electricityBillersForCountry('GH');
        if (_isElectricityPaymentStep) {
          return [
            const SizedBox(height: AppSpacing.md),
            _FormStepSection(
              step: '2',
              title: 'Payment details',
              subtitle: 'Enter the recharge amount and submit the request.',
              children: [
                if (_meterCustomerName != null) ...[
                  _VerifiedCustomerPanel(
                    name: _meterCustomerName!,
                    address: _meterCustomerAddress,
                    detail: 'Meter ${_recipientController.text.trim()}',
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else ...[
                  _InfoPanel(
                    text:
                        'Meter ${_recipientController.text.trim()} — continuing without name verification. Double-check the number before paying.',
                    icon: Icons.warning_amber_rounded,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                _InputField(
                  controller: _amountController,
                  label: 'Amount',
                  prefixText: '₦ ',
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                _QuickAmountChips(
                  amounts: const [1000, 2000, 3000, 5000, 10000],
                  selectedText: _amountController.text.trim(),
                  onSelected: (value) {
                    setState(() => _amountController.text = value);
                  },
                ),
                const SizedBox(height: AppSpacing.lg),
                _buildSubmitButton(
                  _configFor(widget.kind).buttonLabel,
                  _configFor(widget.kind).title,
                ),
              ],
            ),
          ];
        }

        return [
          const SizedBox(height: AppSpacing.md),
          _FormStepSection(
            step: '1',
            title: 'Meter details',
            subtitle: 'Choose your provider and enter the meter details.',
            children: [
              _ChoiceRow(
                label: 'Meter type',
                value: _meterType,
                values: const ['prepaid', 'postpaid'],
                labels: const {
                  'prepaid': 'Prepaid',
                  'postpaid': 'Postpaid',
                },
                onChanged: (value) => setState(() {
                  _meterType = value;
                  _isElectricityPaymentStep = false;
                  _meterCustomerName = null;
                }),
              ),
              const SizedBox(height: AppSpacing.md),
              if (_electricityCountryCode == 'GH') ...[
                if (_isLoadingVtuCatalog &&
                    ghanaElectricityBillers.isEmpty) ...[
                  const _InfoPanel(
                    text: 'Loading available electricity billers...',
                    isLoading: true,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else if (ghanaElectricityBillers.isEmpty) ...[
                  const _InfoPanel(
                    text: 'No Ghana electricity billers are available yet.',
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else ...[
                  _VtuProviderSelector(
                    label: 'Biller',
                    value: _electricityBillerId,
                    providers: ghanaElectricityBillers,
                    onChanged: (value) => setState(() {
                      _electricityBillerId = value;
                      _isElectricityPaymentStep = false;
                    }),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
              ] else ...[
                if (_isLoadingVtuCatalog &&
                    _localElectricityProviders.isEmpty) ...[
                  const _InfoPanel(
                    text: 'Loading VTPass electricity providers...',
                    isLoading: true,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else if (_localElectricityProviders.isEmpty) ...[
                  const _InfoPanel(
                    text:
                        'No Nigerian electricity providers are available yet.',
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else ...[
                  _VtuProviderSelector(
                    label: 'Provider',
                    value: _vtuProvider,
                    providers: _localElectricityProviders,
                    onChanged: (value) => _setVtuProvider(value),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
              ],
              _InputField(
                controller: _recipientController,
                label: 'Meter number',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: AppSpacing.md),
              VtuPhoneField(
                  controller: _electricityPhoneController,
                  label: 'Contact phone number',
                  enabled: !_isSubmitting),
              const SizedBox(height: AppSpacing.lg),
              FilledButton(
                onPressed:
                    _isVerifyingMeter ? null : _continueToElectricityPayment,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(54),
                ),
                child: _isVerifyingMeter
                    ? const TrustPayLottie(
                        variant: TrustPayAnimationVariant.loading,
                        size: 20,
                        semanticsLabel: 'Verifying meter',
                      )
                    : Text(
                        _electricityCountryCode == 'NG'
                            ? 'Verify meter & continue'
                            : 'Continue',
                      ),
              ),
            ],
          ),
        ];
    }
  }

  Widget _buildSubmitButton(String label, String title) {
    return FilledButton(
      onPressed: _isSubmitting ? null : _submit,
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(54),
      ),
      child: _isSubmitting
          ? TrustPayLottie(
              variant: TrustPayAnimationVariant.loading,
              size: 30,
              semanticsLabel: 'Submitting $title',
            )
          : Text(label),
    );
  }

  HomeVirtualAccount? _preferredFundingAccount() {
    for (final account in _fundingAccounts) {
      if (account.provider.toUpperCase() == 'PAYSTACK' &&
          account.currency.toUpperCase() == 'NGN' &&
          account.status.toUpperCase() == 'ACTIVE') {
        return account;
      }
    }
    for (final account in _fundingAccounts) {
      if (account.provider.toUpperCase() == 'PAYSTACK' &&
          account.currency.toUpperCase() == 'NGN' &&
          (account.status.toUpperCase() == 'ACTIVE' ||
              account.status.toUpperCase() == 'PENDING')) {
        return account;
      }
    }
    return null;
  }

  Future<void> _copyFundingValue(String value) async {
    final trimmed = value.trim();
    if (trimmed.isEmpty || trimmed.contains('*')) {
      _showMessage(
        'Account number is not ready yet. Refresh and try again.',
        type: MoneyActionFeedbackType.warning,
      );
      return;
    }

    await Clipboard.setData(ClipboardData(text: trimmed));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Account number copied')));
  }
}

/// Adds thousands separators while preserving an optional decimal portion.
///
/// The formatted value is display-only: [MoneyActionFormValidator] removes
/// separators before producing the API payload.
class ThousandsSeparatorInputFormatter extends TextInputFormatter {
  static final _validInput = RegExp(r'^\d*\.?\d*$');

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final raw = newValue.text.replaceAll(',', '');
    if (!_validInput.hasMatch(raw)) return oldValue;

    final parts = raw.split('.');
    final groupedInteger = _groupDigits(parts.first);
    final formatted =
        parts.length == 1 ? groupedInteger : '$groupedInteger.${parts[1]}';
    final rawCursor =
        _rawOffsetAt(newValue.text, newValue.selection.baseOffset);
    final formattedCursor = _formattedOffsetAt(formatted, rawCursor);

    return newValue.copyWith(
      text: formatted,
      selection: TextSelection.collapsed(offset: formattedCursor),
      composing: TextRange.empty,
    );
  }

  static String _groupDigits(String value) {
    if (value.isEmpty) return value;
    final normalized = value.replaceFirst(RegExp(r'^0+(?=\d)'), '');
    final firstGroupLength =
        normalized.length % 3 == 0 ? 3 : normalized.length % 3;
    final groups = <String>[normalized.substring(0, firstGroupLength)];
    for (var index = firstGroupLength; index < normalized.length; index += 3) {
      groups.add(normalized.substring(index, index + 3));
    }
    return groups.join(',');
  }

  static int _rawOffsetAt(String value, int formattedOffset) {
    final offset = formattedOffset.clamp(0, value.length);
    return value.substring(0, offset).replaceAll(',', '').length;
  }

  static int _formattedOffsetAt(String value, int rawOffset) {
    var rawSeen = 0;
    for (var index = 0; index < value.length; index++) {
      if (value[index] == ',') continue;
      if (rawSeen == rawOffset) return index;
      rawSeen++;
    }
    return value.length;
  }
}

/// Returns a readable English description of an exchange amount.
String? exchangeAmountInWords(String rawAmount, String currency) {
  final value = rawAmount.trim().replaceAll(',', '');
  if (value.isEmpty || !RegExp(r'^\d+(\.\d+)?$').hasMatch(value)) {
    return null;
  }

  final parts = value.split('.');
  final whole = parts.first.replaceFirst(RegExp(r'^0+(?=\d)'), '');
  final wholeValue = int.tryParse(whole) ?? 0;
  if (wholeValue == 0 && (parts.length == 1 || int.tryParse(parts[1]) == 0)) {
    return null;
  }

  final currencyCode = currency.toUpperCase();
  final majorUnit = currencyCode == 'GHS' ? 'cedis' : 'naira';
  final minorUnit = currencyCode == 'GHS' ? 'pesewas' : 'kobo';
  final words = _integerToWords(wholeValue);
  final minor = parts.length == 2
      ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0
      : 0;
  final minorWords =
      minor == 0 ? '' : ' and ${_integerToWords(minor)} $minorUnit';
  return '${_capitalize(words)} $majorUnit$minorWords';
}

String _capitalize(String value) =>
    value.isEmpty ? value : '${value[0].toUpperCase()}${value.substring(1)}';

String _integerToWords(int value) {
  if (value == 0) return 'zero';
  const scales = ['', 'thousand', 'million', 'billion', 'trillion'];
  final groups = <String>[];
  var remaining = value;
  var scaleIndex = 0;
  while (remaining > 0) {
    final group = remaining % 1000;
    if (group > 0) {
      final groupWords = _underThousandToWords(group);
      groups.insert(0,
          scaleIndex == 0 ? groupWords : '$groupWords ${scales[scaleIndex]}');
    }
    remaining ~/= 1000;
    scaleIndex++;
  }
  return groups.join(', ');
}

String _underThousandToWords(int value) {
  const ones = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety'
  ];
  if (value < 20) return ones[value];
  if (value < 100) {
    return value % 10 == 0
        ? tens[value ~/ 10]
        : '${tens[value ~/ 10]}-${ones[value % 10]}';
  }
  final remainder = value % 100;
  final suffix = remainder == 0 ? '' : ' ${_underThousandToWords(remainder)}';
  return '${ones[value ~/ 100]} hundred$suffix';
}

class _CurrencySelector extends StatelessWidget {
  final String value;
  final List<String> values;
  final ValueChanged<String> onChanged;

  const _CurrencySelector({
    required this.value,
    required this.values,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _ChoiceRow(
      label: 'Currency',
      value: value,
      values: values,
      onChanged: onChanged,
    );
  }
}

class _TransferCurrencyNotice extends StatelessWidget {
  final VoidCallback onExchange;

  const _TransferCurrencyNotice({required this.onExchange});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.currency_exchange_rounded,
            size: 20,
            color: AppColors.primaryLight,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Bank payouts use NGN. If your funds are in GHS, exchange to NGN first.',
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textPrimary,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          TextButton(
            onPressed: onExchange,
            child: const Text('Exchange'),
          ),
        ],
      ),
    );
  }
}

class _WithdrawalTransferSummary extends StatelessWidget {
  final String amount;
  final String currency;
  final VoidCallback onEdit;

  const _WithdrawalTransferSummary({
    required this.amount,
    required this.currency,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final normalized = MoneyActionFormValidator.validateAmount(amount);
    final displayAmount = normalized.value == null
        ? '$amount $currency'
        : transferMoneyLabel(normalized.value!, currency);

    return _Panel(
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.check_rounded,
              color: AppColors.success,
              size: 20,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Transfer amount', style: AppTextStyles.bodyS),
                const SizedBox(height: 2),
                Text(
                  displayAmount,
                  style: AppTextStyles.labelL.copyWith(
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          TextButton(onPressed: onEdit, child: const Text('Edit')),
        ],
      ),
    );
  }
}

class _VtuProviderSelector extends StatelessWidget {
  final String label;
  final String value;
  final List<VtuProviderOption> providers;
  final ValueChanged<String> onChanged;

  const _VtuProviderSelector({
    required this.label,
    required this.value,
    required this.providers,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final items = providers.isEmpty
        ? [VtuProviderOption(id: value, name: value, type: '', isActive: true)]
        : providers;

    return DropdownButtonFormField<String>(
      isExpanded: true,
      initialValue:
          items.any((item) => item.id == value) ? value : items.first.id,
      items: items
          .map(
            (item) => DropdownMenuItem(
                value: item.id,
                child: Row(children: [
                  VtuProviderLogo(id: item.id, size: 28),
                  const SizedBox(width: 10),
                  Expanded(
                      child: Text(item.name, overflow: TextOverflow.ellipsis)),
                ])),
          )
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
      dropdownColor: AppColors.surface,
      decoration: _inputDecoration(label),
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
    );
  }
}

class _NetworkTilesSkeleton extends StatelessWidget {
  const _NetworkTilesSkeleton();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      children: [
        for (var i = 0; i < 4; i++) ...[
          if (i > 0) const SizedBox(width: AppSpacing.sm),
          const Expanded(
            child: ShimmerBlock(width: double.infinity, height: 76),
          ),
        ],
      ],
    );
  }
}

class _QuickAmountChips extends StatelessWidget {
  final List<int> amounts;
  final String selectedText;
  final ValueChanged<String> onSelected;

  const _QuickAmountChips({
    required this.amounts,
    required this.selectedText,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final selectedValue = double.tryParse(selectedText);

    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (final amount in amounts)
          Builder(
            builder: (context) {
              final selected =
                  selectedValue != null && selectedValue == amount.toDouble();
              return TapScale(
                onTap: () => onSelected(amount.toString()),
                borderRadius: BorderRadius.circular(AppRadius.full),
                semanticLabel: 'Set amount to $amount naira',
                child: AnimatedContainer(
                  constraints:
                      const BoxConstraints(minHeight: 48, minWidth: 76),
                  duration: const Duration(milliseconds: 160),
                  curve: Curves.easeOutCubic,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.primary.withValues(alpha: 0.1)
                        : AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    border: Border.all(
                      color: selected ? AppColors.primary : AppColors.border,
                      width: selected ? 1.4 : 1,
                    ),
                  ),
                  child: Text(
                    '₦${NumberFormat('#,##0').format(amount)}',
                    style: AppTextStyles.labelM.copyWith(
                      color:
                          selected ? AppColors.primary : AppColors.textPrimary,
                    ),
                  ),
                ),
              );
            },
          ),
      ],
    );
  }
}

class _TotalDueLine extends StatelessWidget {
  final String amountLabel;

  const _TotalDueLine({required this.amountLabel});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm + 4,
      ),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Expanded(child: Text('You pay', style: AppTextStyles.labelM)),
          Text(
            amountLabel,
            style: AppTextStyles.headingM.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _VerifiedCustomerPanel extends StatelessWidget {
  final String name;
  final String? address;
  final String detail;

  const _VerifiedCustomerPanel({
    required this.name,
    required this.address,
    required this.detail,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.success.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.verified_user_rounded, size: 20, color: AppColors.success),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: AppTextStyles.labelM),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  detail,
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
                if (address != null && address!.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    address!,
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ChoiceRow extends StatelessWidget {
  final String label;
  final String value;
  final List<String> values;
  final Map<String, String> labels;
  final ValueChanged<String> onChanged;

  const _ChoiceRow({
    required this.label,
    required this.value,
    required this.values,
    this.labels = const {},
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return DropdownButtonFormField<String>(
      isExpanded: true,
      initialValue: value,
      items: values.map((item) {
        final displayLabel = labels[item] ?? item;
        return DropdownMenuItem(
          value: item,
          child: Text(
            displayLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        );
      }).toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
      dropdownColor: AppColors.surface,
      decoration: _inputDecoration(label),
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
    );
  }
}

class _InputField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool enabled;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onChanged;
  final String? prefixText;
  final int? maxCodePoints;
  final FocusNode? focusNode;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  const _InputField({
    required this.controller,
    required this.label,
    this.enabled = true,
    this.keyboardType,
    this.inputFormatters,
    this.onChanged,
    this.prefixText,
    this.maxCodePoints,
    this.focusNode,
    this.textInputAction,
    this.onSubmitted,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return TextField(
      enabled: enabled,
      controller: controller,
      focusNode: focusNode,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      inputFormatters: [
        ...?inputFormatters,
        if (maxCodePoints != null)
          _UnicodeCodePointLimitingFormatter(maxCodePoints!),
      ],
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
      decoration: _inputDecoration(label, prefixText: prefixText).copyWith(
        counterText: maxCodePoints == null
            ? null
            : '${controller.text.runes.length}/$maxCodePoints',
      ),
    );
  }
}

class _ReviewRowData {
  final String label;
  final String value;

  const _ReviewRowData(this.label, this.value);
}

class _UnicodeCodePointLimitingFormatter extends TextInputFormatter {
  final int maxCodePoints;

  _UnicodeCodePointLimitingFormatter(this.maxCodePoints);

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (newValue.text.runes.length <= maxCodePoints) return newValue;
    final truncated = String.fromCharCodes(
      newValue.text.runes.take(maxCodePoints),
    );
    return TextEditingValue(
      text: truncated,
      selection: TextSelection.collapsed(offset: truncated.length),
    );
  }
}

class _PaystackCheckoutPanel extends StatefulWidget {
  final bool isLoadingCapabilities;
  final bool isOpening;
  final String minimumAmount;
  final String? amount;
  final bool hasPendingAttempt;
  final String? reference;
  final Uri? authorizationUrl;
  final String? message;
  final ValueChanged<String> onOpen;
  final VoidCallback onReopen;
  final VoidCallback onVerify;

  const _PaystackCheckoutPanel({
    required this.isLoadingCapabilities,
    required this.isOpening,
    required this.minimumAmount,
    required this.amount,
    required this.hasPendingAttempt,
    required this.reference,
    required this.authorizationUrl,
    required this.message,
    required this.onOpen,
    required this.onReopen,
    required this.onVerify,
  });

  @override
  State<_PaystackCheckoutPanel> createState() => _PaystackCheckoutPanelState();
}

class _PaystackCheckoutPanelState extends State<_PaystackCheckoutPanel> {
  final _amountController = TextEditingController();

  @override
  void didUpdateWidget(covariant _PaystackCheckoutPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.amount == widget.amount) return;
    final amount = widget.amount;
    if (amount == null || amount.isEmpty) {
      _amountController.clear();
    } else {
      _amountController.text = amount;
      _amountController.selection = TextSelection.collapsed(
        offset: _amountController.text.length,
      );
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Secure checkout', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Pay by card or bank transfer. TRUSTPAY verifies the reference on the server before crediting your NGN wallet.',
            style: AppTextStyles.bodyS,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Minimum checkout amount: NGN ${widget.minimumAmount}',
            style:
                AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _amountController,
            enabled: !widget.isOpening && !widget.hasPendingAttempt,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
            ],
            decoration: const InputDecoration(
              labelText: 'Amount (NGN)',
              hintText: 'e.g. 5000',
              prefixText: '₦ ',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: widget.isOpening ||
                      (widget.reference != null && widget.reference!.isNotEmpty)
                  ? null
                  : () => widget.onOpen(_amountController.text),
              icon: widget.isOpening
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.lock_outline_rounded),
              label: Text(
                widget.isOpening
                    ? 'Checking checkout...'
                    : widget.reference != null && widget.reference!.isNotEmpty
                        ? 'Payment pending'
                        : widget.hasPendingAttempt
                            ? 'Resume secure checkout'
                            : 'Open secure checkout',
              ),
            ),
          ),
          if (widget.message != null && widget.message!.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(widget.message!, style: AppTextStyles.bodyS),
          ],
          if (widget.reference != null && widget.reference!.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text('Payment reference', style: AppTextStyles.caption),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    widget.reference!,
                    key: const ValueKey('paystack-checkout-reference'),
                    style: AppTextStyles.bodyS,
                  ),
                ),
                IconButton(
                  tooltip: 'Copy payment reference',
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  onPressed: () async {
                    await Clipboard.setData(
                        ClipboardData(text: widget.reference!));
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Payment reference copied')),
                    );
                  },
                ),
              ],
            ),
            if (widget.authorizationUrl != null)
              OutlinedButton.icon(
                onPressed: widget.isOpening ? null : widget.onReopen,
                icon: const Icon(Icons.open_in_new_rounded),
                label: const Text('Open checkout again'),
              ),
            OutlinedButton.icon(
              onPressed: widget.isOpening ? null : widget.onVerify,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Check payment status'),
            ),
          ],
          if (widget.isLoadingCapabilities)
            const Padding(
              padding: EdgeInsets.only(top: AppSpacing.sm),
              child: LinearProgressIndicator(),
            ),
        ],
      ),
    );
  }
}

class _FundingAccountPanel extends StatelessWidget {
  final HomeUser? user;
  final HomeVirtualAccount? account;
  final bool isLoading;
  final bool isRequesting;
  final String? message;
  final bool provisioningPending;
  final bool provisioningActionRequired;
  final bool canRevealAccountNumber;
  final bool accountConsentAccepted;
  final VoidCallback onRefresh;
  final VoidCallback onRequest;
  final ValueChanged<bool> onAccountConsentChanged;
  final VoidCallback onCompleteKyc;
  final ValueChanged<String> onCopy;

  const _FundingAccountPanel({
    required this.user,
    required this.account,
    required this.isLoading,
    required this.isRequesting,
    required this.message,
    required this.provisioningPending,
    required this.provisioningActionRequired,
    required this.canRevealAccountNumber,
    required this.accountConsentAccepted,
    required this.onRefresh,
    required this.onRequest,
    required this.onAccountConsentChanged,
    required this.onCompleteKyc,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (isLoading) {
      return const StaggeredEntrance(
        child: _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ShimmerBlock(width: double.infinity, height: 18),
              SizedBox(height: AppSpacing.sm),
              ShimmerBlock(width: 220, height: 14),
              SizedBox(height: AppSpacing.sm),
              ShimmerBlock(width: double.infinity, height: 64),
            ],
          ),
        ),
      );
    }

    final fundingAccount = account;
    final displayNumber = canRevealAccountNumber
        ? fundingAccount?.displayAccountNumber ?? ''
        : '';
    final canCopy = canRevealAccountNumber &&
        displayNumber.isNotEmpty &&
        !displayNumber.contains('*');
    final accountPending = provisioningPending ||
        (fundingAccount != null &&
            displayNumber.isEmpty &&
            fundingAccount.status.toUpperCase() == 'PENDING');
    final accountStateMessage = provisioningActionRequired
        ? AccountSetupCopy.actionRequiredBody(bvnVerified: null)
        : accountPending
            ? AccountSetupCopy.pendingBody
            : message ?? 'Request your NGN account to fund by transfer.';

    return StaggeredEntrance(
      child: _Panel(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 240),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          child: accountPending
              ? Column(
                  key: const ValueKey('funding-pending'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.schedule_rounded),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'TrustPay is preparing your NGN receiving account.',
                      style: AppTextStyles.labelM,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      AccountSetupCopy.pendingBody,
                      style: AppTextStyles.bodyS,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    OutlinedButton.icon(
                      onPressed: onRefresh,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Refresh status'),
                    ),
                  ],
                )
              : fundingAccount == null
                  ? Column(
                      key: const ValueKey('funding-request'),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _FundingUserSummary(user: user),
                        const SizedBox(height: AppSpacing.md),
                        if (provisioningActionRequired) ...[
                          Row(
                            children: [
                              const Icon(Icons.warning_amber_rounded),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text(
                                  AccountSetupCopy.actionRequiredTitle,
                                  style: AppTextStyles.labelM,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                        ],
                        Text(
                          accountStateMessage,
                          style: AppTextStyles.bodyS.copyWith(
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        if (canRevealAccountNumber) ...[
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            value: accountConsentAccepted,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: const Text(
                              'I authorize TRUSTPAY to create a dedicated Paystack NGN receiving account for me.',
                            ),
                            onChanged: isRequesting
                                ? null
                                : (value) =>
                                    onAccountConsentChanged(value ?? false),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                        ],
                        Row(
                          children: [
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: canRevealAccountNumber
                                    ? (isRequesting || !accountConsentAccepted
                                        ? null
                                        : onRequest)
                                    : onCompleteKyc,
                                icon: !canRevealAccountNumber
                                    ? const Icon(Icons.verified_user_rounded)
                                    : isRequesting
                                        ? const TrustPayLottie(
                                            variant: TrustPayAnimationVariant
                                                .loading,
                                            size: 24,
                                            semanticsLabel:
                                                'Requesting funding account',
                                          )
                                        : const Icon(
                                            Icons.account_balance_rounded),
                                label: Text(
                                  !canRevealAccountNumber
                                      ? 'Verify BVN'
                                      : isRequesting
                                          ? 'Requesting account...'
                                          : 'Request account',
                                ),
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            IconButton(
                              onPressed: onRefresh,
                              icon: const Icon(Icons.refresh_rounded),
                              tooltip: 'Refresh',
                            ),
                          ],
                        ),
                      ],
                    )
                  : Column(
                      key: const ValueKey('funding-account'),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 42,
                              height: 42,
                              decoration: BoxDecoration(
                                color: AppColors.inputFill,
                                borderRadius:
                                    BorderRadius.circular(AppRadius.sm),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Icon(
                                Icons.account_balance_rounded,
                                color: AppColors.primary,
                                size: 22,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    fundingAccount.bankName,
                                    style: AppTextStyles.labelL,
                                  ),
                                  const SizedBox(height: AppSpacing.xs),
                                  Text(
                                    fundingAccount.accountName,
                                    style: AppTextStyles.bodyS,
                                  ),
                                ],
                              ),
                            ),
                            _StatusPill(label: fundingAccount.status),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        canRevealAccountNumber
                            ? Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(AppSpacing.md),
                                decoration: BoxDecoration(
                                  color: AppColors.background,
                                  borderRadius:
                                      BorderRadius.circular(AppRadius.sm),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            'Account number',
                                            style: AppTextStyles.bodyS.copyWith(
                                              color: AppColors.textSecondary,
                                            ),
                                          ),
                                          const SizedBox(height: AppSpacing.xs),
                                          AnimatedValueText(
                                            value:
                                                '${fundingAccount.currency} $displayNumber',
                                            style:
                                                AppTextStyles.headingM.copyWith(
                                              letterSpacing: 0,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: canCopy
                                          ? () => onCopy(displayNumber)
                                          : null,
                                      icon: const Icon(Icons.copy_rounded),
                                      tooltip: 'Copy account number',
                                    ),
                                  ],
                                ),
                              )
                            : _KycAccountNumberGate(
                                onCompleteKyc: onCompleteKyc),
                        const SizedBox(height: AppSpacing.md),
                        _FundingUserSummary(user: user),
                        const SizedBox(height: AppSpacing.md),
                        Text(
                          'Transfer NGN to this receiving account. Your wallet is credited after TRUSTPAY verifies the transaction.',
                          style: AppTextStyles.bodyS.copyWith(
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
        ),
      ),
    );
  }
}

class _KycAccountNumberGate extends StatelessWidget {
  final VoidCallback onCompleteKyc;

  const _KycAccountNumberGate({required this.onCompleteKyc});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.lock_outline_rounded, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Account number locked',
                  style: AppTextStyles.labelM,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Complete BVN and bank verification to reveal and share this account number.',
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: onCompleteKyc,
              icon: const Icon(Icons.verified_user_rounded, size: 18),
              label: const Text('Verify BVN'),
            ),
          ),
        ],
      ),
    );
  }
}

class _FundingUserSummary extends StatelessWidget {
  final HomeUser? user;

  const _FundingUserSummary({required this.user});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final currentUser = user;

    if (currentUser == null) {
      return Row(
        children: [
          Icon(Icons.verified_user_outlined, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Loading profile details...',
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
        ],
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.inputFill,
                child: Text(
                  currentUser.initials,
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.primary,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  currentUser.displayName,
                  style: AppTextStyles.labelM,
                ),
              ),
              _StatusPill(label: currentUser.kycStatus),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          _FundingDetailRow(label: 'Email', value: currentUser.email),
          if (currentUser.phone.isNotEmpty)
            _FundingDetailRow(label: 'Phone', value: currentUser.phone),
          _FundingDetailRow(label: 'Tier', value: currentUser.kycTier),
        ],
      ),
    );
  }
}

class _FundingDetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _FundingDetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Row(
        children: [
          SizedBox(
            width: 52,
            child: Text(
              label,
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.bodyS.copyWith(color: AppColors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}

class _PaymentRecoveryPanel extends StatelessWidget {
  final List<PaymentAttempt> attempts;
  final bool isChecking;
  final ValueChanged<PaymentAttempt> onCheckStatus;
  final VoidCallback onSupport;

  const _PaymentRecoveryPanel({
    required this.attempts,
    required this.isChecking,
    required this.onCheckStatus,
    required this.onSupport,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.sync_problem_rounded, color: AppColors.warning),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Payment recovery',
                  style: AppTextStyles.labelL,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'A previous payment has no confirmed final result. TrustPay will not send it again automatically.',
            style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final attempt in attempts) ...[
            _PaymentRecoveryRow(
              attempt: attempt,
              isChecking: isChecking,
              onCheckStatus: () => onCheckStatus(attempt),
            ),
            if (attempt != attempts.last) const Divider(height: AppSpacing.lg),
          ],
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: onSupport,
              icon: const Icon(Icons.support_agent_rounded, size: 18),
              label: const Text('Contact support'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PaymentRecoveryRow extends StatelessWidget {
  final PaymentAttempt attempt;
  final bool isChecking;
  final VoidCallback onCheckStatus;

  const _PaymentRecoveryRow({
    required this.attempt,
    required this.isChecking,
    required this.onCheckStatus,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final reference = attempt.reference;
    final status = switch (attempt.state) {
      PaymentAttemptState.prepared => 'Waiting for submission',
      PaymentAttemptState.submitted => 'Submitted · checking',
      PaymentAttemptState.unknown => 'Status unknown',
      PaymentAttemptState.pending => 'Pending',
      PaymentAttemptState.success => 'Success',
      PaymentAttemptState.failed => 'Failed',
      PaymentAttemptState.reversed => 'Reversed',
    };

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(status, style: AppTextStyles.labelM),
              if (reference != null && reference.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Reference: $reference',
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        TextButton.icon(
          onPressed: isChecking ? null : onCheckStatus,
          icon: isChecking
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.refresh_rounded, size: 18),
          label: const Text('Check status'),
        ),
      ],
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final String text;
  final IconData icon;
  final bool isLoading;

  const _InfoPanel({
    required this.text,
    this.icon = Icons.info_outline_rounded,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: isLoading
                ? CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  )
                : Icon(icon, size: 18, color: AppColors.textSecondary),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.bodyS.copyWith(color: AppColors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}

class _AirtimeRecipientSummary extends StatelessWidget {
  final String providerId;
  final String network;
  final String phoneNumber;
  final VoidCallback onEdit;

  const _AirtimeRecipientSummary({
    required this.providerId,
    required this.network,
    required this.phoneNumber,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VtuProviderLogo(id: providerId, size: 44),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Top-up recipient', style: AppTextStyles.bodyS),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  phoneNumber,
                  style: AppTextStyles.labelL,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  network,
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onEdit,
            child: const Text('Edit'),
          ),
        ],
      ),
    );
  }
}

class _FormStepSection extends StatelessWidget {
  final String step;
  final String title;
  final String subtitle;
  final List<Widget> children;

  const _FormStepSection({
    required this.step,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.full),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.22),
                ),
              ),
              child: Text(
                step,
                style: AppTextStyles.labelS.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.labelL.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    subtitle,
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        ...children,
      ],
    );
  }
}

class _MessagePanel extends StatelessWidget {
  final String message;
  final MoneyActionFeedbackType type;
  final VoidCallback? onRetry;

  const _MessagePanel({
    required this.message,
    this.type = MoneyActionFeedbackType.info,
    this.onRetry,
  });

  Color get _accentColor {
    switch (type) {
      case MoneyActionFeedbackType.success:
        return AppColors.success;
      case MoneyActionFeedbackType.error:
        return AppColors.error;
      case MoneyActionFeedbackType.warning:
        return AppColors.warning;
      case MoneyActionFeedbackType.info:
        return AppColors.primary;
    }
  }

  IconData get _icon {
    switch (type) {
      case MoneyActionFeedbackType.success:
        return Icons.check_circle_rounded;
      case MoneyActionFeedbackType.error:
        return Icons.error_rounded;
      case MoneyActionFeedbackType.warning:
        return Icons.info_rounded;
      case MoneyActionFeedbackType.info:
        return Icons.info_rounded;
    }
  }

  String get _title {
    switch (type) {
      case MoneyActionFeedbackType.success:
        return 'Completed';
      case MoneyActionFeedbackType.error:
        return 'Needs attention';
      case MoneyActionFeedbackType.warning:
        return 'Check details';
      case MoneyActionFeedbackType.info:
        return 'Update';
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final accent = _accentColor;

    return StaggeredEntrance(
      duration: const Duration(milliseconds: 260),
      beginOffset: const Offset(0, 0.02),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: accent.withValues(alpha: 0.42)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (type == MoneyActionFeedbackType.success)
              const TrustPayLottie(
                variant: TrustPayAnimationVariant.success,
                size: 28,
                repeat: false,
                semanticsLabel: 'Completed',
              )
            else
              Icon(_icon, color: accent, size: 22),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _title,
                    style: AppTextStyles.labelM.copyWith(color: accent),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    message,
                    style: AppTextStyles.bodyM.copyWith(
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (onRetry != null) ...[
                    const SizedBox(height: AppSpacing.sm),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh_rounded, size: 18),
                        label: const Text('Retry'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: accent,
                          side: BorderSide(color: accent),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VtuOrderStatusPanel extends StatelessWidget {
  final String reference;
  final VtuOrderStatus? order;
  final bool isChecking;
  final VoidCallback onCheckStatus;

  const _VtuOrderStatusPanel({
    required this.reference,
    required this.order,
    required this.isChecking,
    required this.onCheckStatus,
  });

  bool get _isTerminal {
    final status = order?.orderStatus;
    return ['SUCCESS', 'FAILED', 'REVERSED'].contains(status);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final status = order?.orderStatus ?? 'PENDING';

    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Recent VTU order', style: AppTextStyles.labelM),
              ),
              _StatusPill(label: status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Reference: ${order?.reference ?? reference}',
            style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
          ),
          if (order != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${order!.provider} - ${order!.currency} ${order!.amount}',
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
            if (order!.targetMasked != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Recipient: ${order!.targetMasked}',
                style: AppTextStyles.bodyS.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ],
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: isChecking || _isTerminal ? null : onCheckStatus,
            icon: isChecking
                ? const TrustPayLottie(
                    variant: TrustPayAnimationVariant.loading,
                    size: 16,
                  )
                : const Icon(Icons.refresh_rounded),
            label: Text(isChecking ? 'Checking...' : 'Check status'),
          ),
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  final Widget child;

  const _Panel({required this.child});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String label;

  const _StatusPill({required this.label});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(label, style: AppTextStyles.labelS),
    );
  }
}

class _SettlementBankOption {
  final String name;
  final String code;
  final String slug;

  const _SettlementBankOption({
    required this.name,
    required this.code,
    required this.slug,
  });

  factory _SettlementBankOption.fromJson(Map<String, dynamic> json) {
    return _SettlementBankOption(
      name: '${json['name'] ?? ''}'.trim(),
      code: '${json['code'] ?? ''}'.trim(),
      slug: '${json['slug'] ?? ''}'.trim(),
    );
  }
}

class _SettlementProviderOption {
  final String name;
  final String type;
  final String accountLabel;
  final String holderLabel;

  const _SettlementProviderOption({
    required this.name,
    required this.type,
    required this.accountLabel,
    required this.holderLabel,
  });
}

class _SettlementProviderSelector extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final _SettlementProviderOption? selected;
  final List<_SettlementProviderOption> providers;
  final ValueChanged<_SettlementProviderOption> onChanged;

  const _SettlementProviderSelector({
    required this.controller,
    required this.focusNode,
    required this.selected,
    required this.providers,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return RawAutocomplete<_SettlementProviderOption>(
      textEditingController: controller,
      focusNode: focusNode,
      displayStringForOption: (provider) => provider.name,
      optionsBuilder: (value) {
        final query = value.text.trim().toLowerCase();
        if (query.isEmpty) return providers.take(10);

        return providers.where((provider) {
          return provider.name.toLowerCase().contains(query) ||
              provider.type.toLowerCase().contains(query);
        }).take(10);
      },
      onSelected: onChanged,
      fieldViewBuilder:
          (context, fieldController, fieldFocusNode, onFieldSubmitted) {
        return TextField(
          controller: fieldController,
          focusNode: fieldFocusNode,
          style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
          decoration: _inputDecoration('Bank or MoMo').copyWith(
            suffixIcon: AnimatedSwitcher(
              duration: const Duration(milliseconds: 160),
              child: Icon(
                selected?.type == 'MoMo'
                    ? Icons.phone_android_rounded
                    : Icons.account_balance_rounded,
                key: ValueKey(selected?.type ?? 'bank-or-momo'),
                color: AppColors.textSecondary,
              ),
            ),
          ),
        );
      },
      optionsViewBuilder: (context, onOptionSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            color: AppColors.surface,
            elevation: 10,
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 300, maxWidth: 420),
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                shrinkWrap: true,
                itemCount: optionList.length,
                separatorBuilder: (_, __) =>
                    Divider(height: 1, color: AppColors.border),
                itemBuilder: (context, index) {
                  final provider = optionList[index];
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      provider.type == 'MoMo'
                          ? Icons.phone_android_rounded
                          : Icons.account_balance_rounded,
                      color: AppColors.primary,
                    ),
                    title: Text(provider.name, style: AppTextStyles.labelM),
                    subtitle: Text(provider.type, style: AppTextStyles.bodyS),
                    onTap: () => onOptionSelected(provider),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

class _SettlementBankSearchField extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final List<_SettlementBankOption> banks;
  final bool isLoading;
  final ValueChanged<_SettlementBankOption> onSelected;

  const _SettlementBankSearchField({
    required this.controller,
    required this.focusNode,
    required this.banks,
    required this.isLoading,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return RawAutocomplete<_SettlementBankOption>(
      textEditingController: controller,
      focusNode: focusNode,
      displayStringForOption: (bank) => bank.name,
      optionsBuilder: (value) {
        final query = value.text.trim().toLowerCase();
        if (query.isEmpty) {
          return banks.take(8);
        }
        return banks.where((bank) {
          return bank.name.toLowerCase().contains(query) ||
              bank.code.toLowerCase().contains(query) ||
              bank.slug.toLowerCase().contains(query);
        }).take(8);
      },
      onSelected: onSelected,
      fieldViewBuilder:
          (context, fieldController, fieldFocusNode, onFieldSubmitted) {
        return TextField(
          controller: fieldController,
          focusNode: fieldFocusNode,
          style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
          decoration: _inputDecoration('Bank').copyWith(
            suffixIcon: isLoading
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: TrustPayLottie(
                      variant: TrustPayAnimationVariant.loading,
                      size: 18,
                    ),
                  )
                : const Icon(Icons.search_rounded),
          ),
        );
      },
      optionsViewBuilder: (context, onOptionSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            color: AppColors.surface,
            elevation: 10,
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260, maxWidth: 420),
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                shrinkWrap: true,
                itemCount: optionList.length,
                separatorBuilder: (_, __) =>
                    Divider(height: 1, color: AppColors.border),
                itemBuilder: (context, index) {
                  final bank = optionList[index];
                  return ListTile(
                    dense: true,
                    title: Text(bank.name, style: AppTextStyles.labelM),
                    subtitle: Text(bank.code, style: AppTextStyles.bodyS),
                    onTap: () => onOptionSelected(bank),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ResolvedAccountPanel extends StatelessWidget {
  final String? accountName;
  final bool isResolving;
  final String? error;
  final bool canResolve;
  final VoidCallback onRetry;
  final String resolvingLabel;
  final String idleLabel;

  const _ResolvedAccountPanel({
    required this.accountName,
    required this.isResolving,
    required this.error,
    required this.canResolve,
    required this.onRetry,
    this.resolvingLabel = 'Confirming account name...',
    this.idleLabel = 'Account name will appear here',
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final isVerified = accountName != null && accountName!.isNotEmpty;
    final icon = isVerified
        ? Icons.verified_rounded
        : error != null
            ? Icons.error_rounded
            : Icons.manage_search_rounded;
    final color = isVerified
        ? AppColors.success
        : error != null
            ? AppColors.error
            : AppColors.textSecondary;
    final title = isVerified
        ? accountName!
        : isResolving
            ? resolvingLabel
            : error ?? idleLabel;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isVerified ? AppColors.success : AppColors.border,
        ),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: Text(
                title,
                key: ValueKey(title),
                style: AppTextStyles.labelM.copyWith(color: color),
              ),
            ),
          ),
          if (isResolving)
            const TrustPayLottie(
              variant: TrustPayAnimationVariant.loading,
              size: 18,
            )
          else if (error != null && canResolve)
            TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _BeneficiaryPrefillPanel extends StatelessWidget {
  final WithdrawPrefill beneficiary;
  final VoidCallback onUseAnother;

  const _BeneficiaryPrefillPanel({
    required this.beneficiary,
    required this.onUseAnother,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.success),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified_rounded, color: AppColors.success),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  beneficiary.accountName,
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.success,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${beneficiary.bankName} • ${beneficiary.accountNumberMasked}',
            style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Saved beneficiary — the account was confirmed when it was saved.',
            style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: onUseAnother,
              child: const Text('Use another account'),
            ),
          ),
        ],
      ),
    );
  }
}

class ExchangeSettlementScreen extends StatefulWidget {
  final ExchangeReceipt? receipt;

  const ExchangeSettlementScreen({super.key, required this.receipt});

  @override
  State<ExchangeSettlementScreen> createState() =>
      _ExchangeSettlementScreenState();
}

class _ExchangeSettlementScreenState extends State<ExchangeSettlementScreen> {
  static const _unknownGhanaProvider = _SettlementProviderOption(
    name: 'Bank or MoMo',
    type: 'Bank account',
    accountLabel: 'Account or MoMo number',
    holderLabel: 'Name on account',
  );

  static const _ghanaSettlementProviders = [
    _SettlementProviderOption(
      name: 'MTN Mobile Money',
      type: 'MoMo',
      accountLabel: 'MoMo number',
      holderLabel: 'Wallet name (optional)',
    ),
    _SettlementProviderOption(
      name: 'Telecel Cash',
      type: 'MoMo',
      accountLabel: 'MoMo number',
      holderLabel: 'Wallet name (optional)',
    ),
    _SettlementProviderOption(
      name: 'AT Money',
      type: 'MoMo',
      accountLabel: 'MoMo number',
      holderLabel: 'Wallet name (optional)',
    ),
    _SettlementProviderOption(
      name: 'G-Money',
      type: 'MoMo',
      accountLabel: 'Wallet number',
      holderLabel: 'Wallet name (optional)',
    ),
    _SettlementProviderOption(
      name: 'Zeepay',
      type: 'MoMo',
      accountLabel: 'Wallet number',
      holderLabel: 'Wallet name (optional)',
    ),
    _SettlementProviderOption(
      name: 'GCB Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Ecobank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Absa Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Stanbic Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Standard Chartered Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Fidelity Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'CalBank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Zenith Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Access Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'UBA Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Consolidated Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Republic Bank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'GTBank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'FirstBank Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Prudential Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'OmniBSIC Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Societe Generale Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Agricultural Development Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'National Investment Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Universal Merchant Bank',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
    _SettlementProviderOption(
      name: 'Bank of Africa Ghana',
      type: 'Bank account',
      accountLabel: 'Account number',
      holderLabel: 'Name on account',
    ),
  ];

  final _apiClient = ApiClient();
  final _destinationNameController = TextEditingController();
  final _destinationAccountController = TextEditingController();
  final _destinationInstitutionController = TextEditingController();
  final _destinationInstitutionFocusNode = FocusNode();
  final _noteController = TextEditingController();
  ExchangeReceipt? _submittedReceipt;
  List<_SettlementBankOption> _settlementBanks = const [];
  _SettlementBankOption? _selectedSettlementBank;
  _SettlementProviderOption? _selectedGhanaProvider;
  String? _settlementAccountName;
  String? _settlementBankMessage;
  String? _settlementResolveError;
  bool _isLoadingSettlementBanks = false;
  bool _isResolvingSettlementAccount = false;
  Timer? _settlementResolveDebounce;
  int _settlementResolveRequestId = 0;

  ExchangeReceipt? get _receipt => widget.receipt;
  _SettlementProviderOption get _activeGhanaProvider =>
      _selectedGhanaProvider ?? _unknownGhanaProvider;

  @override
  void initState() {
    super.initState();
    final receipt = _receipt;
    if (receipt != null) {
      _destinationNameController.text = receipt.destinationLabel;
      _destinationInstitutionController.text = receipt.destinationInstitution;
      if (receipt.toCurrency == 'NGN') {
        _destinationNameController.clear();
        _destinationInstitutionController.clear();
        _destinationAccountController.addListener(
          _scheduleSettlementAccountResolve,
        );
        _destinationInstitutionController.addListener(_onSettlementBankTyped);
        _loadSettlementBanks();
      } else if (receipt.toCurrency == 'GHS') {
        _selectedGhanaProvider = _ghanaSettlementProviders.first;
        _destinationInstitutionController.addListener(_onGhanaProviderTyped);
        _destinationNameController.clear();
        _destinationInstitutionController.text = _selectedGhanaProvider!.name;
      }
    }
  }

  @override
  void dispose() {
    _settlementResolveDebounce?.cancel();
    _destinationAccountController.removeListener(
      _scheduleSettlementAccountResolve,
    );
    _destinationInstitutionController.removeListener(_onSettlementBankTyped);
    _destinationInstitutionController.removeListener(_onGhanaProviderTyped);
    _destinationNameController.dispose();
    _destinationAccountController.dispose();
    _destinationInstitutionController.dispose();
    _destinationInstitutionFocusNode.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _loadSettlementBanks() async {
    setState(() {
      _isLoadingSettlementBanks = true;
      _settlementBankMessage = null;
    });

    try {
      final response = await _apiClient.client.get('/api/banking/banks');
      final data = response.data;
      final items = data is List ? data : const [];
      final banks = items
          .whereType<Map>()
          .map(
            (item) => _SettlementBankOption.fromJson(
              Map<String, dynamic>.from(item),
            ),
          )
          .where((bank) => bank.name.isNotEmpty && bank.code.isNotEmpty)
          .toList()
        ..sort((a, b) => a.name.compareTo(b.name));

      if (!mounted) return;
      setState(() {
        _settlementBanks = banks;
        if (banks.isEmpty) {
          _settlementBankMessage = 'No live banks are available right now.';
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _settlementBankMessage = authErrorMessage(
          error,
          'Could not load live bank list.',
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isLoadingSettlementBanks = false);
      }
    }
  }

  void _onSettlementBankTyped() {
    final query = _destinationInstitutionController.text.trim().toLowerCase();
    _SettlementBankOption? exactMatch;
    for (final bank in _settlementBanks) {
      if (bank.name.toLowerCase() == query ||
          bank.code.toLowerCase() == query ||
          bank.slug.toLowerCase() == query) {
        exactMatch = bank;
        break;
      }
    }

    if (_selectedSettlementBank?.code != exactMatch?.code) {
      setState(() {
        _selectedSettlementBank = exactMatch;
        _settlementAccountName = null;
        _settlementResolveError = null;
      });
      _scheduleSettlementAccountResolve();
    }
  }

  void _selectSettlementBank(_SettlementBankOption bank) {
    setState(() {
      _selectedSettlementBank = bank;
      _destinationInstitutionController.text = bank.name;
      _destinationInstitutionController.selection = TextSelection.collapsed(
        offset: bank.name.length,
      );
      _settlementAccountName = null;
      _settlementResolveError = null;
    });
    _scheduleSettlementAccountResolve();
  }

  void _selectGhanaProvider(_SettlementProviderOption provider) {
    setState(() {
      _selectedGhanaProvider = provider;
      _destinationInstitutionController.text = provider.name;
      _destinationInstitutionController.selection = TextSelection.collapsed(
        offset: provider.name.length,
      );
    });
  }

  void _onGhanaProviderTyped() {
    final query = _destinationInstitutionController.text.trim().toLowerCase();
    _SettlementProviderOption? exactMatch;
    for (final provider in _ghanaSettlementProviders) {
      if (provider.name.toLowerCase() == query) {
        exactMatch = provider;
        break;
      }
    }

    if (_selectedGhanaProvider?.name != exactMatch?.name) {
      setState(() => _selectedGhanaProvider = exactMatch);
    }
  }

  void _scheduleSettlementAccountResolve() {
    _settlementResolveDebounce?.cancel();
    final receipt = _receipt;
    if (receipt?.toCurrency != 'NGN') return;

    setState(() {
      _settlementAccountName = null;
      _settlementResolveError = null;
    });

    final accountNumber = _destinationAccountController.text.trim();
    if (accountNumber.length != 10 || _selectedSettlementBank == null) {
      return;
    }

    _settlementResolveDebounce = Timer(
      const Duration(milliseconds: 600),
      _resolveSettlementAccount,
    );
  }

  Future<void> _resolveSettlementAccount() async {
    final bank = _selectedSettlementBank;
    final accountNumber = _destinationAccountController.text.trim();
    if (bank == null || accountNumber.length != 10) return;

    final requestId = ++_settlementResolveRequestId;
    setState(() {
      _isResolvingSettlementAccount = true;
      _settlementResolveError = null;
    });

    try {
      final response = await _apiClient.client.post(
        '/api/banking/banks/resolve',
        data: {
          'accountNumber': accountNumber,
          'bankCode': bank.code,
          'provider': 'paystack',
        },
      );
      if (!mounted || requestId != _settlementResolveRequestId) return;

      final data = Map<String, dynamic>.from(response.data as Map);
      final accountName = '${data['accountName'] ?? ''}'.trim();
      setState(() {
        _settlementAccountName = accountName;
        _destinationNameController.text = accountName;
      });
    } catch (error) {
      if (!mounted || requestId != _settlementResolveRequestId) return;
      setState(() {
        _settlementAccountName = null;
        _settlementResolveError = authErrorMessage(
          error,
          'Could not confirm this account name.',
        );
      });
    } finally {
      if (mounted && requestId == _settlementResolveRequestId) {
        setState(() => _isResolvingSettlementAccount = false);
      }
    }
  }

  void _submitDestination() {
    final receipt = _receipt;
    if (receipt == null) return;

    final destinationName = _destinationNameController.text.trim();
    final destinationAccount = _destinationAccountController.text.trim();
    final destinationInstitution =
        _destinationInstitutionController.text.trim();

    if (receipt.toCurrency == 'GHS' && _selectedGhanaProvider == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a bank or MoMo wallet.')),
      );
      return;
    }

    final requiresName = receipt.toCurrency != 'GHS' ||
        _activeGhanaProvider.type == 'Bank account';

    if ((requiresName && destinationName.isEmpty) ||
        destinationAccount.isEmpty ||
        destinationInstitution.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add the name, account, and bank or wallet.'),
        ),
      );
      return;
    }

    if (receipt.toCurrency == 'NGN' &&
        (_selectedSettlementBank == null ||
            _settlementAccountName == null ||
            _settlementAccountName!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Choose a bank and confirm the account name first.'),
        ),
      );
      return;
    }

    setState(() {
      _submittedReceipt = receipt.copyWith(
        destinationLabel: _settlementAccountName ??
            (destinationName.isEmpty
                ? destinationInstitution
                : destinationName),
        destinationAccount: destinationAccount,
        destinationInstitution:
            _selectedSettlementBank?.name ?? destinationInstitution,
        note: _noteController.text.trim(),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final receipt = _submittedReceipt ?? _receipt;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
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
                  const TpPageHeader(label: 'Send to'),
                  Text(
                    'Choose a bank or wallet. Add the account number.',
                    style: AppTextStyles.bodyL,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  if (receipt == null) ...[
                    const _InfoPanel(
                      text:
                          'Create a quote first. Then choose where to send the money.',
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: () => context.go(AppRoutes.exchange),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(56),
                      ),
                      child: const Text('Create quote'),
                    ),
                  ] else ...[
                    _Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _ReceiptMetricRow(
                            label: 'Quote',
                            value:
                                '${receipt.sendAmount} ${receipt.fromCurrency} to ${receipt.receiveAmount} ${receipt.toCurrency}',
                          ),
                          _ReceiptMetricRow(
                            label: 'Reference',
                            value: receipt.id,
                            showDivider: false,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    _Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (receipt.toCurrency == 'NGN') ...[
                            _SettlementBankSearchField(
                              controller: _destinationInstitutionController,
                              focusNode: _destinationInstitutionFocusNode,
                              banks: _settlementBanks,
                              isLoading: _isLoadingSettlementBanks,
                              onSelected: _selectSettlementBank,
                            ),
                            if (_settlementBankMessage != null) ...[
                              const SizedBox(height: AppSpacing.sm),
                              Text(
                                _settlementBankMessage!,
                                style: AppTextStyles.bodyS,
                              ),
                            ],
                            const SizedBox(height: AppSpacing.md),
                            _InputField(
                              controller: _destinationAccountController,
                              label: 'Account number',
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                                LengthLimitingTextInputFormatter(10),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.md),
                            _ResolvedAccountPanel(
                              accountName: _settlementAccountName,
                              isResolving: _isResolvingSettlementAccount,
                              error: _settlementResolveError,
                              canResolve: _selectedSettlementBank != null &&
                                  _destinationAccountController.text
                                          .trim()
                                          .length ==
                                      10,
                              onRetry: _resolveSettlementAccount,
                            ),
                          ] else ...[
                            _SettlementProviderSelector(
                              controller: _destinationInstitutionController,
                              focusNode: _destinationInstitutionFocusNode,
                              selected: _selectedGhanaProvider,
                              providers: _ghanaSettlementProviders,
                              onChanged: _selectGhanaProvider,
                            ),
                            const SizedBox(height: AppSpacing.md),
                            _InputField(
                              controller: _destinationNameController,
                              label: _activeGhanaProvider.holderLabel,
                            ),
                            const SizedBox(height: AppSpacing.md),
                            _InputField(
                              controller: _destinationAccountController,
                              label: _activeGhanaProvider.accountLabel,
                              keyboardType: TextInputType.phone,
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                  RegExp(r'[0-9+]'),
                                ),
                              ],
                            ),
                          ],
                          const SizedBox(height: AppSpacing.md),
                          _InputField(
                            controller: _noteController,
                            label: 'Note (optional)',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: _submitDestination,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(56),
                      ),
                      child: const Text('Submit for review'),
                    ),
                    if (_submittedReceipt != null) ...[
                      const SizedBox(height: AppSpacing.lg),
                      _ExchangeReceiptCard(receipt: _submittedReceipt!),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExchangeSwapPanel extends StatelessWidget {
  final String fromCurrency;
  final String toCurrency;
  final TextEditingController amountController;
  final double estimatedReceive;
  final bool isRateLoading;
  final String? rateError;
  final ValueChanged<String> onFromChanged;
  final ValueChanged<String> onToChanged;
  final VoidCallback onSwap;

  const _ExchangeSwapPanel({
    required this.fromCurrency,
    required this.toCurrency,
    required this.amountController,
    required this.estimatedReceive,
    required this.isRateLoading,
    required this.rateError,
    required this.onFromChanged,
    required this.onToChanged,
    required this.onSwap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
          child: Column(
            children: [
              _ExchangeLegCard(
                title: 'You send',
                currency: fromCurrency,
                amountController: amountController,
                onCurrencyChanged: onFromChanged,
              ),
              const SizedBox(height: AppSpacing.xl + AppSpacing.md),
              _ExchangeLegResultCard(
                title: 'You receive',
                currency: toCurrency,
                amount: estimatedReceive,
                isRateLoading: isRateLoading,
                rateError: rateError,
                onCurrencyChanged: onToChanged,
              ),
            ],
          ),
        ),
        Positioned(
          child: TapScale(
            onTap: onSwap,
            borderRadius: BorderRadius.circular(AppRadius.full),
            pressedScale: 0.92,
            child: Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.border, width: 5),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.overlayLight,
                    blurRadius: 14,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Icon(
                Icons.swap_vert_rounded,
                color: AppColors.primary,
                size: 24,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ExchangeLegCard extends StatelessWidget {
  final String title;
  final String currency;
  final TextEditingController amountController;
  final ValueChanged<String> onCurrencyChanged;

  const _ExchangeLegCard({
    required this.title,
    required this.currency,
    required this.amountController,
    required this.onCurrencyChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: AppTextStyles.labelM),
              const Spacer(),
              _ExchangeCurrencyPill(
                currency: currency,
                onChanged: onCurrencyChanged,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [ThousandsSeparatorInputFormatter()],
            textAlign: TextAlign.right,
            style: AppTextStyles.displayMedium.copyWith(fontSize: 28),
            decoration: InputDecoration(
              prefixText: '${_currencySymbol(currency)} ',
              prefixStyle: AppTextStyles.displayMedium.copyWith(
                fontSize: 24,
                color: AppColors.textSecondary,
              ),
              hintText: '0.00',
              hintStyle: AppTextStyles.displayMedium.copyWith(
                fontSize: 28,
                color: AppColors.textHint,
              ),
              filled: false,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              contentPadding: EdgeInsets.zero,
            ),
          ),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: amountController,
            builder: (context, value, _) {
              final words = exchangeAmountInWords(value.text, currency);
              if (words == null) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: AppSpacing.xs),
                child: Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    words,
                    textAlign: TextAlign.right,
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ExchangeLegResultCard extends StatelessWidget {
  final String title;
  final String currency;
  final double amount;
  final bool isRateLoading;
  final String? rateError;
  final ValueChanged<String> onCurrencyChanged;

  const _ExchangeLegResultCard({
    required this.title,
    required this.currency,
    required this.amount,
    required this.isRateLoading,
    required this.rateError,
    required this.onCurrencyChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: AppTextStyles.labelM),
              const Spacer(),
              _ExchangeCurrencyPill(
                currency: currency,
                onChanged: onCurrencyChanged,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            reverse: true,
            child: AnimatedValueText(
              value: rateError != null
                  ? '--'
                  : amount <= 0
                      ? '0.00'
                      : '${_currencySymbol(currency)} ${NumberFormat('#,##0.00').format(amount)}',
              textAlign: TextAlign.right,
              style: AppTextStyles.displayMedium.copyWith(fontSize: 28),
            ),
          ),
          if (rateError != null || isRateLoading) ...[
            const SizedBox(height: AppSpacing.sm),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: Row(
                key: ValueKey('${isRateLoading}_${rateError ?? 'ready'}'),
                children: [
                  if (isRateLoading) ...[
                    const TrustPayLottie(
                      variant: TrustPayAnimationVariant.loading,
                      size: 12,
                    ),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Expanded(
                    child: Text(
                      rateError != null
                          ? 'Live rate unavailable'
                          : 'Refreshing quote',
                      style: AppTextStyles.bodyS,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExchangeCurrencyPill extends StatelessWidget {
  final String currency;
  final ValueChanged<String> onChanged;

  const _ExchangeCurrencyPill({
    required this.currency,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 6,
      ),
      constraints: const BoxConstraints(minWidth: 92),
      decoration: BoxDecoration(
        color: AppColors.inputFill,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: currency,
          isDense: true,
          dropdownColor: AppColors.surface,
          iconEnabledColor: AppColors.textPrimary,
          style: AppTextStyles.labelM.copyWith(color: AppColors.textPrimary),
          items: const ['NGN', 'GHS']
              .map(
                (item) => DropdownMenuItem<String>(
                  value: item,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_currencyFlag(item)),
                      const SizedBox(width: 6),
                      Text(item),
                    ],
                  ),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
      ),
    );
  }
}

class _ExchangeReceiptCard extends StatelessWidget {
  final ExchangeReceipt receipt;

  const _ExchangeReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final formatter = DateFormat('dd MMM yyyy • HH:mm');
    return Container(
      width: double.infinity,
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
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppColors.primaryLight.withValues(alpha: 0.88),
                        AppColors.primary.withValues(alpha: 0.88),
                      ],
                    ),
                  ),
                  child: const Icon(
                    Icons.receipt_long_rounded,
                    color: Colors.white,
                    size: 34,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text('Exchange quote created', style: AppTextStyles.headingL),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Receipt prepared. Review the details before payout.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyM,
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
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'Receipt ID',
                        value: receipt.id,
                      ),
                    ),
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'Status',
                        value: receipt.status,
                        alignEnd: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'You send',
                        value: '${receipt.sendAmount} ${receipt.fromCurrency}',
                      ),
                    ),
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'You receive',
                        value: '${receipt.receiveAmount} ${receipt.toCurrency}',
                        alignEnd: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                _ReceiptMetricRow(
                  label: 'Date & time',
                  value: formatter.format(receipt.createdAt),
                ),
                _ReceiptMetricRow(
                  label: 'Exchange rate',
                  value:
                      '1 ${receipt.fromCurrency} = ${receipt.rate} ${receipt.toCurrency}',
                ),
                _ReceiptMetricRow(
                  label: 'Fee',
                  value: '${receipt.fee} ${receipt.fromCurrency}',
                ),
                _ReceiptMetricRow(
                  label: 'Destination',
                  value: receipt.destinationLabel,
                ),
                _ReceiptMetricRow(
                  label: 'Account',
                  value: receipt.destinationAccount,
                ),
                _ReceiptMetricRow(
                  label: 'Institution',
                  value: receipt.destinationInstitution,
                  showDivider: receipt.note.isEmpty,
                ),
                if (receipt.note.isNotEmpty)
                  _ReceiptMetricRow(
                    label: 'Instruction',
                    value: receipt.note,
                    showDivider: false,
                  ),
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
            child: Column(
              children: [
                Text(
                  'SUBMITTED FOR REVIEW',
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Your exchange request is ready for payout processing.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyS,
                ),
                const SizedBox(height: AppSpacing.md),
                Container(
                  width: double.infinity,
                  height: 56,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: AppColors.border,
                      style: BorderStyle.solid,
                    ),
                  ),
                  child: CustomPaint(painter: _BarcodePainter()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReceiptMetricColumn extends StatelessWidget {
  final String label;
  final String value;
  final bool alignEnd;

  const _ReceiptMetricColumn({
    required this.label,
    required this.value,
    this.alignEnd = false,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final alignment =
        alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Column(
      crossAxisAlignment: alignment,
      children: [
        Text(label, style: AppTextStyles.bodyS),
        const SizedBox(height: AppSpacing.xs),
        Text(
          value,
          textAlign: alignEnd ? TextAlign.right : TextAlign.left,
          style: AppTextStyles.headingM.copyWith(letterSpacing: 0),
        ),
      ],
    );
  }
}

class _ReceiptMetricRow extends StatelessWidget {
  final String label;
  final String value;
  final bool showDivider;

  const _ReceiptMetricRow({
    required this.label,
    required this.value,
    this.showDivider = true,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(label, style: AppTextStyles.bodyS)),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: AppTextStyles.labelM.copyWith(letterSpacing: 0),
              ),
            ),
          ],
        ),
        if (showDivider) ...[
          const SizedBox(height: AppSpacing.sm),
          Divider(color: AppColors.divider, height: 1),
          const SizedBox(height: AppSpacing.sm),
        ],
      ],
    );
  }
}

class _ReceiptCutLine extends StatelessWidget {
  const _ReceiptCutLine();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return SizedBox(
      height: 24,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned(
            left: -12,
            child: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            right: -12,
            child: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned.fill(
            child: Center(
              child: Container(
                height: 1,
                margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(
                      color: AppColors.border,
                      width: 1,
                      style: BorderStyle.solid,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BarcodePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = AppColors.textPrimary;
    double x = 14;
    const pattern = [
      2.0,
      1.0,
      3.0,
      2.0,
      1.5,
      4.0,
      1.0,
      2.5,
      1.0,
      3.5,
      2.0,
      1.0,
      2.0,
      4.0,
      1.0,
      2.5,
      3.0,
      1.0,
      2.0,
      1.5,
    ];

    for (var i = 0; x < size.width - 14; i++) {
      final width = pattern[i % pattern.length];
      canvas.drawRect(Rect.fromLTWH(x, 8, width, size.height - 16), paint);
      x += width + ((i % 3) + 1);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

InputDecoration _inputDecoration(String label, {String? prefixText}) {
  return InputDecoration(
    labelText: label,
    labelStyle: AppTextStyles.bodyM,
    prefixText: prefixText,
    prefixStyle: AppTextStyles.labelL.copyWith(color: AppColors.textPrimary),
    filled: true,
    fillColor: AppColors.surfaceVariant,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.primary),
    ),
  );
}

_ActionConfig _configFor(MoneyActionKind kind) {
  switch (kind) {
    case MoneyActionKind.fund:
      return const _ActionConfig(
        title: 'Add money',
        subtitle: 'Use your account number to transfer into your wallet.',
        buttonLabel: 'Copy account number',
        status: 'NGN transfer',
        icon: Icons.account_balance_wallet_rounded,
      );
    case MoneyActionKind.send:
      return const _ActionConfig(
        title: 'Send money',
        subtitle: 'Send to another TrustPay user by email.',
        buttonLabel: 'Send transfer',
        status: 'Verification required',
        icon: Icons.near_me_rounded,
      );
    case MoneyActionKind.withdraw:
      return const _ActionConfig(
        title: 'Send to bank',
        subtitle: 'Send wallet funds to a bank account.',
        buttonLabel: 'Send transfer',
        status: 'Verification required',
        icon: Icons.account_balance_rounded,
      );
    case MoneyActionKind.exchange:
      return const _ActionConfig(
        title: 'Exchange',
        subtitle: 'Create a cross-currency settlement request.',
        buttonLabel: 'Submit for review',
        status: 'Quote request',
        icon: Icons.currency_exchange_rounded,
      );
    case MoneyActionKind.airtime:
      return const _ActionConfig(
        title: 'Airtime',
        subtitle: 'Buy airtime from your NGN wallet.',
        buttonLabel: 'Buy airtime',
        status: 'VTPass local',
        icon: Icons.phone_android_rounded,
      );
    case MoneyActionKind.data:
      return const _ActionConfig(
        title: 'Data',
        subtitle: 'Buy mobile data from your NGN wallet.',
        buttonLabel: 'Buy data',
        status: 'VTPass local',
        icon: Icons.signal_cellular_alt_rounded,
      );
    case MoneyActionKind.cable:
      return const _ActionConfig(
        title: 'Cable TV',
        subtitle: 'Pay DStv, GOtv and StarTimes from your NGN wallet.',
        buttonLabel: 'Pay subscription',
        status: 'VTPass local',
        icon: Icons.live_tv_rounded,
      );
    case MoneyActionKind.electricity:
      return const _ActionConfig(
        title: 'Electricity',
        subtitle: 'Recharge Nigerian electricity meters.',
        buttonLabel: 'Recharge meter',
        status: 'VTPass local',
        icon: Icons.bolt_rounded,
      );
  }
}

String _successMessage(dynamic data) {
  if (data is Map<String, dynamic>) {
    final reference = data['reference'] ?? data['id'];
    final message = data['message'];
    final status = data['status'];
    final success = data['success'];
    final purchasedCode = data['purchasedCode'];
    if (status == 'PENDING' || success == false) {
      return '${message is String ? message : 'VTU purchase is pending provider confirmation.'}\nReference: $reference';
    }
    if (message is String && reference != null) {
      return '$message\nReference: $reference'
          '${purchasedCode is String && purchasedCode.isNotEmpty ? '\nDelivery code: $purchasedCode' : ''}';
    }
    if (reference != null) return 'Request created.\nReference: $reference';
    return 'Request completed: $data';
  }
  return 'Request completed.';
}

String _orderStatusMessage(VtuOrderStatus order) {
  switch (order.orderStatus) {
    case 'SUCCESS':
      return 'VTU purchase confirmed.\nReference: ${order.reference}'
          '${order.purchasedCode?.isNotEmpty == true ? '\nDelivery code: ${order.purchasedCode}' : ''}';
    case 'FAILED':
    case 'REVERSED':
      return 'VTU purchase failed. Reserved funds were reversed.\nReference: ${order.reference}';
    default:
      return 'VTU purchase is still pending provider confirmation.\nReference: ${order.reference}';
  }
}

MoneyActionFeedbackType _feedbackTypeForOrder(VtuOrderStatus order) {
  switch (order.orderStatus) {
    case 'SUCCESS':
      return MoneyActionFeedbackType.success;
    case 'FAILED':
    case 'REVERSED':
      return MoneyActionFeedbackType.error;
    default:
      return MoneyActionFeedbackType.info;
  }
}

class MoneyActionValidationResult {
  final String? value;
  final String? error;

  const MoneyActionValidationResult._({
    required this.value,
    required this.error,
  });

  const MoneyActionValidationResult.valid(String value)
      : this._(value: value, error: null);

  const MoneyActionValidationResult.invalid(String error)
      : this._(value: null, error: error);
}

class MoneyActionFormValidator {
  static final RegExp _amountPattern = RegExp(r'^\d+(\.\d{1,2})?$');
  static final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  static final RegExp _digitsPattern = RegExp(r'^\d+$');

  static bool isValidEmail(String value) {
    return _emailPattern.hasMatch(value.trim());
  }

  static MoneyActionValidationResult validateAmount(String raw) {
    final value = raw.trim().replaceAll(',', '');
    if (value.isEmpty) {
      return const MoneyActionValidationResult.invalid('Enter a valid amount.');
    }
    if (!_amountPattern.hasMatch(value)) {
      return const MoneyActionValidationResult.invalid(
        'Enter an amount with up to 2 decimal places.',
      );
    }

    final parts = value.split('.');
    final whole = parts.first.replaceFirst(RegExp(r'^0+(?=\d)'), '');
    final decimals = parts.length == 2 ? parts[1].padRight(2, '0') : '00';
    final normalized = '$whole.$decimals';
    if (RegExp(r'^0+\.0{2}$').hasMatch(normalized)) {
      return const MoneyActionValidationResult.invalid(
        'Enter an amount greater than zero.',
      );
    }

    return MoneyActionValidationResult.valid(normalized);
  }

  static String? validateFields({
    required MoneyActionKind kind,
    String recipient = '',
    String accountNumber = '',
    String accountName = '',
    String bankCode = '',
    String note = '',
  }) {
    if (note.trim().runes.length > 120) {
      return 'Keep the note to 120 characters or fewer.';
    }

    switch (kind) {
      case MoneyActionKind.send:
        if (!_emailPattern.hasMatch(recipient.trim())) {
          return 'Enter a valid recipient email.';
        }
        return null;
      case MoneyActionKind.withdraw:
        final account = accountNumber.trim();
        if (bankCode.trim().isEmpty ||
            account.length != 10 ||
            !_digitsPattern.hasMatch(account)) {
          return 'Choose a bank and enter a valid 10-digit account number.';
        }
        if (accountName.trim().length < 2) {
          return 'Enter the account name.';
        }
        return null;
      case MoneyActionKind.airtime:
      case MoneyActionKind.data:
        if (!VtuPhone.isValid(recipient)) {
          return 'Enter a valid phone number.';
        }
        return null;
      case MoneyActionKind.cable:
        final smartCard = recipient.trim();
        if (smartCard.length < 5 || !_digitsPattern.hasMatch(smartCard)) {
          return 'Enter a valid smart card / IUC number.';
        }
        return null;
      case MoneyActionKind.electricity:
        final meter = recipient.trim();
        if (meter.length < 6 || !_digitsPattern.hasMatch(meter)) {
          return 'Enter a valid meter number.';
        }
        return null;
      case MoneyActionKind.fund:
      case MoneyActionKind.exchange:
        return null;
    }
  }
}

class MoneyReviewRow {
  final String label;
  final String value;

  const MoneyReviewRow(this.label, this.value);

  @override
  bool operator ==(Object other) =>
      other is MoneyReviewRow && other.label == label && other.value == value;

  @override
  int get hashCode => Object.hash(label, value);
}

class InternalTransferReviewContract {
  static List<MoneyReviewRow> financialRows({
    required String amount,
    required String currency,
  }) {
    return [
      MoneyReviewRow('Amount', '$amount $currency'),
      MoneyReviewRow('Fee', '0.00 $currency'),
      MoneyReviewRow('Total debit', '$amount $currency'),
    ];
  }
}

class MoneySubmissionGate {
  bool _claimed = false;

  bool get isClaimed => _claimed;

  bool tryClaim() {
    if (_claimed) return false;
    _claimed = true;
    return true;
  }

  void release() {
    _claimed = false;
  }
}

String _maskAccountNumber(String value) {
  if (value.length <= 4) return '****';
  return '${'*' * (value.length - 4)}${value.substring(value.length - 4)}';
}

class _ActionConfig {
  final String title;
  final String subtitle;
  final String buttonLabel;
  final String status;
  final IconData icon;

  const _ActionConfig({
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.status,
    required this.icon,
  });
}

class ExchangeReceipt {
  final String id;
  final String fromCurrency;
  final String toCurrency;
  final String sendAmount;
  final String receiveAmount;
  final String rate;
  final String fee;
  final DateTime createdAt;
  final String status;
  final String destinationLabel;
  final String destinationAccount;
  final String destinationInstitution;
  final String note;

  const ExchangeReceipt({
    required this.id,
    required this.fromCurrency,
    required this.toCurrency,
    required this.sendAmount,
    required this.receiveAmount,
    required this.rate,
    required this.fee,
    required this.createdAt,
    required this.status,
    required this.destinationLabel,
    required this.destinationAccount,
    required this.destinationInstitution,
    required this.note,
  });

  factory ExchangeReceipt.fromApi(
    Map<String, dynamic> data, {
    required String destinationLabel,
    required String destinationAccount,
    required String destinationInstitution,
    required String note,
  }) {
    String formatAmount(dynamic value) {
      if (value is num) return value.toStringAsFixed(2);
      final parsed = double.tryParse('$value') ?? 0;
      return parsed.toStringAsFixed(2);
    }

    return ExchangeReceipt(
      id: '${data['id'] ?? 'QUOTE'}',
      fromCurrency: '${data['from'] ?? 'GHS'}',
      toCurrency: '${data['to'] ?? 'NGN'}',
      sendAmount: formatAmount(data['sendAmount'] ?? data['amount']),
      receiveAmount: formatAmount(data['receiveAmount'] ?? 0),
      rate: formatAmount(data['rate'] ?? 0),
      fee: formatAmount(data['fee'] ?? 0),
      createdAt: DateTime.tryParse('${data['createdAt']}') ?? DateTime.now(),
      status: 'Pending review',
      destinationLabel: destinationLabel,
      destinationAccount: destinationAccount,
      destinationInstitution: destinationInstitution,
      note: note,
    );
  }

  ExchangeReceipt copyWith({
    String? destinationLabel,
    String? destinationAccount,
    String? destinationInstitution,
    String? note,
  }) {
    return ExchangeReceipt(
      id: id,
      fromCurrency: fromCurrency,
      toCurrency: toCurrency,
      sendAmount: sendAmount,
      receiveAmount: receiveAmount,
      rate: rate,
      fee: fee,
      createdAt: createdAt,
      status: status,
      destinationLabel: destinationLabel ?? this.destinationLabel,
      destinationAccount: destinationAccount ?? this.destinationAccount,
      destinationInstitution:
          destinationInstitution ?? this.destinationInstitution,
      note: note ?? this.note,
    );
  }
}

String _currencyFlag(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return '🇳🇬';
    case 'GHS':
      return '🇬🇭';
    default:
      return '';
  }
}

String _currencySymbol(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return '₦';
    case 'GHS':
      return '₵';
    default:
      return currency.toUpperCase();
  }
}
