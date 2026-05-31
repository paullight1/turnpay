import 'package:dio/dio.dart';

import 'api_client.dart';

class WalletService {
  WalletService({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  /// Fetches wallets with balances for the current user.
  Future<List<WalletData>> fetchWallets() async {
    final response = await _apiClient.client.get('/api/wallets');
    final data = response.data;

    if (data is List) {
      return data.map((item) => WalletData.fromJson(_asMap(item))).toList();
    }

    if (data is Map<String, dynamic> && data['wallets'] is List) {
      return (data['wallets'] as List)
          .map((item) => WalletData.fromJson(_asMap(item)))
          .toList();
    }

    return [];
  }

  /// Fetches a single wallet detail by currency.
  Future<WalletData?> fetchWallet(String currency) async {
    try {
      final response =
          await _apiClient.client.get('/api/wallets/$currency');
      return WalletData.fromJson(_asMap(response.data));
    } on DioException {
      return null;
    }
  }

  /// Fetches transaction history, paginated.
  Future<TransactionListResponse> fetchTransactions({
    int page = 1,
    int limit = 20,
    String? status,
    String? type,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'limit': limit,
    };

    if (status != null && status.isNotEmpty) queryParams['status'] = status;
    if (type != null && type.isNotEmpty) queryParams['type'] = type;

    final response = await _apiClient.client.get(
      '/api/transactions',
      queryParameters: queryParams,
    );

    final data = _asMap(response.data);
    return TransactionListResponse.fromJson(data);
  }

  /// Fetches full detail for a single transaction by reference.
  Future<TransactionDetail?> fetchTransactionDetail(String reference) async {
    try {
      final response =
          await _apiClient.client.get('/api/transactions/$reference');
      return TransactionDetail.fromJson(_asMap(response.data));
    } on DioException {
      return null;
    }
  }

  /// Fetches virtual accounts for the current user.
  Future<List<VirtualAccountData>> fetchVirtualAccounts() async {
    try {
      final response = await _apiClient.client.get('/api/banking/accounts');
      final data = response.data;

      if (data is List) {
        return data
            .map((item) => VirtualAccountData.fromJson(_asMap(item)))
            .toList();
      }

      return [];
    } on DioException {
      return [];
    }
  }

  /// Fetches recent deposits for the receive money screen.
  Future<List<DepositRecord>> fetchRecentDeposits({int limit = 10}) async {
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: {'limit': limit, 'type': 'FUND'},
      );

      final data = _asMap(response.data);
      final items = _asList(data['transactions']);
      return items
          .map((item) => DepositRecord.fromJson(_asMap(item)))
          .toList();
    } on DioException {
      return [];
    }
  }

  /// Provisions a new virtual account.
  Future<VirtualAccountData?> provisionVirtualAccount({
    required String currency,
    required String provider,
    required String country,
    required String firstName,
    required String lastName,
    String? middleName,
    String? idempotencyKey,
  }) async {
    try {
      final options = idempotencyKey != null && idempotencyKey.isNotEmpty
          ? Options(headers: {'Idempotency-Key': idempotencyKey})
          : null;

      final requestData = <String, dynamic>{
        'currency': currency,
        'provider': provider,
        'country': country,
        'firstName': firstName,
        'lastName': lastName,
      };

      if (middleName != null && middleName.trim().isNotEmpty) {
        requestData['middleName'] = middleName.trim();
      }

      final response = await _apiClient.client.post(
        '/api/banking/accounts/provision',
        data: requestData,
        options: options,
      );

      return VirtualAccountData.fromJson(_asMap(response.data));
    } on DioException {
      return null;
    }
  }
}

// ─── Data models ──────────────────────────────────────────────────────────────

class WalletData {
  final String id;
  final String currency;
  final double balance;
  final DateTime? updatedAt;

  const WalletData({
    required this.id,
    required this.currency,
    required this.balance,
    this.updatedAt,
  });

