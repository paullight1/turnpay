import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/widgets/keyboard_visibility_guard.dart';

void main() {
  testWidgets('scrolls focused input above keyboard after viewport shrinks',
      (tester) async {
    final focus = FocusNode();
    addTearDown(focus.dispose);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpWidget(MaterialApp(
        home: KeyboardVisibilityGuard(
      child: Scaffold(
          body: ListView(children: [
        const SizedBox(height: 450),
        TextField(focusNode: focus),
        const SizedBox(height: 600),
      ])),
    )));
    focus.requestFocus();
    tester.view.viewInsets =
        FakeViewPadding(bottom: 250 * tester.view.devicePixelRatio);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pumpAndSettle();
    final rect = tester.getRect(find.byType(TextField));
    expect(rect.top, greaterThanOrEqualTo(0));
    expect(rect.bottom, lessThanOrEqualTo(350));
    await tester.pumpWidget(const SizedBox());
  });
}
