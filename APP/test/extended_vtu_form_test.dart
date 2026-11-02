import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/extended_vtu_form.dart';

void main() {
  for (final service in [
    'glo-sme',
    '9mobile-sme',
    'showmax',
    'smile',
    'smile-airtime',
    'foreign-airtime'
  ]) {
    testWidgets(
        '$service reviews a server quote and returns a bounded purchase for PIN approval',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      final dio = Dio();
      dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final dynamic data;
        if (options.path.endsWith('/quote')) {
          data = {
            'amount': '1000.00',
            'fee': '25.00',
            'totalDebit': '1025.00',
            'currency': 'NGN'
          };
        } else if (options.path.endsWith('/countries')) {
          data = [
            {'code': 'GH', 'name': 'Ghana', 'prefix': '233', 'currency': 'GHS'}
          ];
        } else if (options.path.endsWith('/operators')) {
          data = [
            {'id': '5', 'name': 'Ghana MTN'}
          ];
        } else if (options.path.endsWith('/validate/smile')) {
          data = {
            'name': 'Smile Customer',
            'accounts': [
              {'id': '1111111111', 'name': 'Home'}
            ]
          };
        } else {
          data = [
            {'id': 'plan-1', 'name': 'Test plan', 'price': '1000.00'}
          ];
        }
        handler.resolve(Response(requestOptions: options, data: data));
      }));
      Map<String, dynamic>? payload;
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
              body: SingleChildScrollView(
                  child: ExtendedVtuForm(
                      client: dio,
                      provider: service,
                      type: service == 'showmax'
                          ? 'cable'
                          : ['smile-airtime', 'foreign-airtime']
                                  .contains(service)
                              ? 'airtime'
                              : 'data',
                      disabled: false,
                      onReady: (data, review) async {
                        payload = data;
                      })))));
      await tester.pumpAndSettle();
      if (service == 'foreign-airtime') {
        await tester.tap(find.byTooltip('Service country').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Ghana').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Operator').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Ghana MTN').last);
        await tester.pumpAndSettle();
      }
      if (service.startsWith('smile')) {
        await tester.enterText(
            find.byType(TextField).at(0), 'smile@example.com');
        await tester.tap(find.text('Verify Smile email'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Smile account').last);
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('Home').last);
        await tester.pumpAndSettle();
      } else {
        await tester.enterText(find.byType(TextField).at(0),
            service == 'foreign-airtime' ? '+233241234567' : '08031234567');
      }
      await tester.enterText(find.byType(TextField).at(1), '08031234567');
      await tester.ensureVisible(find.text('Test plan'));
      await tester.tap(find.text('Test plan'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Review purchase'));
      await tester.tap(find.text('Review purchase'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Total from NGN wallet: 1025.00'),
          findsOneWidget);
      await tester.ensureVisible(find.text('Continue to payment approval'));
      await tester.tap(find.text('Continue to payment approval'));
      await tester.pumpAndSettle();
      expect(payload, containsPair('expectedTotal', '1025.00'));
      if (service.startsWith('smile')) {
        expect(payload, containsPair('smileAccountId', '1111111111'));
      } else {
        expect(
            payload,
            containsPair(
                'recipientNumber',
                service == 'foreign-airtime'
                    ? '+233241234567'
                    : '+2348031234567'));
      }
      expect(payload, containsPair('packageId', 'plan-1'));
      expect(payload!.containsKey('smartCardNumber'), isFalse);
    });
  }
}
