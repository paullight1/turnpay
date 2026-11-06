import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
      'lost reminder response reuses its original key after reopening and does not lock a new exchange',
      () async {
    final adapter = _ReminderAdapter();
    final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'https://fixture.invalid'))
          ..httpClientAdapter = adapter);
    ManualExchangeAttemptStore store() => ManualExchangeAttemptStore(
        accountScopeProvider: () async => 'fixture-user');
    final first = ManualExchangeService(apiClient: api, attemptStore: store());
    await expectLater(
        first.requestReviewReminder('order-1'), throwsA(isA<DioException>()));
    final createKey = await store().keyFor(
        action: 'create',
        fingerprint:
            jsonEncode({'amount': '100.00', 'settlementMode': 'BANK'}));
    expect(createKey, isNotEmpty);
    final reopened =
        ManualExchangeService(apiClient: api, attemptStore: store());
    final result = await reopened.requestReviewReminder('order-1');
    expect(adapter.keys, hasLength(2));
    expect(adapter.keys[1], adapter.keys[0]);
    expect(adapter.bodies, everyElement({'reason': 'REVIEW'}));
    expect(result.nextAllowedAt.difference(result.requestedAt),
        const Duration(minutes: 10));
    expect(
        (await store().readAttempts())
            .where((a) => a.action == 'review-reminder'),
        isEmpty);
  });
  test(
      'structured cooldown survives the backend exception envelope and releases only the reminder attempt',
      () async {
    final adapter = _CooldownAdapter();
    final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'https://fixture.invalid'))
          ..httpClientAdapter = adapter);
    final store = ManualExchangeAttemptStore(
        accountScopeProvider: () async => 'fixture-user');
    final service = ManualExchangeService(apiClient: api, attemptStore: store);
    final createKey = await store.keyFor(
        action: 'create', fingerprint: jsonEncode({'amount': '100.00'}));
    Object? failure;
    try {
      await service.requestReviewReminder('order-1');
    } catch (error) {
      failure = error;
    }
    expect(failure, isA<DioException>());
    expect(ManualExchangeReminder.cooldownFromError(failure!),
        DateTime.utc(2026, 11, 4, 10, 10));
    final attempts = await store.readAttempts();
    expect(attempts.where((a) => a.action == 'review-reminder'), isEmpty);
    expect(attempts.single.key, createKey);
    await service.requestReviewReminder('order-1');
    expect(adapter.keys[1], isNot(adapter.keys[0]));
  });
}

class _CooldownAdapter implements HttpClientAdapter {
  final keys = <String>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    keys.add(options.headers['Idempotency-Key'] as String);
    return ResponseBody.fromString(
        jsonEncode(keys.length == 1
            ? {
                'statusCode': 429,
                'message': {
                  'message': 'Please wait',
                  'nextAllowedAt': '2026-11-04T10:10:00.000Z'
                }
              }
            : {
                'requestedAt': '2026-11-04T10:10:00.000Z',
                'nextAllowedAt': '2026-11-04T10:20:00.000Z'
              }),
        keys.length == 1 ? 429 : 200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType]
        });
  }

  @override
  void close({bool force = false}) {}
}

class _ReminderAdapter implements HttpClientAdapter {
  final keys = <String>[];
  final bodies = <dynamic>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    expect(options.method, 'POST');
    expect(options.path, '/api/exchange/manual-orders/order-1/remind');
    keys.add(options.headers['Idempotency-Key'] as String);
    bodies.add(options.data);
    if (keys.length == 1) {
      throw DioException.connectionError(
          requestOptions: options, reason: 'lost response fixture');
    }
    return ResponseBody.fromString(
        jsonEncode({
          'requestedAt': '2026-11-04T10:00:00.000Z',
          'nextAllowedAt': '2026-11-04T10:10:00.000Z'
        }),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType]
        });
  }

  @override
  void close({bool force = false}) {}
}
