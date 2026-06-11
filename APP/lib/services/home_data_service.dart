import 'package:dio/dio.dart';

import '../core/constants/app_constants.dart';
import 'api_client.dart';

class HomeDataService {
  HomeDataService({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<HomeDashboardData> fetchDashboard() async {
    final bootstrapResponse =
        await _apiClient.client.post('/api/auth/bootstrap');

    final optionalResponses = await Future.wait<dynamic>([
      _fetchTransactionsForDashboard(),
      _fetchVirtualAccountsForDashboard(),
      _fetchBeneficiariesForDashboard(),
    ]);

    return HomeDashboardData.fromResponses(
      bootstrap: bootstrapResponse.data,
      transactions: optionalResponses[0],
      virtualAccounts: optionalResponses[1],
      beneficiaries: optionalResponses[2],
    );
  }

  Future<Map<String, dynamic>> _fetchTransactionsForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: {'limit': 5},
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is Map<String, dynamic>) return data;
    } on DioException {
      return const {'transactions': []};
    }

    return const {'transactions': []};
  }

  Future<List<dynamic>> _fetchVirtualAccountsForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/accounts',
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is List) return data;
    } on DioException {
      return const [];
    }

    return const [];
  }

  Future<List<dynamic>> _fetchBeneficiariesForDashboard() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/beneficiaries',
        options: _freshRequestOptions(),
      );
      final data = response.data;
      if (data is List) return data;
      if (data is Map<String, dynamic>) return _asList(data['beneficiaries']);
    } on DioException {
      return const [];
    }

    return const [];
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

    return HomeUser.fromJson(_asMap(response.data));
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

  static bool _isVerified(String status) {
    return status.toUpperCase() == 'VERIFIED';
  }

  static bool _isTier2OrHigher(String kycTier) {
    final normalized = kycTier.trim().toUpperCase();
    final tierMatch = RegExp(r'\d+').firstMatch(normalized);
    final tierText = tierMatch?.group(0);
    final tierNumber = tierText == null ? null : int.tryParse(tierText);

    return tierNumber != null && tierNumber >= 2;
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
    final bootstrapMap = bootstrap is Map<String, dynamic> ? bootstrap : {};
    final transactionMap =
        transactions is Map<String, dynamic> ? transactions : {};
    final accountsList = virtualAccounts is List ? virtualAccounts : const [];
    final beneficiaryList = beneficiaries is List ? beneficiaries : const [];

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

class ReferralDashboard {
  final String code;
  final double rewardAmount;
  final String rewardCurrency;
  final int invites;
  final double pendingAmount;
  final double paidAmount;
  final List<ReferralReward> referrals;

  const ReferralDashboard({
    required this.code,
    required this.rewardAmount,
    required this.rewardCurrency,
    required this.invites,
    required this.pendingAmount,
    required this.paidAmount,
    required this.referrals,
  });

  factory ReferralDashboard.fromJson(Map<String, dynamic> json) {
    final reward = _asMap(json['reward']);
    final summary = _asMap(json['summary']);
    return ReferralDashboard(
      code: _asString(json['code']),
      rewardAmount: _asDouble(reward['amount']),
      rewardCurrency: _asString(reward['currency'], fallback: 'NGN'),
      invites: _asNullableInt(summary['invites']) ?? 0,
      pendingAmount: _asDouble(summary['pending']),
      paidAmount: _asDouble(summary['paid']),
      referrals: _asList(json['referrals'])
          .map((item) => ReferralReward.fromJson(_asMap(item)))
          .toList(),
    );
  }
}

class ReferralReward {
  final String id;
  final String referredName;
  final double amount;
  final String currency;
  final String status;
  final DateTime? createdAt;

  const ReferralReward({
    required this.id,
    required this.referredName,
    required this.amount,
    required this.currency,
    required this.status,
    required this.createdAt,
  });

  factory ReferralReward.fromJson(Map<String, dynamic> json) {
    return ReferralReward(
      id: _asString(json['id']),
      referredName: _asString(json['referredName'], fallback: 'Friend'),
      amount: _asDouble(json['amount']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      status: _asString(json['status'], fallback: 'PENDING'),
      createdAt: _asDate(json['createdAt']),
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

int? _asNullableInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '');
}

DateTime? _asDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
