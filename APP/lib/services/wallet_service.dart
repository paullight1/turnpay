import 'package:dio/dio.dart';

import '../core/money/money_value.dart';
import '../core/state/resource_state.dart';
import 'api_client.dart';

class WalletService {
  WalletService({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  /// Fetches wallets with balances for the current user.
  Future<List<WalletData>> fetchWallets() async {
    late final dynamic data;
    try {
      final response = await _apiClient.client.get('/api/wallets');
      data = response.data;
    } on DioException catch (error) {
      // A missing wallet collection means there are no provisioned wallets.
      // Keep all other failures visible to the caller.
      if (_isNotFound(error)) return const [];
      rethrow;
    }

    if (data is List) {
      return data.map((item) => WalletData.fromJson(_asMap(item))).toList();
    }

    if (data is Map<String, dynamic> && data['wallets'] is List) {
      return (data['wallets'] as List)
          .map((item) => WalletData.fromJson(_asMap(item)))
          .toList();
    }

    throw const FormatException(
      'Invalid wallets response: expected a list or a wallets list.',
    );
  }

  /// Fetches a single wallet detail by currency.
  Future<WalletData?> fetchWallet(String currency) async {
    try {
      final response = await _apiClient.client.get('/api/wallets/$currency');
      return WalletData.fromJson(_asMap(response.data));
    } on DioException catch (error) {
      // A missing currency wallet is a valid empty result.  Auth, network,
      // and server failures must remain visible to the caller.
      if (_isNotFound(error)) return null;
      rethrow;
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

    late final dynamic responseData;
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: queryParams,
      );
      responseData = response.data;
    } on DioException catch (error) {
      // A collection 404 is treated as no history yet; server and network
      // failures still reach the caller as unavailable.
      if (_isNotFound(error)) {
        return TransactionListResponse(
          transactions: const [],
          total: 0,
          page: page,
          limit: limit,
          totalPages: 0,
        );
      }
      rethrow;
    }

    final data = _asMap(responseData);
    return TransactionListResponse.fromJson(data);
  }

  /// Fetches full detail for a single transaction by reference.
  Future<TransactionDetail?> fetchTransactionDetail(String reference) async {
    try {
      final response =
          await _apiClient.client.get('/api/transactions/$reference');
      return TransactionDetail.fromJson(_asMap(response.data));
    } on DioException catch (error) {
      // A transaction reference can legitimately be absent.  Do not turn an
      // outage or auth rejection into a missing transaction.
      if (_isNotFound(error)) return null;
      rethrow;
    }
  }

  /// Fetches virtual accounts for the current user.
  Future<List<VirtualAccountData>> fetchVirtualAccounts() async {
    try {
      final response = await _apiClient.client.get(
        '/api/banking/accounts',
        options: _freshRequestOptions(),
      );
      final data = response.data;

      if (data is List) {
        return data
            .map((item) => VirtualAccountData.fromJson(_asMap(item)))
            .toList();
      }

      throw const FormatException(
        'Invalid virtual accounts response: expected a list.',
      );
    } on DioException catch (error) {
      // A 404 means this account collection is not provisioned yet.  Other
      // failures are unavailable and must be rendered as such by consumers.
      if (_isNotFound(error)) return const [];
      rethrow;
    }
  }

  /// Fetches recent deposits for the receive money screen.
  Future<List<DepositRecord>> fetchRecentDeposits({int limit = 10}) async {
    try {
      final response = await _apiClient.client.get(
        '/api/transactions',
        queryParameters: {'limit': limit, 'type': 'FUND'},
        options: _freshRequestOptions(),
      );

      final data = _asMap(response.data);
      final items = _requiredList(data, 'transactions');
      return items.map((item) => DepositRecord.fromJson(_asMap(item))).toList();
    } on DioException catch (error) {
      // A missing history endpoint is treated as an empty collection.  A
      // 5xx, timeout, or auth error remains observable.
      if (_isNotFound(error)) return const [];
      rethrow;
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
  }

  /// Loads wallets into an explicit state for callers that need to retain a
  /// last successful value during a refresh.
  Future<ResourceState<List<WalletData>>> fetchWalletsState({
    DateTime? refreshedAt,
    List<WalletData>? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final wallets = await fetchWallets();
      return resourceValueOrEmpty(
        wallets,
        isEmpty: wallets.isEmpty,
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
      return ResourceState<List<WalletData>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<TransactionListResponse>> fetchTransactionsState({
    int page = 1,
    int limit = 20,
    String? status,
    String? type,
    DateTime? refreshedAt,
    TransactionListResponse? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final response = await fetchTransactions(
        page: page,
        limit: limit,
        status: status,
        type: type,
      );
      return response.transactions.isEmpty
          ? ResourceState<TransactionListResponse>.empty(
              refreshedAt: refreshedAt,
            )
          : ResourceState<TransactionListResponse>.value(
              response,
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
      return ResourceState<TransactionListResponse>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<List<VirtualAccountData>>> fetchVirtualAccountsState({
    DateTime? refreshedAt,
    List<VirtualAccountData>? previousValue,
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
      return ResourceState<List<VirtualAccountData>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }

  Future<ResourceState<List<DepositRecord>>> fetchRecentDepositsState({
    int limit = 10,
    DateTime? refreshedAt,
    List<DepositRecord>? previousValue,
    DateTime? lastUpdated,
  }) async {
    try {
      final deposits = await fetchRecentDeposits(limit: limit);
      return resourceValueOrEmpty(
        deposits,
        isEmpty: deposits.isEmpty,
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
      return ResourceState<List<DepositRecord>>.error(
        error,
        previousValue: previousValue,
        lastUpdated: lastUpdated,
        stackTrace: stackTrace,
      );
    }
  }
}

bool _isNotFound(DioException error) => error.response?.statusCode == 404;

List<dynamic> _requiredList(Map<String, dynamic> json, String fieldName) {
  final value = json[fieldName];
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

// ─── Data models ──────────────────────────────────────────────────────────────

class WalletData {
  final String id;
  final String currency;
  final double balance;

  /// Exact API value retained alongside the legacy double getter.
  final MoneyValue? balanceValue;
  final DateTime? updatedAt;

  const WalletData({
    required this.id,
    required this.currency,
    required this.balance,
    this.balanceValue,
    this.updatedAt,
  });

  factory WalletData.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency']).toUpperCase();
    final exactBalance = _asMoney(
      json['balance'],
      fieldName: 'balance',
      currency: currency,
    );
    return WalletData(
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
      transactions: _requiredList(json, 'transactions')
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
  final MoneyValue? amountValue;
  final MoneyValue? feeValue;
  final DateTime? createdAt;

  const TransactionSummary({
    required this.id,
    required this.type,
    required this.status,
    required this.reference,
    required this.currency,
    required this.amount,
    required this.fee,
    this.amountValue,
    this.feeValue,
    this.createdAt,
  });

  factory TransactionSummary.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency'], fallback: 'NGN');
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    final exactFee = _asMoney(
      json['fee'],
      fieldName: 'fee',
      currency: currency,
    );
    return TransactionSummary(
      id: _asString(json['id']),
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: currency,
      amount: exactAmount.toDouble(),
      fee: exactFee.toDouble(),
      amountValue: exactAmount,
      feeValue: exactFee,
      createdAt: _asDate(json['createdAt']),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  MoneyValue get exactFee => feeValue ?? _asMoney(fee, fieldName: 'fee');
  String get amountDecimalString => exactAmount.decimalString;
  String get feeDecimalString => exactFee.decimalString;
}

class TransactionDetail {
  final String id;
  final String type;
  final String status;
  final String reference;
  final String currency;
  final double amount;
  final double fee;
  final MoneyValue? amountValue;
  final MoneyValue? feeValue;
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
    this.amountValue,
    this.feeValue,
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
    final currency = _asString(json['currency'], fallback: 'NGN');
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    final exactFee = _asMoney(
      json['fee'],
      fieldName: 'fee',
      currency: currency,
    );
    return TransactionDetail(
      id: _asString(json['id']),
      type: _asString(json['type'], fallback: 'TRANSACTION'),
      status: _asString(json['status'], fallback: 'PENDING'),
      reference: _asString(json['reference']),
      currency: currency,
      amount: exactAmount.toDouble(),
      fee: exactFee.toDouble(),
      amountValue: exactAmount,
      feeValue: exactFee,
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
          ? ExchangeReceiptData.fromJson(_asMap(json['exchangeReceipt']))
          : null,
      exchangePayout: json['exchangePayout'] != null
          ? ExchangePayoutData.fromJson(_asMap(json['exchangePayout']))
          : null,
      vtuOrder:
          json['vtuOrders'] != null && (_asList(json['vtuOrders'])).isNotEmpty
              ? VtuOrderData.fromJson(_asMap(_asList(json['vtuOrders']).first))
              : null,
      disputes: _asList(json['disputes'])
          .map((item) => DisputeData.fromJson(_asMap(item)))
          .toList(),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  MoneyValue get exactFee => feeValue ?? _asMoney(fee, fieldName: 'fee');
  String get amountDecimalString => exactAmount.decimalString;
  String get feeDecimalString => exactFee.decimalString;
}

class LedgerEntryData {
  final String id;
  final String direction;
  final double amount;
  final String currency;
  final double balanceBefore;
  final double balanceAfter;
  final MoneyValue? amountValue;
  final MoneyValue? balanceBeforeValue;
  final MoneyValue? balanceAfterValue;
  final String source;
  final DateTime? createdAt;

  const LedgerEntryData({
    required this.id,
    required this.direction,
    required this.amount,
    required this.currency,
    required this.balanceBefore,
    required this.balanceAfter,
    this.amountValue,
    this.balanceBeforeValue,
    this.balanceAfterValue,
    required this.source,
    this.createdAt,
  });

  factory LedgerEntryData.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency']);
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    final exactBefore = _asMoney(
      json['balanceBefore'],
      fieldName: 'balanceBefore',
      currency: currency,
    );
    final exactAfter = _asMoney(
      json['balanceAfter'],
      fieldName: 'balanceAfter',
      currency: currency,
    );
    return LedgerEntryData(
      id: _asString(json['id']),
      direction: _asString(json['direction']),
      amount: exactAmount.toDouble(),
      currency: currency,
      balanceBefore: exactBefore.toDouble(),
      balanceAfter: exactAfter.toDouble(),
      amountValue: exactAmount,
      balanceBeforeValue: exactBefore,
      balanceAfterValue: exactAfter,
      source: _asString(json['source']),
      createdAt: _asDate(json['createdAt']),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  MoneyValue get exactBalanceBefore =>
      balanceBeforeValue ?? _asMoney(balanceBefore, fieldName: 'balanceBefore');
  MoneyValue get exactBalanceAfter =>
      balanceAfterValue ?? _asMoney(balanceAfter, fieldName: 'balanceAfter');
  String get amountDecimalString => exactAmount.decimalString;
  String get balanceBeforeDecimalString => exactBalanceBefore.decimalString;
  String get balanceAfterDecimalString => exactBalanceAfter.decimalString;
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
  final MoneyValue? amountValue;
  final MoneyValue? expectedCreditAmountValue;
  final String? rateDecimalString;
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
    this.amountValue,
    this.expectedCreditAmountValue,
    this.rateDecimalString,
    required this.senderName,
    this.senderBankName,
    this.bankReference,
    this.reviewReason,
    this.creditedAt,
  });

  factory ExchangeReceiptData.fromJson(Map<String, dynamic> json) {
    final sourceCurrency = _asString(json['sourceCurrency']);
    final targetCurrency = _asString(json['targetCurrency']);
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: sourceCurrency,
    );
    final exactExpected = _asMoney(
      json['expectedCreditAmount'],
      fieldName: 'expectedCreditAmount',
      currency: targetCurrency,
    );
    final exactRate = _asDecimal(json['rate'], fieldName: 'rate');
    return ExchangeReceiptData(
      id: _asString(json['id']),
      status: _asString(json['status']),
      sourceCurrency: sourceCurrency,
      targetCurrency: targetCurrency,
      amount: exactAmount.toDouble(),
      expectedCreditAmount: exactExpected.toDouble(),
      rate: double.parse(exactRate),
      amountValue: exactAmount,
      expectedCreditAmountValue: exactExpected,
      rateDecimalString: exactRate,
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

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  MoneyValue get exactExpectedCreditAmount =>
      expectedCreditAmountValue ??
      _asMoney(expectedCreditAmount, fieldName: 'expectedCreditAmount');
  String get amountDecimalString => exactAmount.decimalString;
  String get expectedCreditAmountDecimalString =>
      exactExpectedCreditAmount.decimalString;
  String get exactRateDecimalString =>
      rateDecimalString ?? _asDecimal(rate, fieldName: 'rate');
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
  final MoneyValue? sourceAmountValue;
  final MoneyValue? destinationAmountValue;
  final MoneyValue? feeValue;
  final String? rateDecimalString;
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
    this.sourceAmountValue,
    this.destinationAmountValue,
    this.feeValue,
    this.rateDecimalString,
    required this.destinationBankName,
    required this.destinationAccountNumber,
    required this.destinationAccountName,
  });

  factory ExchangePayoutData.fromJson(Map<String, dynamic> json) {
    final sourceCurrency = _asString(json['sourceCurrency']);
    final destinationCurrency = _asString(json['destinationCurrency']);
    final exactSource = _asMoney(json['sourceAmount'],
        fieldName: 'sourceAmount', currency: sourceCurrency);
    final exactDestination = _asMoney(
      json['destinationAmount'],
      fieldName: 'destinationAmount',
      currency: destinationCurrency,
    );
    final exactFee = _asMoney(
      json['fee'],
      fieldName: 'fee',
      currency: sourceCurrency,
    );
    final exactRate = _asDecimal(json['rate'], fieldName: 'rate');
    return ExchangePayoutData(
      id: _asString(json['id']),
      status: _asString(json['status']),
      sourceCurrency: sourceCurrency,
      destinationCurrency: destinationCurrency,
      sourceAmount: exactSource.toDouble(),
      destinationAmount: exactDestination.toDouble(),
      rate: double.parse(exactRate),
      fee: exactFee.toDouble(),
      sourceAmountValue: exactSource,
      destinationAmountValue: exactDestination,
      feeValue: exactFee,
      rateDecimalString: exactRate,
      destinationBankName: _asString(json['destinationBankName']),
      destinationAccountNumber: _asString(json['destinationAccountNumber']),
      destinationAccountName: _asString(json['destinationAccountName']),
    );
  }

  MoneyValue get exactSourceAmount =>
      sourceAmountValue ?? _asMoney(sourceAmount, fieldName: 'sourceAmount');
  MoneyValue get exactDestinationAmount =>
      destinationAmountValue ??
      _asMoney(destinationAmount, fieldName: 'destinationAmount');
  MoneyValue get exactFee => feeValue ?? _asMoney(fee, fieldName: 'fee');
  String get sourceAmountDecimalString => exactSourceAmount.decimalString;
  String get destinationAmountDecimalString =>
      exactDestinationAmount.decimalString;
  String get feeDecimalString => exactFee.decimalString;
  String get exactRateDecimalString =>
      rateDecimalString ?? _asDecimal(rate, fieldName: 'rate');
}

class VtuOrderData {
  final String id;
  final String provider;
  final String serviceType;
  final String status;
  final double amount;
  final MoneyValue? amountValue;
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
    this.amountValue,
    this.targetMasked,
    this.providerRequestId,
    this.providerTransactionId,
    this.requeryAttempts = 0,
  });

  factory VtuOrderData.fromJson(Map<String, dynamic> json) {
    final exactAmount = _asMoney(json['amount'], fieldName: 'amount');
    return VtuOrderData(
      id: _asString(json['id']),
      provider: _asString(json['provider']),
      serviceType: _asString(json['serviceType']),
      status: _asString(json['status']),
      amount: exactAmount.toDouble(),
      amountValue: exactAmount,
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

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  String get amountDecimalString => exactAmount.decimalString;
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
      resolution:
          json['resolution'] is String ? json['resolution'] as String : null,
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
  final MoneyValue? amountValue;
  final String currency;
  final DateTime? createdAt;

  const DepositRecord({
    required this.reference,
    required this.status,
    required this.amount,
    this.amountValue,
    required this.currency,
    required this.createdAt,
  });

  factory DepositRecord.fromJson(Map<String, dynamic> json) {
    final currency = _asString(json['currency'], fallback: 'NGN');
    final exactAmount = _asMoney(
      json['amount'],
      fieldName: 'amount',
      currency: currency,
    );
    return DepositRecord(
      reference: _asString(json['reference']),
      status: _asString(json['status'], fallback: 'PENDING'),
      amount: exactAmount.toDouble(),
      amountValue: exactAmount,
      currency: currency,
      createdAt: _asDate(json['createdAt']),
    );
  }

  MoneyValue get exactAmount =>
      amountValue ?? _asMoney(amount, fieldName: 'amount');
  String get amountDecimalString => exactAmount.decimalString;
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

int _asInt(dynamic value, {int fallback = 0}) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
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

String _asDecimal(dynamic value, {required String fieldName}) {
  final text = switch (value) {
    String() => value,
    int() => value.toString(),
    double() when value.isFinite => value.toString(),
    num() => value.toString(),
    _ => throw FormatException(
        'Invalid $fieldName: expected a finite decimal value.',
        value,
      ),
  };

  if (!RegExp(r'^[+-]?(?:0+|[1-9][0-9]*)(?:\.[0-9]+)?$').hasMatch(text)) {
    throw FormatException(
      'Invalid $fieldName: expected a decimal value.',
      value,
    );
  }
  return text;
}

DateTime? _asDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