  factory WalletData.fromJson(Map<String, dynamic> json) {
    return WalletData(
      id: _asString(json['id']),
      currency: _asString(json['currency']).toUpperCase(),
      balance: _asDouble(json['balance']),
      updatedAt: _asDate(json['updatedAt']),
    );
  }
}

class TransactionListResponse {
  final List<TransactionSummary> transactions;
  final int total;
  final int page;
  final int limit;
  final int totalPages;

  const TransactionListResponse({
    required this.transactions,
    required this.total,
    required this.page,
    required this.limit,
    required this.totalPages,
  });

  factory TransactionListResponse.fromJson(Map<String, dynamic> json) {
    return TransactionListResponse(
      transactions: _asList(json['transactions'])
          .map((item) => TransactionSummary.fromJson(_asMap(item)))
          .toList(),
      total: _asInt(json['total']),
      page: _asInt(json['page'], fallback: 1),
      limit: _asInt(json['limit'], fallback: 20),
      totalPages: _asInt(json['totalPages'], fallback: 1),
    );
  }
}

class TransactionSummary {
  final String id;
  final String type;
  final String status;
  final String reference;
  final String currency;
  final double amount;
  final double fee;
  final DateTime? createdAt;

  const TransactionSummary({
    required this.id,
    required this.type,
    required this.status,
    required this.reference,
    required this.currency,
    required this.amount,
    required this.fee,
    this.createdAt,
  });

  factory TransactionSummary.fromJson(Map<String, dynamic> json) {
    return TransactionSummary(
      id: _asString(json['id']),
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      amount: _asDouble(json['amount']),
      fee: _asDouble(json['fee']),
      createdAt: _asDate(json['createdAt']),
    );
  }
}

class TransactionDetail {
  final String id;
  final String type;
  final String status;
  final String reference;
  final String currency;
  final double amount;
  final double fee;
  final Map<String, dynamic>? metadata;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<LedgerEntryData> ledgerEntries;
  final List<TransferAttemptData> transferAttempts;
  final ExchangeReceiptData? exchangeReceipt;
  final ExchangePayoutData? exchangePayout;
  final VtuOrderData? vtuOrder;
  final List<DisputeData> disputes;

  const TransactionDetail({
    required this.id,
    required this.type,
    required this.status,
    required this.reference,
    required this.currency,
    required this.amount,
    required this.fee,
    this.metadata,
    this.createdAt,
    this.updatedAt,
    this.ledgerEntries = const [],
    this.transferAttempts = const [],
    this.exchangeReceipt,
    this.exchangePayout,
    this.vtuOrder,
    this.disputes = const [],
  });

  factory TransactionDetail.fromJson(Map<String, dynamic> json) {
    return TransactionDetail(
      id: _asString(json['id']),
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      amount: _asDouble(json['amount']),
      fee: _asDouble(json['fee']),
      metadata: json['metadata'] is Map<String, dynamic>
          ? json['metadata'] as Map<String, dynamic>
          : null,
      createdAt: _asDate(json['createdAt']),
      updatedAt: _asDate(json['updatedAt']),
      ledgerEntries: _asList(json['ledgerEntries'])
          .map((item) => LedgerEntryData.fromJson(_asMap(item)))
          .toList(),
      transferAttempts: _asList(json['transferAttempts'])
          .map((item) => TransferAttemptData.fromJson(_asMap(item)))
          .toList(),
      exchangeReceipt: json['exchangeReceipt'] != null
          ? ExchangeReceiptData.fromJson(
              _asMap(json['exchangeReceipt']))
          : null,
      exchangePayout: json['exchangePayout'] != null
          ? ExchangePayoutData.fromJson(
              _asMap(json['exchangePayout']))
          : null,
      vtuOrder: json['vtuOrders'] != null &&
              (_asList(json['vtuOrders'])).isNotEmpty
          ? VtuOrderData.fromJson(
              _asMap(_asList(json['vtuOrders']).first))
          : null,
      disputes: _asList(json['disputes'])
          .map((item) => DisputeData.fromJson(_asMap(item)))
          .toList(),
    );
  }
}

