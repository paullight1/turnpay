import 'package:dio/dio.dart';

import '../core/constants/app_constants.dart';
import '../core/kyc/kyc_tier.dart';
import '../core/money/money_value.dart';
import '../core/state/resource_state.dart';
import 'api_client.dart';
import 'kyc_service.dart';

class HomeDataService {
  HomeDataService({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  HomeUser? _lastKnownUser;
  Future<Response<dynamic>>? _pendingBootstrap;

  HomeUser? get lastKnownUser => _lastKnownUser;

  Future<Response<dynamic>> _bootstrap() => _pendingBootstrap ??=
          _apiClient.client.post('/api/auth/bootstrap').then((response) {
        // Keep this cache on the service instance: MainShell shares one
        // service for the signed-in account, and no user data crosses a
        // logout/new-session boundary through a process-wide cache. Updating
        // it as soon as bootstrap resolves lets Profile render known identity
        // details while slower dashboard collections are still loading.
        _rememberBootstrapUser(response);
        return response;
      }).whenComplete(() {
        _pendingBootstrap = null;
      });

  void _rememberBootstrapUser(Response<dynamic> response) {
    final data = response.data;
    if (data is! Map<String, dynamic>) return;
    final rawUser = data['user'];
    if (rawUser is! Map<String, dynamic>) return;
    _lastKnownUser = HomeUser.fromJson(rawUser);
  }

  /// Lightweight, uncached reads for foreground balance updates.
  Future<List<HomeWallet>> fetchWalletBalances() async {
    final response = await _apiClient.client
        .get('/api/wallets', options: _freshRequestOptions());
    if (response.data is! List) {
      throw const FormatException('Invalid wallet balances response.');
    }
    return (response.data as List)
        .map((item) => HomeWallet.fromJson(_requiredMap(item, 'wallet')))
        .toList();
  }

  Future<KycOverview> fetchKycOverview() =>
      KycService(apiClient: _apiClient).fetchOverview();

  Future<HomeUser> fetchCurrentUser() async {
    final response = await _bootstrap();
    final data = response.data;
    if (data is! Map<String, dynamic> ||
        data['user'] is! Map<String, dynamic>) {
      throw const FormatException('Invalid profile response: expected a user.');
    }
    return _lastKnownUser =
        HomeUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  /// Loads only the data needed by the Account Details route.
  ///
  /// The dashboard also includes transactions and beneficiaries, but those
  /// collections are not needed to render identity, KYC, or receiving-account
  /// details. Keep this request scoped to the signed-in service instance so it
  /// cannot become a cross-account cache.
  Future<HomeAccountDetailsData> fetchAccountDetails() async {
    final responses = await Future.wait<dynamic>([
      fetchCurrentUser(),
      fetchVirtualAccounts(),
    ]);

    return HomeAccountDetailsData(
      user: responses[0] as HomeUser,
      virtualAccounts: responses[1] as List<HomeVirtualAccount>,
    );
  }

  Future<HomeDashboardData> fetchDashboard() async {
    final responses = await Future.wait<dynamic>([
      _bootstrap(),
      _fetchTransactionsForDashboard(),
      _fetchVirtualAccountsForDashboard(),
      _fetchBeneficiariesForDashboard(),
    ]);

    final dashboard = HomeDashboardData.fromResponses(
      bootstrap: (responses[0] as Response).data,
      transactions: responses[1],
      virtualAccounts: responses[2],
      beneficiaries: responses[3],
    );
    _lastKnownUser = dashboard.user;
    return dashboard;
  }

  Future<Map<String, dynamic>> _fetchTransactionsForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: {'limit': 5},
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is Map<String, dynamic>) {
        _requiredList(data, 'transactions');
        return data;
      }
    } on DioException catch (error) {
      // A missing optional collection is a genuine empty state.  An outage,
      // timeout, or auth rejection must fail the dashboard load visibly.
      if (_isNotFound(error)) return const {'transactions': []};
      rethrow;
    }

    throw const FormatException(
      'Invalid dashboard transactions response: expected an object.',
    );
  }

