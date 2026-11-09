import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/home/widgets/vtu_order_detail_view.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/vtu_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  testWidgets('unknown and pending stay unresolved and hide raw metadata',
      (tester) async {
    await _pumpView(
      tester,
      order: _order(orderStatus: 'UNKNOWN', transactionStatus: 'PENDING'),
    );

    expect(find.text('Still confirming your payment'), findsOneWidget);
    expect(find.textContaining('Don’t repeat this purchase'), findsOneWidget);
    expect(find.text('UNKNOWN'), findsNothing);
    expect(find.text('PENDING'), findsNothing);
    expect(find.text('VTU-EXAMPLE-REFERENCE'), findsNothing);
    expect(find.text('Order-123'), findsNothing);
    expect(find.text('Check status'), findsOneWidget);

    await tester.tap(find.text('Payment references'));
    await tester.pumpAndSettle();
    expect(find.text('VTU-EXAMPLE-REFERENCE'), findsOneWidget);
    expect(find.text('Order-123'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a terminal/provider conflict remains checkable', (tester) async {
    var checks = 0;
    await _pumpView(
      tester,
      order: _order(orderStatus: 'SUCCESS', transactionStatus: 'PENDING'),
      onCheck: () => checks++,
    );

    expect(find.text('Still confirming your payment'), findsOneWidget);
    expect(find.text('Payment confirmed'), findsNothing);
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Check status'),
    );
    expect(button.onPressed, isNotNull);
    await tester.tap(find.widgetWithText(FilledButton, 'Check status'));
    expect(checks, 1);
  });

  testWidgets(
      'exhausted provider checks open support instead of a futile requery',
      (tester) async {
    var checks = 0, support = 0;
    final order = VtuOrderStatus.fromJson({
      'orderId': 'Order-123',
      'reference': 'VTU-EXAMPLE-REFERENCE',
      'orderStatus': 'UNKNOWN',
      'transactionStatus': 'PENDING',
      'provider': 'VTPASS',
      'amount': '500.00',
      'currency': 'NGN',
      'targetMasked': '+234 *** 23',
      'actionRequired': true,
      'customerAction':
          'Keep this reference and contact support. Do not start a replacement purchase while the provider result is unresolved.',
    });
    await _pumpView(tester,
        order: order, onCheck: () => checks++, onSupport: () => support++);
    expect(find.text('Support review needed'), findsOneWidget);
    expect(find.text('Check status'), findsNothing);
    await tester.ensureVisible(find.text('Contact support'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Contact support'));
    expect(support, 1);
    expect(checks, 0);
  });

  testWidgets('checking state disables the primary action', (tester) async {
    var checks = 0;
    await _pumpView(
      tester,
      order: _order(orderStatus: 'UNKNOWN', transactionStatus: 'PENDING'),
      isChecking: true,
      onCheck: () => checks++,
    );

    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Checking…'),
    );
    expect(button.onPressed, isNull);
    expect(find.text('Checking payment status…'), findsOneWidget);
    expect(find.text('Still confirming your payment'), findsNothing);
    expect(checks, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('last known details remain visible after a requery error',
      (tester) async {
    final response = Completer<VtuOrderStatus>();
    final service = _FakeVtuService(
      initial: _order(orderStatus: 'UNKNOWN', transactionStatus: 'PENDING'),
      requery: () => response.future,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: VtuOrderDetailScreen(
          reference: 'VTU-EXAMPLE-REFERENCE',
          vtuService: service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Still confirming your payment'), findsOneWidget);

    final checkButton = find.widgetWithText(FilledButton, 'Check status');
    await tester.scrollUntilVisible(
      checkButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(checkButton);
    await tester.pumpAndSettle();
    await tester.tap(checkButton);
    await tester.pump();
    expect(find.text('Checking payment status…'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Checking…'),
          )
          .onPressed,
      isNull,
    );

    response.completeError(Exception('temporary network failure'));
    await tester.pumpAndSettle();

    expect(find.text('Still confirming your payment'), findsOneWidget);
    expect(find.text('VTU-EXAMPLE-REFERENCE'), findsNothing);
    expect(find.textContaining('Unable to refresh VTU order status'),
        findsOneWidget);
    expect(find.text('Retry status check'), findsOneWidget);
    expect(service.requeryCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('receipt refresh retains details and blocks duplicate reads',
      (tester) async {
    final response = Completer<VtuOrderStatus>();
    final service = _FakeVtuService(
      initial: _order(orderStatus: 'PENDING', transactionStatus: 'PENDING'),
      requery: () => response.future,
    );
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: VtuOrderDetailScreen(
            reference: 'VTU-EXAMPLE-REFERENCE', vtuService: service)));
    await tester.pumpAndSettle();
    service.readOverride = () => response.future;
    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Refresh'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Checking payment status…'), findsOneWidget);
    expect(find.text('Payment summary'), findsOneWidget);
    expect(service.readCalls, 2);
    response.complete(service.initial);
    await tester.pumpAndSettle();
    expect(find.text('Still confirming your payment'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final theme in <ThemeData>[AppTheme.light, AppTheme.dark]) {
    testWidgets('renders at 320px with large text in ${theme.brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(320, 760);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpView(
        tester,
        theme: theme,
        textScaler: const TextScaler.linear(2),
        order: _order(orderStatus: 'UNKNOWN', transactionStatus: 'PENDING'),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('Still confirming your payment'), findsOneWidget);
      expect(find.text('Check status'), findsOneWidget);
    });
  }
}

Future<void> _pumpView(
  WidgetTester tester, {
  required VtuOrderStatus order,
  ThemeData? theme,
  TextScaler? textScaler,
  bool isChecking = false,
  VoidCallback? onCheck,
  VoidCallback? onSupport,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: theme ?? AppTheme.light,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: textScaler ?? const TextScaler.linear(1),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: VtuOrderDetailView(
            order: order,
            isChecking: isChecking,
            onCheckStatus: onCheck ?? () {},
            onSupport: onSupport,
          ),
        ),
      ),
    ),
  );
  if (isChecking) {
    await tester.pump();
  } else {
    await tester.pumpAndSettle();
  }
}

VtuOrderStatus _order({
  required String orderStatus,
  required String transactionStatus,
}) {
  return VtuOrderStatus(
    orderId: 'Order-123',
    reference: 'VTU-EXAMPLE-REFERENCE',
    orderStatus: orderStatus,
    transactionStatus: transactionStatus,
    provider: 'VTPASS',
    amount: '500.00',
    currency: 'NGN',
    targetMasked: '+234 *** 23',
    nextRequeryAt: null,
    purchasedCode: null,
  );
}

class _FakeVtuService extends VtuService {
  final VtuOrderStatus initial;
  final Future<VtuOrderStatus> Function() requery;
  int requeryCalls = 0;
  int readCalls = 0;
  Future<VtuOrderStatus> Function()? readOverride;

  _FakeVtuService({required this.initial, required this.requery})
      : super(apiClient: ApiClient(dio: Dio()));

  @override
  Future<VtuOrderStatus> getOrderStatus(String reference) async {
    readCalls++;
    return readOverride == null ? initial : await readOverride!();
  }

  @override
  Future<VtuOrderStatus> requeryOrder(
    String reference, {
    required String idempotencyKey,
  }) {
    requeryCalls++;
    return requery();
  }
}