class LedgerEntryData {
  final String id;
  final String direction;
  final double amount;
  final String currency;
  final double balanceBefore;
  final double balanceAfter;
  final String source;
  final DateTime? createdAt;

  const LedgerEntryData({
    required this.id,
    required this.direction,
    required this.amount,
    required this.currency,
    required this.balanceBefore,
    required this.balanceAfter,
    required this.source,
    this.createdAt,
  });

  factory LedgerEntryData.fromJson(Map<String, dynamic> json) {
    return LedgerEntryData(
      id: _asString(json['id']),
      direction: _asString(json['direction']),
      amount: _asDouble(json['amount']),
      currency: _asString(json['currency']),
      balanceBefore: _asDouble(json['balanceBefore']),
      balanceAfter: _asDouble(json['balanceAfter']),
      source: _asString(json['source']),
      createdAt: _asDate(json['createdAt']),
    );
  }
}

class TransferAttemptData {
  final String id;
  final String provider;
  final String providerReference;
  final String providerStatus;
  final String status;
  final int attemptNo;
  final DateTime? createdAt;

  const TransferAttemptData({
    required this.id,
    required this.provider,
    required this.providerReference,
    required this.providerStatus,
    required this.status,
    required this.attemptNo,
    this.createdAt,
  });

  factory TransferAttemptData.fromJson(Map<String, dynamic> json) {
    return TransferAttemptData(
      id: _asString(json['id']),
      provider: _asString(json['provider']),
      providerReference: _asString(json['providerReference']),
      providerStatus: _asString(json['providerStatus']),
      status: _asString(json['status']),
      attemptNo: _asInt(json['attemptNo'], fallback: 1),
      createdAt: _asDate(json['createdAt']),
    );
  }
}

class ExchangeReceiptData {
  final String id;
  final String status;
  final String sourceCurrency;
  final String targetCurrency;
  final double amount;
  final double expectedCreditAmount;
  final double rate;
  final String senderName;
  final String? senderBankName;
  final String? bankReference;
  final String? reviewReason;
  final DateTime? creditedAt;

  const ExchangeReceiptData({
    required this.id,
    required this.status,
    required this.sourceCurrency,
    required this.targetCurrency,
    required this.amount,
    required this.expectedCreditAmount,
    required this.rate,
    required this.senderName,
    this.senderBankName,
    this.bankReference,
    this.reviewReason,
    this.creditedAt,
  });

  factory ExchangeReceiptData.fromJson(Map<String, dynamic> json) {
    return ExchangeReceiptData(
      id: _asString(json['id']),
      status: _asString(json['status']),
      sourceCurrency: _asString(json['sourceCurrency']),
      targetCurrency: _asString(json['targetCurrency']),
      amount: _asDouble(json['amount']),
      expectedCreditAmount: _asDouble(json['expectedCreditAmount']),
      rate: _asDouble(json['rate']),
      senderName: _asString(json['senderName']),
      senderBankName: json['senderBankName'] is String
          ? json['senderBankName'] as String
          : null,
      bankReference: json['bankReference'] is String
          ? json['bankReference'] as String
          : null,
      reviewReason: json['reviewReason'] is String
          ? json['reviewReason'] as String
          : null,
      creditedAt: _asDate(json['creditedAt']),
    );
  }
}

class ExchangePayoutData {
  final String id;
  final String status;
  final String sourceCurrency;
  final String destinationCurrency;
  final double sourceAmount;
  final double destinationAmount;
  final double rate;
  final double fee;
  final String destinationBankName;
  final String destinationAccountNumber;
  final String destinationAccountName;

  const ExchangePayoutData({
    required this.id,
    required this.status,
    required this.sourceCurrency,
    required this.destinationCurrency,
    required this.sourceAmount,
    required this.destinationAmount,
    required this.rate,
    required this.fee,
    required this.destinationBankName,
    required this.destinationAccountNumber,
    required this.destinationAccountName,
  });

