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

  const HomeUser({
    required this.id,
    required this.email,
    required this.phone,
    required this.fullName,
    required this.role,
    required this.kycStatus,
  });

  factory HomeUser.fromJson(Map<String, dynamic> json) {
    return HomeUser(
      id: _asString(json['id']),
      email: _asString(json['email']),
      phone: _asString(json['phone']),
      fullName: _asString(json['fullName']),
      role: _asString(json['role'], fallback: 'USER'),
      kycStatus: _asString(json['kycStatus'], fallback: 'PENDING'),
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

class HomeVirtualAccount {
  final String provider;
  final String accountNumberMasked;
  final String accountName;
  final String bankName;
  final String currency;
  final String status;

  const HomeVirtualAccount({
    required this.provider,
    required this.accountNumberMasked,
    required this.accountName,
    required this.bankName,
    required this.currency,
    required this.status,
  });

  factory HomeVirtualAccount.fromJson(Map<String, dynamic> json) {
    return HomeVirtualAccount(
      provider: _asString(json['provider']),
      accountNumberMasked: _asString(json['accountNumberMasked']),
      accountName: _asString(json['accountName']),
      bankName: _asString(json['bankName']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      status: _asString(json['status'], fallback: 'PENDING'),
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
