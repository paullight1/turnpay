import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_presenter.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_widgets.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('parses recovery metadata without exposing identity details', () {
    final recovery = PaystackKycRecovery.fromJson({
      'state': 'ACTION_REQUIRED',
      'message': 'Provider review is taking longer than expected.',
      'supportReference': 'KYC-document-7',
      'pendingSince': '2026-10-31T08:00:00Z',
      'checkedAt': null,
      'retryAllowed': false,
      'bvn': '22112233445',
    });

    expect(recovery.state, PaystackKycRecovery.actionRequired);
    expect(recovery.message, contains('longer'));
    expect(recovery.supportReference, 'KYC-document-7');
    expect(recovery.pendingSince, DateTime.parse('2026-10-31T08:00:00Z'));
    expect(recovery.checkedAt, isNull);
    expect(recovery.retryAllowed, isFalse);
    expect(recovery.toJson(), isNot(contains('bvn')));
  });

  test('reconcile sends an empty body and rotates its key after a response',
      () async {
    final adapter = _RecoveryAdapter([
      _jsonRecovery(PaystackKycRecovery.awaitingProvider),
      _jsonRecovery(PaystackKycRecovery.noPending),
    ]);
    final service = _service(adapter);

    final first = await service.reconcilePaystack();
    final second = await service.reconcilePaystack();

    expect(first.state, PaystackKycRecovery.awaitingProvider);
    expect(second.state, PaystackKycRecovery.noPending);
    expect(adapter.reconcileRequests, hasLength(2));
    expect(adapter.reconcileRequests[0].data, <String, dynamic>{});
    expect(adapter.reconcileRequests[1].data, <String, dynamic>{});
    final keys = adapter.reconcileRequests
        .map((request) => request.headers['Idempotency-Key'])
        .toList();
    expect(keys[0], isA<String>());
    expect(keys[1], isA<String>());
    expect(keys[0], isNot(keys[1]));
  });

  test('reconcile retains its key after an uncertain transport outcome',
      () async {
    final adapter = _RecoveryAdapter([
      _jsonRecovery(PaystackKycRecovery.awaitingProvider),
    ], timeoutFirstReconcile: true);
    final service = _service(adapter);

    await expectLater(
        service.reconcilePaystack(), throwsA(isA<DioException>()));
    await service.reconcilePaystack();

    expect(adapter.reconcileRequests, hasLength(2));
    expect(
      adapter.reconcileRequests[0].headers['Idempotency-Key'],
      adapter.reconcileRequests[1].headers['Idempotency-Key'],
    );
  });

  test('reconcile rotates its key after a temporary-unavailable response',
      () async {
    final adapter = _RecoveryAdapter([
      _jsonRecovery(PaystackKycRecovery.temporarilyUnavailable),
      _jsonRecovery(PaystackKycRecovery.awaitingProvider),
    ]);
    final service = _service(adapter);

    final first = await service.reconcilePaystack();
    final second = await service.reconcilePaystack();

    expect(first.state, PaystackKycRecovery.temporarilyUnavailable);
    expect(second.state, PaystackKycRecovery.awaitingProvider);
    expect(
      adapter.reconcileRequests[0].headers['Idempotency-Key'],
      isNot(adapter.reconcileRequests[1].headers['Idempotency-Key']),
    );
  });

  test('status and document reads expose recovery on a pending Paystack check',
      () async {
    final adapter = _RecoveryAdapter([
      _jsonRecovery(PaystackKycRecovery.awaitingProvider),
    ]);
    final service = _service(adapter);

    final overview = await service.fetchOverview();

    expect(overview.recovery?.state, PaystackKycRecovery.awaitingProvider);
    expect(overview.documents.single.recovery?.supportReference,
        'KYC-bvn-document');
    expect(
        kycRecoveryFor(overview, 'BVN')?.supportReference, 'KYC-bvn-document');
  });

  test('stale status reconciliation retains known recovery guidance', () {
    final previous = _overview(
      recovery: _recovery(PaystackKycRecovery.actionRequired),
      documents: [
        KycDocumentSummary(
          type: 'BVN',
          status: 'SUBMITTED',
          updatedAt: null,
          recovery: _recovery(PaystackKycRecovery.actionRequired),
        ),
      ],
    );
    final incoming = _overview(providerStatus: 'PENDING');

    final merged = kycReconcileOverview(previous, incoming);

    expect(kycRecoveryFor(merged, 'BVN')?.state,
        PaystackKycRecovery.actionRequired);
  });

  test('terminal BVN refresh clears delayed recovery guidance', () {
    final previous =
        _overview(recovery: _recovery(PaystackKycRecovery.actionRequired));
    final incoming = _overview(providerStatus: 'VERIFIED');
    final merged = kycReconcileOverview(previous, incoming);
    expect(merged.recovery, isNull);
    expect(kycRecoveryFor(merged, 'BVN'), isNull);
  });

  testWidgets('newer manual NIN does not disable pending BVN reconciliation',
      (tester) async {
    final service = _ManualNinRecoveryService();
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service, initialOverview: service.overview)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-status-BVN')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(service.reconciliations, 1);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('pending BVN shows delayed guidance and support reference',
      (tester) async {
    final overview = _overview(
      providerStatus: 'PENDING',
      recovery: _recovery(PaystackKycRecovery.actionRequired),
    );
    var reconciliations = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: KycCheckDetailsSheet(
          overview: overview,
          type: 'BVN',
          onCheckStatus: () async => overview,
          onReconcile: () async {
            reconciliations++;
            return _recovery(PaystackKycRecovery.actionRequired);
          },
          onContinue: (_) {},
        ),
      ),
    ));

    expect(find.text('Provider review is taking longer than expected.'),
        findsOneWidget);
    expect(find.textContaining('KYC-bvn-document'), findsOneWidget);
    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(reconciliations, 1);
  });

  testWidgets('verified refresh does not reconcile again', (tester) async {
    final pending = _overview(
      providerStatus: 'PENDING',
      recovery: _recovery(PaystackKycRecovery.awaitingProvider),
    );
    final verified = _overview(providerStatus: 'VERIFIED');
    var reconciliations = 0;
    var refreshes = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: KycCheckDetailsSheet(
          overview: pending,
          type: 'BVN',
          onCheckStatus: () async {
            refreshes++;
            return verified;
          },
          onReconcile: () async {
            reconciliations++;
            return _recovery(PaystackKycRecovery.awaitingProvider);
          },
          onContinue: (_) {},
        ),
      ),
    ));

    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(reconciliations, 1);
    expect(refreshes, 1);
    expect(find.text('Your BVN check is complete.'), findsOneWidget);

    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(reconciliations, 1);
    expect(refreshes, 2);
  });
}

