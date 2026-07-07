import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/core/widgets/app_lock_gate.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('app lock gate requires a PIN to unlock the app',
      (tester) async {
    // The lock overlay is a full-height portrait screen; the default 800x600
    // test surface clips the PIN keypad off-screen. Use a phone-sized surface
    // so the digit keys are hittable.
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric approval',
      ),
      approvedPin: '2468',
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: AppLockGate(
            securityService: securityService,
            child: const Scaffold(
              body: Center(child: Text('Protected content')),
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Unlock TRUSTPAY'), findsOneWidget);
    expect(find.text('Enter your transaction PIN to continue.'), findsOneWidget);

    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }

    await tester.pumpAndSettle();

    expect(find.text('Unlock TRUSTPAY'), findsNothing);
    expect(find.text('Enter your transaction PIN to continue.'), findsNothing);
  });

  testWidgets('app lock gate stays open when no pin is saved',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: false,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric approval',
      ),
      approvedPin: '2468',
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: AppLockGate(
            securityService: securityService,
            child: const Scaffold(
              body: Center(child: Text('Protected content')),
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Unlock TRUSTPAY'), findsNothing);
    expect(find.text('Enter your transaction PIN to continue.'),
        findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });
}

void _usePhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

class _FakeAppLockSecurityService extends TransactionSecurityService {
  final TransactionSecurityConfig config;
  final String approvedPin;

  _FakeAppLockSecurityService({
    required this.config,
    required this.approvedPin,
  });

  @override
  Future<TransactionSecurityConfig> getConfig() async => config;

  @override
  Future<PinVerificationResult> verifyPinWithLockout(String pin) async {
    if (pin == approvedPin) {
      return const PinVerificationResult.approved();
    }

    return const PinVerificationResult.rejected(
      failedAttempts: 1,
    );
  }

  @override
  Future<bool> authenticateBiometric({
    required String reason,
  }) async {
    return false;
  }
}
