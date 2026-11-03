import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/features/home/widgets/vtu_phone.dart';
import 'package:trustpay_app/features/home/widgets/vtu_purchase_widgets.dart';
import 'package:trustpay_app/services/vtu_service.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';
import 'support/trustpay_test_api.dart';

const _networks = ['mtn', 'airtel', 'glo', '9mobile'];
const _names = ['MTN', 'Airtel', 'Glo', '9mobile'];
List<Map<String, dynamic>> _providers(String type) => [
      for (var i = 0; i < 4; i++)
        {'id': _networks[i], 'name': _names[i], 'type': type, 'isActive': true},
      {
        'id': type == 'airtime' ? 'smile-airtime' : 'smile',
        'name': 'Smile',
        'type': type,
        'isActive': true
      },
      if (type == 'airtime')
        {
          'id': 'foreign-airtime',
          'name': 'International Airtime',
          'type': type,
          'isActive': true
        },
    ];
List<Map<String, dynamic>> _plans(String provider) => [
      {
        'id': '$provider-day',
        'name': '1GB Everyday Plan',
        'price': '350.00',
        'validity': '1 day'
      },
      {
        'id': '$provider-week',
        'name': '2GB Weekly Plan',
        'price': '1000.00',
        'validity': '7 days'
      },
      {
        'id': '$provider-month',
        'name': '5GB Monthly Plan',
        'price': '2500.00',
        'validity': '30 days'
      },
      {
        'id': '$provider-social',
        'name': '1GB Social Bundle · WhatsApp & Instagram only',
        'price': '250.00',
        'validity': '7 days'
      },
      for (var i = 6; i < 10; i++)
        {
          'id': '$provider-$i',
          'name': '${i}GB Monthly Plan',
          'price': '${i * 500}.00',
          'validity': '30 days'
        },
    ];

Finder _phone([String label = 'Phone number']) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label);

Future<TrustPayTestBundle> _render(WidgetTester tester, MoneyActionKind kind,
    {Size size = const Size(390, 844),
    bool dark = false,
    double textScale = 1,
    GlobalKey? capture,
    TransactionSecurityService? security,
    void Function(RequestOptions, RequestInterceptorHandler)? requests,
    void Function(RequestOptions, RequestInterceptorHandler)? packages}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
  setMockSecureStorage();
  final bundle = buildTrustPayTestBundle();
  bundle.dio.interceptors
      .add(InterceptorsWrapper(onRequest: (options, handler) {
    if (options.path == '/api/vtu/providers') {
      final type = '${options.queryParameters['type']}';
      handler.resolve(Response(
          requestOptions: options,
          data: type == 'airtime' || type == 'data'
              ? _providers(type)
              : type == 'cable'
                  ? [
                      {
                        'id': 'dstv',
                        'name': 'DStv',
                        'type': type,
                        'isActive': true
                      }
                    ]
                  : [
                      {
                        'id': 'ikeja-electric',
                        'name': 'Ikeja Electric',
                        'type': type,
                        'isActive': true
                      }
                    ]));
    } else if (options.path == '/api/vtu/packages') {
      if (packages != null) {
        packages(options, handler);
        return;
      }
      handler.resolve(Response(
          requestOptions: options,
          data: _plans('${options.queryParameters['provider']}')));
    } else if (requests != null) {
      requests(options, handler);
    } else {
      handler.next(options);
    }
  }));
  await tester.pumpWidget(RepaintBoundary(
      key: capture,
      child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: dark ? AppTheme.dark : AppTheme.light,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!),
          home: MoneyActionScreen(
              kind: kind,
              apiClient: bundle.apiClient,
              transactionSecurityService: security))));
  if (packages == null) {
    await tester.pumpAndSettle();
  } else {
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }
  return bundle;
}

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  if (!const bool.fromEnvironment('VTU_CAPTURE')) return;
  // Asset I/O must complete outside the test clock; then pump its image events.
  await tester
      .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 750)));
  await tester.pumpAndSettle();
  await tester
      .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final picture = await boundary.toImage(pixelRatio: 2);
    final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/vtu-ui/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    picture.dispose();
  });
}

