import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/widgets/micro_interactions.dart';
import 'package:trustpay_app/core/widgets/tp_auth_background.dart';
import 'package:trustpay_app/core/widgets/tp_snackbar.dart';
import 'package:trustpay_app/core/widgets/trustpay_lottie.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('tp auth background renders its child', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: TpAuthBackground(
            showGradient: false,
            child: Text('Auth backdrop'),
          ),
        ),
      ),
    );

    expect(find.text('Auth backdrop'), findsOneWidget);
  });

  testWidgets('trustpay lottie loading variant renders fallback icon',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: TrustPayLottie(
            variant: TrustPayAnimationVariant.loading,
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.sync_rounded), findsOneWidget);
  });

  testWidgets('trustpay lottie respects reduced motion fallback',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: TrustPayLottie(
              variant: TrustPayAnimationVariant.send,
              semanticsLabel: 'Sending transfer',
            ),
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.near_me_rounded), findsOneWidget);
  });

  testWidgets('trustpay animated state renders status copy', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: TrustPayAnimatedState(
              variant: TrustPayAnimationVariant.success,
              title: 'Receipt ready',
              detail: 'Your transfer is complete.',
              action: Text('View receipt'),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Receipt ready'), findsOneWidget);
    expect(find.text('Your transfer is complete.'), findsOneWidget);
    expect(find.text('View receipt'), findsOneWidget);
  });

  testWidgets('tap scale triggers the supplied callback', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TapScale(
            haptic: false,
            onTap: () => tapped = true,
            child: const Text('Tap me'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Tap me'));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('staggered entrance transitions to visible', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: StaggeredEntrance(
            delay: Duration(milliseconds: 100),
            child: Text('Appears'),
          ),
        ),
      ),
    );

    final initialOpacity =
        tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity));
    expect(initialOpacity.opacity, 0);

    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();

    final finalOpacity =
        tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity));
    expect(finalOpacity.opacity, 1);
    expect(find.text('Appears'), findsOneWidget);
  });

  testWidgets('animated value text updates when the value changes',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AnimatedValueText(value: 'One'),
        ),
      ),
    );

    expect(find.text('One'), findsOneWidget);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AnimatedValueText(value: 'Two'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Two'), findsOneWidget);
  });

  testWidgets('shimmer block renders a loading placeholder', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ShimmerBlock(width: 120, height: 24),
        ),
      ),
    );

    expect(find.byType(ShimmerBlock), findsOneWidget);
  });

  testWidgets('showTpSnackbar displays the requested feedback', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () => showTpSnackbar(
                  context,
                  'Saved',
                  type: TpSnackbarType.success,
                ),
                child: const Text('Show snackbar'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Show snackbar'));
    await tester.pump();

    expect(find.text('Saved'), findsOneWidget);
  });
}
