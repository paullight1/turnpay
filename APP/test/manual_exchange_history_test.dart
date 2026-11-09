import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'package:trustpay_app/features/exchange/widgets/manual_exchange_history.dart';
import 'package:trustpay_app/features/exchange/widgets/review_reminder_button.dart';
import 'manual_exchange_v1_ux_test.dart' show fixtureV1Order;

void main() {
  setUp(() => GoogleFonts.config.allowRuntimeFetching = false);
  setUpAll(() async {
    if (!const bool.fromEnvironment('HISTORY_CAPTURE')) return;
    final font = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await font.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await font.readAsBytes()))))
          .load();
    }
  });
  testWidgets('history is visible even before a customer has an exchange',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
            body: ManualExchangeHistory(
                orders: Future.value([]),
                service: _Reminders(),
                onRetry: () {}))));
    await tester.pumpAndSettle();
    expect(find.text('Exchange history'), findsOneWidget);
    expect(find.text('No exchanges yet'), findsOneWidget);
    expect(find.textContaining('start another exchange'), findsOneWidget);
  });
  testWidgets(
      'pending history remains openable and reminder is sent only once while busy',
      (tester) async {
    final service = _Reminders();
    final pending = fixtureV1Order(
        status: 'AWAITING_CONFIRMATION',
        hasProof: true,
        remindersEnabled: true);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
            body: SingleChildScrollView(
                child: ManualExchangeHistory(
                    orders: Future.value([pending]),
                    service: service,
                    onRetry: () {})))));
    await tester.pumpAndSettle();
    expect(find.text('View review status'), findsOneWidget);
    await tester.ensureVisible(find.text('Remind admin'));
    await tester.tap(find.text('Remind admin'));
    await tester.pump();
    expect(service.calls, 1);
    expect(find.text('Sending reminder…'), findsOneWidget);
    service.result.complete(ManualExchangeReminder(
        requestedAt: DateTime.now().toUtc(),
        nextAllowedAt:
            DateTime.now().toUtc().add(const Duration(minutes: 10))));
    await tester.pumpAndSettle();
    expect(find.textContaining('Reminder sent'), findsOneWidget);
    expect(service.calls, 1);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('an older backend never offers a nonfunctional reminder',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
            body: ReviewReminderButton(
                order: fixtureV1Order(
                    status: 'AWAITING_CONFIRMATION', hasProof: true),
                service: _Reminders()))));
    await tester.pumpAndSettle();
    expect(find.text('Remind admin'), findsNothing);
  });

  testWidgets(
      'a rejected reminder keeps payment state and never claims success',
      (tester) async {
    final service = _Reminders();
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
            body: ReviewReminderButton(
                order: fixtureV1Order(
                    status: 'AWAITING_CONFIRMATION',
                    hasProof: true,
                    remindersEnabled: true),
                service: service))));
    await tester.tap(find.text('Remind admin'));
    await tester.pump();
    service.result.completeError(DioException(
        requestOptions: RequestOptions(),
        response: Response(requestOptions: RequestOptions(), statusCode: 404)));
    await tester.pumpAndSettle();
    expect(find.textContaining('not available yet'), findsOneWidget);
    expect(find.textContaining('Reminder sent.'), findsNothing);
    final button = tester.widget<OutlinedButton>(find.byType(OutlinedButton));
    expect(button.onPressed, isNull);
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
  ]) {
    testWidgets('pending and completed history fit ${variant.name}',
        (tester) async {
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: variant.dark ? AppTheme.dark : AppTheme.light,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(variant.scale)),
                child: child!),
            home: Scaffold(
                body: SafeArea(
                    child: SingleChildScrollView(
                        padding: const EdgeInsets.all(20),
                        child: ManualExchangeHistory(
                            orders: Future.value([
                              fixtureV1Order(
                                  status: 'AWAITING_CONFIRMATION',
                                  hasProof: true,
                                  remindersEnabled: true),
                              fixtureV1Order(
                                  id: 'completed-order',
                                  status: 'COMPLETED',
                                  hasProof: true),
                            ]),
                            service: _Reminders(),
                            onRetry: () {})))),
          )));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('View review status'), findsOneWidget);
      if (const bool.fromEnvironment('HISTORY_CAPTURE')) {
        await tester.runAsync(() async {
          final image = await (key.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 2);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file =
              File('../output/exchange-history-ui/history-${variant.name}.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.scrollUntilVisible(find.text('View details'), 200);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
          tester
              .getSize(find.ancestor(
                  of: find.text('View details'),
                  matching: find.byType(OutlinedButton)))
              .height,
          greaterThanOrEqualTo(56));
      await tester.pumpWidget(const SizedBox());
    });
  }
}

class _Reminders extends ManualExchangeService {
  int calls = 0;
  final result = Completer<ManualExchangeReminder>();
  @override
  Future<ManualExchangeReminder> requestReviewReminder(String id) {
    calls++;
    return result.future;
  }
}
