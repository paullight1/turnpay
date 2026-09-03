import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/auth/widgets/social_auth_button.dart';
import 'package:trustpay_app/features/home/widgets/home_header.dart';
import 'package:trustpay_app/features/home/widgets/quick_actions_row.dart';
import 'package:trustpay_app/features/home/widgets/recent_recipients.dart';
import 'package:trustpay_app/features/home/widgets/recent_transactions_list.dart';
import 'package:trustpay_app/features/home/widgets/wallet_balance_card.dart';
import 'package:trustpay_app/features/home/widgets/wallet_cards_row.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('social auth button renders and taps', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SocialAuthButton(
            label: 'Continue with Google',
            icon: Icons.g_mobiledata_rounded,
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Continue with Google'), findsOneWidget);

    await tester.tap(find.text('Continue with Google'));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('home header renders greeting and badge', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HomeHeader(
            notificationCount: 3,
            userName: 'Ada',
          ),
        ),
      ),
    );

    expect(find.text('Welcome Back!'), findsOneWidget);
    expect(find.text('Hi, Ada.'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('wallet balance card toggles visibility', (tester) async {
    var visible = true;

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: StatefulBuilder(
            builder: (context, setState) {
              return Scaffold(
                body: WalletBalanceCard(
                  balanceGHS: 17298.92,
                  visible: visible,
                  onToggleVisibility: () => setState(() => visible = !visible),
                ),
              );
            },
          ),
        ),
      ),
    );

    expect(find.textContaining('GH'), findsWidgets);
    expect(find.text('GH₵ ••••••'), findsNothing);

    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pump();

    expect(find.text('GH₵ ••••••'), findsOneWidget);
  });

  testWidgets('quick actions and wallet cards render demo content',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: Column(
              children: [
                QuickActionsRow(),
                SizedBox(height: 16),
                WalletCardsRow(),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.text('Send'), findsOneWidget);
    expect(find.text('Exchange'), findsOneWidget);
    expect(find.text('Wallets'), findsOneWidget);
    expect(find.textContaining('GHS'), findsWidgets);
    expect(find.textContaining('NGN'), findsWidgets);
  });

  testWidgets('recent recipients and transactions render live data',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: ListView(
              padding: EdgeInsets.zero,
              children: [
                RecentRecipients(homeDataService: bundle.homeDataService),
                const SizedBox(height: 24),
                RecentTransactionsList(
                  homeDataService: bundle.homeDataService,
                ),
              ],
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Recipients'), findsOneWidget);
    expect(find.textContaining('First Bank'), findsOneWidget);
    expect(find.text('Recent transactions'), findsOneWidget);
    expect(find.text('Fund'), findsWidgets);
    expect(find.text('DEP-001'), findsOneWidget);
    expect(find.text('See all'), findsOneWidget);
  });
}
