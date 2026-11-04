import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/core/widgets/tp_receipt.dart';
import 'package:trustpay_app/features/home/screens/transfer_receipt_screen.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('incoming receipt identifies the sender by the saved name', () {
    final receipt = TransferReceiptData.fromJson({
      'reference': 'TRF-NAMED',
      'direction': 'IN',
      'status': 'SUCCESS',
      'amount': '50.00',
      'currency': 'NGN',
      'counterparty': {
        'displayName': 'Ada Okoli',
        'maskedIdentifier': 'a***@example.com'
      },
    });
    expect(receipt.counterparty, 'Ada Okoli');
    expect(receipt.direction, 'IN');
  });

  test('parses the POST receipt with exact money and masked recipient data',
      () {
    final receipt = TransferReceiptData.fromJson({
      'reference': 'TRF-001',
      'status': 'SUCCESS',
      'amount': '25.50',
      'currency': 'ngn',
      'senderTransactionReference': 'TRF-001-OUT',
      'senderBalanceAfter': '974.50',
      'recipient': {
        'maskedIdentifier': 't***@example.com',
        'avatarInitials': 'TA',
        'identifier': 'taylor@example.com',
      },
      'createdAt': '2026-09-01T12:00:00.000Z',
    });

    expect(receipt.amount.decimalString, '25.50');
    expect(receipt.amount.currency, 'NGN');
    expect(receipt.fee.decimalString, '0.00');
    expect(receipt.transactionReference, 'TRF-001-OUT');
    expect(receipt.direction, 'OUT');
    expect(receipt.counterparty, 't***@example.com');
    expect(receipt.avatarInitials, 'TA');
    expect(receipt.counterparty, isNot(contains('taylor@example.com')));
  });

  test('rejects malformed money, unsafe amounts, fees, and currencies', () {
    final base = <String, dynamic>{
      'reference': 'TRF-002',
      'status': 'SUCCESS',
      'amount': '25.501',
      'currency': 'NGN',
    };

    expect(
      () => TransferReceiptData.fromJson(base),
      throwsFormatException,
    );
    expect(
      () => TransferReceiptData.fromJson(
          {...base, 'amount': '25.50', 'currency': 'USD'}),
      throwsFormatException,
    );
    expect(
      () => TransferReceiptData.fromJson(
          {...base, 'amount': '0.00', 'currency': 'NGN'}),
      throwsFormatException,
    );
    expect(
      () => TransferReceiptData.fromJson({
        ...base,
        'amount': '25.50',
        'currency': 'NGN',
        'fee': '-0.01',
      }),
      throwsFormatException,
    );
    expect(
      () => TransferReceiptData.fromJson({
        ...base,
        'amount': '25.50',
        'currency': null,
      }),
      throwsFormatException,
    );
  });

  test('rejects a receipt that does not match the requested reference', () {
    expect(
      () => TransferReceiptData.fromJson(
        {
          'reference': 'TRF-OTHER',
          'status': 'SUCCESS',
          'amount': '1.00',
          'currency': 'NGN',
        },
        referenceFallback: 'TRF-REQUESTED',
      ),
      throwsFormatException,
    );
  });

  test('accepts a requested transaction-reference alias', () {
    final receipt = TransferReceiptData.fromJson(
      {
        'reference': 'TRF-ALIAS',
        'transactionReference': 'TRF-ALIAS-OUT',
        'status': 'SUCCESS',
        'amount': '1.00',
        'currency': 'NGN',
      },
      referenceFallback: 'TRF-ALIAS-OUT',
    );

    expect(receipt.reference, 'TRF-ALIAS');
    expect(receipt.transactionReference, 'TRF-ALIAS-OUT');
  });

  test('does not invent success and defaults an unknown direction to OUT', () {
    final receipt = TransferReceiptData.fromJson({
      'reference': 'TRF-003',
      'amount': '1.00',
      'currency': 'GHS',
      'direction': 'SIDEWAYS',
    });

    expect(receipt.status, 'UNKNOWN');
    expect(receipt.direction, 'OUT');
    expect(receipt.isSuccessful, isFalse);
  });

  test('completed reversal overrides the original success display state', () {
    final receipt = TransferReceiptData.fromJson({
      'reference': 'TRF-REV-001',
      'status': 'SUCCESS',
      'amount': '25.50',
      'currency': 'NGN',
      'direction': 'OUT',
      'reversalStatus': 'completed',
      'reversalReference': 'ITR-001',
    });

    // Preserve the original transaction status as returned by the API while
    // deriving the user-facing outcome from the completed reversal.
    expect(receipt.status, 'SUCCESS');
    expect(receipt.reversalStatus, 'COMPLETED');
    expect(receipt.isReversed, isTrue);
    expect(receipt.isSuccessful, isFalse);
    expect(receipt.displayStatus, 'REVERSED');
    expect(receipt.tone, TpReceiptTone.failed);
  });

  test('only completed reversal status overrides a successful transfer', () {
    for (final reversalStatus in [
      'PENDING_APPROVAL',
      'BLOCKED',
      'REJECTED',
    ]) {
      final receipt = TransferReceiptData.fromJson({
        'reference': 'TRF-REV-$reversalStatus',
        'status': 'SUCCESS',
        'amount': '25.50',
        'currency': 'NGN',
        'direction': 'OUT',
        'reversalStatus': reversalStatus,
      });

      expect(receipt.isReversed, isFalse, reason: reversalStatus);
      expect(receipt.isSuccessful, isTrue, reason: reversalStatus);
      expect(receipt.displayStatus, 'SUCCESS', reason: reversalStatus);
      expect(receipt.tone, TpReceiptTone.success, reason: reversalStatus);
    }
  });

  testWidgets('renders a completed reversal instead of Money sent',
      (tester) async {
    await tester.pumpWidget(_themed(
      const TransferReceiptScreen(
        reference: 'TRF-REV-002',
        initialReceipt: {
          'reference': 'TRF-REV-002',
          'status': 'SUCCESS',
          'amount': '12500.50',
          'currency': 'NGN',
          'direction': 'OUT',
          'reversalStatus': 'COMPLETED',
          'reversalReference': 'ITR-002',
        },
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Transfer reversed'), findsOneWidget);
    expect(find.text('REVERSED'), findsWidgets);
    expect(find.text('₦12,500.50'), findsWidgets);
    expect(find.text('Money sent'), findsNothing);
    expect(
        find.text('This transfer was reversed. No second transfer was sent.'),
        findsOneWidget);
  });

  testWidgets('shows Money sent but never exposes the sender balance',
      (tester) async {
    final api = _ReceiptApiClient([
      const _ReceiptResponse.data({
        'reference': 'TRF-004',
        'transactionReference': 'TRF-004-OUT',
        'type': 'INTERNAL_TRANSFER',
        'direction': 'OUT',
        'status': 'SUCCESS',
        'amount': '25.50',
        'currency': 'NGN',
        'fee': '0.00',
        'counterparty': {
          'maskedIdentifier': 't***@example.com',
        },
        'createdAt': '2026-09-01T12:00:00.000Z',
      }),
    ]);

    await tester.pumpWidget(_themed(TransferReceiptScreen(
      reference: 'TRF-004',
      apiClient: api,
      initialReceipt: const {
        'reference': 'TRF-004',
        'status': 'SUCCESS',
        'amount': '25.50',
        'currency': 'NGN',
        'senderBalanceAfter': '974.50',
        'recipient': {'maskedIdentifier': 't***@example.com'},
      },
    )));
    await tester.pumpAndSettle();

    expect(find.text('Transfer receipt'), findsWidgets);
    expect(find.text('Money sent'), findsOneWidget);
    expect(find.text('Sent'), findsOneWidget);
    expect(find.text('₦25.50'), findsWidgets);
    expect(find.textContaining('25.50'), findsWidgets);
    expect(find.text('t***@example.com'), findsWidgets);
    expect(find.text('974.50'), findsNothing);
    expect(find.text('taylor@example.com'), findsNothing);
  });

  testWidgets('GET refresh replaces the initial status with authoritative data',
      (tester) async {
    final api = _ReceiptApiClient([
      const _ReceiptResponse.data({
        'reference': 'TRF-005',
        'transactionReference': 'TRF-005-OUT',
        'direction': 'OUT',
        'status': 'PENDING',
        'amount': '10.00',
        'currency': 'NGN',
        'fee': '0.00',
        'counterparty': {'maskedIdentifier': 'r***@example.com'},
        'createdAt': '2026-09-01T12:00:00.000Z',
      }),
    ]);

    await tester.pumpWidget(_themed(
      TransferReceiptScreen(
        reference: 'TRF-005',
        apiClient: api,
        initialReceipt: const {
          'reference': 'TRF-005',
          'status': 'SUCCESS',
          'amount': '10.00',
          'currency': 'NGN',
          'recipient': {'maskedIdentifier': 'r***@example.com'},
        },
      ),
    ));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Money sent'), findsOneWidget);

    await tester.tap(find.byTooltip('Refresh'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));

    expect(find.text('Money sent'), findsNothing);
    expect(find.text('PENDING'), findsWidgets);
    expect(api.requestedPaths, contains('/api/transfers/internal/TRF-005'));
  });

  testWidgets('receipt remains readable at 320px and 150% text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(1.5),
          ),
          child: child!,
        ),
        home: const TransferReceiptScreen(
          reference: 'TRF-007',
          initialReceipt: {
            'reference': 'TRF-007',
            'status': 'SUCCESS',
            'amount': '999999.99',
            'currency': 'NGN',
            'recipient': {'maskedIdentifier': 'l***@example.com'},
            'createdAt': '2026-09-01T12:00:00.000Z',
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Money sent'), findsOneWidget);
    expect(find.text('Copy reference'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('refresh outage preserves the last receipt and status',
      (tester) async {
    final api = _ReceiptApiClient([
      const _ReceiptResponse.error(),
    ]);

    await tester.pumpWidget(_themed(
      TransferReceiptScreen(
        reference: 'TRF-008',
        apiClient: api,
        initialReceipt: const {
          'reference': 'TRF-008',
          'status': 'SUCCESS',
          'amount': '3.00',
          'currency': 'NGN',
          'recipient': {'maskedIdentifier': 'o***@example.com'},
        },
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));

    expect(find.text('Money sent'), findsOneWidget);
    expect(find.text('Latest status unavailable'), findsOneWidget);
  });

  testWidgets(
      'a failed initial fetch exposes retry and renders no fake receipt',
      (tester) async {
    final api = _ReceiptApiClient([
      const _ReceiptResponse.error(),
      const _ReceiptResponse.data({
        'reference': 'TRF-006',
        'status': 'FAILED',
        'amount': '4.00',
        'currency': 'NGN',
        'fee': '0.00',
        'counterparty': {'maskedIdentifier': 'f***@example.com'},
      }),
    ]);

    await tester.pumpWidget(_themed(
      TransferReceiptScreen(reference: 'TRF-006', apiClient: api),
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));

    expect(find.text('Could not load this receipt'), findsOneWidget);
    expect(find.text('Money sent'), findsNothing);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('FAILED'), findsWidgets);
    expect(find.text('Money sent'), findsNothing);
  });
}

Widget _themed(Widget child) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light,
    home: child,
  );
}

class _ReceiptApiClient extends ApiClient {
  _ReceiptApiClient(List<_ReceiptResponse> responses)
      : _adapter = _ReceiptAdapter(responses),
        super(
          dio: Dio(BaseOptions(baseUrl: _ReceiptAdapter.baseUrl)),
        ) {
    client.httpClientAdapter = _adapter;
  }

  final _ReceiptAdapter _adapter;

  List<String> get requestedPaths => _adapter.requestedPaths;
}

class _ReceiptResponse {
  const _ReceiptResponse.data(this.data) : error = false;
  const _ReceiptResponse.error()
      : data = const <String, dynamic>{},
        error = true;

  final Map<String, dynamic> data;
  final bool error;
}

class _ReceiptAdapter implements HttpClientAdapter {
  static const baseUrl = 'https://receipt.test';

  _ReceiptAdapter(this.responses);

  final List<_ReceiptResponse> responses;
  final List<String> requestedPaths = [];
  var _index = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requestedPaths.add(options.uri.path);
    final response = _index < responses.length
        ? responses[_index++]
        : const _ReceiptResponse.error();
    if (response.error) {
      return ResponseBody.fromString(
        jsonEncode({'message': 'receipt unavailable'}),
        503,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    return ResponseBody.fromString(
      jsonEncode(response.data),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
