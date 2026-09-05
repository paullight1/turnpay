import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/device_integrity_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('trustpay/device_integrity');
  const service = DeviceIntegrityService(enforced: true);
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, null));
  test(
      'risky, missing and unexpected platform signals cannot approve a payment',
      () async {
    for (final signal in ['risky', 'unavailable', 'unexpected', null]) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => signal);
      await expectLater(
          service.requireForRequest('POST', '/api/exchange/manual-orders'),
          throwsStateError);
      await service.requireForRequest(
          'GET', '/api/exchange/manual-orders/order');
      await service.requireForRequest('POST', '/api/support/tickets');
    }
  });
  test(
      'a clear signal allows a request to continue to ordinary server authorization',
      () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => 'clear');
    await service.requireForRequest('POST', '/api/transfers/internal');
  });
  test('platform errors fail closed', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            channel, (_) async => throw PlatformException(code: 'unavailable'));
    expect(await service.check(), DeviceIntegritySignal.unavailable);
  });
}
