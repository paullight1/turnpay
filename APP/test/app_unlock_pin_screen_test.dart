import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/security/screens/app_unlock_pin_screen.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

class _Device extends TransactionSecurityService {
  String pin = '1357';
  int saves = 0;
  @override
  Future<PinVerificationResult> verifyPinWithLockout(String value) async =>
      value == pin
          ? const PinVerificationResult.approved()
          : const PinVerificationResult.rejected(failedAttempts: 1);
  @override
  Future<void> savePin(String value, {required int pinLength}) async {
    pin = value;
    saves++;
  }
}

Future<void> enter(WidgetTester tester, String pin) async {
  for (final digit in pin.split('')) {
    final key = find.text(digit);
    await tester.ensureVisible(key);
    await tester.tap(key);
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets(
      'app PIN change requires existing app PIN and saves only new device PIN',
      (tester) async {
    final device = _Device();
    await tester.pumpWidget(MaterialApp(
        home: AppUnlockPinScreen(
            securityService: device,
            config: const TransactionSecurityConfig(
                hasPin: true,
                pinLength: 4,
                biometricEnabled: false,
                canUseBiometrics: false,
                hasBiometric: false,
                biometricLabel: 'Phone security'))));
    await enter(tester, '2468');
    expect(device.saves, 0);
    expect(find.text('Incorrect app-unlock PIN. Try again.'), findsOneWidget);
    await enter(tester, '1357');
    await enter(tester, '864208');
    await enter(tester, '864208');
    expect(device.saves, 1);
    expect(device.pin, '864208');
  });
}
