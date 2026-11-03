import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/widgets/startup_gate.dart';

void main() {
  testWidgets('startup renders safely when opened on a deep link',
      (tester) async {
    tester.binding.platformDispatcher.defaultRouteNameTestValue = '/home';
    addTearDown(
        tester.binding.platformDispatcher.clearDefaultRouteNameTestValue);
    final initialized = Completer<void>();
    await tester.pumpWidget(StartupGate(
      initialize: () => initialized.future,
      builder: (_) => const Directionality(
        textDirection: TextDirection.ltr,
        child: Text('Application ready'),
      ),
    ));
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Starting TrustPay'), findsOneWidget);
    initialized.complete();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Application ready'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

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
