import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'trustpay_access_token': _jwtFor('account-a'),
    });
  });

  test('uses published receiving options and rejects invalid capability data',
      () {
    final config = ManualExchangeConfig.fromJson({
      'enabled': true,
      'sourceCurrency': 'GHS',
      'targetCurrency': 'NGN',
      'supportedSourceCurrencies': ['GHS', 'NGN'],
      'settlementOptions': {
        'GHS': ['WALLET'],
        'NGN': ['BANK']
      }
    });
    expect(config.deliveryModesFor('GHS'), [ManualSettlementMode.wallet]);
    expect(config.deliveryModesFor('NGN'), [ManualSettlementMode.bank]);
    expect(
        () => ManualExchangeConfig.fromJson({
              'enabled': true,
              'sourceCurrency': 'GHS',
              'targetCurrency': 'NGN',
              'supportedSourceCurrencies': ['GHS'],
              'settlementOptions': {'GHS': []}
            }),
        throwsFormatException);
    expect(
        () => ManualExchangeConfig.fromJson({
              'enabled': true,
              'sourceCurrency': 'GHS',
              'targetCurrency': 'NGN',
              'supportedSourceCurrencies': ['GHS'],
              'settlementOptions': {
                'GHS': ['UNKNOWN']
              }
            }),
        throwsFormatException);
  });
  test('retries an unknown create outcome with the same account-scoped key',
      () async {
    final adapter = _ManualExchangeAdapter(failFirstCreate: true);
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );
    final store = ManualExchangeAttemptStore();
    final service = ManualExchangeService(
      apiClient: api,
      attemptStore: store,
    );

    Future<ManualExchangeOrder> create() => service.createOrder(
          amount: '100.00',
          settlementMode: ManualSettlementMode.wallet,
          transactionPin: '2468',
        );

    await expectLater(create(), throwsA(isA<DioException>()));

    final pending = await store.readAttempts();
    expect(pending, hasLength(1));
    expect(pending.single.action, 'create');
    expect(jsonEncode(pending), isNot(contains('2468')));

    final order = await create();
    expect(order.id, 'order-1');
    expect(adapter.createIdempotencyKeys, hasLength(2));
    expect(adapter.createIdempotencyKeys.first,
        adapter.createIdempotencyKeys.last);
    expect(await store.readAttempts(), isEmpty);
  });

  test('reopens a server receipt status after a fresh service instance',
      () async {
    final adapter = _ManualExchangeAdapter();
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );

    final first = ManualExchangeService(apiClient: api);
    final saved = await first.listOrders();
    expect(saved, hasLength(1));
    expect(saved.single.id, 'order-1');
    expect(saved.single.status, ManualExchangeOrderStatus.awaitingConfirmation);
    expect(saved.single.hasProof, isTrue);
    expect(manualExchangeStatusLabel(saved.single.status),
        'Awaiting confirmation');

    final reopened = ManualExchangeService(apiClient: api);
    final detail = await reopened.getOrder('order-1');
    expect(detail.hasProof, isTrue);
    expect(detail.events, hasLength(2));
  });

  test('keeps retry metadata scoped to the authenticated account', () async {
    final store = ManualExchangeAttemptStore();
    final firstKey = await store.keyFor(
      action: 'create',
      fingerprint: '{"amount":"100.00"}',
    );

    FlutterSecureStorage.setMockInitialValues({
      'trustpay_access_token': _jwtFor('account-b'),
    });
    final secondKey = await store.keyFor(
      action: 'create',
      fingerprint: '{"amount":"100.00"}',
    );

    expect(secondKey, isNot(firstKey));
    expect(await store.readAttempts(), hasLength(1));
  });

  test('rejects an unknown settlement mode instead of defaulting to wallet',
      () {
    expect(
      manualSettlementModeFromValue('WALLET'),
      ManualSettlementMode.wallet,
    );
    expect(
      () => manualSettlementModeFromValue('CRYPTO'),
      throwsA(isA<FormatException>()),
    );
  });

  test('fails closed when retry journal data is corrupt', () async {
    const storage = FlutterSecureStorage();
    final store = ManualExchangeAttemptStore(
      storage: storage,
      accountScopeProvider: () async => 'account-a',
    );
    final digest = sha256.convert(utf8.encode('account-a')).toString();
    final storageKey =
        'trustpay_manual_exchange_attempts_v1_${digest.substring(0, 32)}';
    await storage.write(key: storageKey, value: '[{"action":"create"}]');

    await expectLater(store.readAttempts(), throwsA(isA<FormatException>()));
  });

  test('does not share retry journal state when no account scope exists',
      () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = ManualExchangeAttemptStore();

    await expectLater(store.readAttempts(), throwsA(isA<StateError>()));
  });

  test('serializes concurrent journal writes across store instances', () async {
    final first = ManualExchangeAttemptStore(
      accountScopeProvider: () async => 'account-a',
    );
    final second = ManualExchangeAttemptStore(
      accountScopeProvider: () async => 'account-a',
    );

    final keys = await Future.wait([
      first.keyFor(action: 'create', fingerprint: '{"amount":"100.00"}'),
      second.keyFor(
        action: 'proof',
        fingerprint: '{"objectKey":"object-1"}',
        orderId: 'order-1',
      ),
    ]);

    expect(keys[0], isNot(keys[1]));
    expect(await first.readAttempts(), hasLength(2));
  });

  test('blocks a replacement create while the original intent is pending',
      () async {
    final store = ManualExchangeAttemptStore();
    await store.keyFor(
      action: 'create',
      fingerprint: '{"amount":"100.00"}',
    );

    await expectLater(
      store.keyFor(
        action: 'create',
        fingerprint: '{"amount":"200.00"}',
      ),
      throwsA(isA<FormatException>()),
    );
    expect((await store.pendingCreate())?.fingerprint, '{"amount":"100.00"}');
  });

  test('keeps a create key after an ambiguous conflict response', () async {
    final adapter = _ManualExchangeAdapter(firstCreateStatus: 409);
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );
    final store = ManualExchangeAttemptStore();
    final service = ManualExchangeService(apiClient: api, attemptStore: store);

    await expectLater(
      service.createOrder(
        amount: '100.00',
        settlementMode: ManualSettlementMode.wallet,
        transactionPin: '2468',
      ),
      throwsA(isA<DioException>()),
    );
    expect(await store.readAttempts(), hasLength(1));
  });

  test('keeps the retry key when a successful response is malformed', () async {
    final adapter = _ManualExchangeAdapter(malformedCreateResponse: true);
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );
    final store = ManualExchangeAttemptStore();
    final service = ManualExchangeService(apiClient: api, attemptStore: store);

    await expectLater(
      service.createOrder(
        amount: '100.00',
        settlementMode: ManualSettlementMode.wallet,
        transactionPin: '2468',
      ),
      throwsA(isA<FormatException>()),
    );
    expect(await store.readAttempts(), hasLength(1));
  });

  test('rejects malformed financial order values before display', () {
    final adapter = _ManualExchangeAdapter();
    final malformed = adapter._order()..['rate'] = '0.0075';

    expect(
      () => ManualExchangeOrder.fromJson(malformed),
      throwsA(isA<FormatException>()),
    );
  });

  test('uploads proof bytes without forwarding the API bearer token', () async {
    final adapter = _ManualExchangeAdapter();
    final uploadAdapter = _SignedUploadAdapter();
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );
    final uploadClient = Dio()..httpClientAdapter = uploadAdapter;
    final service = ManualExchangeService(
      apiClient: api,
      uploadClient: uploadClient,
    );

    final order = await service.submitProof(
      orderId: 'order-1',
      file: ManualExchangeProofFile(
        fileName: 'receipt.png',
        contentType: 'image/png',
        bytes: Uint8List.fromList([1, 2, 3]),
      ),
      bankReference: 'TRF-001',
    );

    expect(order.id, 'order-1');
    expect(uploadAdapter.authorizationHeader, isNull);
    expect(uploadAdapter.contentType, 'image/png');
    expect(uploadAdapter.bytes, [1, 2, 3]);
  });

  test('retries an unknown proof attach without uploading a second receipt',
      () async {
    final adapter = _ManualExchangeAdapter(failFirstProof: true);
    final uploadAdapter = _SignedUploadAdapter();
    final store = ManualExchangeAttemptStore();
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
        ..httpClientAdapter = adapter,
    );
    final service = ManualExchangeService(
      apiClient: api,
      attemptStore: store,
      uploadClient: Dio()..httpClientAdapter = uploadAdapter,
    );
    final file = ManualExchangeProofFile(
      fileName: 'receipt.png',
      contentType: 'image/png',
      bytes: Uint8List.fromList([4, 5, 6]),
    );

    await expectLater(
      service.submitProof(
        orderId: 'order-1',
        file: file,
        bankReference: 'TRF-RETRY',
      ),
      throwsA(isA<DioException>()),
    );
    final journal = jsonEncode(await store.readAttempts());
    expect(journal, isNot(contains('https://signed.manual-exchange.test')));
    expect(journal, isNot(contains('upload-token')));
    final retried = await service.submitProof(
      orderId: 'order-1',
      file: file,
      bankReference: 'TRF-RETRY',
    );

    expect(retried.id, 'order-1');
    expect(adapter.proofIdempotencyKeys, hasLength(2));
    expect(
        adapter.proofIdempotencyKeys.first, adapter.proofIdempotencyKeys.last);
    expect(uploadAdapter.uploadCount, 1);
  });
}