  Future<List<dynamic>> _fetchVirtualAccountsForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/accounts',
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is List) return data;
    } on DioException catch (error) {
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    throw const FormatException(
      'Invalid dashboard virtual accounts response: expected a list.',
    );
  }

  Future<List<dynamic>> _fetchBeneficiariesForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/beneficiaries',
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is List) return data;
      if (data is Map<String, dynamic>) {
        return _requiredList(data, 'beneficiaries');
      }
    } on DioException catch (error) {
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    throw const FormatException(
      'Invalid dashboard beneficiaries response: expected a list or object.',
    );
  }

  Future<List<HomeTransaction>> fetchTransactions({int limit = 20}) async {
    late final dynamic responseData;
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: {'limit': limit},
      );
      responseData = response.data;
    } on DioException catch (error) {
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    final data = responseData;
    if (data is! Map<String, dynamic>) {
      throw const FormatException(
        'Invalid transactions response: expected an object.',
      );
    }

    return _requiredList(data, 'transactions')
        .map((item) => HomeTransaction.fromJson(_asMap(item)))
        .toList();
  }

  Future<List<HomeBeneficiary>> fetchBeneficiaries() async {
    late final dynamic responseData;
    try {
      final response =
          await _apiClient.client.get('/api/banking/beneficiaries');
      responseData = response.data;
    } on DioException catch (error) {
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    final data = responseData is List
        ? responseData
        : (responseData is Map<String, dynamic>
            ? _requiredList(
                responseData,
                'beneficiaries',
              )
            : throw const FormatException(
                'Invalid beneficiaries response: expected a list or object.',
              ));

    return data.map((item) => HomeBeneficiary.fromJson(_asMap(item))).toList();
  }

  Future<List<HomeVirtualAccount>> fetchVirtualAccounts() async {
    late final dynamic responseData;
    try {
      final response = await _apiClient.client.get('/api/banking/accounts');
      responseData = response.data;
    } on DioException catch (error) {
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    final accounts = responseData is List
        ? responseData
        : throw const FormatException(
            'Invalid virtual accounts response: expected a list.',
          );

    return accounts
        .map((item) => HomeVirtualAccount.fromJson(_asMap(item)))
        .toList();
  }

  /// Reads the server-owned provisioning state separately from the issued
  /// account list. A pending Paystack request is not an account yet, so it
  /// must survive a screen reload without being inferred from a blank row.
  Future<HomeVirtualAccountProvisioning>
      fetchVirtualAccountProvisioning() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/accounts/provisioning',
        options: _freshRequestOptions(),
      );
      return HomeVirtualAccountProvisioning.fromJson(_asMap(response.data));
    } on DioException catch (error) {
      // Older deployments do not expose the optional status endpoint yet.
      // Treat that as an untouched request, while surfacing auth/outage
      // errors to the caller so the UI does not invent a ready account.
      if (_isNotFound(error)) {
        return const HomeVirtualAccountProvisioning(
          provider: 'PAYSTACK',
          status: 'NOT_REQUESTED',
        );
      }
      rethrow;
    }
  }

  Future<HomeVirtualAccount> provisionVirtualAccount({
    bool consentAccepted = false,
    String idempotencyKey = '',
  }) async {
    if (!consentAccepted) {
      throw ArgumentError.value(
        consentAccepted,
        'consentAccepted',
        'Dedicated-account setup requires explicit user consent.',
      );
    }
    final response = await _apiClient.client.post(
      '/api/banking/accounts/provision',
      options: idempotencyKey.isEmpty
          ? null
          : Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {
        'currency': 'NGN',
        'country': 'NG',
        'consentAccepted': true,
      },
    );

    return HomeVirtualAccount.fromJson(_asMap(response.data));
  }

  Future<HomeVirtualAccountProvisioning> requestAccountSetup({
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.client.post(
      '/api/banking/accounts/setup-request',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {'consentAccepted': true},
    );
    return HomeVirtualAccountProvisioning.fromJson(_asMap(response.data));
  }

  Future<HomeUser> updateProfile({
    required String fullName,
    required String phone,
    required int yearOfBirth,
    required String country,
  }) async {
    final response = await _apiClient.client.patch(
      '/api/users/me',
      data: {
        'fullName': fullName.trim(),
        'phone': phone.replaceAll(RegExp(r'[\s-]+'), '').trim(),
        'yearOfBirth': yearOfBirth,
        'country': country.toUpperCase(),
      },
    );

    return _lastKnownUser = HomeUser.fromJson(_asMap(response.data));
  }

  Future<List<SupportTicket>> fetchSupportTickets({int limit = 10}) async {
    final response = await _apiClient.client.get(
      '/api/support/tickets',
      queryParameters: {'limit': limit},
    );

    final data = response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{};

    return _asList(data['tickets'])
        .map((item) => SupportTicket.fromJson(_asMap(item)))
        .toList();
  }

  Future<SupportTicket> createSupportTicket({
    required String category,
    required String description,
    String? transactionReference,
  }) async {
    final response = await _apiClient.client.post(
      '/api/support/tickets',
      data: {
        'category': category,
        'description': description,
        if (transactionReference != null && transactionReference.isNotEmpty)
          'transactionReference': transactionReference,
      },
    );

    return SupportTicket.fromJson(_asMap(response.data));
  }

  Future<ReferralDashboard> fetchReferralDashboard() async {
    final response = await _apiClient.client.get(
      '/api/referrals/me',
      options: _freshRequestOptions(),
    );

    return ReferralDashboard.fromJson(_asMap(response.data));
  }

  Future<ResourceState<HomeDashboardData>> fetchDashboardState({
    DateTime? refreshedAt,
    HomeDashboardData? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final dashboard = await fetchDashboard();
      return ResourceState<HomeDashboardData>.value(
        dashboard,
        refreshedAt: refreshedAt,
      );
    } on DioException catch (error, stackTrace) {
      return _resourceStateForError(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    } on FormatException catch (error, stackTrace) {
      return ResourceState<HomeDashboardData>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<List<HomeTransaction>>> fetchTransactionsState({
    int limit = 20,
    DateTime? refreshedAt,
    List<HomeTransaction>? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final transactions = await fetchTransactions(limit: limit);
      return resourceValueOrEmpty(
        transactions,
        isEmpty: transactions.isEmpty,
        refreshedAt: refreshedAt,
      );
    } on DioException catch (error, stackTrace) {
      return _resourceStateForError(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    } on FormatException catch (error, stackTrace) {
      return ResourceState<List<HomeTransaction>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<List<HomeBeneficiary>>> fetchBeneficiariesState({
    DateTime? refreshedAt,
    List<HomeBeneficiary>? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final beneficiaries = await fetchBeneficiaries();
      return resourceValueOrEmpty(
        beneficiaries,
        isEmpty: beneficiaries.isEmpty,
        refreshedAt: refreshedAt,
      );
    } on DioException catch (error, stackTrace) {
      return _resourceStateForError(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    } on FormatException catch (error, stackTrace) {
      return ResourceState<List<HomeBeneficiary>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<List<HomeVirtualAccount>>> fetchVirtualAccountsState({
    DateTime? refreshedAt,
    List<HomeVirtualAccount>? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final accounts = await fetchVirtualAccounts();
      return resourceValueOrEmpty(
        accounts,
        isEmpty: accounts.isEmpty,
        refreshedAt: refreshedAt,
      );
    } on DioException catch (error, stackTrace) {
      return _resourceStateForError(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    } on FormatException catch (error, stackTrace) {
      return ResourceState<List<HomeVirtualAccount>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }
}

bool _isNotFound(DioException error) => error.response?.statusCode == 404;

Map<String, dynamic> _requiredMap(dynamic value, String fieldName) {
  if (value is! Map<String, dynamic>) {
    throw FormatException(
      'Invalid response: expected "$fieldName" to be an object.',
    );
  }
  return value;
}

List<dynamic> _requiredList(dynamic source, String fieldName) {
  final value = source is Map<String, dynamic> ? source[fieldName] : source;
  if (value is! List) {
    throw FormatException(
      'Invalid response: expected "$fieldName" to be a list.',
    );
  }
  return value;
}

ResourceState<T> _resourceStateForError<T>(
  DioException error, {
  T? previousValue,
  DateTime? lastUpdated,
  StackTrace? stackTrace,
}) {
  if (ApiClient.isAuthRejection(error)) {
    return ResourceState<T>.authRequired(
      error: error,
      previousValue: previousValue,
      lastUpdated: lastUpdated,
      stackTrace: stackTrace,
    );
  }
  if (previousValue != null) {
    return ResourceState<T>.stale(
      previousValue,
      error: error,
      lastUpdated: lastUpdated,
      stackTrace: stackTrace,
    );
  }
  return ResourceState<T>.unavailable(
    error,
    previousValue: previousValue,
    lastUpdated: lastUpdated,
    stackTrace: stackTrace,
  );
}

Options _freshRequestOptions() {
  return Options(
    headers: const {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  );
}

class KycGatePolicy {
  static const Set<String> routesRequiringVerification = {
    '/send/trustpay',
    '/send/bank',
    '/withdraw',
    '/exchange',
    '/virtual-account',
    '/airtime',
    '/data',
    '/electricity',
    '/cable',
  };

  // Compatibility for existing callers; supported services now start at Tier 1.
  static const Set<String> vtuRoutesRequiringTier2 = <String>{};

  static bool isBlocked({
    required String route,
    required String status,
    required String kycTier,
  }) {
    if (routesRequiringVerification.contains(route)) {
      return !_isVerified(status) || !_isTier1OrHigher(kycTier);
    }

    if (vtuRoutesRequiringTier2.contains(route)) {
      if (AppConstants.allowVtuWithoutKyc) {
        return false;
      }
      return !_isVerified(status) || !_isTier2OrHigher(kycTier);
    }

    return false;
  }

  static bool isTier2OrHigher(String kycTier) {
    return _isTier2OrHigher(kycTier);
  }

  static bool canRevealVirtualAccount({
    required String status,
    required String kycTier,
  }) {
    return _isVerified(status) && _isTier1OrHigher(kycTier);
  }

  static bool _isVerified(String status) {
    return status.toUpperCase() == 'VERIFIED';
  }

  static bool _isTier2OrHigher(String kycTier) {
    return kycTierRank(kycTier) >= 2;
  }

  static bool _isTier1OrHigher(String kycTier) {
    return kycTierRank(kycTier) >= 1;
  }
}

class HomeDashboardData {
  final HomeUser user;
  final List<HomeWallet> wallets;
  final List<HomeTransaction> transactions;
  final List<HomeVirtualAccount> virtualAccounts;
  final List<HomeBeneficiary> beneficiaries;

  const HomeDashboardData({
    required this.user,
    required this.wallets,
    required this.transactions,
    required this.virtualAccounts,
    required this.beneficiaries,
  });

  factory HomeDashboardData.fromResponses({
    required dynamic bootstrap,
    required dynamic transactions,
    required dynamic virtualAccounts,
    dynamic beneficiaries = const [],
  }) {
    final bootstrapMap = _requiredMap(bootstrap, 'bootstrap');
    final userMap = _requiredMap(bootstrapMap['user'], 'user');
    final transactionMap = _requiredMap(transactions, 'transactions response');
    final accountsList = _requiredList(virtualAccounts, 'virtual accounts');
    final beneficiaryList = _requiredList(beneficiaries, 'beneficiaries');

    return HomeDashboardData(
      user: HomeUser.fromJson(userMap),
      wallets: _requiredList(bootstrapMap, 'wallets')
          .map((item) => HomeWallet.fromJson(_asMap(item)))
          .toList(),
      transactions: _requiredList(transactionMap, 'transactions')
          .map((item) => HomeTransaction.fromJson(_asMap(item)))
          .toList(),
      virtualAccounts: accountsList
          .map((item) => HomeVirtualAccount.fromJson(_asMap(item)))
          .toList(),
      beneficiaries: beneficiaryList
          .map((item) => HomeBeneficiary.fromJson(_asMap(item)))
          .toList(),
    );
  }

  HomeWallet? walletFor(String currency) {
    for (final wallet in wallets) {
      if (wallet.currency == currency) return wallet;
    }
    return null;
  }
}

class HomeAccountDetailsData {
  final HomeUser user;
  final List<HomeVirtualAccount> virtualAccounts;

  const HomeAccountDetailsData({
    required this.user,
    required this.virtualAccounts,
  });
}

class HomeUser {
  final String id;
  final String email;
  final String phone;
  final String fullName;
  final String role;
  final String kycStatus;
  final String kycTier;
  final int? yearOfBirth;
  final String country;
  final DateTime? profileDetailsUpdatedAt;

  const HomeUser({
    required this.id,
    required this.email,
    required this.phone,
    required this.fullName,
    required this.role,
    required this.kycStatus,
    required this.kycTier,
    required this.yearOfBirth,
    required this.country,
    required this.profileDetailsUpdatedAt,
  });

  factory HomeUser.fromJson(Map<String, dynamic> json) {
    return HomeUser(
      id: _asString(json['id']),
      email: _asString(json['email']),
      phone: _asString(json['phone']),
      fullName: _asString(json['fullName']),
      role: _asString(json['role'], fallback: 'USER'),
      kycStatus: _asString(json['kycStatus'], fallback: 'PENDING'),
      kycTier: _asString(json['kycTier'], fallback: 'TIER_0'),
      yearOfBirth: _asNullableInt(json['yearOfBirth']),
      country: _asString(json['country']),
      profileDetailsUpdatedAt: _asDate(json['profileDetailsUpdatedAt']),
    );
  }

  String get displayName {
    if (fullName.isNotEmpty) return fullName;
    final localPart = email.split('@').first.trim();
    if (localPart.isEmpty) return 'TrustPay wallet';
    return localPart;
  }

  String get initials {
    final source = displayName.isNotEmpty ? displayName : email;
    return source.substring(0, 1).toUpperCase();
  }

  bool get canEditProfileDetails => profileDetailsUpdatedAt == null;
}

class HomeWallet {
  final String id;
  final String currency;
  final double balance;

  /// Exact API value retained alongside the legacy double getter.
  final MoneyValue? balanceValue;
  final DateTime? updatedAt;

  const HomeWallet({
    required this.id,
    required this.currency,
    required this.balance,
    this.balanceValue,
    this.updatedAt,
  });

  factory HomeWallet.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency']).toUpperCase();
    final exactBalance = _asMoney(
      json['balance'],
      fieldName: 'balance',
      currency: currency,
    );
    return HomeWallet(
      id: _asString(json['id']),
      currency: currency,
      balance: exactBalance.toDouble(),
      balanceValue: exactBalance,
      updatedAt: _asDate(json['updatedAt']),
    );
  }

  MoneyValue get exactBalance =>
      balanceValue ?? _asMoney(balance, fieldName: 'balance');
  String get balanceDecimalString => exactBalance.decimalString;
}

class HomeTransaction {
  final String type;
  final String status;
  final String reference;
  final String currency;
  final double amount;
  final MoneyValue? amountValue;
  final DateTime? createdAt;

  const HomeTransaction({
    required this.type,
    required this.status,
    required this.reference,
    required this.currency,
    required this.amount,
    this.amountValue,
    this.createdAt,
  });

  factory HomeTransaction.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency'], fallback: 'NGN');
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    return HomeTransaction(
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: currency,
      amount: exactAmount.toDouble(),
      amountValue: exactAmount,
      createdAt: _asDate(json['createdAt']),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  String get amountDecimalString => exactAmount.decimalString;
}

class HomeBeneficiary {
  final String id;
  final String bankName;
  final String accountName;
  final String accountNumberMasked;
  final String bankCode;
  final String currency;
  final String provider;
  final DateTime? createdAt;

  const HomeBeneficiary({
    required this.id,
    required this.bankName,
    required this.accountName,
    required this.accountNumberMasked,
    required this.bankCode,
    required this.currency,
    required this.provider,
    this.createdAt,
  });

  factory HomeBeneficiary.fromJson(Map<String, dynamic> json) {
    return HomeBeneficiary(
      id: _asString(json['id']),
      bankName: _asString(json['bankName']),
      accountName: _asString(json['accountName']),
      accountNumberMasked: _asString(json['accountNumberMasked']),
      bankCode: _asString(json['bankCode']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      provider: _asString(json['provider']),
      createdAt: _asDate(json['createdAt']),
    );
  }
}

class HomeVirtualAccount {
  final String provider;
  final String accountNumber;
  final String accountNumberMasked;
  final String accountName;
  final String bankName;
  final String currency;
  final String status;

  const HomeVirtualAccount({
    required this.provider,
    required this.accountNumber,
    required this.accountNumberMasked,
    required this.accountName,
    required this.bankName,
    required this.currency,
    required this.status,
  });

  factory HomeVirtualAccount.fromJson(Map<String, dynamic> json) {
    return HomeVirtualAccount(
      provider: _asString(json['provider']),
      accountNumber: _asString(json['accountNumber']),
      accountNumberMasked: _asString(json['accountNumberMasked']),
      accountName: _asString(json['accountName']),
      bankName: _asString(json['bankName']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      status: _asString(json['status'], fallback: 'PENDING'),
    );
  }

  String get displayAccountNumber {
    if (accountNumber.isNotEmpty) return accountNumber;
    return accountNumberMasked;
  }
}

class HomeVirtualAccountProvisioning {
  final String provider;
  final String status;
  final String message;
  final DateTime? updatedAt;

  const HomeVirtualAccountProvisioning({
    required this.provider,
    required this.status,
    this.message = '',
    this.updatedAt,
  });

  factory HomeVirtualAccountProvisioning.fromJson(Map<String, dynamic> json) {
    return HomeVirtualAccountProvisioning(
      provider: _asString(json['provider'], fallback: 'PAYSTACK').toUpperCase(),
      status: _asString(
        json['status'],
        fallback: 'NOT_REQUESTED',
      ).toUpperCase(),
      message: _asString(json['message']),
      updatedAt: _asDate(json['updatedAt']),
    );
  }

  bool get isWaitingForKyc => status == 'WAITING_FOR_KYC';
  bool get isPending => status == 'PENDING';
  bool get isActive => status == 'ACTIVE';
  bool get isActionRequired => status == 'ACTION_REQUIRED';
}

class SupportTicket {
  final String id;
  final String type;
  final String description;
  final String status;
  final String resolution;
  final DateTime? createdAt;
  final String transactionReference;

  const SupportTicket({
    required this.id,
    required this.type,
    required this.description,
    required this.status,
    required this.resolution,
    required this.createdAt,
    required this.transactionReference,
  });

  factory SupportTicket.fromJson(Map<String, dynamic> json) {
    final transaction = _asMap(json['transaction']);

    return SupportTicket(
      id: _asString(json['id']),
      type: _asString(json['type'], fallback: 'OTHER'),
      description: _asString(json['description']),
      status: _asString(json['status'], fallback: 'OPEN'),
      resolution: _asString(json['resolution']),
      createdAt: _asDate(json['createdAt']),
      transactionReference: _asString(transaction['reference']),
    );
  }
}

class ReferralDashboard {
  final String code;
  final double rewardAmount;
  final String rewardCurrency;
  final int invites;
  final double pendingAmount;
  final double paidAmount;
  final MoneyValue? rewardAmountValue;
  final MoneyValue? pendingAmountValue;
  final MoneyValue? paidAmountValue;
  final List<ReferralReward> referrals;

  const ReferralDashboard({
    required this.code,
    required this.rewardAmount,
    required this.rewardCurrency,
    required this.invites,
    required this.pendingAmount,
    required this.paidAmount,
    this.rewardAmountValue,
    this.pendingAmountValue,
    this.paidAmountValue,
    required this.referrals,
  });

  factory ReferralDashboard.fromJson(Map<String, dynamic> json) {
    final reward = _asMap(json['reward']);
    final summary = _asMap(json['summary']);
    final rewardCurrency = _asString(reward['currency'], fallback: 'NGN');
    final exactReward = _asMoney(
      reward['amount'],
      fieldName: 'reward.amount',
      currency: rewardCurrency,
    );
    final exactPending = _asMoney(
      summary['pending'],
      fieldName: 'summary.pending',
      currency: rewardCurrency,
    );
    final exactPaid = _asMoney(
      summary['paid'],
      fieldName: 'summary.paid',
      currency: rewardCurrency,
    );
    return ReferralDashboard(
      code: _asString(json['code']),
      rewardAmount: exactReward.toDouble(),
      rewardCurrency: rewardCurrency,
      invites: _asNullableInt(summary['invites']) ?? 0,
      pendingAmount: exactPending.toDouble(),
      paidAmount: exactPaid.toDouble(),
      rewardAmountValue: exactReward,
      pendingAmountValue: exactPending,
      paidAmountValue: exactPaid,
      referrals: _asList(json['referrals'])
          .map((item) => ReferralReward.fromJson(_asMap(item)))
          .toList(),
    );
  }

  MoneyValue get exactRewardAmount =>
      rewardAmountValue ?? _asMoney(rewardAmount, fieldName: 'reward.amount');
  MoneyValue get exactPendingAmount =>
      pendingAmountValue ??
      _asMoney(pendingAmount, fieldName: 'summary.pending');
  MoneyValue get exactPaidAmount =>
      paidAmountValue ?? _asMoney(paidAmount, fieldName: 'summary.paid');
  String get rewardAmountDecimalString => exactRewardAmount.decimalString;
  String get pendingAmountDecimalString => exactPendingAmount.decimalString;
  String get paidAmountDecimalString => exactPaidAmount.decimalString;
}

class ReferralReward {
  final String id;
  final String referredName;
  final double amount;
  final MoneyValue? amountValue;
  final String currency;
  final String status;
  final DateTime? createdAt;

  const ReferralReward({
    required this.id,
    required this.referredName,
    required this.amount,
    this.amountValue,
    required this.currency,
    required this.status,
    required this.createdAt,
  });

  factory ReferralReward.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency'], fallback: 'NGN');
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    return ReferralReward(
      id: _asString(json['id']),
      referredName: _asString(json['referredName'], fallback: 'Friend'),
      amount: exactAmount.toDouble(),
      amountValue: exactAmount,
      currency: currency,
      status: _asString(json['status'], fallback: 'PENDING'),
      createdAt: _asDate(json['createdAt']),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  String get amountDecimalString => exactAmount.decimalString;
}

Map<String, dynamic> _asMap(dynamic value) {
  return value is Map<String, dynamic> ? value : <String, dynamic>{};
}

List<dynamic> _asList(dynamic value) {
  return value is List ? value : const <dynamic>[];
}

String _asString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

int? _asNullableInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '');
}

MoneyValue _asMoney(
  dynamic value, {
  required String fieldName,
  String? currency,
}) {
  try {
    return MoneyValue.fromJson(value, currency: currency);
  } on FormatException catch (error) {
    throw FormatException(
      'Invalid $fieldName: ${error.message}',
      value,
    );
  }
}

DateTime? _asDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
