import 'package:dio/dio.dart';

import 'api_client.dart';

class HomeDataService {
  HomeDataService({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<HomeDashboardData> fetchDashboard() async {
    final responses = await Future.wait<Response<dynamic>>([
      _apiClient.client.post('/api/auth/bootstrap'),
      _apiClient.client.get('/api/transactions', queryParameters: {'limit': 5}),
      _apiClient.client.get('/api/banking/accounts'),
    ]);

    return HomeDashboardData.fromResponses(
      bootstrap: responses[0].data,
      transactions: responses[1].data,
      virtualAccounts: responses[2].data,
    );
  }

  Future<List<HomeTransaction>> fetchTransactions({int limit = 20}) async {
    final response = await _apiClient.client.get(
      '/api/transactions',
      queryParameters: {'limit': limit},
    );

    final data = response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{};

    return _asList(data['transactions'])
        .map((item) => HomeTransaction.fromJson(_asMap(item)))
        .toList();
  }

  Future<List<HomeBeneficiary>> fetchBeneficiaries() async {
    final response = await _apiClient.client.get('/api/banking/beneficiaries');
    final data = response.data is List
        ? response.data as List
        : (response.data is Map<String, dynamic>
              ? _asList((response.data as Map<String, dynamic>)['beneficiaries'])
              : const []);

    return data.map((item) => HomeBeneficiary.fromJson(_asMap(item))).toList();
  }

  Future<List<HomeVirtualAccount>> fetchVirtualAccounts() async {
    final response = await _apiClient.client.get('/api/banking/accounts');
    final accounts = response.data is List ? response.data as List : const [];

    return accounts
        .map((item) => HomeVirtualAccount.fromJson(_asMap(item)))
        .toList();
  }

  Future<HomeVirtualAccount> provisionVirtualAccount({
    required String firstName,
    required String lastName,
    String? middleName,
    String idempotencyKey = '',
  }) async {
    final response = await _apiClient.client.post(
      '/api/banking/accounts/provision',
      options: idempotencyKey.isEmpty
          ? null
          : Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {
        'currency': 'NGN',
        'provider': 'monnify',
        'country': 'NG',
        'firstName': firstName,
        'lastName': lastName,
        if (middleName != null && middleName.trim().isNotEmpty)
          'middleName': middleName.trim(),
      },
    );

    return HomeVirtualAccount.fromJson(_asMap(response.data));
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
}

class KycGatePolicy {
  static const Set<String> routesRequiringVerification = {
    '/send',
    '/withdraw',
    '/exchange',
    '/virtual-account',
  };

  static const Set<String> vtuRoutesRequiringTier2 = {
    '/airtime',
    '/data',
    '/electricity',
  };

  static bool isBlocked({
    required String route,
    required String status,
    required String kycTier,
  }) {
    if (routesRequiringVerification.contains(route)) {
      return !_isVerified(status);
    }

    if (vtuRoutesRequiringTier2.contains(route)) {
      return !_isVerified(status) || !_isTier2OrHigher(kycTier);
    }

    return false;
  }

  static bool isTier2OrHigher(String kycTier) {
    return _isTier2OrHigher(kycTier);
  }

  static bool _isVerified(String status) {
    return status.toUpperCase() == 'VERIFIED';
  }

  static bool _isTier2OrHigher(String kycTier) {
    final normalized = kycTier.trim().toUpperCase();
    final tierMatch = RegExp(r'\d+').firstMatch(normalized);
    final tierNumber =
        tierMatch == null ? null : int.tryParse(tierMatch.group(0)!);

    return tierNumber != null && tierNumber >= 2;
  }
}

class HomeDashboardData {
  final HomeUser user;
  final List<HomeWallet> wallets;
  final List<HomeTransaction> transactions;
  final List<HomeVirtualAccount> virtualAccounts;

  const HomeDashboardData({
    required this.user,
    required this.wallets,
    required this.transactions,
    required this.virtualAccounts,
  });

  factory HomeDashboardData.fromResponses({
    required dynamic bootstrap,
    required dynamic transactions,
    required dynamic virtualAccounts,
  }) {
    final bootstrapMap = bootstrap is Map<String, dynamic> ? bootstrap : {};
    final transactionMap =
        transactions is Map<String, dynamic> ? transactions : {};
    final accountsList = virtualAccounts is List ? virtualAccounts : const [];

    return HomeDashboardData(
      user: HomeUser.fromJson(_asMap(bootstrapMap['user'])),
      wallets: _asList(bootstrapMap['wallets'])
          .map((item) => HomeWallet.fromJson(_asMap(item)))
          .toList(),
      transactions: _asList(transactionMap['transactions'])
          .map((item) => HomeTransaction.fromJson(_asMap(item)))
          .toList(),
      virtualAccounts: accountsList
          .map((item) => HomeVirtualAccount.fromJson(_asMap(item)))
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

class HomeUser {
  final String id;
  final String email;
  final String phone;
  final String fullName;
  final String role;
  final String kycStatus;
  final String kycTier;

  const HomeUser({
    required this.id,
    required this.email,
    required this.phone,
    required this.fullName,
    required this.role,
    required this.kycStatus,
    required this.kycTier,
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
}

class HomeWallet {
  final String id;
  final String currency;
  final double balance;
  final DateTime? updatedAt;

  const HomeWallet({
    required this.id,
    required this.currency,
    required this.balance,
    this.updatedAt,
  });

  factory HomeWallet.fromJson(Map<String, dynamic> json) {
    return HomeWallet(
      id: _asString(json['id']),
      currency: _asString(json['currency']).toUpperCase(),
      balance: _asDouble(json['balance']),
      updatedAt: _asDate(json['updatedAt']),
    );
  }
}

class HomeTransaction {
  final String type;
  final String status;
  final String reference;
  final String currency;
  final double amount;
  final DateTime? createdAt;

  const HomeTransaction({
    required this.type,
    required this.status,
    required this.reference,
    required this.currency,
    required this.amount,
    this.createdAt,
  });

  factory HomeTransaction.fromJson(Map<String, dynamic> json) {
    return HomeTransaction(
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      amount: _asDouble(json['amount']),
      createdAt: _asDate(json['createdAt']),
    );
  }
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

double _asDouble(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

DateTime? _asDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