  factory ExchangePayoutData.fromJson(Map<String, dynamic> json) {
    return ExchangePayoutData(
      id: _asString(json['id']),
      status: _asString(json['status']),
      sourceCurrency: _asString(json['sourceCurrency']),
      destinationCurrency: _asString(json['destinationCurrency']),
      sourceAmount: _asDouble(json['sourceAmount']),
      destinationAmount: _asDouble(json['destinationAmount']),
      rate: _asDouble(json['rate']),
      fee: _asDouble(json['fee']),
      destinationBankName: _asString(json['destinationBankName']),
      destinationAccountNumber:
          _asString(json['destinationAccountNumber']),
      destinationAccountName:
          _asString(json['destinationAccountName']),
    );
  }
}

class VtuOrderData {
  final String id;
  final String provider;
  final String serviceType;
  final String status;
  final double amount;
  final String? targetMasked;
  final String? providerRequestId;
  final String? providerTransactionId;
  final int requeryAttempts;

  const VtuOrderData({
    required this.id,
    required this.provider,
    required this.serviceType,
    required this.status,
    required this.amount,
    this.targetMasked,
    this.providerRequestId,
    this.providerTransactionId,
    this.requeryAttempts = 0,
  });

  factory VtuOrderData.fromJson(Map<String, dynamic> json) {
    return VtuOrderData(
      id: _asString(json['id']),
      provider: _asString(json['provider']),
      serviceType: _asString(json['serviceType']),
      status: _asString(json['status']),
      amount: _asDouble(json['amount']),
      targetMasked: json['targetMasked'] is String
          ? json['targetMasked'] as String
          : null,
      providerRequestId: json['providerRequestId'] is String
          ? json['providerRequestId'] as String
          : null,
      providerTransactionId: json['providerTransactionId'] is String
          ? json['providerTransactionId'] as String
          : null,
      requeryAttempts: _asInt(json['requeryAttempts']),
    );
  }
}

class DisputeData {
  final String id;
  final String type;
  final String status;
  final String description;
  final String? resolution;
  final DateTime? createdAt;

  const DisputeData({
    required this.id,
    required this.type,
    required this.status,
    required this.description,
    this.resolution,
    this.createdAt,
  });

  factory DisputeData.fromJson(Map<String, dynamic> json) {
    return DisputeData(
      id: _asString(json['id']),
      type: _asString(json['type']),
      status: _asString(json['status']),
      description: _asString(json['description']),
      resolution: json['resolution'] is String
          ? json['resolution'] as String
          : null,
      createdAt: _asDate(json['createdAt']),
    );
  }
}

class VirtualAccountData {
  final String provider;
  final String accountNumber;
  final String accountNumberMasked;
  final String accountName;
  final String bankName;
  final String currency;
  final String status;

  const VirtualAccountData({
    required this.provider,
    required this.accountNumber,
    required this.accountNumberMasked,
    required this.accountName,
    required this.bankName,
    required this.currency,
    required this.status,
  });

  factory VirtualAccountData.fromJson(Map<String, dynamic> json) {
    return VirtualAccountData(
      provider: _asString(json['provider']),
      accountNumber: _asString(json['accountNumber']),
      accountNumberMasked: _asString(json['accountNumberMasked']),
      accountName: _asString(json['accountName']),
      bankName: _asString(json['bankName']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      status: _asString(json['status'], fallback: 'PENDING'),
    );
  }
}

class DepositRecord {
  final String reference;
  final String status;
  final double amount;
  final String currency;
  final DateTime? createdAt;

  const DepositRecord({
    required this.reference,
    required this.status,
    required this.amount,
    required this.currency,
    required this.createdAt,
  });

  factory DepositRecord.fromJson(Map<String, dynamic> json) {
    return DepositRecord(
      reference: _asString(json['reference']),
      status: _asString(json['status'], fallback: 'PENDING'),
      amount: _asDouble(json['amount']),
      currency: _asString(json['currency'], fallback: 'NGN'),
      createdAt: _asDate(json['createdAt']),
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

int _asInt(dynamic value, {int fallback = 0}) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

DateTime? _asDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
