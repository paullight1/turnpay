import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/kora_service.dart';

Map<String, dynamic> quoteFixture() => {
      'id': '11111111-1111-4111-8111-111111111111',
      'sourceCurrency': 'GHS',
      'targetCurrency': 'NGN',
      'fundingSource': 'WALLET',
      'amount': '10.00',
      'fee': '0.10',
      'total': '10.10',
      'rate': '100.000000',
      'targetAmount': '1000.00',
      'destinationType': 'BANK',
      'destinationCode': '058',
      'destinationName': 'Verified Receiver',
      'destinationMasked': '******6789',
      'expiresAt':
          DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
    };
Map<String, dynamic> orderFixture() => {
      'id': '22222222-2222-4222-8222-222222222222',
      'transactionId': 'tx-test',
      'reference': 'PX-test',
      'status': 'READY',
      'fundedAt': DateTime.now().toIso8601String(),
      'quote': quoteFixture()
    };
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'trustpay_access_token': 'e30.${base64Url.encode(utf8.encode(jsonEncode({
                'sub': 'owner-a'
              }))).replaceAll('=', '')}.test'
    });
  });
  test('Ghana receiving alone does not activate the provider exchange flow',
      () {
    expect(usesProviderExchange({'ghanaEnabled': true, 'enabled': false}),
        isFalse);
    expect(
        usesProviderExchange({'ghanaEnabled': true, 'enabled': true}), isTrue);
    expect(usesProviderExchange({'enabled': false, 'hasOrders': true}), isTrue);
    expect(
        usesProviderExchange({'enabled': false, 'hasPending': true}), isTrue);
  });
  test(
      'rejects inconsistent totals and currency pairs before displaying a quote',
      () {
    expect(KoraQuote.fromJson(quoteFixture()).total, '10.10');
    expect(() => KoraQuote.fromJson({...quoteFixture(), 'total': '10.00'}),
        throwsFormatException);
    expect(
        () => KoraQuote.fromJson({...quoteFixture(), 'targetCurrency': 'GHS'}),
        throwsFormatException);
  });
  test(
      'keeps an unknown exchange attempt across restart and never stores the PIN',
      () async {
    final adapter = _Adapter();
    final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'https://kora.test'))
          ..httpClientAdapter = adapter);
    final service = KoraService(apiClient: api);
    final quote = KoraQuote.fromJson(quoteFixture());
    await expectLater(
        service.createOrder(quote, '2468'), throwsA(isA<DioException>()));
    expect((await service.pendingAttempt())?['quoteId'], quote.id);
    const storage = FlutterSecureStorage();
    expect(jsonEncode(await storage.readAll()), isNot(contains('2468')));
    final reopened = KoraService(apiClient: api);
    final order = await reopened.createOrder(quote, '2468');
    expect(order.status, 'READY');
    expect(adapter.keys[0], adapter.keys[1]);
    expect(await reopened.pendingAttempt(), isNull);
  });
  test(
      'a terminal expired unused quote clears the attempt and permits a fresh quote',
      () async {
    final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'https://kora.test'))
          ..httpClientAdapter = _ExpiredAdapter());
    final service = KoraService(apiClient: api);
    await expectLater(
        service.createOrder(KoraQuote.fromJson(quoteFixture()), '2468'),
        throwsFormatException);
    expect(await service.pendingAttempt(), isNull);
  });
  test('an owned recovered order acknowledges its lost MoMo create response',
      () async {
    final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'https://kora.test'))
          ..httpClientAdapter = _Adapter());
    final service = KoraService(apiClient: api);
    await expectLater(
        service.momo(
            orderId: '22222222-2222-4222-8222-222222222222',
            number: '0241234567'),
        throwsA(isA<DioException>()));
    await service.acknowledgeOrder(KoraOrder.fromJson({
      ...orderFixture(),
      'payment': {'id': 'intent', 'status': 'SUCCESS'}
    }));
    expect(await service.pendingMutation('kora-momo-create'), isNull);
  });
  test('normalizes Ghana numbers and refuses a different country', () {
    expect(ghanaPhone('0241234567'), '233241234567');
    expect(ghanaPhone('+233241234567'), '233241234567');
    expect(() => ghanaPhone('+2348012345678'), throwsFormatException);
  });
}

class _Adapter implements HttpClientAdapter {
  final keys = <String>[];
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    keys.add('${options.headers['Idempotency-Key']}');
    if (keys.length == 1) {
      throw DioException(
          requestOptions: options, type: DioExceptionType.connectionError);
    }
    return ResponseBody.fromString(jsonEncode(orderFixture()), 200, headers: {
      Headers.contentTypeHeader: ['application/json']
    });
  }
}

class _ExpiredAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancel) async {
    if (options.path.endsWith('/recover')) {
      return ResponseBody.fromString(
          jsonEncode({'order': null, 'canRequote': true}), 200,
          headers: {
            Headers.contentTypeHeader: ['application/json']
          });
    }
    return ResponseBody.fromString(
        jsonEncode({
          'message': 'This quote expired. Review a new quote before paying.'
        }),
        409,
        headers: {
          Headers.contentTypeHeader: ['application/json']
        });
  }
}
