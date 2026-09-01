import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/wallet/screens/receive_money_screen.dart';
import 'package:trustpay_app/features/wallet/screens/wallet_detail_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('wallet detail renders balance and opens receive money',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.walletDetailFor('NGN'),
          routes: [
            GoRoute(
              path: AppRoutes.walletDetail,
              builder: (context, state) => WalletDetailScreen(
                currency: state.pathParameters['currency'] ?? 'NGN',
                walletService: bundle.walletService,
              ),
            ),
            GoRoute(
              path: AppRoutes.receiveMoney,
              builder: (context, state) => ReceiveMoneyScreen(
                walletService: bundle.walletService,
                homeDataService: bundle.homeDataService,
              ),
            ),
            GoRoute(
              path: AppRoutes.activity,
              builder: (context, state) => DashboardDetailScreen(
                kind: DashboardDetailKind.activity,
                homeDataService: bundle.homeDataService,
              ),
            ),
            GoRoute(
              path: AppRoutes.send,
              builder: (context, state) => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('NGN Wallet'), findsWidgets);
    expect(find.text('Send Money'), findsOneWidget);
    expect(find.text('Receive Money'), findsOneWidget);

    final walletScroll = find.descendant(
      of: find.byType(CustomScrollView).first,
      matching: find.byType(Scrollable),
    ).first;
    await tester.scrollUntilVisible(
      find.text('Virtual Account — Active'),
      300,
      scrollable: walletScroll,
    );
    expect(find.text('Virtual Account — Active'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Transaction History'),
      300,
      scrollable: walletScroll,
    );
    expect(find.text('Transaction History'), findsOneWidget);

    await tester.drag(walletScroll, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.text('Wallet Deposit'), findsWidgets);

    await tester.scrollUntilVisible(
      find.text('Receive Money'),
      -300,
      scrollable: walletScroll,
    );
    await tester.tap(find.text('Receive Money'));
    await tester.pumpAndSettle();

    expect(find.text('Receive Money'), findsWidgets);

    await tester.scrollUntilVisible(
      find.text('Recent Deposits'),
      300,
      scrollable: find.descendant(
        of: find.byType(CustomScrollView).first,
        matching: find.byType(Scrollable),
      ).first,
    );
    expect(find.text('Recent Deposits'), findsOneWidget);
  });
}
