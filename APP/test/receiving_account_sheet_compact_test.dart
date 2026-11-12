import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/features/wallet/widgets/receiving_account_sheet.dart';

import 'support/trustpay_test_api.dart';

void main() {
  for (final size in [
    const Size(320, 640),
    const Size(390, 844),
    const Size(1024, 768)
  ]) {
    testWidgets('account details fit without scrolling at $size',
        (tester) async {
      setMockSecureStorage(refreshToken: 'fixture-refresh');
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bundle = buildTrustPayTestBundle();
      final router = GoRouter(initialLocation: '/account', routes: [
        GoRoute(path: '/', builder: (_, __) => const Scaffold()),
        GoRoute(
            path: '/account',
            pageBuilder: (_, state) => AccountSheetPage(
                  key: state.pageKey,
                  child: ReceivingAccountSheet(
                      walletService: bundle.walletService),
                )),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      expect(find.text('Account number'), findsOneWidget);
      expect(find.text('Account name'), findsOneWidget);
      expect(find.textContaining('Use this account to fund'), findsNothing);
      expect(find.text('View deposits & account status'), findsNothing);
      final sheet = find.byType(ReceivingAccountSheet);
      for (final scroll in tester.stateList<ScrollableState>(
          find.descendant(of: sheet, matching: find.byType(Scrollable)))) {
        expect(scroll.position.maxScrollExtent, 0);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
