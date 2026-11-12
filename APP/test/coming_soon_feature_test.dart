import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/home_task_screen.dart';

void main() {
  setUp(() => GoogleFonts.config.allowRuntimeFetching = false);
  const features = [
    'airtime-cash',
    'virtual-cards',
    'book-hotels',
    'pay-flights',
    'betting-wallet',
    'gift-cards'
  ];
  for (final slug in features) {
    testWidgets('$slug opens its advert and returns to the hub',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (_, state) => const HomeTaskScreen()),
        GoRoute(
            path: '/coming-soon/:feature',
            builder: (_, state) => ComingSoonFeatureScreen(
                slug: state.pathParameters['feature']!)),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(
          MaterialApp.router(theme: AppTheme.dark, routerConfig: router));
      await tester.pumpAndSettle();
      final card = find.byKey(ValueKey('coming-soon-$slug'));
      await tester.scrollUntilVisible(card, 250,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(card);
      await tester.pumpAndSettle();
      await tester.tap(card);
      await tester.pumpAndSettle();
      expect(find.byType(ComingSoonFeatureScreen), findsOneWidget);
      expect(find.byKey(ValueKey('feature-advert-$slug')), findsOneWidget);
      expect(
          tester
              .widget<FilledButton>(
                  find.byKey(const ValueKey('coming-soon-cta')))
              .onPressed,
          isNull);
      await tester.tap(find.byTooltip('Back').first);
      await tester.pumpAndSettle();
      expect(router.routerDelegate.currentConfiguration.uri.path, '/');
      expect(tester.takeException(), isNull);
    });
  }
  for (final size in [const Size(320, 640), const Size(1024, 768)]) {
    testWidgets('advert fits $size with large text and safe areas',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(MaterialApp(
          theme: AppTheme.light,
          builder: (_, child) => MediaQuery(
              data: MediaQueryData(
                  size: size,
                  padding: const EdgeInsets.only(top: 44, bottom: 24),
                  textScaler: const TextScaler.linear(1.8)),
              child: child!),
          home: const ComingSoonFeatureScreen(slug: 'virtual-cards')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey('coming-soon-cta')));
      await tester.pumpAndSettle();
      expect(find.text('Coming soon'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('unknown feature has a safe unavailable state', (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.dark,
        home: const ComingSoonFeatureScreen(slug: 'unknown-feature')));
    await tester.pumpAndSettle();
    expect(find.text('Feature unavailable'), findsOneWidget);
    expect(find.byKey(const ValueKey('coming-soon-cta')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