void main() {
  testWidgets(
      'airtime approval checks PIN only with the purchase and never writes an app PIN',
      (tester) async {
    final security = _VtuTestSecurity();
    var standaloneChecks = 0, purchases = 0;
    await _render(tester, MoneyActionKind.airtime, security: security,
        requests: (options, handler) {
      if (options.path == '/api/auth/transaction-pin/verify') {
        standaloneChecks++;
      }
      if (options.path == '/api/vtu/purchase') {
        purchases++;
        expect(options.data['transactionPin'], '2468');
        handler.resolve(Response(requestOptions: options, data: {
          'status': 'SUCCESS',
          'reference': 'VTU-BOUNDARY',
          'orderId': 'boundary-order',
          'amount': '500.00',
          'currency': 'NGN'
        }));
      } else {
        handler.next(options);
      }
    });
    await tester.enterText(_phone(), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('₦500'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy airtime'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(purchases, 1);
    expect(standaloneChecks, 0);
    expect(security.saves, 0);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'corrected airtime PIN starts a new attempt after a cached pre-mutation rejection',
      (tester) async {
    final rejectedKeys = <String>{};
    final keys = <String>[];
    var purchases = 0;
    await _render(tester, MoneyActionKind.airtime, security: _VtuTestSecurity(),
        requests: (options, handler) {
      if (options.path != '/api/vtu/purchase') {
        handler.next(options);
        return;
      }
      final key = '${options.headers['Idempotency-Key']}';
      keys.add(key);
      if (rejectedKeys.contains(key) ||
          options.data['transactionPin'] != '2468') {
        rejectedKeys.add(key);
        handler.reject(DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(
                requestOptions: options,
                statusCode: 403,
                data: {'message': 'Invalid transaction PIN'})));
        return;
      }
      purchases++;
      handler.resolve(Response(requestOptions: options, data: {
        'status': 'SUCCESS',
        'reference': 'VTU-CORRECTED',
        'orderId': 'corrected-order',
        'amount': '500.00',
        'currency': 'NGN'
      }));
    });
    await tester.enterText(_phone(), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('₦500'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy airtime'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    for (final digit in ['1', '3', '5', '7']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(purchases, 0);
    final retry = find.widgetWithText(OutlinedButton, 'Retry');
    await tester.ensureVisible(retry);
    await tester.tap(retry);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(purchases, 1);
    expect(keys.toSet(), hasLength(2));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('VTU_CAPTURE')) return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });
  test(
      'normalizes Nigerian phone formats and leaves unknown networks for manual choice',
      () {
    for (final phone in [
      '08031234567',
      '+234 803 123 4567',
      '2348031234567',
      '(0803) 123-4567'
    ]) {
      expect(VtuPhone.normalize(phone), '08031234567');
      expect(VtuPhone.suggest(phone), 'mtn');
    }
    expect(VtuPhone.suggest('09121234567'), 'airtel');
    expect(VtuPhone.suggest('09151234567'), 'glo');
    expect(VtuPhone.suggest('08091234567'), '9mobile');
    expect(VtuPhone.suggest('08011234567'), isNull);
    for (final invalid in [
      '0803',
      '+233241234567',
      'abc08031234567',
      '080312345678'
    ]) {
      expect(VtuPhone.isValid(invalid), isFalse);
      expect(VtuPhone.suggest(invalid), isNull);
    }
  });

  testWidgets(
      'expanded catalogs keep network logos visible and specialist services reachable',
      (tester) async {
    await _render(tester, MoneyActionKind.airtime);
    for (final name in _names) {
      expect(find.bySemanticsLabel('$name network'), findsOneWidget);
    }
    expect(find.byType(VtuProviderLogo), findsNWidgets(4));
    await tester.ensureVisible(find.text('More services'));
    await tester.tap(find.text('More services'));
    await tester.pumpAndSettle();
    expect(find.text('Smile'), findsOneWidget);
    await tester.tap(find.text('International Airtime'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Service country'), findsOneWidget);
  });

  testWidgets(
      'manual override survives formatting and reaches the amount screen',
      (tester) async {
    await _render(tester, MoneyActionKind.airtime);
    await tester.enterText(_phone(), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Airtel network'));
    await tester.pumpAndSettle();
    await tester.enterText(_phone(), '+2348031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(find.text('Airtel'), findsOneWidget);
    expect(find.text('08031234567'), findsOneWidget);
  });

  testWidgets(
      'returning from specialist services preserves the recipient network',
      (tester) async {
    await _render(tester, MoneyActionKind.airtime);
    await tester.enterText(_phone(), '08021234567');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('More services'));
    await tester.tap(find.text('More services'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Smile'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(find.text('08021234567'), findsOneWidget);
    expect(find.text('Airtel'), findsOneWidget);
  });

  testWidgets(
      'data separates recipient, plan, and payment with retained details',
      (tester) async {
    final key = GlobalKey();
    await _render(tester, MoneyActionKind.data, capture: key);
    expect(find.byType(VtuPlanPicker), findsNothing);
    expect(find.text('Continue to plans'), findsOneWidget);
    await tester.enterText(_phone('Recipient phone number'), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to plans'));
    await tester.pumpAndSettle();
    expect(_phone('Recipient phone number'), findsNothing);
    expect(find.byType(VtuPlanPicker), findsOneWidget);
    await _capture(tester, key, 'data-plan-page');
    await tester.tap(find.text('1GB Everyday Plan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to payment'));
    await tester.pumpAndSettle();
    expect(find.byType(VtuPlanPicker), findsNothing);
    expect(find.text('Buy data'), findsOneWidget);
    expect(find.text('08031234567'), findsOneWidget);
    await tester.tap(find.byTooltip('Service country'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nigeria'));
    await tester.pumpAndSettle();
    expect(find.text('Buy data'), findsOneWidget);
    expect(find.text('08031234567'), findsOneWidget);
    await _capture(tester, key, 'data-payment-page');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(VtuPlanPicker), findsOneWidget);
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(_phone('Recipient phone number'))
            .controller!
            .text,
        '08031234567');
  });

  testWidgets('airtime amount page preserves input when navigating back',
      (tester) async {
    final key = GlobalKey();
    await _render(tester, MoneyActionKind.airtime, capture: key);
    await tester.enterText(_phone(), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(_phone(), findsNothing);
    final amount = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Amount');
    await tester.enterText(amount, '750');
    await tester.pumpAndSettle();
    await _capture(tester, key, 'airtime-amount-page');
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    expect(amount, findsNothing);
    expect(tester.widget<TextField>(_phone()).controller!.text, '08031234567');
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(amount).controller!.text, '750');
  });

  testWidgets('changing data network clears the previous plan', (tester) async {
    await _render(tester, MoneyActionKind.data);
    await tester.enterText(_phone('Recipient phone number'), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to plans'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('1GB Everyday Plan'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Airtel network'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to plans'));
    await tester.pumpAndSettle();
    final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Continue to payment'));
    expect(button.onPressed, isNull);
    expect(find.text('Airtel'), findsOneWidget);
  });

  for (final status in ['SUCCESS', 'FAILED', 'REVERSED', 'PENDING']) {
    testWidgets('order $status permits a new top-up only after final status',
        (tester) async {
      var purchases = 0;
      await _render(tester, MoneyActionKind.airtime,
          security: _VtuTestSecurity(), requests: (options, handler) {
        if (options.path == '/api/vtu/purchase') {
          purchases++;
          handler.resolve(Response(requestOptions: options, data: {
            'status': 'SUCCESS',
            'reference': 'VTU-TEST',
            'orderId': 'order-test',
            'amount': '500.00',
            'currency': 'NGN',
          }));
        } else if (options.path == '/api/vtu/orders/order-test') {
          handler.resolve(Response(requestOptions: options, data: {
            'orderId': 'order-test',
            'reference': 'VTU-TEST',
            'orderStatus': status,
            'transactionStatus': status,
            'provider': 'mtn',
            'amount': '500.00',
            'currency': 'NGN',
          }));
        } else {
          handler.next(options);
        }
      });
      await tester.enterText(_phone(), '08031234567');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue to amount'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('₦500'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Buy airtime'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      for (final digit in ['2', '4', '6', '8']) {
        await tester.tap(find.text(digit));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(purchases, 1);
      expect(
          tester
              .widget<FilledButton>(
                  find.widgetWithText(FilledButton, 'Buy airtime'))
              .onPressed,
          isNull);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      if (status == 'PENDING') {
        expect(find.text('Start another top-up'), findsNothing);
      } else {
        await tester.tap(find.text('Start another top-up'));
        await tester.pumpAndSettle();
        expect(_phone(), findsOneWidget);
        expect(find.text('Recent VTU order'), findsNothing);
        expect(purchases, 1,
            reason: 'Starting again must never submit a purchase.');
      }
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets('slow old network response cannot replace the current data plans',
      (tester) async {
    RequestOptions? oldOptions;
    RequestInterceptorHandler? oldHandler;
    await _render(tester, MoneyActionKind.data, packages: (options, handler) {
      if (options.queryParameters['provider'] == 'mtn') {
        oldOptions = options;
        oldHandler = handler;
      } else {
        handler.resolve(Response(requestOptions: options, data: [
          {
            'id': 'airtel-only',
            'name': 'Airtel current plan',
            'price': '1000.00',
            'validity': '7 days'
          }
        ]));
      }
    });
    await tester.enterText(_phone('Recipient phone number'), '08021234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to plans'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Airtel current plan'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Airtel current plan'), findsOneWidget);
    oldHandler!.resolve(Response(requestOptions: oldOptions!, data: [
      {
        'id': 'mtn-stale',
        'name': 'Stale MTN plan',
        'price': '200.00',
        'validity': '1 day'
      }
    ]));
    await tester.pumpAndSettle();
    expect(find.text('Stale MTN plan'), findsNothing);
    expect(find.text('Airtel current plan'), findsOneWidget);
    await tester.ensureVisible(find.text('Airtel current plan'));
    await tester.tap(find.text('Airtel current plan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to payment'));
    await tester.pumpAndSettle();
    expect(find.text('08021234567'), findsOneWidget);
    expect(find.text('Buy data'), findsOneWidget);
  });

  testWidgets(
      'plan search distinguishes restricted bundles with the same allowance',
      (tester) async {
    String? selected;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: VtuPlanPicker(
                    value: null,
                    packages:
                        _plans('mtn').map(VtuPackageOption.fromJson).toList(),
                    onChanged: (id) => selected = id)))));
    await tester.enterText(find.byType(TextField), 'social');
    await tester.pumpAndSettle();
    expect(find.text('1GB Everyday Plan'), findsNothing);
    await tester
        .tap(find.text('1GB Social Bundle · WhatsApp & Instagram only'));
    expect(selected, 'mtn-social');
    expect(find.text('₦250'), findsOneWidget);
  });

  for (final size in [
    const Size(320, 740),
    const Size(390, 844),
    const Size(768, 1024)
  ]) {
    for (final dark in [false, true]) {
      testWidgets('VTU layout ${size.width} dark=$dark handles large text',
          (tester) async {
        final key = GlobalKey();
        await _render(tester, MoneyActionKind.airtime,
            size: size,
            dark: dark,
            textScale: size.width == 320 ? 1.5 : 1,
            capture: key);
        await tester.enterText(_phone(), '08031234567');
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('Continue to amount').hitTestable(), findsOneWidget);
        if (size.width == 768) {
          expect(
              tester
                  .getSize(
                      find.widgetWithText(FilledButton, 'Continue to amount'))
                  .width,
              560);
        }
        await _capture(tester, key,
            'airtime-${size.width.toInt()}-${dark ? 'dark' : 'light'}');
      });
    }
  }
  for (final dark in [false, true]) {
    testWidgets('data pages at 320px with large text dark=$dark',
        (tester) async {
      final key = GlobalKey();
      await _render(tester, MoneyActionKind.data,
          size: const Size(320, 740), textScale: 1.5, dark: dark, capture: key);
      await tester.enterText(_phone('Recipient phone number'), '08031234567');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue to plans'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('1GB Everyday Plan'));
      await tester.tap(find.text('1GB Everyday Plan'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Continue to payment').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Continue to payment'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Buy data').hitTestable(), findsOneWidget);
      await _capture(
          tester, key, 'data-payment-320-${dark ? 'dark' : 'light'}');
    });
  }

  for (final kind in [
    MoneyActionKind.data,
    MoneyActionKind.cable,
    MoneyActionKind.electricity
  ]) {
    testWidgets('${kind.name} presents readable service details',
        (tester) async {
      final key = GlobalKey();
      await _render(tester, kind, capture: key);
      if (kind == MoneyActionKind.data) {
        await tester.enterText(_phone('Recipient phone number'), '08031234567');
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull);
      await _capture(tester, key, '${kind.name}-390-light');
      if (kind == MoneyActionKind.data) {
        await tester.tap(find.text('Continue to plans'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(find.text('1GB Everyday Plan'), 200,
            scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await _capture(tester, key, 'data-plans-390-light');
      }
    });
  }

  testWidgets('purchase action stays above the keyboard', (tester) async {
    await _render(tester, MoneyActionKind.airtime);
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();
    expect(tester.getBottomRight(find.text('Continue to amount')).dy,
        lessThan(544));
    expect(tester.takeException(), isNull);
  });
}

class _VtuTestSecurity extends TransactionSecurityService {
  int saves = 0;
  @override
  Future<TransactionSecurityConfig> getConfig() async =>
      const TransactionSecurityConfig(
          hasPin: true,
          pinLength: 4,
          biometricEnabled: false,
          canUseBiometrics: false,
          hasBiometric: false,
          biometricLabel: 'Biometric approval');
  @override
  Future<void> saveVerifiedDevicePin(String pin) async {
    saves++;
  }
}
