import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/auth/widgets/tp_button.dart';

void main() {
  testWidgets('auth action exposes a button role and keyboard activation',
      (tester) async {
    final semantics = tester.ensureSemantics();
    var activations = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
          body: TpButton(label: 'Continue', onTap: () => activations++)),
    ));
    final node = tester.getSemantics(find.text('Continue'));
    expect(node.getSemanticsData().flagsCollection.isButton, isTrue);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(activations, 1);
    semantics.dispose();
  });

  testWidgets('loading preserves the action name and prevents submission',
      (tester) async {
    final semantics = tester.ensureSemantics();
    var activations = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: TpButton(
      label: 'Create account',
      isLoading: true,
      onTap: () => activations++,
    ))));
    expect(find.bySemanticsLabel('Create account, loading'), findsOneWidget);
    await tester.tap(find.byType(TpButton));
    await tester.pump();
    expect(activations, 0);
    semantics.dispose();
  });

  testWidgets('auth action expands for large text without clipping',
      (tester) async {
    tester.view.physicalSize = const Size(280, 400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(3)),
      child: Scaffold(body: TpButton(label: 'Create account', onTap: () {})),
    )));
    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byType(TpButton)).height, greaterThan(56));
  });
}
