import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import '../core/money/money_value.dart';
import '../features/exchange/services/manual_exchange_service.dart';
import 'api_client.dart';

/// Receiving products do not activate exchange; existing obligations always remain reachable.
bool usesProviderExchange(Map<String, dynamic> config) =>
    config['enabled'] == true ||
    config['hasOrders'] == true ||
    config['hasPending'] == true;

Map<String, dynamic> koraMap(dynamic value) {
  if (value is! Map) {
    throw const FormatException(
        'Payment details could not be read. Refresh the status.');
  }
  return Map<String, dynamic>.from(value);
}

String _text(Map<String, dynamic> data, String key) {
  final value = data[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('Missing payment $key.');
  }
  return value;
}

String ghanaPhone(String value) {
  var number =
      value.replaceAll(RegExp(r'[\s-]'), '').replaceFirst(RegExp(r'^\+'), '');
  if (RegExp(r'^0\d{9}$').hasMatch(number)) {
    number = '233${number.substring(1)}';
  }
  if (!RegExp(r'^233\d{9}$').hasMatch(number)) {
    throw const FormatException(
        'Enter a Ghana MoMo number, for example 0241234567.');
  }
  return number;
}

String koraMoney(String value, String currency) {
  final text = MoneyValue.parse(value).decimalString;
  final parts = text.split('.');
  final grouped =
      parts.first.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return '${currency == 'GHS' ? '₵' : '₦'}$grouped.${parts.last}';
}

class KoraQuoteExpired extends FormatException {
  const KoraQuoteExpired()
      : super('This quote expired. Review a fresh quote before paying.');
}

class KoraQuote {
  final String id,
      sourceCurrency,
      targetCurrency,
      fundingSource,
      amount,
      fee,
      total,
      rate,
      targetAmount,
      destinationName,
      destinationMasked,
      destinationCode;
  final DateTime expiresAt;
  KoraQuote._(
      this.id,
      this.sourceCurrency,
      this.targetCurrency,
      this.fundingSource,
      this.amount,
      this.fee,
      this.total,
      this.rate,
      this.targetAmount,
      this.destinationName,
      this.destinationMasked,
      this.destinationCode,
      this.expiresAt);
  factory KoraQuote.fromJson(Map<String, dynamic> data) {
    final source = _text(data, 'sourceCurrency'),
        target = _text(data, 'targetCurrency');
    if (!['NGN', 'GHS'].contains(source) ||
        !['NGN', 'GHS'].contains(target) ||
        source == target) {
      throw const FormatException('Invalid exchange currencies.');
    }
    final amount = MoneyValue.parse(_text(data, 'amount')),
        fee = MoneyValue.parse(_text(data, 'fee')),
        total = MoneyValue.parse(_text(data, 'total')),
        receive = MoneyValue.parse(_text(data, 'targetAmount'));
    if (amount.minorUnits <= BigInt.zero ||
        fee.minorUnits < BigInt.zero ||
        receive.minorUnits <= BigInt.zero ||
        amount.minorUnits + fee.minorUnits != total.minorUnits) {
      throw const FormatException('The exchange totals could not be verified.');
    }
    final rate = _text(data, 'rate');
    if (!RegExp(r'^\d+(\.\d{1,6})?$').hasMatch(rate) ||
        BigInt.parse(rate.replaceAll('.', '')) <= BigInt.zero) {
      throw const FormatException('Invalid exchange rate.');
    }
    final funding = _text(data, 'fundingSource');
    if (!['WALLET', 'EXTERNAL'].contains(funding)) {
      throw const FormatException('Invalid funding method.');
    }
    return KoraQuote._(
        _text(data, 'id'),
        source,
        target,
        funding,
        amount.decimalString,
        fee.decimalString,
        total.decimalString,
        rate,
        receive.decimalString,
        _text(data, 'destinationName'),
        _text(data, 'destinationMasked'),
        _text(data, 'destinationCode'),
        DateTime.parse(_text(data, 'expiresAt')));
  }
}

