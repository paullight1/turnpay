import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/security/screens/transaction_security_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

class _FakeSecurityService extends TransactionSecurityService {
  @override
  Future<TransactionSecurityConfig> getConfig() async {
    return const TransactionSecurityConfig(
      hasPin: false,
      pinLength: 4,
      biometricEnabled: false,
      canUseBiometrics: false,
      hasBiometric: false,
      biometricLabel: 'Fingerprint',
    );
  }
}

class _FakeAuthService extends AuthService {
  @override
  Future<TransactionPinServerStatus> getTransactionPinStatus() async {
    return const TransactionPinServerStatus(
      configured: false,
      pinLength: null,
      resetHoldUntil: null,
      locked: false,
    );
  }
}

void main() {
  testWidgets(
    'Create PIN is enabled and independent from disabled biometrics',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: TransactionSecurityScreen(
            securityService: _FakeSecurityService(),
            authService: _FakeAuthService(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.bySemanticsLabel('Create PIN'),
        findsOneWidget,
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('Create PIN')),
        matchesSemantics(
          label: 'Create PIN',
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          hasTapAction: true,
        ),
      );
      expect(
        tester.getSemantics(
          find.bySemanticsLabel('Fingerprint app unlock'),
        ),
        matchesSemantics(
          label: 'Fingerprint app unlock',
          value: 'Unavailable',
          hasEnabledState: true,
          isEnabled: false,
          hasToggledState: true,
          isToggled: false,
        ),
      );
    },
  );

  testWidgets('security controls remain usable at large text scale', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: TransactionSecurityScreen(
            securityService: _FakeSecurityService(),
            authService: _FakeAuthService(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.bySemanticsLabel('Create PIN'), findsOneWidget);
  });

  testWidgets('transaction PIN entry keeps biometric action unavailable',
      (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(
      MaterialApp(
        home: TransactionPinScreen.verify(
          pinLength: 4,
          title: 'Enter your transaction PIN',
          subtitle: 'Approve this money action before submission.',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.fingerprint_rounded), findsNothing);
    expect(find.byIcon(Icons.face_retouching_natural_rounded), findsNothing);
    expect(find.text('Approve this money action before submission.'),
        findsOneWidget);
  });
}