String _jwtFor(String subject) {
  String encode(Map<String, dynamic> value) =>
      base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
  return '${encode({'alg': 'none'})}.${encode({'sub': subject})}.signature';
}

class _ManualExchangeAdapter implements HttpClientAdapter {
  static const baseUrl = 'https://manual-exchange.test';

  final bool failFirstCreate;
  final bool failFirstProof;
  final int? firstCreateStatus;
  final bool malformedCreateResponse;
  int createCalls = 0;
  int proofCalls = 0;
  final List<String> createIdempotencyKeys = [];
  final List<String> proofIdempotencyKeys = [];

  _ManualExchangeAdapter({
    this.failFirstCreate = false,
    this.failFirstProof = false,
    this.firstCreateStatus,
    this.malformedCreateResponse = false,
  });

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    final method = options.method.toUpperCase();

    if (method == 'POST' && path == '/api/exchange/manual-orders') {
      createCalls += 1;
      createIdempotencyKeys.add(
        '${options.headers['Idempotency-Key'] ?? ''}',
      );
      if (firstCreateStatus != null && createCalls == 1) {
        return _json(
          {'message': 'ambiguous'},
          statusCode: firstCreateStatus!,
        );
      }
      if (failFirstCreate && createCalls == 1) {
        throw DioException(
          requestOptions: options,
          error: 'offline',
          type: DioExceptionType.connectionError,
        );
      }
      if (malformedCreateResponse && createCalls == 1) {
        return _json({'id': 'missing-required-order-fields'});
      }
      return _json(_order());
    }

