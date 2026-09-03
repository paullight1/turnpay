import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/vtu_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('uses body DTOs and explicit idempotency keys for VTU mutations',
      () async {
    FlutterSecureStorage.setMockInitialValues({});
    final adapter = _VtuAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://mockserver'))
      ..httpClientAdapter = adapter;
    final service = VtuService(apiClient: ApiClient(dio: dio));

    final customer = await service.validateMeter(
      provider: 'ikedc',
      meterNumber: '45028701',
      meterType: 'postpaid',
      contactPhone: '+2348012345678',
      idempotencyKey: 'validate-key',
    );
    final receipt = await service.purchase(
      data: {
        'type': 'electricity',
        'provider': 'ikedc',
        'contactPhone': '+2348012345678',
        'meterNumber': '45028701',
        'meterType': 'postpaid',
        'amount': '5000.00',
        'transactionPin': '1234',
      },
      idempotencyKey: 'purchase-key',
    );

    expect(customer.name, 'ADA OBI');
    expect(receipt.purchasedCode, '1234-5678-9012');
    expect(adapter.requests[0].queryParameters, isEmpty);
    expect(adapter.requests[0].data, {
      'provider': 'ikedc',
      'meterNumber': '45028701',
      'meterType': 'postpaid',
      'contactPhone': '+2348012345678',
    });
    expect(adapter.requests[0].headers['Idempotency-Key'], 'validate-key');
    expect(adapter.requests[1].headers['Idempotency-Key'], 'purchase-key');
  });
}

class _VtuAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (options.path.endsWith('/validate/meter')) {
      return _json({'name': 'ADA OBI', 'address': 'Ikeja'});
    }
    return _json({
      'success': true,
      'status': 'SUCCESS',
      'reference': 'VTU-1',
      'orderId': 'order-1',
      'amount': '5000.00',
      'fee': '25.00',
      'totalDebit': '5025.00',
      'purchasedCode': '1234-5678-9012',
    });
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
