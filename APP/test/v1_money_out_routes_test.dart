import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/router/app_router.dart';

void main() {
  for (final path in [
    AppRoutes.send,
    AppRoutes.sendTrustpay,
    AppRoutes.sendBank,
    AppRoutes.withdraw,
    '/withdraw/authorize/WD-1',
  ]) {
    test('V1 redirects active money-out route $path to Home', () {
      expect(v1MoneyOutRedirectFor(path), AppRoutes.home);
    });
  }

  test('V1 keeps historical money-out receipts routable', () {
    expect(v1MoneyOutRedirectFor('/send/receipt/IT-1'), isNull);
    expect(v1MoneyOutRedirectFor('/withdraw/receipt/WD-1'), isNull);
    expect(v1MoneyOutRedirectFor(AppRoutes.withdrawSuccess), isNull);
  });
}
