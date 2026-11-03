import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'package:trustpay_app/services/home_data_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => setMockSecureStorage(refreshToken: 'refresh-token'));

  Future<_DepositService> service() async => _DepositService(
      await buildTrustPayTestBundle().homeDataService.fetchDashboard());

  testWidgets('pulling down with a mouse refreshes the wallet on web',
      (tester) async {
    final api = (await tester.runAsync(service))!;
    await tester
        .pumpWidget(MaterialApp(home: HomeScreen(homeDataService: api)));
    await tester.pumpAndSettle();
    api.balance = '125500.50';
    await tester.drag(find.byType(ListView).first, const Offset(0, 450),
        kind: PointerDeviceKind.mouse);
    await tester.pumpAndSettle();
    expect(find.text('125,500.50'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'a confirmed deposit updates the visible balance without a gesture',
      (tester) async {
    final api = (await tester.runAsync(service))!;
    await tester
        .pumpWidget(MaterialApp(home: HomeScreen(homeDataService: api)));
    await tester.pumpAndSettle();
    expect(find.text('125,000.50'), findsOneWidget);
    api.balance = '125500.50';
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(find.text('125,500.50'), findsOneWidget);
    expect(find.text('125,000.50'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'background polling pauses and returning to the app refreshes immediately',
      (tester) async {
    final api = (await tester.runAsync(service))!;
    await tester
        .pumpWidget(MaterialApp(home: HomeScreen(homeDataService: api)));
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    final before = api.polls;
    api.balance = '125500.50';
    await tester.pump(const Duration(seconds: 12));
    expect(api.polls, before);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('125,500.50'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'an unavailable balance poll keeps the last confirmed balance visible',
      (tester) async {
    final api = (await tester.runAsync(service))!;
    await tester
        .pumpWidget(MaterialApp(home: HomeScreen(homeDataService: api)));
    await tester.pumpAndSettle();
    api.failPoll = true;
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(api.polls, greaterThan(0));
    expect(find.text('125,000.50'), findsOneWidget);
    expect(find.byType(RefreshIndicator), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}

class _DepositService extends HomeDataService {
  final HomeDashboardData original;
  String balance = '125000.50';
  int polls = 0;
  bool failPoll = false;
  _DepositService(this.original);

  List<HomeWallet> get wallets => original.wallets
      .map((w) => w.currency == 'NGN'
          ? HomeWallet.fromJson(
              {'id': w.id, 'currency': 'NGN', 'balance': balance})
          : w)
      .toList();

  @override
  Future<List<HomeWallet>> fetchWalletBalances() async {
    polls++;
    if (failPoll) throw StateError('Temporary outage');
    return wallets;
  }

  @override
  Future<HomeDashboardData> fetchDashboard() async => HomeDashboardData(
      user: original.user,
      wallets: wallets,
      transactions: original.transactions,
      virtualAccounts: original.virtualAccounts,
      beneficiaries: original.beneficiaries);
}
