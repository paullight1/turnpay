import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/core/widgets/tp_card.dart';
import 'package:trustpay_app/core/widgets/tp_back_button.dart';
import 'package:trustpay_app/core/widgets/tp_page_header.dart';
import 'package:trustpay_app/features/auth/widgets/auth_help_button.dart';
import 'package:trustpay_app/features/auth/widgets/auth_text_field.dart';
import 'package:trustpay_app/features/auth/widgets/tp_button.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('auth help button renders and taps', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AuthHelpButton(
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Get help'), findsOneWidget);

    await tester.tap(find.text('Get help'));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('tp button renders and taps', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TpButton(
            label: 'Continue',
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Continue'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('tp back button renders and taps', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TpBackButton(
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    await tester.tap(find.byIcon(Icons.arrow_back_ios_new_rounded));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('auth text field renders label and hint', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AuthTextField(
            controller: TextEditingController(),
            label: 'Email',
            hint: 'you@example.com',
          ),
        ),
      ),
    );

    expect(find.text('Email'), findsOneWidget);
    expect(find.text('you@example.com'), findsOneWidget);
  });

  testWidgets('tp card and variant render content', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              TpCard(
                child: Text('Standard card'),
              ),
              TpCardVariant(
                child: Text('Variant card'),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Standard card'), findsOneWidget);
    expect(find.text('Variant card'), findsOneWidget);
  });

  testWidgets('tp page header invokes the menu callback', (tester) async {
    var menuTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TpPageHeader(
            label: 'Header',
            showBackButton: false,
            onMenu: () => menuTapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Header'), findsOneWidget);

    await tester.tap(find.byTooltip('Menu'));
    await tester.pump();

    expect(menuTapped, isTrue);
  });

  testWidgets('page menu opens the published WhatsApp support chat',
      (tester) async {
    final launches = <MethodCall>[];
    const channel = MethodChannel('plugins.flutter.io/url_launcher');
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel,
        (call) async {
      launches.add(call);
      return true;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null));
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
          body: TpPageHeader(label: 'Exchange', showBackButton: false)),
    ));
    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Contact support'));
    await tester.pumpAndSettle();
    final launch = launches.singleWhere((call) => call.method == 'launch');
    final url = Uri.parse((launch.arguments as Map)['url'] as String);
    expect(url.scheme, 'https');
    expect(url.host, 'wa.me');
    expect(url.path, '/233555507240');
    expect(url.queryParameters['text'], 'Hello TrustPay, I need help.');
  });

  testWidgets('tp app header renders its label and back callback',
      (tester) async {
    var backTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TpAppHeader(
            label: 'Receive Money',
            onBack: () => backTapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Receive Money'), findsOneWidget);

    await tester.tap(find.byTooltip('Back'));
    await tester.pump();

    expect(backTapped, isTrue);
  });

  testWidgets('shared page headers consume the status inset once',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(430, 932);
    const cutout = FakeViewPadding(top: 32, left: 44, right: 44);
    tester.view.viewPadding = cutout;
    tester.view.padding = cutout;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetViewPadding);
    addTearDown(tester.view.resetPadding);

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: TpPageHeader(label: 'Exchange', showBackButton: false),
      ),
    ));
    await tester.pumpAndSettle();

    final menu = tester.getRect(find.byTooltip('Menu'));
    expect(menu.left, greaterThanOrEqualTo(44));
    expect(menu.right, lessThanOrEqualTo(430 - 44));
    expect(
        tester.getTopLeft(find.text('Exchange')).dy, greaterThanOrEqualTo(32));
    final orangeSurface = tester.widget<ColoredBox>(
      find
          .ancestor(
            of: find.text('Exchange'),
            matching: find.byType(ColoredBox),
          )
          .first,
    );
    expect(orangeSurface.color, AppColors.primary);
    final region = tester.widget<AnnotatedRegion<SystemUiOverlayStyle>>(
      find.byType(AnnotatedRegion<SystemUiOverlayStyle>),
    );
    expect(region.value.statusBarIconBrightness, Brightness.light);
    expect(region.value.systemStatusBarContrastEnforced, isFalse);
    expect(region.value.systemNavigationBarContrastEnforced, isFalse);

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: SafeArea(
          child: TpPageHeader(label: 'Exchange', showBackButton: false),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final nestedMenu = tester.getRect(find.byTooltip('Menu'));
    expect(nestedMenu.left, greaterThanOrEqualTo(44));
    expect(nestedMenu.right, lessThanOrEqualTo(430 - 44));

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: CustomScrollView(
          slivers: [
            SliverList(
              delegate: SliverChildListDelegate.fixed(
                [
                  TpPageHeader(label: 'Exchange', showBackButton: false),
                ],
              ),
            ),
          ],
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Menu'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        appBar: TpAppHeader(label: 'Receive Money'),
        body: SizedBox.shrink(),
      ),
    ));
    await tester.pumpAndSettle();
    expect(
      tester.getTopLeft(find.text('Receive Money')).dy,
      greaterThanOrEqualTo(32),
    );
    expect(tester.takeException(), isNull);
  });
}
