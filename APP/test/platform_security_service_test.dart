import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/platform_security_service.dart';

void main() {
  test('unconfigured platform security status stays fail-safe and explicit',
      () async {
    const service = UnconfiguredPlatformSecurityService();

    final status = await service.getStatus();

    expect(status.hasProductionCertificatePinning, isFalse);
    expect(status.supportsDeviceIntegritySignals, isFalse);
    expect(status.deviceIntegrityRisk, DeviceIntegrityRisk.unavailable);
    expect(status.summary, contains('Pending platform adapter wiring'));
  });
}
