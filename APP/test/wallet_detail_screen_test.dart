import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/state/wallet_refresh_signal.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/wallet/screens/receive_money_screen.dart';
import 'package:trustpay_app/features/wallet/screens/virtual_account_screen.dart';
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

  testWidgets('verified setup retry reveals the account with one click',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
    );
    await tester.pumpWidget(MaterialApp(
      home: ReceiveMoneyScreen(
        walletService: bundle.walletService,
        homeDataService: bundle.homeDataService,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Try account setup again'));
    await tester.pumpAndSettle();

    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/banking/accounts/provision'),
      hasLength(1),
    );
    expect(find.text('Copy account number'), findsOneWidget);
    expect(find.text('Authorize setup'), findsNothing);
    expect(find.text('Receiving account'), findsNothing);
  });

  testWidgets('account setup retry cannot submit twice while preparing',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
    );
    final release = Completer<void>();
    var calls = 0;
    bundle.dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        if (options.path == '/api/banking/accounts/provision') {
          calls++;
          await release.future;
        }
        handler.next(options);
      },
    ));
    await tester.pumpWidget(MaterialApp(
      home: ReceiveMoneyScreen(
        walletService: bundle.walletService,
        homeDataService: bundle.homeDataService,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Try account setup again'));
    await tester.pump();
    final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Preparing account…'));
    expect(button.onPressed, isNull);
    await tester.tap(find.text('Preparing account…'));
    await tester.pump();
    release.complete();
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Copy account number'), findsOneWidget);
  });

  testWidgets('uncertain account setup retry keeps its original attempt key',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
    );
    final keys = <String>[];
    bundle.dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.path == '/api/banking/accounts/provision') {
          keys.add(options.headers['Idempotency-Key'] as String);
          if (keys.length == 1) {
            handler.reject(DioException(
              requestOptions: options,
              type: DioExceptionType.connectionTimeout,
            ));
            return;
          }
        }
        handler.next(options);
      },
    ));
    await tester.pumpWidget(MaterialApp(
      home: ReceiveMoneyScreen(
        walletService: bundle.walletService,
        homeDataService: bundle.homeDataService,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Try account setup again'));
    await tester.pumpAndSettle();
    expect(find.text('Copy account number'), findsNothing);
    expect(
        find.text(
            'Could not confirm your account setup. Refresh status or try again.'),
        findsOneWidget);
    await tester.tap(find.text('Try account setup again'));
    await tester.pumpAndSettle();
    expect(keys, hasLength(2));
    expect(keys.first, isNotEmpty);
    expect(keys.last, keys.first);
    expect(find.text('Copy account number'), findsOneWidget);
  });

  testWidgets('verified account setup failure has one safe retry path',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
      virtualAccountProvisioningMessage:
          'Paystack account setup needs attention. Contact support before retrying.',
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

    expect(find.text("We couldn't finish setting up your account"),
        findsOneWidget);
    expect(
      find.text(
          'Your BVN is verified. Try account setup again. If it still doesn’t work, contact support.'),
      findsOneWidget,
    );
    expect(
      find.text(
          'Paystack account setup needs attention. Contact support before retrying.'),
      findsNothing,
    );
    expect(find.text('Verify identity'), findsNothing);
    expect(find.text('Try account setup again'), findsOneWidget);

    final setupBundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
      virtualAccountProvisioningMessage:
          'Paystack account setup needs attention. Contact support before retrying.',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: ProfileActionScreen(
          kind: ProfileActionKind.account,
          homeDataService: setupBundle.homeDataService,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text("We couldn't finish setting up your account"),
        findsOneWidget);
    expect(
      find.text(
          'Try account setup again. If it still doesn’t work, contact support.'),
      findsOneWidget,
    );
    expect(
      find.text(
          'Paystack account setup needs attention. Contact support before retrying.'),
      findsNothing,
    );
    expect(
        find.text('Request now. We’ll create it after identity verification.'),
        findsNothing);
    expect(find.text('Verify identity'), findsNothing);
    expect(find.text('Retry account setup'), findsOneWidget);
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

  testWidgets(
      'unverified users can request setup while identity verification waits',
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
    expect(find.text('Request receiving account'), findsOneWidget);
    await tester.ensureVisible(find.text('Request receiving account'));
    await tester.tap(find.text('Request receiving account'));
    await tester.pumpAndSettle();
    expect(find.text('Authorize setup'), findsOneWidget);
    await tester.tap(find.text('Authorize setup'));
    await tester.pumpAndSettle();
    expect(find.text('Account request saved'), findsOneWidget);
    expect(find.text('Verify identity'), findsOneWidget);
    expect(
        bundle.adapter.requestedUris
            .where((u) => u.path == '/api/banking/accounts/provision'),
        isEmpty);
    expect(find.text('Copy account number'), findsNothing);
  });
  testWidgets('pending BVN still offers a separate account setup request',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
        includeVirtualAccounts: false, kycStatus: 'SUBMITTED');
    await tester.pumpWidget(MaterialApp(
        home: DashboardDetailScreen(
            kind: DashboardDetailKind.virtualAccount,
            homeDataService: bundle.homeDataService)));
    await tester.pumpAndSettle();
    expect(find.text('Your identity check is under review'), findsOneWidget);
    expect(find.text('Request receiving account'), findsOneWidget);
    expect(find.text('Request received. Checking for your account details.'),
        findsNothing);
    await tester.ensureVisible(find.text('Request receiving account'));
    await tester.tap(find.text('Request receiving account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(
        bundle.adapter.requestedUris
            .where((u) => u.path == '/api/banking/accounts/setup-request'),
        isEmpty);
  });

  testWidgets('receive money restores a saved pre-KYC setup request',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
        includeVirtualAccounts: false, kycStatus: 'PENDING');
    await tester.runAsync(() => bundle.homeDataService
        .requestAccountSetup(idempotencyKey: 'test-request-1'));
    await tester.pumpWidget(MaterialApp(
        home: ReceiveMoneyScreen(
            walletService: bundle.walletService,
            homeDataService: bundle.homeDataService)));
    await tester.pumpAndSettle();
    expect(find.text('Account request saved'), findsOneWidget);
    expect(find.text('Create TrustPay account'), findsNothing);
    expect(find.text('View account setup'), findsOneWidget);
    expect(find.text('Copy account number'), findsNothing);
  });

  testWidgets(
      'verified saved setup offers continuation without re-verification',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      includeVirtualAccounts: false,
      kycStatus: 'VERIFIED',
      virtualAccountProvisioningStatus: 'WAITING_FOR_KYC',
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
    expect(find.text('Continue setup'), findsOneWidget);
    expect(
      find.text(
          'Request saved. Continue setup to finish creating your account.'),
      findsOneWidget,
    );
    expect(
      find.text(
          'Your setup request is saved. We’ll create your NGN account after your identity is verified.'),
      findsNothing,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: VirtualAccountScreen(service: bundle.homeDataService),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Account request saved'), findsOneWidget);
    expect(
      find.text(
          'Request saved. Continue setup to finish creating your account.'),
      findsOneWidget,
    );
    expect(find.text('Continue setup'), findsOneWidget);
    expect(find.text('Verify identity'), findsNothing);
  });
}
