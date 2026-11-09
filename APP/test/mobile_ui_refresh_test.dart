import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/exchange/widgets/exchange_introduction.dart';
import 'package:trustpay_app/features/wallet/widgets/receiving_account_sheet.dart';
import 'package:trustpay_app/services/wallet_service.dart';

void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets(
      'exchange first entry explains receiving details before opening the form',
      (tester) async {
    final preference = ExchangeIntroductionPreference();
    var formBuilds = 0;
    Widget app({bool pending = false}) => MaterialApp(
          theme: AppTheme.light,
          home: ExchangeIntroductionGate(
            preference: preference,
            resumePending: pending,
            builder: (_) {
              formBuilds++;
              return const Scaffold(body: Text('Exchange form'));
            },
          ),
        );
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    expect(find.text('Your receiving account'), findsOneWidget);
    expect(formBuilds, 0);
    await tester.ensureVisible(find.text('Get started'));
    await tester.tap(find.text('Get started'));
    await tester.pumpAndSettle();
    expect(find.text('Exchange form'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    expect(find.text('Get started'), findsNothing);
    expect(find.text('Exchange form'), findsOneWidget);
  });

  testWidgets(
      'pending exchange bypasses the welcome screen without acknowledging it',
      (tester) async {
    final preference = ExchangeIntroductionPreference();
    await tester.pumpWidget(MaterialApp(
        home: ExchangeIntroductionGate(
      preference: preference,
      resumePending: true,
      builder: (_) => const Text('Resume original attempt'),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Resume original attempt'), findsOneWidget);
    expect(await preference.hasStarted(), isFalse);
  });

  testWidgets(
      'account sheet shows and copies only an active NGN Paystack account',
      (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home:
            Scaffold(body: ReceivingAccountSheet(walletService: _Accounts()))));
    await tester.pumpAndSettle();
    expect(find.text('0123456789'), findsOneWidget);
    expect(find.text('Synthetic Bank'), findsOneWidget);
    expect(find.text('Account holder'), findsOneWidget);
    expect(find.textContaining('For currency exchange'), findsOneWidget);
    final copyIcon = find.byTooltip('Copy account number');
    await tester.ensureVisible(copyIcon);
    await tester.tap(copyIcon);
    await tester.pumpAndSettle();
    expect(copied, '0123456789');
    expect(find.text('Account number copied'), findsOneWidget);
  });

  testWidgets('inactive and legacy accounts never become funding instructions',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.dark,
        home: Scaffold(
            body: ReceivingAccountSheet(
                walletService: _Accounts(active: false)))));
    await tester.pumpAndSettle();
    expect(find.text('0123456789'), findsNothing);
    expect(find.byTooltip('Copy account number'), findsNothing);
    expect(find.text('View account setup'), findsOneWidget);
  });

  testWidgets('account read failure provides retry rather than account setup',
      (tester) async {
    final service = _Accounts(failOnce: true);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(body: ReceivingAccountSheet(walletService: service))));
    await tester.pumpAndSettle();
    expect(find.text('View account setup'), findsNothing);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('0123456789'), findsOneWidget);
  });
}

class _Accounts extends WalletService {
  final bool active;
  bool failOnce;
  _Accounts({this.active = true, this.failOnce = false});
  @override
  Future<List<VirtualAccountData>> fetchVirtualAccounts() async {
    if (failOnce) {
      failOnce = false;
      throw StateError('fixture read unavailable');
    }
    return [
      VirtualAccountData(
          provider: active ? 'PAYSTACK' : 'MONNIFY',
          accountNumber: '0123456789',
          accountNumberMasked: '******6789',
          accountName: 'Account holder',
          bankName: 'Synthetic Bank',
          currency: 'NGN',
          status: active ? 'ACTIVE' : 'PENDING')
    ];
  }
}