class KoraOrder {
  final String id, reference, status;
  final String? payoutReference;
  final Map<String, dynamic>? payment;
  final KoraQuote quote;
  KoraOrder._(this.id, this.reference, this.status, this.quote,
      this.payoutReference, this.payment);
  factory KoraOrder.fromJson(Map<String, dynamic> data) {
    final status = _text(data, 'status');
    if (![
      'AWAITING_PAYMENT',
      'READY',
      'PROCESSING',
      'SENT',
      'FAILED',
      'REFUNDED',
      'NEEDS_REVIEW'
    ].contains(status)) {
      throw const FormatException(
          'Unrecognized payment status. Refresh this exchange.');
    }
    return KoraOrder._(
        _text(data, 'id'),
        _text(data, 'reference'),
        status,
        KoraQuote.fromJson(koraMap(data['quote'])),
        data['payoutReference'] as String?,
        data['payment'] is Map ? koraMap(data['payment']) : null);
  }
  bool get active =>
      ['AWAITING_PAYMENT', 'READY', 'PROCESSING'].contains(status);
  String get label => switch (status) {
        'AWAITING_PAYMENT' => 'Waiting for your payment',
        'READY' => 'Money confirmed',
        'PROCESSING' => 'Sending',
        'SENT' => 'Sent',
        'REFUNDED' => 'Money returned to your wallet',
        'NEEDS_REVIEW' => 'Our team is checking this payment',
        _ => 'Payment needs attention'
      };
}

class KoraService {
  final ApiClient _api;
  final ManualExchangeAttemptStore _attempts;
  KoraService({ApiClient? apiClient, ManualExchangeAttemptStore? attemptStore})
      : _api = apiClient ?? ApiClient(),
        _attempts = attemptStore ?? ManualExchangeAttemptStore();
  Future<Map<String, dynamic>> config() async =>
      koraMap((await _api.client.get('/api/exchange/provider/config')).data);
  Future<Map<String, dynamic>> capabilities() async =>
      koraMap((await _api.client.get('/api/ghana/capabilities')).data);
  Future<List<Map<String, dynamic>>> banks() async =>
      ((await _api.client.get('/api/payments/banks')).data as List)
          .map(koraMap)
          .toList();
  Future<List<Map<String, dynamic>>> operators() async =>
      ((await _api.client.get('/api/ghana/operators')).data as List)
          .map(koraMap)
          .toList();
  Future<Map<String, String>> balances() async {
    final data = (await _api.client.get('/api/wallets')).data;
    if (data is! List) {
      throw const FormatException('Wallet balances could not load.');
    }
    return {
      for (final item in data)
        '${koraMap(item)['currency']}':
            MoneyValue.fromJson(koraMap(item)['balance']).decimalString
    };
  }

  Future<KoraQuote> quote(
      {required String source,
      required String funding,
      required String amount,
      required String code,
      required String number}) async {
    final value = MoneyValue.parse(amount);
    if (value.minorUnits <= BigInt.zero ||
        value.minorUnits > BigInt.from(1000000000)) {
      throw const FormatException(
          'Enter an amount between 0.01 and 10,000,000.');
    }
    final response =
        await _api.client.post('/api/exchange/provider/quotes', data: {
      'sourceCurrency': source,
      'fundingSource': funding,
      'amount': value.decimalString,
      'destinationCode': code,
      'destinationNumber': source == 'NGN' ? ghanaPhone(number) : number
    });
    return KoraQuote.fromJson(koraMap(response.data));
  }

  Future<KoraQuote> getQuote(String id) async => KoraQuote.fromJson(koraMap(
      (await _api.client.get('/api/exchange/provider/quotes/$id')).data));
  Future<Map<String, dynamic>?> pendingAttempt() async {
    final rows = await _attempts.readAttempts();
    for (final row in rows) {
      if (row.action == 'provider-create') {
        return koraMap(jsonDecode(row.fingerprint));
      }
    }
    return null;
  }

  Future<Map<String, dynamic>?> pendingMutation(String action) async {
    for (final row in await _attempts.readAttempts()) {
      if (row.action == action) return koraMap(jsonDecode(row.fingerprint));
    }
    return null;
  }

