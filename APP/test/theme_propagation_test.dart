import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/core/widgets/tp_card.dart';

void main() {
  test('small helper text remains readable on both theme surfaces', () {
    for (final brightness in Brightness.values) {
      AppColors.applyBrightness(brightness);
      for (final surface in [
        AppColors.background,
        AppColors.surface,
        AppColors.surfaceVariant,
        AppColors.inputFill
      ]) {
        final a = AppColors.textHint.computeLuminance();
        final b = surface.computeLuminance();
        final ratio = ((a > b ? a : b) + 0.05) / ((a < b ? a : b) + 0.05);
        expect(ratio, greaterThanOrEqualTo(4.5));
      }
    }
    AppColors.applyBrightness(Brightness.light);
  });
  testWidgets('an open form follows appearance changes without losing input',
      (tester) async {
    const form = Scaffold(body: TpCard(child: TextField()));
    Widget app(ThemeMode mode) => MaterialApp(
          theme: ThemeData.light(),
          darkTheme: ThemeData.dark(),
          themeMode: mode,
          home: form,
        );
    Color? cardColor() => (tester
            .widget<Container>(find
                .descendant(
                    of: find.byType(TpCard), matching: find.byType(Container))
                .first)
            .decoration as BoxDecoration)
        .color;

    await tester.pumpWidget(app(ThemeMode.light));
    final light = cardColor();
    await tester.enterText(find.byType(TextField), 'Unsaved recipient');
    await tester.pumpWidget(app(ThemeMode.dark));
    await tester.pumpAndSettle();
    expect(cardColor(), isNot(light));
    expect(AppColors.isDark, isTrue);
    expect(find.text('Unsaved recipient'), findsOneWidget);
    await tester.pumpWidget(app(ThemeMode.light));
    await tester.pumpAndSettle();
    expect(cardColor(), light);
    expect(find.text('Unsaved recipient'), findsOneWidget);
  });
}
