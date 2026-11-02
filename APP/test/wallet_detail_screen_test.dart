import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/state/wallet_refresh_signal.dart';
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
    expect(find.text('Transaction History'), findsOneWidget);
    await tester.drag(
      find.byType(CustomScrollView),
      const Offset(0, -500),
    );
    await tester.pumpAndSettle();
    expect(find.text('Wallet Deposit'), findsWidgets);
    expect(find.text('Virtual Account — Active'), findsOneWidget);

    await tester.drag(
      find.byType(CustomScrollView),
      const Offset(0, 500),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Receive Money'));
    await tester.pumpAndSettle();

    expect(find.text('Receive Money'), findsWidgets);
    await tester.drag(
      find.byType(CustomScrollView),
      const Offset(0, -500),
    );
    await tester.pumpAndSettle();
    expect(find.text('Recent Deposits'), findsOneWidget);
  });

  testWidgets('receive money focuses on account request before provisioning',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      includeDeposits: true,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: ReceiveMoneyScreen(
          walletService: bundle.walletService,
          homeDataService: bundle.homeDataService,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Create TrustPay account'), findsOneWidget);
    expect(find.text('Recent Deposits'), findsNothing);
    expect(find.text('No deposits yet'), findsNothing);
    final previousTick = walletRefreshSignal.tick;
    await tester.tap(find.text('Create TrustPay account'));
    await tester.pumpAndSettle();
    expect(walletRefreshSignal.tick, previousTick);
    expect(find.byType(DashboardDetailScreen), findsOneWidget);
    await tester.ensureVisible(find.text('Create receiving account'));
    await tester.tap(find.text('Create receiving account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Authorize setup'));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Create TrustPay account'), findsNothing);
    expect(find.text('Copy account number'), findsOneWidget);
    expect(find.text('0123456789'), findsOneWidget);
  });

  testWidgets('virtual account entry creates an account after explicit consent',
      (tester) async {
    final bundle = buildTrustPayTestBundle(includeVirtualAccounts: false);
    await tester.pumpWidget(MaterialApp(
      home: DashboardDetailScreen(
        kind: DashboardDetailKind.virtualAccount,
        homeDataService: bundle.homeDataService,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Create receiving account'), findsOneWidget);
    await tester.ensureVisible(find.text('Create receiving account'));
    await tester.tap(find.text('Create receiving account'));
    await tester.pumpAndSettle();
    expect(
        bundle.adapter.requestedUris
            .where((uri) => uri.path == '/api/banking/accounts/provision'),
        isEmpty);
    await tester.tap(find.text('Authorize setup'));
    await tester.pumpAndSettle();
    expect(find.text('Copy account number'), findsOneWidget);
    expect(find.text('Create receiving account'), findsNothing);
  });

  testWidgets('returning from KYC reloads masked receiving account details',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    bundle.adapter.revealAccountNumbers = false;
    await tester.pumpWidget(MaterialApp.router(
        routerConfig: GoRouter(
      initialLocation: AppRoutes.receiveMoney,
      routes: [
        GoRoute(
            path: AppRoutes.receiveMoney,
            builder: (_, __) => ReceiveMoneyScreen(
                  walletService: bundle.walletService,
                  homeDataService: bundle.homeDataService,
                )),
        GoRoute(
            path: AppRoutes.kyc,
            builder: (context, _) => Scaffold(
                  body: FilledButton(
                      onPressed: () {
                        bundle.adapter.revealAccountNumbers = true;
                        context.pop();
                      },
                      child: const Text('Finish verification')),
                )),
      ],
    )));
    await tester.pumpAndSettle();
    expect(find.text('Copy account number'), findsNothing);
    await tester.tap(find.text('Complete KYC'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Finish verification'));
    await tester.pumpAndSettle();
    expect(find.text('Copy account number'), findsOneWidget);
  });

  testWidgets('unverified users get a KYC action instead of account creation',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      kycStatus: 'PENDING',
    );
    await tester.pumpWidget(MaterialApp(
      home: DashboardDetailScreen(
        kind: DashboardDetailKind.virtualAccount,
        homeDataService: bundle.homeDataService,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Verify identity'), findsOneWidget);
    expect(find.text('Create receiving account'), findsNothing);
  });
}
