import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/api_client.dart';
import '../../../services/home_data_service.dart';
import '../../../services/transaction_security_service.dart';
import '../../../services/vtu_service.dart';
import '../../security/screens/transaction_security_screen.dart';

enum MoneyActionKind {
  fund,
  send,
  withdraw,
  exchange,
  airtime,
  data,
  electricity,
}

enum MoneyActionFeedbackType { info, success, error, warning }

class MoneyActionScreen extends StatefulWidget {
  final MoneyActionKind kind;
  final bool showBackButton;

  const MoneyActionScreen({
    super.key,
    required this.kind,
    this.showBackButton = true,
  });

  @override
  State<MoneyActionScreen> createState() => _MoneyActionScreenState();
}

class _MoneyActionScreenState extends State<MoneyActionScreen> {
  final _apiClient = ApiClient();
  final _homeDataService = HomeDataService();
  final _transactionSecurityService = TransactionSecurityService();
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _accountNumberController = TextEditingController();
  final _accountNameController = TextEditingController();
  final _bankCodeController = TextEditingController();
  final _noteController = TextEditingController();
  final _attemptIdempotency = MoneyAttemptIdempotency();
  late final VtuService _vtuService;

  static const _countryLabels = {
    'NG': 'Nigeria',
    'GH': 'Ghana',
    'KE': 'Kenya',
    'ZA': 'South Africa',
    'US': 'United States',
    'GB': 'United Kingdom',
  };
  static const _airtimeCountryOptions = ['GH', 'KE', 'ZA', 'US', 'GB'];
  static const _dataCountryOptions = ['NG', 'GH', 'KE', 'ZA', 'US', 'GB'];
  static const _electricityCountryOptions = ['NG', 'GH', 'KE', 'ZA'];
  static const _enabledAirtimeCountries = {'GH'};
  static const _enabledDataCountries = {'NG', 'GH'};
  static const _enabledElectricityCountries = {'NG', 'GH'};

  String _currency = 'NGN';
  String _exchangeFrom = 'GHS';
  String _exchangeTo = 'NGN';
  String _provider = 'paystack';
  String _vtuProvider = 'mtn';
  String _airtimeScope = 'local';
  String _airtimeCountryCode = 'GH';
  String _airtimeOperatorId = '';
  String _dataCountryCode = 'NG';
  String _dataOperatorId = '';
  String _electricityCountryCode = 'NG';
  String _electricityBillerId = '';
  String? _dataPackageId;
  String? _message;
  MoneyActionFeedbackType _messageType = MoneyActionFeedbackType.info;
  bool _messageCanRetry = false;
  bool _isLoadingExchangeRate = false;
  String? _exchangeRateError;
  double? _exchangeEffectiveRate;
  int _exchangeRateRequestId = 0;
  bool _isLoadingFundingAccounts = false;
  bool _isRequestingFundingAccount = false;
  String? _vtuCatalogMessage;
  String? _fundingAccountMessage;
  String? _pendingOrderReference;
  VtuOrderStatus? _trackedOrder;
  bool _isSubmitting = false;
  bool _isLoadingVtuCatalog = false;
  bool _isCheckingOrder = false;
  List<VtuProviderOption> _localAirtimeProviders = const [];
  List<VtuProviderOption> _localDataProviders = const [];
  List<VtuProviderOption> _localElectricityProviders = const [];
  Map<String, List<VtuProviderOption>> _airtimeOperatorsByCountry = const {};
  Map<String, List<VtuProviderOption>> _dataOperatorsByCountry = const {};
  Map<String, List<VtuProviderOption>> _electricityBillersByCountry = const {};
  List<VtuPackageOption> _dataPackages = const [];
  HomeUser? _fundingUser;

  @override
  void initState() {
    super.initState();
    _vtuService = VtuService(apiClient: _apiClient);
    _amountController.addListener(_onAmountChanged);
    _loadFundingAccounts();
    _loadExchangeRate();
    _loadVtuCatalogs();
  }

  List<HomeVirtualAccount> _fundingAccounts = const [];