    if (method == 'GET' && path == '/api/exchange/manual-orders') {
      return _json([_order()]);
    }

    if (method == 'GET' && path == '/api/exchange/manual-orders/order-1') {
      return _json(_order());
    }

    if (method == 'POST' &&
        path == '/api/exchange/manual-orders/order-1/upload-url') {
      return _json({
        'signedUrl': 'https://signed.manual-exchange.test/receipt',
        'objectKey': 'private/order-1/receipt.png',
        'token': 'upload-token',
      });
    }

    if (method == 'POST' &&
        path == '/api/exchange/manual-orders/order-1/proof') {
      proofCalls += 1;
      proofIdempotencyKeys.add(
        '${options.headers['Idempotency-Key'] ?? ''}',
      );
      if (failFirstProof && proofCalls == 1) {
        throw DioException(
          requestOptions: options,
          error: 'offline',
          type: DioExceptionType.connectionError,
        );
      }
      return _json(_order());
    }

    return _json({'message': 'Unexpected request'}, statusCode: 404);
  }

  Map<String, dynamic> _order() {
    return {
      'id': 'order-1',
      'reference': 'EX-001',
      'status': 'AWAITING_CONFIRMATION',
      'settlementMode': 'WALLET',
      'sourceCurrency': 'NGN',
      'targetCurrency': 'GHS',
      'amount': '100.00',
      'targetAmount': '0.75',
      'rate': '0.007500',
      'fee': '0.00',
      'collectionAccount': {
        'bankName': 'TrustPay Bank',
        'accountName': 'TrustPay Collection',
        'accountNumber': '1234567890',
        'currency': 'NGN',
        'version': 'v1',
      },
      'expiresAt': '2026-09-05T12:00:00.000Z',
      'createdAt': '2026-09-05T10:00:00.000Z',
      'updatedAt': '2026-09-05T10:30:00.000Z',
      'reviewReason': null,
      'destinationInstitution': null,
      'destinationAccountMasked': null,
      'destinationName': null,
      'bankReference': 'TRF-001',
      'depositReference': null,
      'payoutReference': null,
      'payoutClaimedBy': null,
      'hasProof': true,
      'hasPayoutProof': false,
      'events': [
        {
          'status': 'AWAITING_TRANSFER',
          'reason': 'Order created',
          'createdAt': '2026-09-05T10:00:00.000Z',
        },
        {
          'status': 'AWAITING_CONFIRMATION',
          'reason': 'Receipt submitted',
          'createdAt': '2026-09-05T10:30:00.000Z',
        },
      ],
    };
  }

  ResponseBody _json(dynamic value, {int statusCode = 200}) {
    return ResponseBody.fromString(
      jsonEncode(value),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

class _SignedUploadAdapter implements HttpClientAdapter {
  String? authorizationHeader;
  String? contentType;
  List<int> bytes = const [];
  int uploadCount = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    uploadCount += 1;
    authorizationHeader = options.headers['Authorization'] as String?;
    contentType = options.headers['Content-Type'] as String?;
    final data = options.data;
    if (data is Uint8List) {
      bytes = data;
    } else if (data is List<int>) {
      bytes = data;
    }
    return ResponseBody.fromString('', 200);
  }
}
