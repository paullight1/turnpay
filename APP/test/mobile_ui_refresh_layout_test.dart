import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/exchange/widgets/exchange_introduction.dart';
import 'package:trustpay_app/features/profile/widgets/profile_overview.dart';
import 'package:trustpay_app/features/wallet/widgets/receiving_account_sheet.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'package:trustpay_app/services/wallet_service.dart';

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('UI_REFRESH_CAPTURE')) return;
    final font = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await font.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await font.readAsBytes()))))
          .load();
    }
  });
  for (final variant in [
    (name: 'light', size: const Size(430, 932), dark: false, scale: 1.0),
    (name: 'dark', size: const Size(430, 932), dark: true, scale: 1.0),
    (
      name: 'small-large-text',
      size: const Size(320, 640),
      dark: true,
      scale: 1.6
    ),
    (name: 'desktop', size: const Size(1024, 768), dark: false, scale: 1.0),
  ]) {
    for (final surface in ['exchange', 'profile', 'account']) {
      testWidgets('$surface remains usable on ${variant.name}', (tester) async {
        FlutterSecureStorage.setMockInitialValues({});
        tester.view.physicalSize = variant.size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final key = GlobalKey();
        final content = switch (surface) {
          'exchange' => ExchangeIntroductionGate(
              preference: ExchangeIntroductionPreference(),
              builder: (_) => const Text('Exchange form')),
          'profile' => Scaffold(
              body: SafeArea(
                  child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: ProfileOverview(
                          user: HomeUser.fromJson({
                            'id': 'fixture',
                            'fullName': 'Alex Morgan',
                            'email': 'alex@example.test'
                          }),
                          onLogout: () {})))),
          _ => Navigator(pages: [
              MaterialPage(
                  child: Scaffold(
                      backgroundColor: variant.dark
                          ? const Color(0xFF101116)
                          : const Color(0xFFF6F7FB),
                      body: const SafeArea(
                          child: Padding(
                              padding: EdgeInsets.all(24),
                              child: Text('Your wallets'))))),
              AccountSheetPage(
                  child:
                      ReceivingAccountSheet(walletService: _LayoutAccounts())),
            ], onDidRemovePage: (_) {}),
        };
        await tester.pumpWidget(RepaintBoundary(
            key: key,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.dark ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(variant.scale)),
                  child: child!),
              home: content,
            )));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        if (surface == 'exchange' &&
            const bool.fromEnvironment('UI_REFRESH_CAPTURE')) {
          await tester.runAsync(() async {
            for (final name in ['transfer', 'bills', 'security']) {
              await precacheImage(
                  AssetImage('assets/images/onboarding_$name.jpg'),
                  key.currentContext!);
            }
          });
          await tester.pumpAndSettle();
        }
        if (surface == 'exchange') {
          expect(tester.getRect(find.text('Get started')).bottom,
              lessThan(variant.size.height));
        }
        if (const bool.fromEnvironment('UI_REFRESH_CAPTURE')) {
          await tester.runAsync(() async {
            final boundary = key.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
            final image = await boundary.toImage(pixelRatio: 2);
            final bytes =
                await image.toByteData(format: ui.ImageByteFormat.png);
            final file = File(
                '../output/mobile-ui-refresh/$surface-${variant.name}.png');
            await file.parent.create(recursive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        final action = switch (surface) {
          'exchange' => find.text('Get started'),
          'profile' => find.text('Log Out'),
          _ => find.text('Copy account number'),
        };
        if (surface == 'profile') {
          await tester.scrollUntilVisible(action, 250,
              scrollable: find.byType(Scrollable).first);
        } else {
          await tester.ensureVisible(action);
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
            tester
                .getSize(find
                    .ancestor(
                        of: action,
                        matching: find.bySubtype<ButtonStyleButton>())
                    .first)
                .height,
            greaterThanOrEqualTo(56));
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
}

class _LayoutAccounts extends WalletService {
  @override
  Future<List<VirtualAccountData>> fetchVirtualAccounts() async => const [
        VirtualAccountData(
            provider: 'PAYSTACK',
            accountNumber: '0123456789',
            accountNumberMasked: '******6789',
            accountName: 'Alex Morgan',
            bankName: 'Synthetic Bank',
            currency: 'NGN',
            status: 'ACTIVE')
      ];
}
