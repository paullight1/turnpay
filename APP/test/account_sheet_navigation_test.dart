import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/auth/auth_state.dart';
import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/widgets/main_shell.dart';
import 'support/trustpay_test_api.dart';

void main() {
  for (final path in ['/fund', '/virtual-account', '/receive-money']) {
    testWidgets('cold $path sheet dismisses back to a real home page',
        (tester) async {
      GoogleFonts.config.allowRuntimeFetching = false;
      setMockSecureStorage();
      authStateNotifier.reset();
      final container = ProviderContainer();
      final router = container.read(appRouterProvider);
      router.go(path);
      await tester.pumpWidget(UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router)));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(find.byType(MainShell, skipOffstage: false), findsOneWidget);
      await tester.tap(find.byTooltip('Close account details'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(router.routeInformationProvider.value.uri.path, '/home');
      expect(find.byType(MainShell), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      container.dispose();
      authStateNotifier.reset();
    });
  }
}