  @override
  void dispose() {
    _amountController.removeListener(_onAmountChanged);
    _amountController.dispose();
    _recipientController.dispose();
    _accountNumberController.dispose();
    _accountNameController.dispose();
    _bankCodeController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _onAmountChanged() {
    if (widget.kind == MoneyActionKind.exchange && mounted) {
      setState(() {});
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
        queryParameters: {
          'from': _exchangeFrom,
          'to': _exchangeTo,
        },
      );
      if (!mounted || requestId != _exchangeRateRequestId) return;

      final data = Map<String, dynamic>.from(response.data as Map);
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
    if (![
      MoneyActionKind.airtime,
      MoneyActionKind.data,
      MoneyActionKind.electricity,
    ].contains(widget.kind)) {
      return;
    }

    setState(() {
      _isLoadingVtuCatalog = true;
      _vtuCatalogMessage = null;
    });

    try {
      final results = await Future.wait([
        _vtuService.getProviders('airtime'),
        _vtuService.getProviders('data'),
        _vtuService.getProviders('electricity'),
      ]);

      if (!mounted) return;

      setState(() {
        _localAirtimeProviders = results[0].isEmpty
            ? _fallbackLocalProviders('airtime')
            : results[0];
        _localDataProviders =
            results[1].isEmpty ? _fallbackLocalProviders('data') : results[1];
        _localElectricityProviders = results[2].isEmpty
            ? _fallbackLocalProviders('electricity')
            : results[2];
        _vtuProvider = _firstProviderId(_providersForCurrentFlow());
      });

      if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
        await _loadDataPackages(_vtuProvider);
      } else if (widget.kind == MoneyActionKind.data &&
          _dataCountryCode == 'GH') {
        await _loadInternationalProviders(
          type: 'data',
          countryCode: _dataCountryCode,
        );
      } else if (widget.kind == MoneyActionKind.electricity &&
          _electricityCountryCode == 'GH') {
        await _loadInternationalProviders(
          type: 'electricity',
          countryCode: _electricityCountryCode,
        );
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _localAirtimeProviders = _fallbackLocalProviders('airtime');
        _localDataProviders = _fallbackLocalProviders('data');
        _localElectricityProviders = _fallbackLocalProviders('electricity');
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load live VTU providers. Showing default local options.',
        );
      });
      if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
        await _loadDataPackages(_vtuProvider);
      }
    } finally {
      if (mounted) {
        setState(() => _isLoadingVtuCatalog = false);
      }
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
      if (!mounted) return;
      setState(() {
        _fundingUser = dashboard.user;
        _fundingAccounts = dashboard.virtualAccounts;
        if (_preferredFundingAccount() == null) {
          _fundingAccountMessage =
              'Request your NGN funding account before making a bank transfer.';
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

  Future<void> _requestFundingAccount() async {
    if (_isRequestingFundingAccount) return;

    final names = _fundingAccountNameParts();
    setState(() {
      _isRequestingFundingAccount = true;
      _fundingAccountMessage = null;
      _setMessageState(null);
    });

    try {
      final account = await _homeDataService.provisionVirtualAccount(
        firstName: names.firstName,
        lastName: names.lastName,
        middleName: names.middleName,
        idempotencyKey:
            _attemptIdempotency.keyFor('funding-account|monnify|NGN'),
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted) return;
      setState(() {
        _fundingAccounts = [
          account,
          ..._fundingAccounts.where(
            (item) =>
                item.provider.toLowerCase() != 'monnify' ||
                item.currency.toUpperCase() != 'NGN',
          ),
        ];
        _fundingAccountMessage = null;
        _setMessageState(
          'Funding account created. Transfer NGN to this account and your wallet will update after payment confirmation.',
          type: MoneyActionFeedbackType.success,
        );
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _setMessageState(
          authErrorMessage(
            error,
            'Could not request your funding account. Complete KYC and try again.',
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

  Future<void> _loadInternationalProviders({
    required String type,
    required String countryCode,
  }) async {
    final existing = type == 'airtime'
        ? _airtimeOperatorsForCountry(countryCode)
        : type == 'data'
            ? _dataOperatorsForCountry(countryCode)
            : _electricityBillersForCountry(countryCode);
    if (existing.isNotEmpty) return;

    setState(() {
      _isLoadingVtuCatalog = true;
      _vtuCatalogMessage = null;
    });

    try {
      final providers = await _vtuService.getProviders(
        type,
        scope: 'international',
        countryCode: countryCode,
      );
      if (!mounted) return;

      setState(() {
        if (type == 'airtime') {
          _airtimeOperatorsByCountry = {
            ..._airtimeOperatorsByCountry,
            countryCode: providers,
          };
          if (_airtimeCountryCode == countryCode) {
            _airtimeOperatorId = _firstProviderId(providers, fallback: '');
          }
        } else if (type == 'data') {
          _dataOperatorsByCountry = {
            ..._dataOperatorsByCountry,
            countryCode: providers,
          };
          if (_dataCountryCode == countryCode) {
            _dataOperatorId = _firstProviderId(providers, fallback: '');
          }
        } else {
          _electricityBillersByCountry = {
            ..._electricityBillersByCountry,
            countryCode: providers,
          };
          if (_electricityCountryCode == countryCode) {
            _electricityBillerId = _firstProviderId(providers, fallback: '');
          }
        }

        if (providers.isEmpty) {
          _vtuCatalogMessage =
              'No ${_countryName(countryCode)} ${type == 'electricity' ? 'electricity billers' : '$type operators'} are available yet.';
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load ${_countryName(countryCode)} ${type == 'electricity' ? 'electricity billers' : '$type operators'}.',
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isLoadingVtuCatalog = false);
      }
    }
  }

  Future<void> _loadDataPackages(String provider) async {
    if (provider.isEmpty) {
      setState(() {
        _dataPackageId = null;
        _dataPackages = const [];
        _vtuCatalogMessage = 'Select a network to load data packages.';
      });
      return;
    }

    setState(() {
      _isLoadingVtuCatalog = true;
      _vtuCatalogMessage = null;
      _dataPackageId = null;
      _dataPackages = const [];
    });

    try {
      final packages = await _vtuService.getPackages(provider);
      if (!mounted) return;
      setState(() {
        _dataPackages = packages;
        if (packages.isNotEmpty) {
          _selectDataPackage(packages.first.id);
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _vtuCatalogMessage = authErrorMessage(
          error,
          'Could not load data packages for this provider.',
        );
      });
    } finally {
      if (mounted) {
        setState(() => _isLoadingVtuCatalog = false);
      }
    }
  }

  void _selectDataPackage(String packageId) {
    final selected = _dataPackages.where((item) => item.id == packageId);
    if (selected.isEmpty) return;
    final package = selected.first;
    _dataPackageId = package.id;
    _amountController.text = package.price.toStringAsFixed(2);
  }

  void _setVtuProvider(String provider) {
    setState(() {
      _vtuProvider = provider;
      _dataPackageId = null;
      _dataPackages = const [];
      _setMessageState(null);
    });

    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
      _loadDataPackages(provider);
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
    _submit();
  }

  void _setAirtimeScope(String scope) {
    setState(() {
      _airtimeScope = scope;
      if (scope == 'local') {
        _vtuProvider = _firstProviderId(_localAirtimeProviders);
      } else {
        _airtimeCountryCode = 'GH';
        _airtimeOperatorId = _firstProviderId(
          _airtimeOperatorsForCountry(_airtimeCountryCode),
          fallback: '',
        );
      }
    });

    if (scope == 'international') {
      _loadInternationalProviders(
        type: 'airtime',
        countryCode: _airtimeCountryCode,
      );
    }
  }

  void _setAirtimeCountryCode(String countryCode) {
    setState(() {
      _airtimeCountryCode = countryCode;
      _airtimeOperatorId = _firstProviderId(
        _airtimeOperatorsForCountry(countryCode),
        fallback: '',
      );
    });

    if (_enabledAirtimeCountries.contains(countryCode)) {
      _loadInternationalProviders(type: 'airtime', countryCode: countryCode);
    }
  }

  void _setDataCountryCode(String countryCode) {
    setState(() {
      _dataCountryCode = countryCode;
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
      _loadDataPackages(_vtuProvider);
    } else if (countryCode == 'GH') {
      _loadInternationalProviders(type: 'data', countryCode: countryCode);
    }
  }

  void _setElectricityCountryCode(String countryCode) {
    setState(() {
      _electricityCountryCode = countryCode;
      if (countryCode == 'GH') {
        _electricityBillerId = _firstProviderId(
          _electricityBillersForCountry(countryCode),
          fallback: '',
        );
      } else {
        _vtuProvider = _firstProviderId(_localElectricityProviders);
      }
    });

    if (countryCode == 'GH') {
      _loadInternationalProviders(
        type: 'electricity',
        countryCode: countryCode,
      );
    }
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
    if (widget.kind == MoneyActionKind.electricity) {
      return _electricityCountryCode == 'GH'
          ? _electricityBillersForCountry(_electricityCountryCode)
          : _localElectricityProviders;
    }
    return const [];
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
    return providers.isEmpty ? (fallback ?? _vtuProvider) : providers.first.id;
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

  List<VtuProviderOption> _fallbackLocalProviders(String type) {
    if (type == 'electricity') {
      const billers = [
        VtuProviderOption(
          id: 'ikedc',
          name: 'Ikeja Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'ekedc',
          name: 'Eko Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'aedc',
          name: 'Abuja Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'phed',
          name: 'Port Harcourt Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'jed',
          name: 'Jos Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'kedco',
          name: 'Kano Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'kaedco',
          name: 'Kaduna Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'eedc',
          name: 'Enugu Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'bedc',
          name: 'Benin Electric',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'aba',
          name: 'ABA Power',
          type: 'electricity',
          isActive: true,
        ),
        VtuProviderOption(
          id: 'yedc',
          name: 'Yola Electric',
          type: 'electricity',
          isActive: true,
        ),
      ];
      return billers;
    }

    const networks = [
      VtuProviderOption(
          id: 'mtn', name: 'MTN', type: 'airtime', isActive: true),
      VtuProviderOption(
        id: 'airtel',
        name: 'Airtel',
        type: 'airtime',
        isActive: true,
      ),
      VtuProviderOption(
          id: 'glo', name: 'Glo', type: 'airtime', isActive: true),
      VtuProviderOption(
        id: '9mobile',
        name: '9mobile',
        type: 'airtime',
        isActive: true,
      ),
    ];

    return networks
        .map(
          (provider) => VtuProviderOption(
            id: provider.id,
            name: provider.name,
            type: type,
            isActive: true,
          ),
        )
        .toList();
  }

  String? _resolvedAmountText() {
    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'NG') {
      final packageId = _dataPackageId;
      if (packageId == null) return null;
      final selected = _dataPackages.where((item) => item.id == packageId);
      if (selected.isEmpty) return null;
      return selected.first.price.toStringAsFixed(2);
    }

    return _amountController.text;
  }

  Future<void> _submit() async {
    if (_isSubmitting) return;

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

    if (widget.kind == MoneyActionKind.airtime &&
        _airtimeScope == 'international') {
      if (!_hasSelectedProvider(
        _airtimeOperatorsForCountry(_airtimeCountryCode),
        _airtimeOperatorId,
      )) {
        await _loadInternationalProviders(
          type: 'airtime',
          countryCode: _airtimeCountryCode,
        );
      }

      if (!_hasSelectedProvider(
        _airtimeOperatorsForCountry(_airtimeCountryCode),
        _airtimeOperatorId,
      )) {
        _showMessage(
          'Select an available ${_countryName(_airtimeCountryCode)} operator.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
    }

    if (widget.kind == MoneyActionKind.data &&
        !_enabledDataCountries.contains(_dataCountryCode)) {
      _showMessage('${_countryName(_dataCountryCode)} is coming soon.');
      return;
    }

    if (widget.kind == MoneyActionKind.data && _dataCountryCode == 'GH') {
      if (!_hasSelectedProvider(
        _dataOperatorsForCountry(_dataCountryCode),
        _dataOperatorId,
      )) {
        await _loadInternationalProviders(
          type: 'data',
          countryCode: _dataCountryCode,
        );
      }

      if (!_hasSelectedProvider(
        _dataOperatorsForCountry(_dataCountryCode),
        _dataOperatorId,
      )) {
        _showMessage(
          'Select an available Ghana data operator.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
    }

    if (widget.kind == MoneyActionKind.electricity &&
        !_enabledElectricityCountries.contains(_electricityCountryCode)) {
      _showMessage('${_countryName(_electricityCountryCode)} is coming soon.');
      return;
    }

    if (widget.kind == MoneyActionKind.electricity &&
        _electricityCountryCode == 'GH') {
      if (!_hasSelectedProvider(
        _electricityBillersForCountry(_electricityCountryCode),
        _electricityBillerId,
      )) {
        await _loadInternationalProviders(
          type: 'electricity',
          countryCode: _electricityCountryCode,
        );
      }

      if (!_hasSelectedProvider(
        _electricityBillersForCountry(_electricityCountryCode),
        _electricityBillerId,
      )) {
        _showMessage(
          'Select an available Ghana electricity biller.',
          type: MoneyActionFeedbackType.warning,
        );
        return;
      }
    }

    final resolvedAmount = _resolvedAmountText();
    if (resolvedAmount == null) {
      _showMessage(
        'Select a data package.',
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

    final fieldError = MoneyActionFormValidator.validateFields(
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

    final confirmed = await _confirmSubmission(amount);
    if (!confirmed) return;

    setState(() {
      _isSubmitting = true;
      _setMessageState(null);
    });

    final transactionPin = await _requireTransactionApproval(
      title: 'Approve ${_configFor(widget.kind).title.toLowerCase()}',
      subtitle: 'Confirm this money action before it is submitted.',
    );
    if (transactionPin == null) {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
      return;
    }

    try {
      final idempotencyKey = _attemptIdempotency.keyFor(
        _attemptFingerprint(amount),
      );
      final response = await _request(amount, idempotencyKey, transactionPin);
      _attemptIdempotency.markFinalOutcome();
      setState(() {
        _captureVtuOrder(response.data);
        _setMessageState(
          _successMessage(response.data),
          type: MoneyActionFeedbackType.success,
        );
      });
    } catch (error) {
      setState(() {
        _setMessageState(
          authErrorMessage(error, 'Request failed'),
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

  bool get _isVtuAction {
    return [
      MoneyActionKind.airtime,
      MoneyActionKind.data,
      MoneyActionKind.electricity,
    ].contains(widget.kind);
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
  }

  Future<void> _checkVtuOrderStatus() async {
    final reference = _trackedOrder?.orderId ?? _pendingOrderReference;
    if (reference == null || _isCheckingOrder) return;

    setState(() {
      _isCheckingOrder = true;
      _setMessageState(null);
    });

    try {
      final order = await _vtuService.requeryOrder(
        reference,
        idempotencyKey: _attemptIdempotency.keyFor('vtu-requery|$reference'),
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted) return;
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
        data: {
          'from': _exchangeFrom,
          'to': _exchangeTo,
          'amount': amount,
        },
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

    switch (widget.kind) {
      case MoneyActionKind.fund:
        return Future.error(
          StateError('Bank-transfer funding uses virtual accounts.'),
        );
      case MoneyActionKind.send:
        return _apiClient.client.post(
          '/api/transfers/internal',
          options: options,
          data: {
            'recipientEmail': _recipientController.text.trim(),
            'amount': amount,
            'currency': _currency,
            'transactionPin': transactionPin,
            if (_noteController.text.trim().isNotEmpty)
              'note': _noteController.text.trim(),
          },
        );
      case MoneyActionKind.withdraw:
        return _apiClient.client.post(
          '/api/payments/withdraw',
          options: options,
          data: {
            'amount': amount,
            'currency': _currency,
            'provider': _provider,
            'bankCode': _bankCodeController.text.trim(),
            'accountNumber': _accountNumberController.text.trim(),
            'accountName': _accountNameController.text.trim(),
            'transactionPin': transactionPin,
          },
        );
      case MoneyActionKind.exchange:
        return _apiClient.client.post(
          '/api/exchange/quote',
          options: options,
          data: {
            'from': _currency,
            'to': _currency == 'NGN' ? 'GHS' : 'NGN',
            'amount': amount,
            'transactionPin': transactionPin,
          },
        );
      case MoneyActionKind.airtime:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          options: options,
          data: {
            'type': 'airtime',
            'scope': _airtimeScope,
            if (_airtimeScope == 'local') 'provider': _vtuProvider,
            if (_airtimeScope == 'international')
              'countryCode': _airtimeCountryCode,
            if (_airtimeScope == 'international')
              'operatorId': _airtimeOperatorId,
            'recipientNumber': _recipientController.text.trim(),
            'amount': amount,
            'transactionPin': transactionPin,
          },
        );
      case MoneyActionKind.data:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          options: options,
          data: {
            'type': 'data',
            'scope': _dataCountryCode == 'GH' ? 'international' : 'local',
            if (_dataCountryCode == 'NG') 'provider': _vtuProvider,
            if (_dataCountryCode == 'NG') 'packageId': _dataPackageId,
            if (_dataCountryCode == 'GH') 'countryCode': _dataCountryCode,
            if (_dataCountryCode == 'GH') 'operatorId': _dataOperatorId,
            'recipientNumber': _recipientController.text.trim(),
            'amount': amount,
            'transactionPin': transactionPin,
          },
        );
      case MoneyActionKind.electricity:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          options: options,
          data: {
            'type': 'electricity',
            'scope':
                _electricityCountryCode == 'GH' ? 'international' : 'local',
            if (_electricityCountryCode == 'NG') 'provider': _vtuProvider,
            if (_electricityCountryCode == 'GH')
              'countryCode': _electricityCountryCode,
            if (_electricityCountryCode == 'GH')
              'operatorId': _electricityBillerId,
            'meterNumber': _recipientController.text.trim(),
            'amount': amount,
            'transactionPin': transactionPin,
          },
        );
    }
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
      _recipientController.text.trim().toLowerCase(),
      _bankCodeController.text.trim(),
      _accountNumberController.text.trim(),
    ].join('|');
  }

  Future<bool> _confirmSubmission(String amount) async {
    final config = _configFor(widget.kind);
    final rows = _reviewRows(amount);

    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              backgroundColor: AppColors.surface,
              title: Text('Review ${config.title.toLowerCase()}',
                  style: AppTextStyles.headingM),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final row in rows)
                    _ReviewDialogRow(label: row.label, value: row.value),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Only continue if these details are correct.',
                    style: AppTextStyles.bodyS,
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(
                    'Edit',
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
                  child: const Text('Continue'),
                ),
              ],
            );
          },
        ) ??
        false;
  }

  List<_ReviewRowData> _reviewRows(String amount) {
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
          _ReviewRowData('Amount', '$amount $_currency'),
          _ReviewRowData('Recipient', _recipientController.text.trim()),
          if (_noteController.text.trim().isNotEmpty)
            _ReviewRowData('Note', _noteController.text.trim()),
        ];
      case MoneyActionKind.withdraw:
        return [
          _ReviewRowData('Amount', '$amount $_currency'),
          _ReviewRowData('Provider', _provider),
          _ReviewRowData('Bank code', _bankCodeController.text.trim()),
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
          _ReviewRowData('Amount', '$amount $_currency'),
          _ReviewRowData('Destination', _airtimeScope),
          _ReviewRowData(
            _airtimeScope == 'international' ? 'Operator' : 'Network',
            _airtimeScope == 'international'
                ? _providerName(
                    _airtimeOperatorsForCountry(_airtimeCountryCode),
                    _airtimeOperatorId,
                  )
                : _providerName(_localAirtimeProviders, _vtuProvider),
          ),
          if (_airtimeScope == 'international')
            _ReviewRowData('Country', _countryName(_airtimeCountryCode)),
          _ReviewRowData('Phone', _recipientController.text.trim()),
        ];
      case MoneyActionKind.data:
        return [
          _ReviewRowData('Amount', '$amount $_currency'),
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
      case MoneyActionKind.electricity:
        return [
          _ReviewRowData('Amount', '$amount $_currency'),
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
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.kind == MoneyActionKind.exchange) {
      return _buildExchangeScaffold(context);
    }

    final config = _configFor(widget.kind);

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
                  Row(
                    children: [
                      if (widget.showBackButton)
                        _IconButton(
                          icon: Icons.arrow_back_ios_new_rounded,
                          onTap: () => context.pop(),
                        ),
                      const Spacer(),
                      _StatusPill(label: config.status),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceVariant,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: Center(
                      child: TrustPayLottie(
                        variant: _animationFor(widget.kind),
                        size: 58,
                        semanticsLabel: config.title,
                      ),
                    ),
                  ),
                  SizedBox(height: AppSpacing.lg),
                  Text(config.title, style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(config.subtitle, style: AppTextStyles.bodyL),
                  SizedBox(height: AppSpacing.xl),
                  if (widget.kind != MoneyActionKind.fund) ...[
                    _CurrencySelector(
                      value: _currency,
                      onChanged: (value) => setState(() => _currency = value),
                    ),
                    SizedBox(height: AppSpacing.md),
                    _InputField(
                      controller: _amountController,
                      label: widget.kind == MoneyActionKind.data &&
                              _dataCountryCode == 'NG'
                          ? 'Amount from selected package'
                          : 'Amount',
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      enabled: !(widget.kind == MoneyActionKind.data &&
                          _dataCountryCode == 'NG'),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                      ],
                    ),
                  ],
                  ..._extraFields(),
                  if (widget.kind != MoneyActionKind.fund) ...[
                    SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: _isSubmitting ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.textPrimary,
                        minimumSize: const Size.fromHeight(54),
                      ),
                      child: _isSubmitting
                          ? TrustPayLottie(
                              variant: TrustPayAnimationVariant.loading,
                              size: 30,
                              semanticsLabel: 'Submitting ${config.title}',
                            )
                          : Text(config.buttonLabel),
                    ),
                  ],
                  if (_vtuCatalogMessage != null) ...[
                    SizedBox(height: AppSpacing.md),
                    _MessagePanel(
                      message: _vtuCatalogMessage!,
                      type: MoneyActionFeedbackType.warning,
                      onRetry: _loadVtuCatalogs,
                    ),
                  ],
                  if (_pendingOrderReference != null) ...[
                    SizedBox(height: AppSpacing.md),
                    _VtuOrderStatusPanel(
                      reference: _pendingOrderReference!,
                      order: _trackedOrder,
                      isChecking: _isCheckingOrder,
                      onCheckStatus: _checkVtuOrderStatus,
                    ),
                  ],
                  if (_message != null) ...[
                    SizedBox(height: AppSpacing.md),
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

  Widget _buildExchangeScaffold(BuildContext context) {
    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
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
                  Row(
                    children: [
                      if (widget.showBackButton)
                        _IconButton(
                          icon: Icons.arrow_back_ios_new_rounded,
                          onTap: () => context.pop(),
                        ),
                      const Spacer(),
                      const _StatusPill(label: 'Quote request'),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Text(config.title, style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Convert between NGN and GHS. Submit the quote, then add the destination for review.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xl),
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
                  SizedBox(height: AppSpacing.lg),
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
                  SizedBox(height: AppSpacing.md),
                  const _InfoPanel(
                    text:
                        'After the quote is created, you will add where the converted payout should be sent.',
                  ),
                  if (_message != null) ...[
                    SizedBox(height: AppSpacing.md),
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

  Future<String?> _requireTransactionApproval({
    required String title,
    required String subtitle,
  }) async {
    final config = await _transactionSecurityService.getConfig();

    if (!mounted) {
      return null;
    }

    if (!config.hasPin) {
      final shouldSetup = await showDialog<bool>(
            context: context,
            builder: (dialogContext) {
              return AlertDialog(
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
      }
      return null;
    }

    final approvedPin = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => TransactionPinScreen.verify(
          pinLength: config.pinLength,
          allowBiometric: config.shouldOfferBiometrics,
          biometricLabel: config.biometricLabel,
          title: title,
          subtitle: subtitle,
        ),
        fullscreenDialog: true,
      ),
    );

    return approvedPin;
  }

  List<Widget> _extraFields() {
    switch (widget.kind) {
      case MoneyActionKind.fund:
        return [
          SizedBox(height: AppSpacing.md),
          _FundingAccountPanel(
            user: _fundingUser,
            account: _preferredFundingAccount(),
            isLoading: _isLoadingFundingAccounts,
            isRequesting: _isRequestingFundingAccount,
            message: _fundingAccountMessage,
            onRefresh: _loadFundingAccounts,
            onRequest: _requestFundingAccount,
            onCopy: _copyFundingValue,
          ),
        ];
      case MoneyActionKind.send:
        return [
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Recipient email',
            keyboardType: TextInputType.emailAddress,
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(controller: _noteController, label: 'Note optional'),
        ];
      case MoneyActionKind.withdraw:
        return [
          SizedBox(height: AppSpacing.md),
          _ProviderSelector(
            value: _provider,
            onChanged: (value) => setState(() => _provider = value),
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(controller: _bankCodeController, label: 'Bank code'),
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _accountNumberController,
            label: 'Account number',
            keyboardType: TextInputType.number,
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(
              controller: _accountNameController, label: 'Account name'),
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
        final airtimeOperators =
            _airtimeOperatorsForCountry(_airtimeCountryCode);
        return [
          SizedBox(height: AppSpacing.md),
          const _VtuProviderRoutePanel(
            title: 'Nigeria via VTPass',
            description: 'Ghana airtime is routed through Reloadly.',
          ),
          SizedBox(height: AppSpacing.md),
          _ChoiceRow(
            label: 'Top-up destination',
            value: _airtimeScope,
            values: const ['local', 'international'],
            onChanged: _setAirtimeScope,
          ),
          SizedBox(height: AppSpacing.md),
          if (_airtimeScope == 'international') ...[
            _ChoiceRow(
              label: 'Service country',
              value: _airtimeCountryCode,
              values: _airtimeCountryOptions,
              labels: _countryLabels,
              disabledValues: _airtimeCountryOptions
                  .where((code) => !_enabledAirtimeCountries.contains(code))
                  .toSet(),
              onChanged: _setAirtimeCountryCode,
            ),
            SizedBox(height: AppSpacing.md),
            if (_isLoadingVtuCatalog && airtimeOperators.isEmpty) ...[
              const _InfoPanel(text: 'Loading available operators...'),
              SizedBox(height: AppSpacing.md),
            ] else if (airtimeOperators.isEmpty) ...[
              _InfoPanel(
                text:
                    'No ${_countryName(_airtimeCountryCode)} operators are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Operator',
                value: _airtimeOperatorId,
                providers: airtimeOperators,
                onChanged: (value) =>
                    setState(() => _airtimeOperatorId = value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
          ] else ...[
            if (_isLoadingVtuCatalog && _localAirtimeProviders.isEmpty) ...[
              const _InfoPanel(text: 'Loading VTPass airtime networks...'),
              SizedBox(height: AppSpacing.md),
            ] else if (_localAirtimeProviders.isEmpty) ...[
              const _InfoPanel(
                text: 'No Nigerian airtime networks are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Network',
                value: _vtuProvider,
                providers: _localAirtimeProviders,
                onChanged: (value) => _setVtuProvider(value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
          ],
          _InputField(
            controller: _recipientController,
            label: 'Phone number',
            keyboardType: TextInputType.phone,
          ),
        ];
      case MoneyActionKind.data:
        final ghanaDataOperators = _dataOperatorsForCountry('GH');
        return [
          SizedBox(height: AppSpacing.md),
          const _VtuProviderRoutePanel(
            title: 'Nigeria data via VTPass',
            description: 'Packages load after you choose a Nigerian network.',
          ),
          SizedBox(height: AppSpacing.md),
          _ChoiceRow(
            label: 'Service country',
            value: _dataCountryCode,
            values: _dataCountryOptions,
            labels: _countryLabels,
            disabledValues: _dataCountryOptions
                .where((code) => !_enabledDataCountries.contains(code))
                .toSet(),
            onChanged: (value) => _setDataCountryCode(value),
          ),
          SizedBox(height: AppSpacing.md),
          if (_dataCountryCode == 'GH') ...[
            if (_isLoadingVtuCatalog && ghanaDataOperators.isEmpty) ...[
              const _InfoPanel(text: 'Loading available data operators...'),
              SizedBox(height: AppSpacing.md),
            ] else if (ghanaDataOperators.isEmpty) ...[
              const _InfoPanel(
                text: 'No Ghana data operators are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Operator',
                value: _dataOperatorId,
                providers: ghanaDataOperators,
                onChanged: (value) => setState(() => _dataOperatorId = value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
          ] else if (_dataCountryCode != 'NG') ...[
            const _InfoPanel(
              text:
                  'This country is coming soon for mobile data. Nigeria and Ghana are available now.',
            ),
            SizedBox(height: AppSpacing.md),
          ] else ...[
            if (_isLoadingVtuCatalog && _localDataProviders.isEmpty) ...[
              const _InfoPanel(text: 'Loading VTPass data networks...'),
              SizedBox(height: AppSpacing.md),
            ] else if (_localDataProviders.isEmpty) ...[
              const _InfoPanel(
                text: 'No Nigerian data networks are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Network',
                value: _vtuProvider,
                providers: _localDataProviders,
                onChanged: (value) => _setVtuProvider(value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
            if (_isLoadingVtuCatalog)
              const _InfoPanel(text: 'Loading VTPass data packages...')
            else if (_dataPackages.isEmpty)
              const _InfoPanel(
                text: 'No data packages are available for this network yet.',
              )
            else
              _VtuPackageSelector(
                value: _dataPackageId,
                packages: _dataPackages,
                onChanged: (value) => setState(() => _selectDataPackage(value)),
              ),
            SizedBox(height: AppSpacing.md),
          ],
          _InputField(
            controller: _recipientController,
            label: 'Phone number',
            keyboardType: TextInputType.phone,
          ),
        ];
      case MoneyActionKind.electricity:
        final ghanaElectricityBillers = _electricityBillersForCountry('GH');
        return [
          SizedBox(height: AppSpacing.md),
          const _VtuProviderRoutePanel(
            title: 'Nigeria electricity via VTPass',
            description: 'Use prepaid meters for the first live test.',
          ),
          SizedBox(height: AppSpacing.md),
          _ChoiceRow(
            label: 'Service country',
            value: _electricityCountryCode,
            values: _electricityCountryOptions,
            labels: _countryLabels,
            disabledValues: _electricityCountryOptions
                .where((code) => !_enabledElectricityCountries.contains(code))
                .toSet(),
            onChanged: _setElectricityCountryCode,
          ),
          SizedBox(height: AppSpacing.md),
          if (_electricityCountryCode == 'GH') ...[
            if (_isLoadingVtuCatalog && ghanaElectricityBillers.isEmpty) ...[
              const _InfoPanel(
                text: 'Loading available electricity billers...',
              ),
              SizedBox(height: AppSpacing.md),
            ] else if (ghanaElectricityBillers.isEmpty) ...[
              const _InfoPanel(
                text: 'No Ghana electricity billers are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Biller',
                value: _electricityBillerId,
                providers: ghanaElectricityBillers,
                onChanged: (value) =>
                    setState(() => _electricityBillerId = value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
          ] else ...[
            if (_isLoadingVtuCatalog && _localElectricityProviders.isEmpty) ...[
              const _InfoPanel(
                text: 'Loading VTPass electricity providers...',
              ),
              SizedBox(height: AppSpacing.md),
            ] else if (_localElectricityProviders.isEmpty) ...[
              const _InfoPanel(
                text: 'No Nigerian electricity providers are available yet.',
              ),
              SizedBox(height: AppSpacing.md),
            ] else ...[
              _VtuProviderSelector(
                label: 'Provider',
                value: _vtuProvider,
                providers: _localElectricityProviders,
                onChanged: (value) => _setVtuProvider(value),
              ),
              SizedBox(height: AppSpacing.md),
            ],
          ],
          _InputField(
            controller: _recipientController,
            label: 'Meter number',
            keyboardType: TextInputType.number,
          ),
        ];
    }
  }

  HomeVirtualAccount? _preferredFundingAccount() {
    for (final account in _fundingAccounts) {
      if (account.provider.toLowerCase() == 'monnify' &&
          account.currency.toUpperCase() == 'NGN' &&
          account.status.toUpperCase() == 'ACTIVE') {
        return account;
      }
    }
    for (final account in _fundingAccounts) {
      if (account.provider.toLowerCase() == 'monnify' &&
          account.currency.toUpperCase() == 'NGN') {
        return account;
      }
    }
    return null;
  }

  _FundingNameParts _fundingAccountNameParts() {
    final user = _fundingUser;
    final source = (user?.fullName.trim().isNotEmpty ?? false)
        ? user!.fullName.trim()
        : (user?.email.split('@').first.trim() ?? '');
    final parts = source
        .split(RegExp(r'\s+|[._-]+'))
        .where((part) => part.trim().isNotEmpty)
        .toList();

    return _FundingNameParts(
      firstName: parts.isNotEmpty ? parts.first : 'TrustPay',
      lastName: parts.length > 1 ? parts.last : 'User',
      middleName: parts.length > 2
          ? parts.sublist(1, parts.length - 1).join(' ')
          : null,
    );
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
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Account number copied')),
    );
  }
}

class _FundingNameParts {
  final String firstName;
  final String lastName;
  final String? middleName;

  const _FundingNameParts({
    required this.firstName,
    required this.lastName,
    this.middleName,
  });
}

class _CurrencySelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _CurrencySelector({
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return _ChoiceRow(
      label: 'Currency',
      value: value,
      values: const ['NGN', 'GHS'],
      onChanged: onChanged,
    );
  }
}

class _ProviderSelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _ProviderSelector({
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return _ChoiceRow(
      label: 'Provider',
      value: value,
      values: const ['paystack', 'flutterwave'],
      onChanged: onChanged,
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
    final items = providers.isEmpty
        ? [
            VtuProviderOption(
              id: value,
              name: value,
              type: '',
              isActive: true,
            ),
          ]
        : providers;

    return DropdownButtonFormField<String>(
      initialValue:
          items.any((item) => item.id == value) ? value : items.first.id,
      items: items
          .map(
            (item) => DropdownMenuItem(
              value: item.id,
              child: Text(item.name),
            ),
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

class _VtuPackageSelector extends StatelessWidget {
  final String? value;
  final List<VtuPackageOption> packages;
  final ValueChanged<String> onChanged;

  const _VtuPackageSelector({
    required this.value,
    required this.packages,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final selectedValue =
        value != null && packages.any((item) => item.id == value)
            ? value
            : packages.first.id;

    return DropdownButtonFormField<String>(
      initialValue: selectedValue,
      items: packages
          .map(
            (item) => DropdownMenuItem(
              value: item.id,
              child: Text(
                '${item.name} - NGN ${item.price.toStringAsFixed(2)}',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
      dropdownColor: AppColors.surface,
      decoration: _inputDecoration('Data package'),
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
    );
  }
}

class _ChoiceRow extends StatelessWidget {
  final String label;
  final String value;
  final List<String> values;
  final Map<String, String> labels;
  final Set<String> disabledValues;
  final ValueChanged<String> onChanged;

  const _ChoiceRow({
    required this.label,
    required this.value,
    required this.values,
    this.labels = const {},
    this.disabledValues = const {},
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      items: values.map((item) {
        final isDisabled = disabledValues.contains(item);
        final displayLabel = labels[item] ?? item;
        return DropdownMenuItem(
          value: item,
          enabled: !isDisabled,
          child: Text(
            isDisabled ? '$displayLabel (coming soon)' : displayLabel,
            style: isDisabled
                ? AppTextStyles.bodyM.copyWith(
                    color: AppColors.textSecondary,
                  )
                : null,
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
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final bool enabled;

  const _InputField({
    required this.controller,
    required this.label,
    this.keyboardType,
    this.inputFormatters,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      enabled: enabled,
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
      decoration: _inputDecoration(label),
    );
  }
}

class _ReviewDialogRow extends StatelessWidget {
  final String label;
  final String value;

  const _ReviewDialogRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(label, style: AppTextStyles.bodyS),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTextStyles.labelS,
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewRowData {
  final String label;
  final String value;

  const _ReviewRowData(this.label, this.value);
}

class _FundingAccountPanel extends StatelessWidget {
  final HomeUser? user;
  final HomeVirtualAccount? account;
  final bool isLoading;
  final bool isRequesting;
  final String? message;
  final VoidCallback onRefresh;
  final VoidCallback onRequest;
  final ValueChanged<String> onCopy;

  const _FundingAccountPanel({
    required this.user,
    required this.account,
    required this.isLoading,
    required this.isRequesting,
    required this.message,
    required this.onRefresh,
    required this.onRequest,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
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
    final displayNumber = fundingAccount?.displayAccountNumber ?? '';
    final canCopy = displayNumber.isNotEmpty && !displayNumber.contains('*');

    return StaggeredEntrance(
      child: _Panel(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 240),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          child: fundingAccount == null
              ? Column(
                  key: const ValueKey('funding-request'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _FundingUserSummary(user: user),
                    SizedBox(height: AppSpacing.md),
                    Text(
                      message ??
                          'Request your NGN account to fund by transfer.',
                      style: AppTextStyles.bodyS.copyWith(
                        color: AppColors.textPrimary,
                      ),
                    ),
                    SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: isRequesting ? null : onRequest,
                            icon: isRequesting
                                ? const TrustPayLottie(
                                    variant: TrustPayAnimationVariant.loading,
                                    size: 24,
                                    semanticsLabel:
                                        'Requesting funding account',
                                  )
                                : const Icon(Icons.account_balance_rounded),
                            label: Text(
                              isRequesting
                                  ? 'Requesting account...'
                                  : 'Request account',
                            ),
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: AppColors.textPrimary,
                            ),
                          ),
                        ),
                        SizedBox(width: AppSpacing.sm),
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
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Icon(
                            Icons.account_balance_rounded,
                            color: AppColors.primary,
                            size: 22,
                          ),
                        ),
                        SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                fundingAccount.bankName,
                                style: AppTextStyles.labelL,
                              ),
                              SizedBox(height: AppSpacing.xs),
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
                    SizedBox(height: AppSpacing.md),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Account number',
                                  style: AppTextStyles.bodyS.copyWith(
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                                SizedBox(height: AppSpacing.xs),
                                AnimatedValueText(
                                  value:
                                      '${fundingAccount.currency} $displayNumber',
                                  style: AppTextStyles.headingM.copyWith(
                                    letterSpacing: 0,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed:
                                canCopy ? () => onCopy(displayNumber) : null,
                            icon: const Icon(Icons.copy_rounded),
                            tooltip: 'Copy account number',
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: AppSpacing.md),
                    _FundingUserSummary(user: user),
                    SizedBox(height: AppSpacing.md),
                    Text(
                      'Transfer NGN to this account. Your wallet is credited after Monnify confirms the transaction.',
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

class _FundingUserSummary extends StatelessWidget {
  final HomeUser? user;

  const _FundingUserSummary({required this.user});

  @override
  Widget build(BuildContext context) {
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
              SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  currentUser.displayName,
                  style: AppTextStyles.labelM,
                ),
              ),
              _StatusPill(label: currentUser.kycStatus),
            ],
          ),
          SizedBox(height: AppSpacing.sm),
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

  const _FundingDetailRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
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
              style: AppTextStyles.bodyS.copyWith(
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _VtuProviderRoutePanel extends StatelessWidget {
  final String title;
  final String description;

  const _VtuProviderRoutePanel({
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.verified_rounded,
              color: AppColors.primary,
              size: 18,
            ),
          ),
          SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.labelM),
                SizedBox(height: AppSpacing.xs),
                Text(
                  description,
                  style: AppTextStyles.bodyS.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final String text;

  const _InfoPanel({required this.text});

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Text(
        text,
        style: AppTextStyles.bodyS.copyWith(color: AppColors.textPrimary),
      ),
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
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
            ),
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
      fieldViewBuilder: (
        context,
        fieldController,
        fieldFocusNode,
        onFieldSubmitted,
      ) {
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
                separatorBuilder: (_, __) => Divider(
                  height: 1,
                  color: AppColors.border,
                ),
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
      fieldViewBuilder: (
        context,
        fieldController,
        fieldFocusNode,
        onFieldSubmitted,
      ) {
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
                separatorBuilder: (_, __) => Divider(
                  height: 1,
                  color: AppColors.border,
                ),
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

  const _ResolvedAccountPanel({
    required this.accountName,
    required this.isResolving,
    required this.error,
    required this.canResolve,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
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
            ? 'Confirming account name...'
            : error ?? 'Account name will appear here';

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
          SizedBox(width: AppSpacing.sm),
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
            TextButton(
              onPressed: onRetry,
              child: const Text('Retry'),
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
          .map((item) =>
              _SettlementBankOption.fromJson(Map<String, dynamic>.from(item)))
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
          'provider': 'monnify',
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
        const SnackBar(
          content: Text('Choose a bank or MoMo wallet.'),
        ),
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
                  Row(
                    children: [
                      _IconButton(
                        icon: Icons.arrow_back_ios_new_rounded,
                        onTap: () => context.pop(),
                      ),
                      const Spacer(),
                      const _StatusPill(label: 'Send to'),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Text(
                    'Where should we send it?',
                    style: AppTextStyles.displayMedium,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Choose a bank or wallet. Add the account number.',
                    style: AppTextStyles.bodyL,
                  ),
                  const SizedBox(height: AppSpacing.xl),
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
                      SizedBox(height: AppSpacing.lg),
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
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                AppColors.surfaceVariant,
              ],
            ),
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              _ExchangeLegCard(
                title: 'You send',
                currency: fromCurrency,
                selectorLabel: 'Debit wallet',
                amountController: amountController,
                onCurrencyChanged: onFromChanged,
                trailing: 'Wallet balance',
              ),
              SizedBox(height: 58),
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
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.border, width: 6),
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
                size: 28,
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
  final String selectorLabel;
  final String trailing;
  final TextEditingController amountController;
  final ValueChanged<String> onCurrencyChanged;

  const _ExchangeLegCard({
    required this.title,
    required this.currency,
    required this.selectorLabel,
    required this.trailing,
    required this.amountController,
    required this.onCurrencyChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: AppTextStyles.bodyM),
              const Spacer(),
              Text(trailing, style: AppTextStyles.bodyS),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          Align(
            alignment: Alignment.centerLeft,
            child: _ExchangeCurrencyPill(
              currency: currency,
              onChanged: onCurrencyChanged,
            ),
          ),
          SizedBox(height: AppSpacing.sm),
          TextField(
            controller: amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
            ],
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
          SizedBox(height: AppSpacing.sm),
          Text(
            _amountInWords(amountController.text, currency),
            style: AppTextStyles.bodyS,
          ),
          SizedBox(height: 4),
          Text(selectorLabel, style: AppTextStyles.bodyS),
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.bodyM),
          SizedBox(height: AppSpacing.md),
          Align(
            alignment: Alignment.centerLeft,
            child: _ExchangeCurrencyPill(
              currency: currency,
              onChanged: onCurrencyChanged,
            ),
          ),
          SizedBox(height: AppSpacing.sm),
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
          SizedBox(height: AppSpacing.sm),
          Text(
            rateError != null
                ? 'Rate unavailable'
                : _amountInWords(amount, currency),
            style: AppTextStyles.bodyS,
          ),
          SizedBox(height: AppSpacing.sm),
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
                  SizedBox(width: AppSpacing.xs),
                ],
                Expanded(
                  child: Text(
                    rateError != null
                        ? 'Live rate unavailable'
                        : isRateLoading
                            ? 'Refreshing quote'
                            : 'Quote amount updates before submission',
                    style: AppTextStyles.bodyS,
                  ),
                ),
              ],
            ),
          ),
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
                      SizedBox(width: 6),
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
    final formatter = DateFormat('dd MMM yyyy â€¢ HH:mm');
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
                  child: Icon(
                    Icons.receipt_long_rounded,
                    color: Colors.white,
                    size: 34,
                  ),
                ),
                SizedBox(height: AppSpacing.md),
                Text('Exchange quote created', style: AppTextStyles.headingL),
                SizedBox(height: AppSpacing.xs),
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
                SizedBox(height: AppSpacing.lg),
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
                SizedBox(height: AppSpacing.lg),
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
                SizedBox(height: AppSpacing.sm),
                Text(
                  'Your exchange request is ready for payout processing.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyS,
                ),
                SizedBox(height: AppSpacing.md),
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
                  child: CustomPaint(
                    painter: _BarcodePainter(),
                  ),
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
    final alignment =
        alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Column(
      crossAxisAlignment: alignment,
      children: [
        Text(label, style: AppTextStyles.bodyS),
        SizedBox(height: AppSpacing.xs),
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
    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(label, style: AppTextStyles.bodyS)),
            SizedBox(width: AppSpacing.md),
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
          SizedBox(height: AppSpacing.sm),
          Divider(color: AppColors.divider, height: 1),
          SizedBox(height: AppSpacing.sm),
        ],
      ],
    );
  }
}

class _ReceiptCutLine extends StatelessWidget {
  const _ReceiptCutLine();

  @override
  Widget build(BuildContext context) {
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
      canvas.drawRect(
        Rect.fromLTWH(x, 8, width, size.height - 16),
        paint,
      );
      x += width + ((i % 3) + 1);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _IconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _IconButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: AppColors.textPrimary, size: 18),
        ),
      ),
    );
  }
}

InputDecoration _inputDecoration(String label) {
  return InputDecoration(
    labelText: label,
    labelStyle: AppTextStyles.bodyM,
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

TrustPayAnimationVariant _animationFor(MoneyActionKind kind) {
  switch (kind) {
    case MoneyActionKind.fund:
      return TrustPayAnimationVariant.loading;
    case MoneyActionKind.send:
    case MoneyActionKind.withdraw:
    case MoneyActionKind.exchange:
    case MoneyActionKind.airtime:
    case MoneyActionKind.data:
    case MoneyActionKind.electricity:
      return TrustPayAnimationVariant.send;
  }
}

_ActionConfig _configFor(MoneyActionKind kind) {
  switch (kind) {
    case MoneyActionKind.fund:
      return const _ActionConfig(
        title: 'Fund wallet',
        subtitle: 'Request a Monnify account and transfer into it.',
        buttonLabel: 'Copy account number',
        status: 'NGN transfer',
        icon: Icons.account_balance_wallet_rounded,
      );
    case MoneyActionKind.send:
      return const _ActionConfig(
        title: 'Send money',
        subtitle: 'Send to another TRUSTPAY user by email.',
        buttonLabel: 'Send transfer',
        status: 'KYC gated',
        icon: Icons.near_me_rounded,
      );
    case MoneyActionKind.withdraw:
      return const _ActionConfig(
        title: 'Withdraw',
        subtitle: 'Send wallet funds to a bank account.',
        buttonLabel: 'Submit withdrawal',
        status: 'KYC gated',
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
    case MoneyActionKind.electricity:
      return const _ActionConfig(
        title: 'Electricity',
        subtitle: 'Recharge Nigerian and Ghanaian electricity meters.',
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
    if (status == 'PENDING' || success == false) {
      return '${message is String ? message : 'VTU purchase is pending provider confirmation.'}\nReference: $reference';
    }
    if (message is String && reference != null) {
      return '$message\nReference: $reference';
    }
    if (reference != null) return 'Request created.\nReference: $reference';
    return 'Request completed: $data';
  }
  return 'Request completed.';
}

String _orderStatusMessage(VtuOrderStatus order) {
  switch (order.orderStatus) {
    case 'SUCCESS':
      return 'VTU purchase confirmed.\nReference: ${order.reference}';
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
  static final RegExp _phonePattern = RegExp(r'^\+?[0-9]{7,15}$');

  static MoneyActionValidationResult validateAmount(String raw) {
    final value = raw.trim();
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
    if (note.trim().length > 500) {
      return 'Keep the note under 500 characters.';
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
            account.length < 8 ||
            account.length > 16 ||
            !_digitsPattern.hasMatch(account)) {
          return 'Enter a valid bank code and account number.';
        }
        if (accountName.trim().length < 2) {
          return 'Enter the account name.';
        }
        return null;
      case MoneyActionKind.airtime:
      case MoneyActionKind.data:
        if (!_phonePattern.hasMatch(recipient.trim())) {
          return 'Enter a valid phone number.';
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

String _amountInWords(dynamic value, String currency) {
  final rawValue = value is num ? value.toStringAsFixed(2) : value.toString();
  final normalized = rawValue.replaceAll(',', '').trim();
  final amount = double.tryParse(normalized);

  if (normalized.isEmpty || amount == null || amount <= 0) {
    return 'Enter an amount';
  }

  final parts = normalized.split('.');
  final whole = int.tryParse(parts.first.isEmpty ? '0' : parts.first);
  final decimals = parts.length > 1
      ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0
      : 0;

  if (whole == null) return 'Amount is too large to spell out';

  final labels = _currencyWordLabels(currency);
  final majorWords = '${_numberToWords(whole)} ${labels.$1}';
  if (decimals > 0) {
    return '$majorWords, ${_numberToWords(decimals)} ${labels.$2}';
  }

  return majorWords;
}

(String, String) _currencyWordLabels(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return ('naira', 'kobo');
    case 'GHS':
      return ('cedis', 'pesewas');
    default:
      return (currency.toUpperCase(), 'minor units');
  }
}

String _numberToWords(int value) {
  const small = [
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
    'ninety',
  ];
  const scales = [
    (1000000000000, 'trillion'),
    (1000000000, 'billion'),
    (1000000, 'million'),
    (1000, 'thousand'),
  ];

  if (value < 20) return small[value];
  if (value < 100) {
    final ten = value ~/ 10;
    final remainder = value % 10;
    return remainder == 0 ? tens[ten] : '${tens[ten]} ${small[remainder]}';
  }
  if (value < 1000) {
    final hundreds = value ~/ 100;
    final remainder = value % 100;
    return remainder == 0
        ? '${small[hundreds]} hundred'
        : '${small[hundreds]} hundred ${_numberToWords(remainder)}';
  }

  for (final scale in scales) {
    if (value >= scale.$1) {
      final count = value ~/ scale.$1;
      final remainder = value % scale.$1;
      return remainder == 0
          ? '${_numberToWords(count)} ${scale.$2}'
          : '${_numberToWords(count)} ${scale.$2} ${_numberToWords(remainder)}';
    }
  }

  return value.toString();
}
