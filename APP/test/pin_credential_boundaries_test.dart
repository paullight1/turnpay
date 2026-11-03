import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/security/screens/transaction_security_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  Future<void> enter(WidgetTester tester, String pin) async {
    for (final digit in pin.split('')) {
      await tester.ensureVisible(find.text(digit));
      await tester.pumpAndSettle();
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
  }

  testWidgets(
      'creating a transaction PIN does not replace an existing app-unlock PIN',
      (tester) async {
    final device = _DevicePin(), server = _ServerPin();
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                body: TextButton(
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => TransactionPinScreen.create(
                                securityService: device, authService: server))),
                    child: const Text('Open setup'))))));
    await tester.tap(find.text('Open setup'));
    await tester.pumpAndSettle();
    await enter(tester, '2468');
    await enter(tester, '2468');
    expect(server.pin, '2468');
    expect(device.pin, '1357');
    expect(find.text('Open setup'), findsOneWidget);
  });

  testWidgets(
      'checking an existing transaction PIN does not replace the app-unlock PIN',
      (tester) async {
    final device = _DevicePin(), server = _ServerPin();
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                body: TextButton(
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => TransactionPinScreen.verify(
                                pinLength: 4,
                                title: 'Check transaction PIN',
                                subtitle: 'Confirm your payment PIN.',
                                securityService: device,
                                authService: server))),
                    child: const Text('Open check'))))));
    await tester.tap(find.text('Open check'));
    await tester.pumpAndSettle();
    await enter(tester, '2468');
    expect(device.pin, '1357');
    expect(server.verifications, 1);
  });

  testWidgets('changing the transaction PIN preserves the app-unlock PIN',
      (tester) async {
    final device = _DevicePin(), server = _ServerPin();
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                body: TextButton(
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => TransactionPinScreen.reset(
                                pinLength: 4,
                                securityService: device,
                                authService: server))),
                    child: const Text('Open change'))))));
    await tester.tap(find.text('Open change'));
    await tester.pumpAndSettle();
    await enter(tester, '2468');
    await enter(tester, '8642');
    await enter(tester, '8642');
    expect(server.pin, '8642');
    expect(device.pin, '1357');
  });
}

class _DevicePin extends TransactionSecurityService {
  String pin = '1357';
  @override
  Future<void> savePin(String value, {required int pinLength}) async {
    pin = value;
  }

  @override
  Future<void> saveVerifiedDevicePin(String value) async {
    pin = value;
  }
}

class _ServerPin extends AuthService {
  String? pin;
  int verifications = 0;
  @override
  Future<void> setTransactionPin(String value) async {
    pin = value;
  }

  @override
  Future<void> verifyTransactionPin(String value) async {
    verifications++;
  }

  @override
  Future<void> resetTransactionPin(
      {required String currentPin, required String newPin}) async {
    pin = newPin;
  }
}
