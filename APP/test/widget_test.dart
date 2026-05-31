import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/main.dart';

void main() {
  testWidgets('TrustPay app renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: TrustPayApp(),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();

    expect(find.byType(TrustPayApp), findsOneWidget);
  });
}
