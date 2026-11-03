import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/app_pin_kdf.dart';
import 'package:trustpay_app/services/app_pin_kdf_common.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test(
      'app PIN hashing lets the UI event loop continue without reducing hash strength',
      () async {
    final security = TransactionSecurityService();
    var eventLoopRan = false;
    Timer.run(() {
      eventLoopRan = true;
    });
    await security.savePin('2468', pinLength: 4);
    expect(eventLoopRan, isTrue);
    expect(await security.verifyPin('2468'), isTrue);
    expect(await security.verifyPin('1357'), isFalse);
  });

  test('PBKDF2 preserves the existing digest format and work factor', () async {
    expect(await deriveAppPinHash('2468', List.generate(16, (i) => i)),
        'gC1BmzAsNUYZ6viKxnxXeZiDc59GN1m9VfaxZi4k1l0=');
  });

  test(
      'phone screen-lock authentication is available without enrolled biometrics',
      () {
    const config = TransactionSecurityConfig(
        hasPin: false,
        pinLength: 4,
        biometricEnabled: true,
        canUseBiometrics: true,
        hasBiometric: false,
        biometricLabel: 'Phone security');
    expect(config.shouldOfferBiometrics, isTrue);
  });
  test(
      'logout during app PIN hashing cannot restore cleared device credentials',
      () async {
    final security = TransactionSecurityService();
    await security.bindToAuthenticatedUser('first-user');
    final saving = security.savePin('2468', pinLength: 4);
    final clearing = security.clearAllDevicePinState();
    await Future.wait([saving, clearing]);
    expect((await security.getConfig()).hasPin, isFalse);
  });
  test('browser fallback preserves PBKDF2 digest compatibility', () async {
    expect(await deriveAppPinHashYielding('2468', List.generate(16, (i) => i)),
        'gC1BmzAsNUYZ6viKxnxXeZiDc59GN1m9VfaxZi4k1l0=');
  });
  test('saving a new app PIN publishes device security changes', () async {
    final security = TransactionSecurityService();
    var notifications = 0;
    void changed() {
      notifications++;
    }

    TransactionSecurityService.changes.addListener(changed);
    try {
      await security.savePin('2468', pinLength: 4);
      expect(notifications, 1);
    } finally {
      TransactionSecurityService.changes.removeListener(changed);
    }
  });
}
