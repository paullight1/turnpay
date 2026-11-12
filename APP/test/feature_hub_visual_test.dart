import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/home_task_screen.dart';

void main() {
  setUp(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('V1 feature hub hides money-out services from the grid',
      (tester) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const HomeTaskScreen(),
      ),
    );
    await tester.pumpAndSettle();

    for (final slug in [
      'fund-wallet',
      'airtime',
      'data',
      'cable-tv',
      'electricity',
      'wallets',
    ]) {
      final card = find.byKey(
        ValueKey('feature-card-$slug'),
        skipOffstage: false,
      );
      expect(card, findsOneWidget);
      final svg = find.descendant(
        of: card,
        matching: find.byType(SvgPicture, skipOffstage: false),
      );
      expect(svg, findsOneWidget);
      final iconBox = find.byKey(
        ValueKey('feature-icon-box-$slug'),
        skipOffstage: false,
      );
      expect(iconBox, findsOneWidget);
      expect(tester.getSize(iconBox).longestSide, greaterThanOrEqualTo(44));
    }

    expect(
      find.byKey(const ValueKey('feature-card-send-money')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('feature-card-withdraw')),
      findsNothing,
    );

    expect(find.text('Money movement'), findsNothing);
    expect(find.text('Bills & top-ups'), findsNothing);
    expect(find.text('Accounts & wallets'), findsNothing);

    final fund = tester.getRect(
      find.byKey(const ValueKey('feature-card-fund-wallet')),
    );
    final airtime = tester.getRect(
      find.byKey(const ValueKey('feature-card-airtime')),
    );
    final data = tester.getRect(
      find.byKey(const ValueKey('feature-card-data')),
    );
    final cable = tester.getRect(
      find.byKey(const ValueKey('feature-card-cable-tv')),
    );
    final electricity = tester.getRect(
      find.byKey(const ValueKey('feature-card-electricity')),
    );
    expect(find.byKey(const ValueKey('feature-card-paystack-account')),
        findsNothing);
    final wallets = tester.getRect(
      find.byKey(const ValueKey('feature-card-wallets')),
    );
    expect(fund.width, inInclusiveRange(100, 125));
    expect(airtime.top, fund.top);
    expect(data.top, fund.top);
    expect(airtime.left, greaterThan(fund.right));
    expect(data.left, greaterThan(airtime.right));
    expect(cable.top, greaterThan(fund.bottom));
    expect(electricity.top, cable.top);
    expect(wallets.top, cable.top);
    expect(find.text('More'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('feature hub remains usable with large text on a small phone',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(1.6),
          ),
          child: child!,
        ),
        home: const HomeTaskScreen(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('More'), findsNothing);
    expect(find.text('Wallets'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('coming soon uses compact full-width vertical cards',
      (tester) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const HomeTaskScreen(),
      ),
    );
    await tester.pumpAndSettle();

    final first = find.byKey(
      const ValueKey('coming-soon-airtime-cash'),
      skipOffstage: false,
    );
    final second = find.byKey(
      const ValueKey('coming-soon-virtual-cards'),
      skipOffstage: false,
    );
    await tester.scrollUntilVisible(
      first,
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    final firstRect = tester.getRect(first);
    final secondRect = tester.getRect(second);
    expect(firstRect.width, greaterThan(350));
    expect(firstRect.height, lessThanOrEqualTo(128));
    expect(secondRect.top, greaterThan(firstRect.bottom));

    for (final slug in ['airtime-cash', 'virtual-cards']) {
      final card = find.byKey(
        ValueKey('coming-soon-$slug'),
        skipOffstage: false,
      );
      expect(
        find.descendant(
          of: card,
          matching: find.byType(SvgPicture, skipOffstage: false),
        ),
        findsNothing,
      );
      final artwork = tester.widget<Image>(
        find.byKey(
          ValueKey('coming-soon-artwork-$slug'),
          skipOffstage: false,
        ),
      );
      expect(artwork.color, isNotNull);
      expect(artwork.colorBlendMode, BlendMode.screen);
    }
    expect(tester.takeException(), isNull);
  });
}
