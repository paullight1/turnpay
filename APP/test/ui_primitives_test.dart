import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

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
}