  Future<T> _create<T>(
      {required String action,
      required String path,
      required Map<String, dynamic> business,
      Map<String, dynamic> secrets = const {},
      required T Function(Map<String, dynamic>) decode}) async {
    final fingerprint = jsonEncode(business);
    final key =
        await _attempts.keyFor(action: action, fingerprint: fingerprint);
    try {
      final response = await _api.client.post(path,
          data: {...business, ...secrets},
          options: Options(headers: {'Idempotency-Key': key}));
      final result = decode(koraMap(response.data));
      await _attempts.resolve(action: action, fingerprint: fingerprint);
      return result;
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status != null &&
          status >= 400 &&
          status < 500 &&
          status != 409 &&
          status != 429) {
        await _attempts.resolve(action: action, fingerprint: fingerprint);
      }
      rethrow;
    }
  }

  Future<void> acknowledgeOrder(KoraOrder order) async {
    await _attempts.resolve(
        action: 'provider-create',
        fingerprint: jsonEncode({'quoteId': order.quote.id}));
    if (order.payment != null) {
      for (final attempt in await _attempts.readAttempts()) {
        if (attempt.action == 'kora-momo-create' &&
            koraMap(jsonDecode(attempt.fingerprint))['orderId'] == order.id) {
          await _attempts.resolve(
              action: attempt.action, fingerprint: attempt.fingerprint);
        }
      }
    }
  }

  Future<KoraOrder?> recoverOrderAttempt(String quoteId) async {
    final result = koraMap((await _api.client
            .post('/api/exchange/provider/quotes/$quoteId/recover'))
        .data);
    if (result['order'] is Map) {
      final order = KoraOrder.fromJson(koraMap(result['order']));
      await acknowledgeOrder(order);
      return order;
    }
    if (result['canRequote'] == true) {
      await _attempts.resolve(
          action: 'provider-create',
          fingerprint: jsonEncode({'quoteId': quoteId}));
      throw const KoraQuoteExpired();
    }
    return null;
  }

  Future<KoraOrder> createOrder(KoraQuote quote, String pin) async {
    try {
      return await _create(
          action: 'provider-create',
          path: '/api/exchange/provider/orders',
          business: {'quoteId': quote.id},
          secrets: {'transactionPin': pin},
          decode: KoraOrder.fromJson);
    } on DioException catch (error) {
      if (error.response?.statusCode == 409) {
        final existing = await recoverOrderAttempt(quote.id);
        if (existing != null) return existing;
      }
      rethrow;
    }
  }

  Future<List<KoraOrder>> orders() async =>
      ((await _api.client.get('/api/exchange/provider/orders')).data as List)
          .map((row) => KoraOrder.fromJson(koraMap(row)))
          .toList();
  Future<KoraOrder> order(String id) async => KoraOrder.fromJson(koraMap(
      (await _api.client.get('/api/exchange/provider/orders/$id')).data));
  Future<KoraOrder> refreshOrder(String id) async => KoraOrder.fromJson(koraMap(
      (await _api.client.post('/api/exchange/provider/orders/$id/refresh'))
          .data));
  Future<Map<String, dynamic>> account() async =>
      koraMap((await _api.client.get('/api/ghana/account')).data);
  Future<Map<String, dynamic>> createAccount() => _create(
      action: 'kora-account-create',
      path: '/api/ghana/account',
      business: {'consentAccepted': true},
      decode: (data) => data);
  Future<Map<String, dynamic>> momo(
          {String? orderId, String? amount, required String number}) =>
      _create(
          action: 'kora-momo-create',
          path: '/api/ghana/collections',
          business: {
            if (orderId != null) 'orderId': orderId,
            if (amount != null)
              'amount': MoneyValue.parse(amount).decimalString,
            'mobileNumber': ghanaPhone(number)
          },
          decode: (data) => data);
  Future<Map<String, dynamic>> refreshPayment(String id) async => koraMap(
      (await _api.client.post('/api/ghana/collections/$id/refresh')).data);
  Future<Map<String, dynamic>> authorizePayment(String id, String otp) async =>
      koraMap((await _api.client.post('/api/ghana/collections/$id/authorize',
              data: {'otp': otp},
              options:
                  Options(headers: {'Idempotency-Key': const Uuid().v4()})))
          .data);
  Future<Map<String, dynamic>> resolveRecipient(
          String number, String operator) async =>
      koraMap((await _api.client.post('/api/ghana/recipients/resolve',
              data: {'mobileNumber': ghanaPhone(number), 'operator': operator}))
          .data);
  Future<Map<String, dynamic>> cashout(
          {required String amount,
          required String number,
          required String operator,
          required String pin,
          String? name}) =>
      _create(
          action: 'ghs-cashout-create',
          path: '/api/ghana/withdrawals',
          business: {
            'amount': MoneyValue.parse(amount).decimalString,
            'mobileNumber': ghanaPhone(number),
            'operator': operator,
            if (name != null) 'expectedName': name
          },
          secrets: {'transactionPin': pin},
          decode: (data) => data);
  Future<Map<String, dynamic>> refreshCashout(String reference) async =>
      koraMap(
          (await _api.client.post('/api/ghana/withdrawals/$reference/refresh'))
              .data);
}
