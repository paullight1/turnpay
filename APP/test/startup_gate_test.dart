import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/widgets/startup_gate.dart';

void main() {
  testWidgets(
      'startup failure shows safe retry and keeps application content gated',
      (tester) async {
    var attempts = 0;
    await tester.pumpWidget(StartupGate(
        initialize: () async {
          if (++attempts == 1) {
            throw StateError('private initialization details');
          }
        },
        builder: (_) => const MaterialApp(home: Text('Application ready'))));
    await tester.pumpAndSettle();
    expect(find.text('Unable to start TrustPay'), findsOneWidget);
    expect(find.textContaining('private initialization'), findsNothing);
    expect(find.text('Application ready'), findsNothing);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Application ready'), findsOneWidget);
    expect(attempts, 2);
  });
}