KycService _service(_RecoveryAdapter adapter) {
  return KycService(
    apiClient: ApiClient(
      dio: Dio(BaseOptions(baseUrl: 'https://kyc.example.test'))
        ..httpClientAdapter = adapter,
    ),
  );
}

KycOverview _overview({
  String providerStatus = 'PENDING',
  PaystackKycRecovery? recovery,
  List<KycDocumentSummary> documents = const [],
}) {
  return KycOverview(
    status: 'PENDING',
    tier: 'TIER_0',
    provider: 'Paystack',
    providerValidationStatus: providerStatus,
    reference: 'paystack-original-reference',
    failureReason: '',
    verificationUri: null,
    updatedAt: null,
    documents: documents,
    recovery: recovery,
  );
}

PaystackKycRecovery _recovery(String state) {
  return PaystackKycRecovery(
    state: state,
    message: 'Provider review is taking longer than expected.',
    supportReference: 'KYC-bvn-document',
    pendingSince: DateTime.parse('2026-10-31T08:00:00Z'),
    checkedAt: null,
    retryAllowed: false,
  );
}

Map<String, dynamic> _jsonRecovery(String state) => {
      'state': state,
      'message': 'Provider review is taking longer than expected.',
      'supportReference': 'KYC-bvn-document',
      'pendingSince': '2026-10-31T08:00:00Z',
      'checkedAt': null,
      'retryAllowed': false,
    };

class _RecoveryAdapter implements HttpClientAdapter {
  _RecoveryAdapter(this.responses, {this.timeoutFirstReconcile = false});

  final List<Map<String, dynamic>> responses;
  final bool timeoutFirstReconcile;
  final reconcileRequests = <RequestOptions>[];
  var _reconcileCount = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path == '/api/kyc/paystack/reconcile') {
      reconcileRequests.add(options);
      _reconcileCount++;
      if (timeoutFirstReconcile && _reconcileCount == 1) {
        throw DioException(
          requestOptions: options,
          type: DioExceptionType.receiveTimeout,
        );
      }
      final payload = responses.removeAt(0);
      return _json(payload);
    }
    if (options.path == '/api/kyc/status') {
      return _json({
        'provider': 'PAYSTACK',
        'kycStatus': 'PENDING',
        'kycTier': 'TIER_0',
        'providerValidationStatus': 'PENDING',
        'reference': 'paystack-original-reference',
        'recovery': _jsonRecovery(PaystackKycRecovery.awaitingProvider),
        'documents': [
          {
            'type': 'BVN',
            'status': 'PENDING',
            'recovery': _jsonRecovery(PaystackKycRecovery.awaitingProvider),
          },
        ],
      });
    }
    throw DioException(
      requestOptions: options,
      message: 'Unexpected test endpoint ${options.path}',
    );
  }

  ResponseBody _json(Object value) => ResponseBody.fromString(
        jsonEncode(value),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );

  @override
  void close({bool force = false}) {}
}

class _ManualNinRecoveryService extends KycService {
  int reconciliations = 0;
  final overview = const KycOverview(
      status: 'SUBMITTED',
      tier: 'TIER_0',
      provider: 'MANUAL_REVIEW',
      providerValidationStatus: 'PENDING',
      reference: 'nin-ref',
      failureReason: '',
      verificationUri: null,
      updatedAt: null,
      documents: [
        KycDocumentSummary(type: 'NIN', status: 'SUBMITTED', updatedAt: null),
        KycDocumentSummary(type: 'BVN', status: 'SUBMITTED', updatedAt: null)
      ]);
  @override
  Future<KycOverview> fetchOverview(
          {bool includeIdentityProfile = false}) async =>
      overview;
  @override
  Future<PaystackKycRecovery> reconcilePaystack() async {
    reconciliations++;
    return _recovery(PaystackKycRecovery.awaitingProvider);
  }
}
