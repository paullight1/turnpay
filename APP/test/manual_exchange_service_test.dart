import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'package:trustpay_app/features/exchange/services/ghana_bank_directory.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('recipient resolution sends an idempotency key and binds the response',
      () async {
    final adapter = _GhanaResolveAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://manual-exchange.test'))
      ..httpClientAdapter = adapter;
    final service = ManualExchangeService(apiClient: ApiClient(dio: dio));
    final result = await service.resolveGhanaMomoRecipient(
        number: '0241234567', operator: 'mtn');
    expect(result.name, 'Verified Recipient');
    expect(adapter.key, isNotEmpty);
  });

  test('a lookup for another number cannot become the verified recipient',
      () async {
    final adapter = _GhanaResolveAdapter(otherNumber: true);
    final dio = Dio(BaseOptions(baseUrl: 'https://manual-exchange.test'))
      ..httpClientAdapter = adapter;
    final service = ManualExchangeService(apiClient: ApiClient(dio: dio));
    await expectLater(
        service.resolveGhanaMomoRecipient(
            number: '0241234567', operator: 'mtn'),
        throwsA(isA<FormatException>()));
  });

  test('loads Nigerian banks in display order and binds a verified account',
      () async {
    final adapter = _NigerianBankAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://manual-exchange.test'))
      ..httpClientAdapter = adapter;
    final service = ManualExchangeService(apiClient: ApiClient(dio: dio));

    final banks = await service.fetchNigerianBanks();
    expect(banks.map((bank) => bank.name),
        ['ALAT by WEMA', 'Access Bank', 'Zenith Bank']);
    expect(banks.first.code, '035A');

    final resolution = await service.resolveNigerianBankAccount(
      accountNumber: '0123456789',
      bankCode: banks.first.code,
    );
    expect(resolution.accountName, 'Ada Lovelace');
    expect(resolution.accountNumber, '0123456789');
    expect(resolution.bankCode, '035A');
    expect(adapter.resolvedBankCode, '035A');
  });

  test('rejects empty or mismatched Nigerian account resolutions', () async {
    for (final response in <Map<String, dynamic>>[
      {
        'accountName': '',
        'accountNumber': '0123456789',
        'bankCode': '044',
      },
      {
        'accountName': 'Wrong account',
        'accountNumber': '0123456780',
        'bankCode': '044',
      },
      {
        'accountName': 'Wrong bank',
        'accountNumber': '0123456789',
        'bankCode': '058',
      },
    ]) {
      final adapter = _NigerianBankAdapter(resolution: response);
      final dio = Dio(BaseOptions(baseUrl: 'https://manual-exchange.test'))
        ..httpClientAdapter = adapter;
      final service = ManualExchangeService(apiClient: ApiClient(dio: dio));

      await expectLater(
        service.resolveNigerianBankAccount(
          accountNumber: '0123456789',
          bankCode: '044',
        ),
        throwsA(isA<FormatException>()),
      );
    }
  });

  test('normalizes only valid Ghana MoMo numbers', () {
    expect(normalizeGhanaMobileNumber('024 123 4567'), '233241234567');
    expect(normalizeGhanaMobileNumber('+233241234567'), '233241234567');
    expect(
      () => normalizeGhanaMobileNumber('024123456'),
      throwsA(isA<FormatException>()),
    );
  });

  test('parses provider recipient names without inventing a fallback', () {
    final result = ManualGhanaRecipientResolution.fromJson({
      'name': 'A Verified Recipient',
      'number': '233241234567',
      'operator': 'mtn',
    });
    expect(result.name, 'A Verified Recipient');
    expect(
      () => ManualGhanaRecipientResolution.fromJson({
        'number': '233241234567',
        'operator': 'mtn',
      }),
      throwsA(isA<FormatException>()),
    );
  });

  test('fails closed when provider capabilities do not expose bank payouts',
      () {
    final capabilities = ManualGhanaPayoutCapabilities.fromJson({
      'enabled': true,
      'momoPayouts': true,
      'bankPayouts': false,
    });
    expect(capabilities.momoPayouts, isTrue);
    expect(capabilities.bankPayouts, isFalse);
  });

  test('directory uses the current Ghana bank names without provider codes',
      () {
    expect(ghanaLicensedBanks, hasLength(23));
    expect(
        ghanaLicensedBanks.any((bank) => bank.name == 'GCB Bank Plc'), isTrue);
    expect(searchGhanaBanks('gcb').single.name, 'GCB Bank Plc');
    expect(
        ghanaLicensedBanks.every((bank) => bank.monogram.isNotEmpty), isTrue);
  });

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
    expect(config.deliveryModesFor('GHS'), isEmpty);
    expect(config.canExchangeFrom('GHS'), isFalse);
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
  test(
      'receiving readiness is per direction, backward compatible and fails closed',
      () {
    final base = <String, dynamic>{
      'enabled': true,
      'sourceCurrency': 'GHS',
      'targetCurrency': 'NGN',
      'supportedSourceCurrencies': ['GHS', 'NGN'],
    };
    final configured = ManualExchangeConfig.fromJson({
      ...base,
      'availableSourceCurrencies': ['NGN'],
    });
    expect(configured.canExchangeFrom('NGN'), isTrue);
    expect(configured.canExchangeFrom('GHS'), isFalse);
    expect(ManualExchangeConfig.fromJson(base).canExchangeFrom('GHS'), isFalse);
    expect(
        ManualExchangeConfig.fromJson({
          ...base,
          'enabled': false,
          'availableSourceCurrencies': ['GHS'],
        }).canExchangeFrom('GHS'),
        isFalse);
    for (final value in [
      null,
      'NGN',
      ['USD']
    ]) {
      expect(
          () => ManualExchangeConfig.fromJson({
                ...base,
                'availableSourceCurrencies': value,
              }),
          throwsFormatException);
    }
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
    // A random UUID may coincidentally contain the PIN's four digits. Check
    // the persisted structure and payload instead of arbitrary substrings.
    expect(pending.single.toJson().keys,
        unorderedEquals(['action', 'fingerprint', 'key']));
    expect(jsonDecode(pending.single.fingerprint),
        {'amount': '100.00', 'settlementMode': 'WALLET'});

    final order = await service.resumeCreateOrder(pending.single, '2468');
    expect(order.id, 'order-1');
    expect(adapter.createIdempotencyKeys, hasLength(2));
    expect(adapter.createIdempotencyKeys.first,
        adapter.createIdempotencyKeys.last);
    expect(await store.readAttempts(), isEmpty);
    await expectLater(
        service.resumeCreateOrder(pending.single, '2468'), throwsStateError);
    expect(adapter.createIdempotencyKeys, hasLength(2));
  });

  for (final legacy in [false, true]) {
    test(
        'reverse bank request uses the new delivery contract while preserving legacy=$legacy retries',
        () async {
      final adapter = _ManualExchangeAdapter();
      final api = ApiClient(
          dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
            ..httpClientAdapter = adapter);
      final store = ManualExchangeAttemptStore();
      String? oldKey;
      if (legacy) {
        oldKey = await store.keyFor(
            action: 'create',
            fingerprint: jsonEncode({
              'sourceCurrency': 'GHS',
              'amount': '100.00',
              'settlementMode': 'BANK',
              'destinationInstitution': 'Synthetic Nigerian Bank',
              'destinationAccount': '0123456789',
              'destinationName': 'Beneficiary',
            }));
      }
      final service =
          ManualExchangeService(apiClient: api, attemptStore: store);
      if (legacy) {
        await service.resumeCreateOrder(
            (await store.pendingCreates()).single, '2468');
      } else {
        await service.createOrder(
          sourceCurrency: 'GHS',
          amount: '100.00',
          settlementMode: ManualSettlementMode.bank,
          transactionPin: '2468',
          destinationInstitution: 'Synthetic Nigerian Bank',
          destinationAccount: '0123456789',
          destinationName: 'Beneficiary',
        );
      }
      expect(adapter.createBodies.single['deliveryPolicyVersion'],
          legacy ? isNull : 2);
      if (legacy) expect(adapter.createIdempotencyKeys.single, oldKey);
    });
  }

  test('explains a legacy API rejection without retrying an older contract',
      () async {
    final adapter = _ManualExchangeAdapter(
      firstCreateStatus: 400,
      firstCreateMessage: {
        'message': ['property deliveryPolicyVersion should not exist'],
      },
    );
    final store = ManualExchangeAttemptStore();
    final service = ManualExchangeService(
      attemptStore: store,
      apiClient: ApiClient(
        dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
          ..httpClientAdapter = adapter,
      ),
    );
    await expectLater(
      service.createOrder(
        sourceCurrency: 'GHS',
        amount: '100.00',
        settlementMode: ManualSettlementMode.bank,
        transactionPin: '2468',
        destinationInstitution: 'Synthetic Nigerian Bank',
        destinationAccount: '0123456789',
        destinationName: 'Beneficiary',
      ),
      throwsA(isA<FormatException>().having(
        (error) => error.message,
        'message',
        contains('No transfer instructions were issued'),
      )),
    );
    expect(adapter.createBodies.single['deliveryPolicyVersion'], 2);
    expect(await store.pendingCreates(), isEmpty);
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
        'Awaiting admin review');

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

  test(
      'saves separate local drafts with the same amount without creating orders',
      () async {
    final adapter = _ManualExchangeAdapter();
    final service = ManualExchangeService(
      apiClient: ApiClient(
        dio: Dio(BaseOptions(baseUrl: _ManualExchangeAdapter.baseUrl))
          ..httpClientAdapter = adapter,
      ),
    );
    await service.saveAmountDraft('GHS', '150.00');
    await service.saveAmountDraft('GHS', '150.00');
    final drafts = await service.pendingCreateAttempts();
    expect(drafts.map((draft) => draft.action), ['draft', 'draft']);
    expect(drafts.first.key, isNot(drafts.last.key));
    await service.saveAmountDraft('GHS', '175.00', previous: drafts.first);
    final updated = await service.pendingCreateAttempts();
    expect(updated.map((draft) => jsonDecode(draft.fingerprint)['amount']),
        unorderedEquals(['150.00', '175.00']));
    expect(adapter.createCalls, 0);
  });

  test('keeps independent pending exchanges and reuses identical retry keys',
      () async {
    final store = ManualExchangeAttemptStore();
    const first = '{"amount":"100.00"}';
    const second = '{"amount":"200.00"}';
    final keys = await Future.wait([
      store.keyFor(action: 'create', fingerprint: first),
      store.keyFor(action: 'create', fingerprint: second),
    ]);
    expect(keys.first, isNot(keys.last));
    expect(
        await store.keyFor(action: 'create', fingerprint: first), keys.first);
    expect((await store.pendingCreates()).map((attempt) => attempt.fingerprint),
        unorderedEquals([first, second]));
    await store.resolve(action: 'create', fingerprint: second);
    expect((await store.pendingCreates()).single.key, keys.first);
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
        receiptName: 'Synthetic Sender',
      ),
      throwsA(isA<DioException>()),
    );
    final journal = jsonEncode(await store.readAttempts());
    expect(journal, isNot(contains('https://signed.manual-exchange.test')));
    expect(journal, isNot(contains('upload-token')));
    expect(journal, isNot(contains('Synthetic Sender')));
    final retried = await service.submitProof(
      orderId: 'order-1',
      file: file,
      receiptName: 'Synthetic Sender',
    );

    expect(retried.id, 'order-1');
    expect(adapter.proofIdempotencyKeys, hasLength(2));
    expect(
        adapter.proofIdempotencyKeys.first, adapter.proofIdempotencyKeys.last);
    expect(uploadAdapter.uploadCount, 1);
    expect(adapter.lastProofBody, {
      'objectKey': 'private/order-1/receipt.png',
      'receiptName': 'Synthetic Sender',
    });
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
  final Object firstCreateMessage;
  final bool malformedCreateResponse;
  int createCalls = 0;
  int proofCalls = 0;
  final List<String> createIdempotencyKeys = [];
  final List<Map<String, dynamic>> createBodies = [];
  final List<String> proofIdempotencyKeys = [];
  dynamic lastProofBody;

  _ManualExchangeAdapter({
    this.failFirstCreate = false,
    this.failFirstProof = false,
    this.firstCreateStatus,
    this.firstCreateMessage = 'ambiguous',
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
      createBodies.add(Map<String, dynamic>.from(options.data as Map));
      createCalls += 1;
      createIdempotencyKeys.add(
        '${options.headers['Idempotency-Key'] ?? ''}',
      );
      if (firstCreateStatus != null && createCalls == 1) {
        return _json(
          {'message': firstCreateMessage},
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
      lastProofBody = options.data;
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

class _GhanaResolveAdapter implements HttpClientAdapter {
  final bool otherNumber;
  String key = '';
  _GhanaResolveAdapter({this.otherNumber = false});
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    key = '${options.headers['Idempotency-Key'] ?? ''}';
    return ResponseBody.fromString(
        jsonEncode(key.isEmpty
            ? {'message': 'Idempotency-Key required'}
            : {
                'name': 'Verified Recipient',
                'number': otherNumber ? '233201234567' : '233241234567',
                'operator': 'mtn',
              }),
        key.isEmpty ? 400 : 200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType]
        });
  }
}

class _NigerianBankAdapter implements HttpClientAdapter {
  final Map<String, dynamic>? resolution;
  String? resolvedBankCode;

  _NigerianBankAdapter({this.resolution});

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    dynamic body;
    if (options.method == 'GET' && options.path == '/api/payments/banks') {
      body = [
        {'name': 'Zenith Bank', 'code': '057', 'slug': 'zenith-bank'},
        {'name': 'Access Bank', 'code': '044', 'slug': 'access-bank'},
        {'name': 'ALAT by WEMA', 'code': '035A'},
        {'name': 'Incomplete entry', 'code': ''},
      ];
    } else if (options.method == 'POST' &&
        options.path == '/api/payments/banks/resolve') {
      resolvedBankCode = (options.data as Map)['bankCode'] as String;
      body = resolution ??
          {
            'accountName': 'Ada Lovelace',
            'accountNumber': '0123456789',
            'bankCode': resolvedBankCode,
          };
    } else {
      return ResponseBody.fromString(
        jsonEncode({'message': 'Unexpected request'}),
        404,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}
